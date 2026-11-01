const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'electron') return path.join(__dirname, 'stubs', 'electron.js');
  return origResolve.call(this, req, ...rest);
};
const { DB } = require('../electron/db');

function makeCtx() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticolo-test-'));
  const db = new DB(path.join(dir, 'lib.db'));
  const handlers = {};
  const events = [];
  const ctx = {
    db, dir, handlers, events,
    handle(ch, fn) { handlers[ch] = fn; },
    emit(ch, p) { events.push([ch, p]); },
    thumbPath: (id) => path.join(dir, `${id}.png`),
    getMainWindow: () => null,
    materialize: async (it) => it.path,
    call: async (ch, ...a) => handlers[ch](...a),
  };
  return ctx;
}
const waitFor = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 20)); }
  throw new Error('waitFor timeout');
};
module.exports = { makeCtx, waitFor };
