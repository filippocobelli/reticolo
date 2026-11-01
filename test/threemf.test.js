// Test del modulo 3MF (node test/threemf.test.js)
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync, strToU8, unzipSync, strFromU8 } = require('fflate');
const T = require('../electron/threemf.js');

function cubeXml(id, size) {
  const s = size;
  const v = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]];
  const t = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  return `<object id="${id}" type="model"><mesh><vertices>${v.map(p => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices>` +
    `<triangles>${t.map((x, i) => `<triangle v1="${x[0]}" v2="${x[1]}" v3="${x[2]}"${i === 2 ? ' paint_color="8"' : ''}/>`).join('')}</triangles></mesh></object>`;
}

// 3MF sintetico stile Bambu: 2 oggetti (uno con 2 parti), 2 piatti, 2 colori
function makeBambu() {
  const objFile = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources>${cubeXml(1, 10)}${cubeXml(2, 5)}${cubeXml(3, 20)}</resources><build/></model>`;
  const root = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
<metadata name="Application">BambuStudio-01.09.00.00</metadata><metadata name="Title">Test &amp; prova</metadata>
<resources>
<object id="10" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></components></object>
<object id="11" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="3"/></components></object>
</resources>
<build><item objectid="10" transform="1 0 0 0 1 0 0 0 1 100 100 0"/><item objectid="11" transform="1 0 0 0 1 0 0 0 1 400 100 0"/></build></model>`;
  const cfg = `<?xml version="1.0"?><config>
<object id="10"><metadata key="name" value="Doppio"/><metadata key="extruder" value="1"/>
  <part id="1" subtype="normal_part"><metadata key="name" value="Grande"/></part>
  <part id="2" subtype="normal_part"><metadata key="name" value="Piccolo"/><metadata key="extruder" value="2"/></part></object>
<object id="11"><metadata key="name" value="Cubone"/><metadata key="extruder" value="2"/><part id="3" subtype="normal_part"/></object>
<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Uno"/><metadata key="thumbnail_file" value="Metadata/plate_1.png"/><model_instance><metadata key="object_id" value="10"/><metadata key="instance_id" value="0"/></model_instance></plate>
<plate><metadata key="plater_id" value="2"/><model_instance><metadata key="object_id" value="11"/><metadata key="instance_id" value="0"/></model_instance></plate>
<assemble><assemble_item object_id="10" instance_id="0"/></assemble>
</config>`;
  const ps = JSON.stringify({ filament_colour: ['#FF0000', '#0000FF'], filament_type: ['PLA', 'PETG'], layer_height: '0.2' });
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    '_rels/.rels': strToU8('<Relationships><Relationship Target="/3D/3dmodel.model" Id="r" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(root),
    '3D/Objects/object_1.model': strToU8(objFile),
    'Metadata/model_settings.config': strToU8(cfg),
    'Metadata/project_settings.config': strToU8(ps),
    'Metadata/plate_1.png': png,
  });
}

const tris = (m) => m.objects.reduce((s, o) => s + o.volumes.reduce((a, v) => a + v.positions.length / 9, 0), 0);

// --- parse ---
const buf = makeBambu();
const m = T.parse3mf(buf);
assert.equal(m.flavor, 'bambu');
assert.equal(m.title, 'Test & prova');
assert.deepEqual(m.colors, ['#FF0000', '#0000FF']);
assert.equal(m.objects.length, 2);
assert.equal(m.plates.length, 2);
assert.equal(m.objects[0].name, 'Doppio');
assert.equal(m.objects[0].volumes.length, 2);
assert.equal(m.objects[0].volumes[1].extruder, 2);
assert.equal(m.objects[1].plate, 2);
assert.equal(tris(m), 36);
assert.ok(m.hasPaint);
// trasformazioni: il cubo piccolo è a x = 100 + 10
const small = m.objects[0].volumes[1].positions;
let minx = Infinity; for (let i = 0; i < small.length; i += 3) minx = Math.min(minx, small[i]);
assert.equal(minx, 110);
assert.equal(T.paintDominant('8'), 2);
assert.equal(T.paintDominant('4'), 1);
assert.equal(T.paintDominant('0C'), 3);

