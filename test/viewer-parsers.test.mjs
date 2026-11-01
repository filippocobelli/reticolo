// node test/viewer-parsers.test.mjs
import assert from 'node:assert';
import * as THREE from 'three';
import { buildGcodeObject } from '../src/viewer/gcode.js';
import { buildDxfObject } from '../src/viewer/dxf.js';

// ---------- G-code ----------
const g = [
  'G21', 'G90', 'M83', 'G28',
  ';LAYER_CHANGE', ';Z:0.2', 'G1 Z0.2 F600', 'G0 X10 Y10',
  ';TYPE:External perimeter', 'G1 X20 Y10 E0.5', 'G1 X20 Y20 E0.5', 'G1 X10 Y20 E0.5', 'G1 X10 Y10 E0.5',
  ';TYPE:Solid infill', 'G1 X20 Y20 E0.8',
  'G1 E-0.8', 'G0 X30 Y30', // retrazione + spostamento
  ';LAYER_CHANGE', ';Z:0.4', 'G1 Z0.4', 'G1 X10 Y10',
  ';TYPE:Perimeter', 'G2 X20 Y10 I5 J0 E1.2', // semicerchio orario
  'N10 G1 X25 Y10 E0.2*55',
  'G91', 'G1 X1 Y0 E0.05', 'G90',
  ';LAYER_CHANGE', 'G1 Z0.6', 'G1 X0 Y0 E1 ; commento',
].join('\n');
const r = buildGcodeObject(g, THREE);
assert.strictEqual(r.layers.length, 3, 'layers');
assert.deepStrictEqual(r.layers.map(l => +l.z.toFixed(2)), [0.2, 0.4, 0.6]);
const ext = r.object.getObjectByName('extrusions'), trv = r.object.getObjectByName('travels');
const arcSegs = r.stats.extrusionSegments - (5 + 1 + 1 + 1);
assert.ok(arcSegs >= 8, `arco campionato (${arcSegs})`);
assert.ok(r.stats.travelSegments >= 2, 'travel');
assert.strictEqual(trv.visible, false);
assert.strictEqual(r.stats.colorMode, 'type');
assert.ok(Math.abs(r.bounds.max.x - 26) < 1e-4 && Math.abs(r.bounds.min.x - 0) < 1e-4, `bounds ${JSON.stringify(r.bounds)}`);
// l'arco G2 orario da (10,10) a (20,10) con centro (15,10) passa sopra (y max 15)
const pos = ext.geometry.attributes.position.array;
let maxArcY = -Infinity, minArcY = Infinity; for (let k = 5 * 6; k < (5 + arcSegs) * 6; k += 3) { maxArcY = Math.max(maxArcY, pos[k + 1]); minArcY = Math.min(minArcY, pos[k + 1]); }
assert.ok(Math.abs(maxArcY - 15) < 0.05 && minArcY > 9.99, `arco orario y ${minArcY}..${maxArcY}`);
r.setLayerRange(1, 1);
assert.strictEqual(ext.geometry.drawRange.start, 5 * 2);
assert.strictEqual(ext.geometry.drawRange.count, (arcSegs + 2) * 2);
r.setLayerRange(0, 99); assert.strictEqual(ext.geometry.drawRange.count, r.stats.extrusionSegments * 2);
const c = ext.geometry.attributes.color.array; // primo segmento: perimetro esterno arancione
assert.deepStrictEqual([c[0], c[1], c[2]], [255, 140, 0]);
console.log('ok gcode', r.stats);

// senza marcatori e senza tipi: strati da Z, colore per altezza
const g2 = ['G90', 'M82', 'G92 E0', 'G1 Z0.3', 'G1 X10 E1', 'G1 Y10 E2', 'G1 Z0.6', 'G1 X0 E3', 'G1 Z0.9', 'G1 Y0 E4', 'G1 Z1.2 E4', 'G0 X5'].join('\n');
const r2 = buildGcodeObject(g2, THREE);
assert.strictEqual(r2.layers.length, 3); assert.strictEqual(r2.stats.colorMode, 'height'); assert.strictEqual(r2.stats.extrusionSegments, 4);
console.log('ok gcode z-layers', r2.stats);

