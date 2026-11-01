// Costruzione geometrie dei generatori (targhetta e vaso). Coordinate in mm, Z verso l'alto.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function roundedRect(w, h, r, cx = 0, cy = 0, asPath = false) {
  r = Math.max(0, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  const s = asPath ? new THREE.Path() : new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  if (r) s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  if (r) s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  if (r) s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  if (r) s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function circlePath(cx, cy, r) {
  const p = new THREE.Path();
  p.absarc(cx, cy, r, 0, Math.PI * 2, true);
  return p;
}
function extrude(shapes, depth, z = 0) {
  if (!shapes.length || depth <= 0) return null;
  const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, z);
  return g.index ? g.toNonIndexed() : g;
}
function merge(list) {
  const gs = list.filter(Boolean).map(g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; });
  if (!gs.length) return null;
  return mergeGeometries(gs, false);
}
function shapeToPath(shape) {
  return new THREE.Path(shape.getPoints());
}

/**
 * Targhetta.
 * @param p parametri, @param lines [{shapes,width,minX,minY,maxY}] gia' calcolati con textShapes
 * @returns {{base: THREE.BufferGeometry, text: THREE.BufferGeometry|null, width:number, height:number, warnings:string[]}}
 */
export function buildNameplate(p, lines) {
  const warnings = [];
  const used = lines.filter(l => l && l.shapes.length);
  const lineGap = p.textHeight * (p.lineSpacing ?? 0.5);
  const textW = used.reduce((m, l) => Math.max(m, l.width), 0);
  const hOf = (l) => l.height || p.textHeight;
  const textH = used.length ? used.reduce((s, l) => s + hOf(l), 0) + (used.length - 1) * lineGap : p.textHeight;
  const tab = p.hole ? p.holeDiameter + Math.max(4, p.holeDiameter * 0.8) : 0;
  const frame = p.border ? p.borderWidth + p.borderGap : 0;
  const areaW = p.autoSize ? textW + 2 * (p.padding + frame) : p.width - tab;
  const areaH = p.autoSize ? textH + 2 * (p.padding + frame) : p.height;
  const W = areaW + tab, H = areaH;
  const areaCx = tab / 2; // l'area del testo e' spostata a destra della linguetta
  if (!p.autoSize && (textW + 2 * frame > areaW || textH + 2 * frame > areaH)) warnings.push('Il testo esce dalla targhetta: aumenta le dimensioni o riduci il testo.');

  // forme testo posizionate (centrate nell'area)
  const textShapesPlaced = [];
  let y = textH / 2;
  for (const l of used) {
    y -= hOf(l);
    const dx = areaCx - l.width / 2 - l.minX;
    for (const s of l.shapes) {
      const moved = new THREE.Shape(s.getPoints(12).map(v => new THREE.Vector2(v.x + dx, v.y + y)));
      moved.holes = s.holes.map(h => new THREE.Path(h.getPoints(12).map(v => new THREE.Vector2(v.x + dx, v.y + y))));
      textShapesPlaced.push(moved);
    }
    y -= lineGap;
  }

  const holeX = -W / 2 + tab / 2;
  const holes = p.hole ? [circlePath(holeX, 0, p.holeDiameter / 2)] : [];
  const outline = () => { const s = roundedRect(W, H, p.cornerRadius); s.holes.push(...holes); return s; };

  // cornice (anello) attorno all'area testo
  let frameShape = null;
  if (p.border) {
    const inset = p.borderGap * 0.5;
    const ow = areaW - 2 * inset, oh = areaH - 2 * inset;
    const rr = Math.max(0, p.cornerRadius - inset);
    frameShape = roundedRect(ow, oh, rr, areaCx);
    frameShape.holes.push(roundedRect(ow - 2 * p.borderWidth, oh - 2 * p.borderWidth, Math.max(0, rr - p.borderWidth), areaCx, 0, true));
  }

  let base, text;
  if (p.mode === 'inciso') {
    const depth = Math.min(p.textThickness, p.baseThickness - 0.4);
    if (depth < p.textThickness) warnings.push('Profondità incisione ridotta per lasciare almeno 0,4 mm di fondo.');
    const bottom = extrude([outline()], p.baseThickness - depth, 0);
    const top = outline();
    const islands = [];
    for (const s of textShapesPlaced) {
      top.holes.push(shapeToPath(s));
      for (const h of s.holes) islands.push(new THREE.Shape(h.getPoints()));
    }
    const frameIslands = [];
    if (frameShape) {
      top.holes.push(shapeToPath(frameShape));
      frameIslands.push(new THREE.Shape(frameShape.holes[0].getPoints()));
    }
    base = merge([bottom, extrude([top], depth, p.baseThickness - depth), extrude(islands, depth, p.baseThickness - depth), extrude(frameIslands, depth, p.baseThickness - depth)]);
    text = p.fillEngraving ? merge([extrude(textShapesPlaced, depth, p.baseThickness - depth), frameShape ? extrude([frameShape], depth, p.baseThickness - depth) : null]) : null;
    if (lines.some(l => l && l.script)) warnings.push('Con font corsivi le lettere sovrapposte possono dare errori in incisione.');
  } else {
    base = extrude([outline()], p.baseThickness, 0);
    text = merge([extrude(textShapesPlaced, p.textThickness, p.baseThickness), frameShape ? extrude([frameShape], p.textThickness, p.baseThickness) : null]);
  }
  return { base, text, width: W, height: H, warnings };
}