// --- viewer ---
const vm = T.meshForViewer(m);
assert.equal(vm.objects.length, 3);
assert.ok(vm.objects[0].positions instanceof Float32Array);
assert.equal(vm.objects[0].color, '#FF0000');
assert.equal(vm.objects[1].color, '#0000FF');
assert.ok(vm.objects[0].vertexColors, 'colori per vertice per la pittura');
assert.deepEqual(vm.plates[1].offset.map(Math.round), [-410, -110, 0]);

// --- conversioni ---
for (const target of ['prusa', 'generic', 'bambu', 'orca']) {
  const { files, warnings } = T.convertModel(m, target);
  const expected = target === 'prusa' || target === 'generic' ? 2 : 1;
  assert.equal(files.length, expected, `${target}: numero file`);
  let total = 0; const allColors = new Set();
  for (const f of files) {
    const r = T.parse3mf(f.data);
    total += tris(r);
    T.meshForViewer(r).objects.forEach(o => allColors.add(o.color));
    if (target === 'bambu' || target === 'orca') {
      assert.equal(r.flavor, target);
      assert.equal(r.plates.length, 2);
      assert.deepEqual(r.colors, ['#FF0000', '#0000FF']);
      assert.ok(r.hasPaint, 'pittura preservata');
      assert.equal(r.objects[0].volumes[1].extruder, 2);
      const ps = JSON.parse(strFromU8(unzipSync(f.data)['Metadata/project_settings.config']));
      assert.equal(ps.layer_height, '0.2', 'impostazioni progetto conservate');
      assert.ok(unzipSync(f.data)['Metadata/plate_1.png'], 'miniatura piatto');
    }
    if (target === 'prusa') {
      assert.equal(r.flavor, 'prusa');
      assert.deepEqual(r.colors, ['#FF0000', '#0000FF']);
    }
  }
  assert.equal(total, 36, `${target}: triangoli`);
  assert.ok(allColors.has('#FF0000') && allColors.has('#0000FF'), `${target}: colori ${[...allColors]}`);
  console.log(`ok ${target}: ${files.length} file, avvisi: ${warnings.length}`);
}

// prusa: il primo file contiene l'oggetto con due volumi e pittura
{
  const { files } = T.convertModel(m, 'prusa');
  const r = T.parse3mf(files[0].data);
  assert.equal(r.objects[0].volumes.length, 2);
  assert.equal(r.objects[0].volumes[1].extruder, 2);
  assert.ok(r.hasPaint);
  // ritorno da prusa a bambu
  const back = T.parse3mf(T.convertModel(r, 'bambu').files[0].data);
  assert.equal(back.objects[0].volumes.length, 2);
  assert.ok(back.hasPaint);
  console.log('ok prusa -> bambu');
}

// --- esportazione generatori ---
{
  const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const model = T.modelFromObjects([{ name: 'Base', positions: tri, color: '#FFFFFF', extruder: 1 }, { name: 'Testo', positions: tri.map(v => v + 2), color: '#000000', extruder: 2 }]);
  const data = T.write3mf(model, 'export');
  const r = T.parse3mf(data);
  assert.equal(r.objects.length, 2);
  assert.equal(r.objects[1].extruder, 2);
  const stl = T.writeStl(model.objects.map(o => ({ positions: o.volumes[0].positions })));
  assert.equal(stl.length, 84 + 2 * 50);
  assert.equal(stl.readUInt32LE(80), 2);
  const tmp = path.join(os.tmpdir(), 'reticolo-test.stl');
  fs.writeFileSync(tmp, stl);
  console.log('ok export 3mf/stl');
}
console.log('TUTTI I TEST 3MF SUPERATI');
