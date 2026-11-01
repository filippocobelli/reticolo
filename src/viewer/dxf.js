// DXF -> linee 2D Three.js sul piano XY. THREE viene passato come parametro.
// buildDxfObject(text, THREE) -> { object: THREE.Group, bounds: THREE.Box3, stats: {entities, segments, skipped} }
import * as DxfNS from 'dxf-parser';

const DxfParser = DxfNS.DxfParser || (DxfNS.default && (DxfNS.default.DxfParser || DxfNS.default)) || DxfNS;
const MAX_DEPTH = 8;
const WHITE = 0xffffff;

// matrice affine 2D [a, b, c, d, e, f]: x' = a*x + c*y + e ; y' = b*x + d*y + f
const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const tr = (x, y) => [1, 0, 0, 1, x, y];
const rot = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
const scl = (x, y) => [x, 0, 0, y, 0, 0];

export function buildDxfObject(text, THREE) {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  const layers = (dxf && dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) || {};
  const blocks = (dxf && dxf.blocks) || {};

  let pos = new Float32Array(4096 * 6), col = new Float32Array(4096 * 6), n = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let entities = 0, skipped = 0;

  function push(x1, y1, x2, y2, rgb) {
    if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return;
    if ((n + 1) * 6 > pos.length) {
      const np = new Float32Array(pos.length * 2); np.set(pos); pos = np;
      const nc = new Float32Array(col.length * 2); nc.set(col); col = nc;
    }
    const o = n * 6;
    pos[o] = x1; pos[o + 1] = y1; pos[o + 2] = 0; pos[o + 3] = x2; pos[o + 4] = y2; pos[o + 5] = 0;
    const r = ((rgb >> 16) & 255) / 255, g = ((rgb >> 8) & 255) / 255, b = (rgb & 255) / 255;
    col[o] = r; col[o + 1] = g; col[o + 2] = b; col[o + 3] = r; col[o + 4] = g; col[o + 5] = b;
    n++;
    if (x1 < minX) minX = x1; if (x2 < minX) minX = x2; if (y1 < minY) minY = y1; if (y2 < minY) minY = y2;
    if (x1 > maxX) maxX = x1; if (x2 > maxX) maxX = x2; if (y1 > maxY) maxY = y1; if (y2 > maxY) maxY = y2;
  }

  // polilinea in coordinate locali -> segmenti trasformati
  function poly(pts, m, rgb, closed = false) {
    if (pts.length < 2) return;
    let [px, py] = apply(m, pts[0]);
    const fx = px, fy = py;
    for (let k = 1; k < pts.length; k++) { const [qx, qy] = apply(m, pts[k]); push(px, py, qx, qy, rgb); px = qx; py = qy; }
    if (closed) push(px, py, fx, fy, rgb);
  }
  const apply = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

  function colorOf(ent, parentColor) {
    const ci = ent.colorIndex;
    if (ci === 0) return parentColor != null ? parentColor : WHITE; // BYBLOCK
    if (ci !== 256 && ent.color != null && ci !== undefined) return fixColor(ent.color);
    if (ci === undefined && ent.color != null) return fixColor(ent.color); // true color (420)
    const l = layers[ent.layer];
    if (l && l.color != null) return fixColor(l.color);
    return parentColor != null ? parentColor : WHITE;
  }
  // il nero (ACI 7 su sfondo scuro, o colori molto scuri) diventa chiaro
  const fixColor = (c) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return r + g + b < 60 ? WHITE : c; };

  function arcPts(cx, cy, r, a0, a1, segPerTurn = 72) {
    while (a1 < a0) a1 += Math.PI * 2;
    const steps = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * segPerTurn));
    const pts = [];
    for (let k = 0; k <= steps; k++) { const a = a0 + (a1 - a0) * (k / steps); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }

  function bulgePts(p1, p2, bulge) {
    const theta = 4 * Math.atan(bulge);
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1]; const chord = Math.hypot(dx, dy);
    if (chord < 1e-12 || Math.abs(theta) < 1e-9) return [p1, p2];
    const r = chord / (2 * Math.sin(theta / 2));
    const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
    const h = r * Math.cos(theta / 2); // distanza firmata centro-corda
    const cx = mx - (h * dy) / chord, cy = my + (h * dx) / chord;
    const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
    const steps = Math.max(2, Math.ceil((Math.abs(theta) / (Math.PI * 2)) * 72));
    const pts = [];
    for (let k = 0; k <= steps; k++) { const a = a0 + theta * (k / steps); pts.push([cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)]); }
    pts[0] = p1; pts[pts.length - 1] = p2;
    return pts;
  }

  function splinePts(ent) {
    const cps = (ent.controlPoints || []).map(p => [p.x, p.y]);
    const p = ent.degreeOfSplineCurve || 3;
    const knots = ent.knotValues || [];
    if (cps.length >= 2 && knots.length === cps.length + p + 1) {
      const lo = knots[p], hi = knots[cps.length];
      const N = Math.max(32, cps.length * 10);
      const pts = [];
      for (let s = 0; s <= N; s++) pts.push(deBoor(lo + (hi - lo) * (s / N), p, knots, cps));
      return pts;
    }
    if (ent.fitPoints && ent.fitPoints.length >= 2) return ent.fitPoints.map(q => [q.x, q.y]);
    return cps;
  }
  function deBoor(t, p, U, P) {
    const n = P.length - 1;
    let k = p;
    if (t >= U[n + 1]) k = n; else { while (k < n && !(t >= U[k] && t < U[k + 1])) k++; }
    const d = [];
    for (let j = 0; j <= p; j++) d.push(P[Math.min(n, Math.max(0, j + k - p))].slice());
    for (let r = 1; r <= p; r++) {
      for (let j = p; j >= r; j--) {
        const i = j + k - p; const den = U[i + p - r + 1] - U[i];
        const a = den === 0 ? 0 : (t - U[i]) / den;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
      }
    }
    return d[p];
  }

  function draw(list, m, parentColor, depth) {
    for (const ent of list || []) {
      if (!ent || ent.inPaperSpace || ent.visible === false) continue;
      const l = layers[ent.layer]; if (l && (l.visible === false || l.frozen)) continue;
      entities++;
      const rgb = colorOf(ent, parentColor);
      // sistema di coordinate dell'oggetto specchiato (estrusione -Z)
      const ez = ent.extrusionDirectionZ != null ? ent.extrusionDirectionZ : (ent.extrusionDirection && ent.extrusionDirection.z);
      const em = ez != null && ez < 0 ? mul(m, scl(-1, 1)) : m;
      try {
        switch (ent.type) {
          case 'LINE': if (ent.vertices && ent.vertices.length >= 2) poly(ent.vertices.slice(0, 2).map(v => [v.x, v.y]), m, rgb); break;
          case 'LWPOLYLINE':
          case 'POLYLINE': {
            const vs = (ent.vertices || []).filter(v => v && v.x != null && !v.splineControlPoint);
            if (vs.length < 2) break;
            const closed = !!ent.shape;
            const pts = [];
            const cnt = closed ? vs.length : vs.length - 1;
            for (let k = 0; k < cnt; k++) {
              const a = vs[k], b = vs[(k + 1) % vs.length];
              const seg = a.bulge ? bulgePts([a.x, a.y], [b.x, b.y], a.bulge) : [[a.x, a.y], [b.x, b.y]];
              if (pts.length) seg.shift();
              pts.push(...seg);
            }
            poly(pts, ent.type === 'LWPOLYLINE' ? em : m, rgb);
            break;
          }
          case 'CIRCLE': poly(arcPts(ent.center.x, ent.center.y, ent.radius, 0, Math.PI * 2), em, rgb); break;
          case 'ARC': poly(arcPts(ent.center.x, ent.center.y, ent.radius, ent.startAngle || 0, ent.endAngle != null ? ent.endAngle : Math.PI * 2), em, rgb); break;
          case 'ELLIPSE': {
            const c = ent.center, M = ent.majorAxisEndPoint, ratio = ent.axisRatio || 1;
            let a0 = ent.startAngle || 0, a1 = ent.endAngle != null ? ent.endAngle : Math.PI * 2;
            while (a1 <= a0) a1 += Math.PI * 2;
            const steps = Math.max(8, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 96));
            const pts = [];
            for (let k = 0; k <= steps; k++) {
              const t = a0 + (a1 - a0) * (k / steps);
              pts.push([c.x + M.x * Math.cos(t) - ratio * M.y * Math.sin(t), c.y + M.y * Math.cos(t) + ratio * M.x * Math.sin(t)]);
            }
            poly(pts, em, rgb);
            break;
          }
          case 'SPLINE': poly(splinePts(ent), m, rgb, !!ent.closed); break;
          case 'SOLID': case '3DFACE': {
            const ps = (ent.points || ent.vertices || []).filter(Boolean).map(v => [v.x, v.y]);
            if (ent.type === 'SOLID' && ps.length === 4) [ps[2], ps[3]] = [ps[3], ps[2]];
            poly(ps, m, rgb, true);
            break;
          }
          case 'TEXT': case 'MTEXT': case 'ATTDEF': {
            const p = ent.startPoint || ent.position; if (!p) break;
            const h = ent.textHeight || ent.height || 2.5;
            const raw = String(ent.text || '').replace(/\\[A-Za-z][^;]*;|[{}]|\\P/g, ' ');
            const w = ent.type === 'MTEXT' && ent.width ? Math.min(ent.width, raw.length * h * 0.6) : raw.length * h * 0.6;
            if (!w) break;
            const rm = mul(m, mul(tr(p.x, p.y), rot(((ent.rotation || 0) * Math.PI) / 180)));
            const yOff = ent.type === 'MTEXT' ? -h : 0;
            poly([[0, yOff], [w, yOff], [w, yOff + h], [0, yOff + h]], rm, rgb, true);
            break;
          }
          case 'INSERT': case 'DIMENSION': {
            const b = blocks[ent.type === 'INSERT' ? ent.name : ent.block];
            if (!b || depth >= MAX_DEPTH) { if (!b) skipped++; break; }
            const base = b.position || { x: 0, y: 0 };
            if (ent.type === 'DIMENSION') { draw(b.entities, mul(m, tr(-0, -0)), rgb, depth + 1); break; }
            const p = ent.position || { x: 0, y: 0 };
            const cols = Math.max(1, ent.columnCount || 1), rows = Math.max(1, ent.rowCount || 1);
            const r = ((ent.rotation || 0) * Math.PI) / 180;
            for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
              const off = apply(rot(r), [ci * (ent.columnSpacing || 0), ri * (ent.rowSpacing || 0)]);
              const bm = mul(em, mul(tr(p.x + off[0], p.y + off[1]), mul(rot(r), mul(scl(ent.xScale || 1, ent.yScale || 1), tr(-base.x, -base.y)))));
              draw(b.entities, bm, rgb, depth + 1);
            }
            break;
          }
          default: skipped++;
        }
      } catch { skipped++; }
    }
  }

  draw(dxf && dxf.entities, I, null, 0);

  const group = new THREE.Group(); group.name = 'dxf'; group.userData.is2D = true;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, n * 6), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col.slice(0, n * 6), 3));
  const ls = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  ls.name = 'dxf-lines'; group.add(ls);
  const bounds = n ? new THREE.Box3(new THREE.Vector3(minX, minY, 0), new THREE.Vector3(maxX, maxY, 0)) : new THREE.Box3();
  return { object: group, bounds, stats: { entities, segments: n, skipped } };
}
