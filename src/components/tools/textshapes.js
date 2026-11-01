// Contorni di testo (opentype.js) -> THREE.Shape
import * as THREE from 'three';

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2;
}

/**
 * Converte una riga di testo in forme 2D (mm, y verso l'alto, linea di base a y=0).
 * @returns {{shapes: THREE.Shape[], width: number, minY: number, maxY: number}}
 */
export function textShapes(font, text, capHeight) {
  const upm = font.unitsPerEm || 1000;
  const cap = (font.tables.os2 && font.tables.os2.sCapHeight) || upm * 0.7;
  const size = capHeight * upm / cap;
  // impaginazione manuale glifo per glifo (evita le feature OpenType non supportate da opentype.js)
  const scale = size / upm;
  const paths = [];
  let x = 0, prev = null;
  for (const ch of Array.from(text)) {
    const g = font.charToGlyph(ch);
    if (prev) { try { x += font.getKerningValue(prev, g) * scale; } catch { /* nessuna crenatura */ } }
    paths.push(g.getPath(x, 0, size));
    x += (g.advanceWidth || 0) * scale;
    prev = g;
  }
  const shapes = [];
  for (const p of paths) {
    const sp = new THREE.ShapePath();
    for (const c of p.commands) {
      switch (c.type) {
        case 'M': sp.moveTo(c.x, -c.y); break;
        case 'L': sp.lineTo(c.x, -c.y); break;
        case 'Q': sp.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y); break;
        case 'C': sp.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y); break;
        default: break;
      }
    }
    if (!sp.subPaths.length) continue;
    // l'orientamento del contorno piu' grande indica i contorni esterni
    let big = null, bigA = 0;
    for (const s of sp.subPaths) { const a = signedArea(s.getPoints()); if (Math.abs(a) > Math.abs(bigA)) { bigA = a; big = s; } }
    const outerIsCW = THREE.ShapeUtils.isClockWise(big.getPoints());
    shapes.push(...sp.toShapes(!outerIsCW));
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of shapes) for (const pt of s.getPoints()) {
    if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
  }
  if (!shapes.length) return { shapes, width: 0, minX: 0, minY: 0, maxY: 0 };
  return { shapes, width: maxX - minX, minX, minY, maxY };
}