// prestazioni: ~1M righe
const lines = ['G90', 'M83'];
for (let L = 0; L < 200; L++) { lines.push(';LAYER_CHANGE', `G1 Z${(0.2 * (L + 1)).toFixed(2)}`, ';TYPE:Sparse infill'); for (let k = 0; k < 5000; k++) lines.push(`G1 X${(k % 200).toFixed(3)} Y${((k * 7) % 200).toFixed(3)} E0.01234`); }
const big = lines.join('\n');
const t0 = performance.now(); const r3 = buildGcodeObject(big, THREE); const dt = performance.now() - t0;
assert.strictEqual(r3.layers.length, 200);
console.log(`ok gcode perf ${(big.length / 1e6).toFixed(1)}MB in ${dt.toFixed(0)}ms`, r3.stats.extrusionSegments, 'segmenti');

// ---------- DXF ----------
const dxf = (secs) => secs.flat().join('\n') + '\n';
const ent = (...pairs) => pairs.flat();
const D = dxf([
  ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '1', '0', 'LAYER', '2', 'ROSSO', '70', '0', '62', '1', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC'],
  ['0', 'SECTION', '2', 'BLOCKS', '0', 'BLOCK', '8', '0', '2', 'QUAD', '70', '0', '10', '0', '20', '0', '30', '0',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '30', '0', '11', '1', '21', '0', '31', '0',
    '0', 'ENDBLK', '8', '0', '0', 'ENDSEC'],
  ['0', 'SECTION', '2', 'ENTITIES',
    ...ent('0', 'LINE', '8', 'ROSSO', '10', '0', '20', '0', '30', '0', '11', '100', '21', '0', '31', '0'),
    ...ent('0', 'CIRCLE', '8', '0', '62', '3', '10', '50', '20', '50', '30', '0', '40', '10'),
    ...ent('0', 'ARC', '8', '0', '10', '0', '20', '0', '30', '0', '40', '5', '50', '0', '51', '90'),
    ...ent('0', 'LWPOLYLINE', '8', '0', '90', '2', '70', '0', '10', '0', '20', '0', '42', '1', '10', '2', '20', '0'),
    ...ent('0', 'INSERT', '8', '0', '2', 'QUAD', '10', '200', '20', '0', '30', '0', '41', '10', '42', '10', '50', '90'),
    ...ent('0', 'ELLIPSE', '8', '0', '10', '0', '20', '-50', '30', '0', '11', '20', '21', '0', '31', '0', '40', '0.5', '41', '0', '42', '6.283185307'),
    ...ent('0', 'SPLINE', '8', '0', '70', '8', '71', '2', '72', '6', '73', '3',
      '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1',
      '10', '0', '20', '0', '30', '0', '10', '5', '20', '10', '30', '0', '10', '10', '20', '0', '30', '0'),
    '0', 'ENDSEC'],
  ['0', 'EOF'],
]);
const d = buildDxfObject(D, THREE);
assert.strictEqual(d.stats.entities, 8, JSON.stringify(d.stats)); // 7 + linea nel blocco
assert.strictEqual(d.stats.skipped, 0);
assert.ok(d.stats.segments > 100);
// linea rossa dal layer
const dc = d.object.children[0].geometry.attributes.color.array;
assert.deepStrictEqual([dc[0], dc[1], dc[2]], [1, 0, 0]);
// limiti: cerchio fino a y=60; ellisse fino a y=-60; INSERT ruotato di 90°: linea da (200,0) a (200,10)
assert.ok(Math.abs(d.bounds.max.y - 60) < 0.01 && Math.abs(d.bounds.min.y + 60) < 0.01, JSON.stringify(d.bounds));
assert.ok(Math.abs(d.bounds.max.x - 200) < 1e-4);
const p = d.object.children[0].geometry.attributes.position.array;
let foundInsert = false; for (let k = 0; k < p.length; k += 6) if (Math.abs(p[k] - 200) < 1e-4 && Math.abs(p[k + 4] - 10) < 1e-4) foundInsert = true;
assert.ok(foundInsert, 'insert trasformato');
// semicerchio della LWPOLYLINE (bulge 1, antiorario da (0,0) a (2,0)) passa per (1,-1)
let foundBulge = false; for (let k = 0; k < p.length; k += 3) if (Math.abs(p[k] - 1) < 0.02 && Math.abs(p[k + 1] + 1) < 0.02) foundBulge = true;
assert.ok(foundBulge, 'bulge');
// spline quadratica: punto medio (5,5)
let foundSpline = false; for (let k = 0; k < p.length; k += 3) if (Math.abs(p[k] - 5) < 0.05 && Math.abs(p[k + 1] - 5) < 0.05) foundSpline = true;
assert.ok(foundSpline, 'spline');
console.log('ok dxf', d.stats);
console.log('VIEWER PARSERS OK');
