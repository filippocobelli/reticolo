// Registro dei formati supportati.
// kind: model | mesh | archive | laser | gcode | cad | image | video | doc
// render: miniatura generata col renderer 3D (finestra worker)
// view: aperto nel visualizzatore 3D
const F = {
  stl:  { kind: 'model', label: 'STL', render: true, view: true },
  '3mf':{ kind: 'model', label: '3MF', render: true, view: true },
  obj:  { kind: 'model', label: 'OBJ', render: true, view: true },
  fbx:  { kind: 'model', label: 'FBX', render: true, view: true },
  step: { kind: 'model', label: 'STEP', render: true, view: true },
  stp:  { kind: 'model', label: 'STEP', render: true, view: true },
  '3dm':{ kind: 'model', label: '3DM', render: true, view: true, partial: true },
  lys:  { kind: 'model', label: 'Lychee', experimental: true },
  f3d:  { kind: 'cad', label: 'Fusion F3D' },
  f3z:  { kind: 'cad', label: 'Fusion F3Z' },
  gcode:{ kind: 'gcode', label: 'G-code', render: true, view: true },
  gco:  { kind: 'gcode', label: 'G-code', render: true, view: true },
  bgcode:{ kind: 'gcode', label: 'G-code binario' },
  glb:  { kind: 'mesh', label: 'GLB', render: true, view: true },
  gltf: { kind: 'mesh', label: 'glTF', searchOnly: true },
  ply:  { kind: 'mesh', label: 'PLY', render: true, view: true },
  zip:  { kind: 'archive', label: 'ZIP' },
  rar:  { kind: 'archive', label: 'RAR' },
  '7z': { kind: 'archive', label: '7Z' },
  tar:  { kind: 'archive', label: 'TAR' },
  'tar.gz': { kind: 'archive', label: 'TAR.GZ' },
  tgz:  { kind: 'archive', label: 'TGZ' },
  xcs:  { kind: 'laser', label: 'xTool XCS' },
  xs:   { kind: 'laser', label: 'xTool XS' },
  lbrn: { kind: 'laser', label: 'LightBurn' },
  lbrn2:{ kind: 'laser', label: 'LightBurn 2' },
  dxf:  { kind: 'laser', label: 'DXF', render: true, view: true },
  dwg:  { kind: 'laser', label: 'DWG' },
  png:  { kind: 'image', label: 'PNG', render: true },
  jpg:  { kind: 'image', label: 'JPG', render: true },
  jpeg: { kind: 'image', label: 'JPG', render: true },
  webp: { kind: 'image', label: 'WEBP', render: true },
  gif:  { kind: 'image', label: 'GIF', render: true },
  bmp:  { kind: 'image', label: 'BMP', render: true },
  svg:  { kind: 'image', label: 'SVG', render: true },
  mp4:  { kind: 'video', label: 'MP4', render: true },
  mov:  { kind: 'video', label: 'MOV', render: true },
  webm: { kind: 'video', label: 'WEBM', render: true },
  m4v:  { kind: 'video', label: 'M4V', render: true },
  pdf:  { kind: 'doc', label: 'PDF' },
  txt:  { kind: 'doc', label: 'TXT' },
  md:   { kind: 'doc', label: 'Markdown' },
};

const COMPANION_KINDS = new Set(['image', 'video', 'doc']);

function extOf(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.tar.gz')) return 'tar.gz';
  const i = n.lastIndexOf('.');
  return i >= 0 ? n.slice(i + 1) : '';
}
function info(ext) { return F[ext] || null; }
function isSupported(name) { return !!F[extOf(name)]; }

module.exports = { FORMATS: F, COMPANION_KINDS, extOf, info, isSupported };
