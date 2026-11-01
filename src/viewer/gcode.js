// Parser G-code -> oggetto Three.js (percorsi di estrusione a strati).
// Coordinate nel sistema della stampante (Z verso l'alto, mm). THREE viene passato come parametro.
//
// buildGcodeObject(text, THREE, opts?) -> {
//   object: THREE.Group (figli: 'extrusions' LineSegments, 'travels' LineSegments nascosto),
//   layers: [{z, index}], bounds: THREE.Box3,
//   setLayerRange(min, max), setShowTravels(bool),
//   stats: {moves, layers, extrusionSegments, travelSegments, colorMode: 'type'|'height', types: [nome]}
// }

const TYPE_COLORS = [
  // [regex, rgb]
  [/outer|external|wall-outer|perimeter.*ext/, [255, 140, 0]],
  [/overhang/, [70, 110, 255]],
  [/bridge/, [80, 160, 255]],
  [/inner|wall-inner|^perimeter|^wall|internal perimeter/, [255, 210, 40]],
  [/top|ironing/, [230, 60, 90]],
  [/bottom/, [170, 60, 200]],
  [/solid/, [200, 40, 160]],
  [/sparse|infill|fill/, [200, 50, 40]],
  [/support.*interface|interface/, [60, 200, 120]],
  [/support/, [40, 170, 70]],
  [/skirt|brim/, [30, 200, 200]],
  [/gap/, [240, 240, 240]],
  [/prime|wipe|tower/, [150, 150, 150]],
  [/skin/, [200, 40, 160]],
];
const DEFAULT_RGB = [160, 160, 170];
const TRAVEL_RGB = [90, 120, 200];

function colorForType(name) {
  const n = name.toLowerCase().trim();
  for (const [re, c] of TYPE_COLORS) if (re.test(n)) return c;
  return DEFAULT_RGB;
}

class SegBuf {
  constructor(cap) { this.pos = new Float32Array(cap * 6); this.col = new Uint8Array(cap * 6); this.n = 0; }
  push(x1, y1, z1, x2, y2, z2, r, g, b) {
    if ((this.n + 1) * 6 > this.pos.length) {
      const np = new Float32Array(this.pos.length * 2); np.set(this.pos); this.pos = np;
      const nc = new Uint8Array(this.col.length * 2); nc.set(this.col); this.col = nc;
    }
    const o = this.n * 6; const p = this.pos, c = this.col;
    p[o] = x1; p[o + 1] = y1; p[o + 2] = z1; p[o + 3] = x2; p[o + 4] = y2; p[o + 5] = z2;
    c[o] = r; c[o + 1] = g; c[o + 2] = b; c[o + 3] = r; c[o + 4] = g; c[o + 5] = b;
    this.n++;
  }
}