// ---------------------------------------------------------------------------
// Vaso
// ---------------------------------------------------------------------------
export const PROFILES = {
  dritto: () => 0,
  bombato: (t) => Math.sin(Math.PI * t),
  clessidra: (t) => -Math.sin(Math.PI * t),
  tulipano: (t) => Math.sin(Math.PI * t * 1.4) * (1 - t * 0.3),
  anfora: (t) => Math.sin(Math.PI * Math.min(1, t * 1.6)) - 0.6 * Math.sin(Math.PI * Math.max(0, (t - 0.6) / 0.4)),
};

/** Raggio del vaso a quota t (0..1) e angolo theta */
export function vaseRadius(p, t, theta) {
  const prof = PROFILES[p.profile] || PROFILES.dritto;
  const R = p.baseRadius + (p.topRadius - p.baseRadius) * Math.pow(t, p.curve ?? 1) + p.bulge * prof(t);
  const phi = theta - (p.twist * Math.PI / 180) * t;
  let f = 1;
  if (p.sides >= 3) {
    const n = p.sides, seg = 2 * Math.PI / n;
    const a = ((phi % seg) + seg) % seg - seg / 2;
    const poly = Math.cos(Math.PI / n) / Math.cos(a);
    f = 1 + (poly - 1) * (1 - p.smooth);
  }
  let r = R * f;
  if (p.waves > 0 && p.waveAmp > 0) r += p.waveAmp * Math.sin(p.waves * phi);
  return Math.max(1, r);
}

/** Mesh chiusa e manifold (anelli + tappo inferiore + tappo superiore) */
export function buildVase(p) {
  const L = Math.max(2, Math.round(p.layers || 100));
  const S = Math.max(12, Math.round(p.segments || 160));
  const pos = new Float32Array(((L + 1) * S + 2) * 3);
  let k = 0;
  for (let j = 0; j <= L; j++) {
    const t = j / L, z = t * p.height;
    for (let i = 0; i < S; i++) {
      const th = (i / S) * Math.PI * 2;
      const r = vaseRadius(p, t, th);
      pos[k++] = r * Math.cos(th); pos[k++] = r * Math.sin(th); pos[k++] = z;
    }
  }
  const bottomC = (L + 1) * S, topC = bottomC + 1;
  pos.set([0, 0, 0], bottomC * 3);
  pos.set([0, 0, p.height], topC * 3);
  const idx = [];
  const v = (j, i) => j * S + (i % S);
  for (let j = 0; j < L; j++) for (let i = 0; i < S; i++) {
    const a = v(j, i), b = v(j, i + 1), c = v(j + 1, i + 1), d = v(j + 1, i);
    idx.push(a, b, c, a, c, d);
  }
  for (let i = 0; i < S; i++) {
    idx.push(bottomC, v(0, i + 1), v(0, i));
    idx.push(topC, v(L, i), v(L, i + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Array di posizioni non indicizzato (per l'esportazione) */
export function positionsOf(geometry) {
  if (!geometry) return null;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  return new Float32Array(g.getAttribute('position').array);
}

/** Verifica manifold: ogni spigolo condiviso da esattamente 2 triangoli con verso opposto */
export function isManifold(geometry) {
  const pos = geometry.getAttribute('position');
  const key = (i) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const idx = geometry.index ? geometry.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const v = [key(idx[t]), key(idx[t + 1]), key(idx[t + 2])];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const k = `${a}|${b}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  for (const [k, n] of edges) {
    const [a, b] = k.split('|');
    if (n !== 1 || edges.get(`${b}|${a}`) !== 1) return false;
  }
  return true;
}
