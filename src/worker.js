// Finestra nascosta: genera miniature PNG e analizza la geometria.
import * as THREE from 'three';
import { loadModel, analyze } from './viewer/loaders.js';
import { addLights, placeOnFloor, fitCamera, disposeObject } from './viewer/scene.js';

const SIZE = 512;
const canvas = document.createElement('canvas');
canvas.width = SIZE; canvas.height = SIZE;
document.body.appendChild(canvas);
let renderer = null;
function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return renderer;
}

const toPng = (cv) => new Promise((res) => cv.toBlob(async (b) => res(b ? await b.arrayBuffer() : null), 'image/png'));

async function render3d(job) {
  const loaded = await loadModel({ id: job.id, ext: job.ext, name: job.name });
  const obj = loaded.object;
  const a = loaded.type === 'mesh' ? analyze(obj) : { tris: 0, dims: null, geoHash: null };
  let png = null;
  if (job.needImage) {
    const scene = new THREE.Scene();
    addLights(scene);
    const box = placeOnFloor(obj);
    scene.add(obj);
    let camera;
    if (loaded.flat) { camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000); fitCamera(camera, box, 'top', null, 1.08); }
    else { camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000); fitCamera(camera, box, 'iso', null, 1.12); }
    try {
      const r = getRenderer();
      r.setClearColor(0x000000, 0);
      r.render(scene, camera);
      png = await toPng(canvas);
    } catch (e) { renderer = null; console.warn('WebGL non disponibile', e.message); }
    scene.remove(obj);
  }
  const meta = {};
  if (loaded.plates && loaded.plates.length) meta.plateCount = loaded.plates.length;
  if (loaded.gcode && loaded.gcode.stats) meta.gcodeStats = loaded.gcode.stats;
  if (loaded.partMeshes) meta.parts = loaded.partMeshes.length;
  if (loaded.meta && loaded.meta.skipped) meta.skippedObjects = loaded.meta.skipped;
  disposeObject(obj);
  return { png, geoHash: a.geoHash, tris: a.tris || null, dims: a.dims, meta };
}

function drawCover(src, w, h) {
  const cv = document.createElement('canvas');
  const s = Math.min(1, SIZE / Math.max(w, h));
  cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
  cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}

async function renderImage(job) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = job.url;
  await img.decode();
  const w = img.naturalWidth || SIZE, h = img.naturalHeight || SIZE;
  return { png: await toPng(drawCover(img, w, h)), meta: { width: w, height: h } };
}

async function renderVideo(job) {
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = job.url;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video non decodificabile')); });
  v.currentTime = Math.min(v.duration * 0.1 || 0, 5);
  await new Promise((res) => { v.onseeked = res; setTimeout(res, 4000); });
  const out = { png: await toPng(drawCover(v, v.videoWidth, v.videoHeight)), meta: { duration: v.duration, width: v.videoWidth, height: v.videoHeight } };
  v.removeAttribute('src'); v.load();
  return out;
}

window.rtc.worker.onJob(async (job) => {
  let result = { id: job.id };
  try {
    let r;
    if (job.kind === 'image') r = await renderImage(job);
    else if (job.kind === 'video') r = await renderVideo(job);
    else r = await render3d(job);
    result = { ...result, ...r };
  } catch (e) {
    result.error = String(e && e.message || e);
  }
  window.rtc.worker.done(result);
});
window.rtc.worker.ready();