export function buildGcodeObject(text, THREE, opts = {}) {
  const estCap = Math.max(1024, Math.min(8e6, (text.length / 30) | 0));
  const ext = new SegBuf(estCap);
  const trv = new SegBuf(Math.max(1024, estCap >> 2));
  const keepTravels = opts.travels !== false;

  let x = 0, y = 0, z = 0, e = 0;
  let relXYZ = false, relE = false, scale = 1;
  let cur = DEFAULT_RGB; let typesSeen = new Set();
  let moves = 0;
  let markersSeen = false, pendingLayer = true, layerZ = -Infinity;
  const layers = []; const layerStart = []; const travelStart = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  // parametri riga corrente
  let pX, pY, pZ, pE, pI, pJ, pR, hX, hY, hZ, hE, hI, hJ, hR;

  const len = text.length;
  let i = 0;
  // lettura numero veloce a partire da `j`; restituisce valore, aggiorna `numEnd`
  let numEnd = 0;
  function readNum(j) {
    let sign = 1, v = 0, c = text.charCodeAt(j);
    while (c === 32) c = text.charCodeAt(++j);
    if (c === 45) { sign = -1; c = text.charCodeAt(++j); } else if (c === 43) c = text.charCodeAt(++j);
    let any = false;
    while (c >= 48 && c <= 57) { v = v * 10 + (c - 48); c = text.charCodeAt(++j); any = true; }
    if (c === 46) {
      let f = 0.1; c = text.charCodeAt(++j);
      while (c >= 48 && c <= 57) { v += (c - 48) * f; f *= 0.1; c = text.charCodeAt(++j); any = true; }
    }
    if (c === 101 || c === 69) { // esponente
      let k = j + 1, es = 1, ev = 0, cc = text.charCodeAt(k);
      if (cc === 45) { es = -1; cc = text.charCodeAt(++k); } else if (cc === 43) cc = text.charCodeAt(++k);
      if (cc >= 48 && cc <= 57) { while (cc >= 48 && cc <= 57) { ev = ev * 10 + (cc - 48); cc = text.charCodeAt(++k); } v *= Math.pow(10, es * ev); j = k; }
    }
    numEnd = j;
    return any ? sign * v : NaN;
  }

  function startLayerIfNeeded(zz) {
    if (pendingLayer || (!markersSeen && zz > layerZ + 0.009)) {
      if (layers.length === 0 || zz !== layerZ || pendingLayer) {
        layers.push({ z: zz, index: layers.length });
        layerStart.push(ext.n); travelStart.push(trv.n);
        layerZ = zz;
      }
      pendingLayer = false;
    }
  }

  function segment(x1, y1, z1, x2, y2, z2, extruding) {
    if (extruding) {
      startLayerIfNeeded(z2);
      ext.push(x1, y1, z1, x2, y2, z2, cur[0], cur[1], cur[2]);
      if (x2 < minX) minX = x2; if (x2 > maxX) maxX = x2; if (y2 < minY) minY = y2; if (y2 > maxY) maxY = y2; if (z2 < minZ) minZ = z2; if (z2 > maxZ) maxZ = z2;
      if (x1 < minX) minX = x1; if (x1 > maxX) maxX = x1; if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1;
    } else if (keepTravels && layers.length) {
      trv.push(x1, y1, z1, x2, y2, z2, TRAVEL_RGB[0], TRAVEL_RGB[1], TRAVEL_RGB[2]);
    }
  }

  while (i < len) {
    let eol = text.indexOf('\n', i); if (eol < 0) eol = len;
    let j = i; let c = text.charCodeAt(j);
    while (c === 32 || c === 9) c = text.charCodeAt(++j);
    if (c === 59) { // commento
      const k = j + 1;
      const c1 = text.charCodeAt(k);
      if (c1 === 84 && text.startsWith('TYPE:', k)) { const t = text.slice(k + 5, eol).trim(); cur = colorForType(t); typesSeen.add(t); }
      else if (c1 === 32 && text.startsWith(' FEATURE:', k)) { const t = text.slice(k + 9, eol).trim(); cur = colorForType(t); typesSeen.add(t); }
      else if (c1 === 76 && (text.startsWith('LAYER_CHANGE', k) || text.startsWith('LAYER:', k))) { markersSeen = true; pendingLayer = true; }
      else if (c1 === 32 && text.startsWith(' CHANGE_LAYER', k)) { markersSeen = true; pendingLayer = true; }
      i = eol + 1; continue;
    }
    if (c === 78 || c === 110) { // numero di riga N123
      readNum(j + 1); j = numEnd; c = text.charCodeAt(j);
      while (c === 32 || c === 9) c = text.charCodeAt(++j);
    }
    if (c === 71 || c === 103 || c === 77 || c === 109) { // G / M
      const letter = c | 32;
      const code = readNum(j + 1); j = numEnd;
      if (letter === 103 && (code === 0 || code === 1 || code === 2 || code === 3 || code === 92)) {
        hX = hY = hZ = hE = hI = hJ = hR = false;
        while (j < eol) {
          c = text.charCodeAt(j);
          if (c === 59) break;
          const L = c | 32;
          if (L >= 97 && L <= 122) {
            const v = readNum(j + 1); j = numEnd;
            if (v !== v) continue;
            switch (L) {
              case 120: pX = v; hX = true; break; case 121: pY = v; hY = true; break; case 122: pZ = v; hZ = true; break;
              case 101: pE = v; hE = true; break; case 105: pI = v; hI = true; break; case 106: pJ = v; hJ = true; break; case 114: pR = v; hR = true; break;
              default: break;
            }
          } else j++;
        }
        if (code === 92) {
          if (hX) x = pX * scale; if (hY) y = pY * scale; if (hZ) z = pZ * scale; if (hE) e = pE;
          i = eol + 1; continue;
        }
        moves++;
        const nx = hX ? (relXYZ ? x + pX * scale : pX * scale) : x;
        const ny = hY ? (relXYZ ? y + pY * scale : pY * scale) : y;
        const nz = hZ ? (relXYZ ? z + pZ * scale : pZ * scale) : z;
        let de = 0;
        if (hE) { if (relE) { de = pE; } else { de = pE - e; e = pE; } }
        const extruding = de > 1e-7 && code !== 0;
        if (code === 2 || code === 3) {
          let cx, cy;
          if (hI || hJ) { cx = x + (hI ? pI * scale : 0); cy = y + (hJ ? pJ * scale : 0); }
          else if (hR) {
            const r = pR * scale; const dx = nx - x, dy = ny - y; const d = Math.hypot(dx, dy);
            if (d < 1e-9) { x = nx; y = ny; z = nz; i = eol + 1; continue; }
            let h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
            const sgn = ((code === 2) !== (r < 0)) ? -1 : 1;
            cx = x + dx / 2 - sgn * h * dy / d; cy = y + dy / 2 + sgn * h * dx / d;
          } else { cx = x; cy = y; }
          const r = Math.hypot(x - cx, y - cy);
          let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx);
          let da = a1 - a0;
          if (code === 2) { if (da >= -1e-9) da -= Math.PI * 2; } else { if (da <= 1e-9) da += Math.PI * 2; }
          const n = Math.max(1, Math.min(128, Math.ceil(Math.max(Math.abs(da) / (Math.PI / 18), Math.abs(da) * r / 1))));
          let px = x, py = y, pz = z;
          for (let s = 1; s <= n; s++) {
            const t = s / n; const a = a0 + da * t;
            const qx = s === n ? nx : cx + r * Math.cos(a), qy = s === n ? ny : cy + r * Math.sin(a), qz = z + (nz - z) * t;
            segment(px, py, pz, qx, qy, qz, extruding);
            px = qx; py = qy; pz = qz;
          }
        } else if (nx !== x || ny !== y || (nz !== z && extruding)) {
          segment(x, y, z, nx, ny, nz, extruding);
        }
        x = nx; y = ny; z = nz;
      } else if (letter === 103) {
        if (code === 90) { relXYZ = false; relE = false; }
        else if (code === 91) { relXYZ = true; relE = true; }
        else if (code === 20) scale = 25.4;
        else if (code === 21) scale = 1;
      } else if (letter === 109) {
        if (code === 82) relE = false; else if (code === 83) relE = true;
      }
    }
    i = eol + 1;
  }

  // colore per altezza se non ci sono tipi
  let colorMode = 'type';
  if (typesSeen.size === 0 && ext.n) {
    colorMode = 'height';
    const p = ext.pos, col = ext.col; const span = Math.max(1e-6, maxZ - minZ);
    for (let s = 0; s < ext.n; s++) {
      for (let v = 0; v < 2; v++) {
        const o = s * 6 + v * 3; const t = (p[o + 2] - minZ) / span;
        const [r, g, b] = heat(t); col[o] = r; col[o + 1] = g; col[o + 2] = b;
      }
    }
  }

  const group = new THREE.Group(); group.name = 'gcode'; group.userData.zUp = true;
  const mk = (buf, name, visible) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(buf.pos.subarray(0, buf.n * 6), 3));
    g.setAttribute('color', new THREE.BufferAttribute(buf.col.subarray(0, buf.n * 6), 3, true));
    const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: name === 'travels', opacity: name === 'travels' ? 0.35 : 1 }));
    ls.name = name; ls.visible = visible; ls.frustumCulled = false;
    group.add(ls); return ls;
  };
  const extObj = mk(ext, 'extrusions', true);
  const trvObj = mk(trv, 'travels', false);

  const bounds = ext.n ? new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)) : new THREE.Box3();
  if (ext.n) extObj.geometry.boundingBox = bounds.clone();

  function setLayerRange(min, max) {
    const L = layers.length; if (!L) return;
    min = Math.max(0, Math.min(L - 1, min | 0)); max = Math.max(min, Math.min(L - 1, max | 0));
    const s = layerStart[min], en = max + 1 < L ? layerStart[max + 1] : ext.n;
    extObj.geometry.setDrawRange(s * 2, (en - s) * 2);
    const ts = travelStart[min], te = max + 1 < L ? travelStart[max + 1] : trv.n;
    trvObj.geometry.setDrawRange(ts * 2, (te - ts) * 2);
  }
  function setShowTravels(v) { trvObj.visible = !!v; }

  return {
    object: group, layers, bounds, setLayerRange, setShowTravels,
    stats: { moves, layers: layers.length, extrusionSegments: ext.n, travelSegments: trv.n, colorMode, types: [...typesSeen] },
  };
}

function heat(t) {
  // blu -> ciano -> verde -> giallo -> rosso
  t = Math.max(0, Math.min(1, t));
  const stops = [[40, 90, 255], [0, 200, 230], [60, 210, 80], [250, 210, 40], [240, 60, 40]];
  const f = t * (stops.length - 1); const k = Math.min(stops.length - 2, Math.floor(f)); const u = f - k;
  const a = stops[k], b = stops[k + 1];
  return [a[0] + (b[0] - a[0]) * u | 0, a[1] + (b[1] - a[1]) * u | 0, a[2] + (b[2] - a[2]) * u | 0];
}
