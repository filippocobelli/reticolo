// Contratto IPC tra interfaccia e processo principale.
// Ogni funzione restituisce una Promise con i dati (o lancia un Error).
const inv = (ch) => (...a) => window.rtc.invoke(ch, ...a);

export const api = {
  app: { info: inv('app:info'), setShortcut: inv('app:setShortcut') },

  // ---- library.js ----
  sources: {
    list: inv('sources:list'),              // () -> [{id,path,name,count,last_scan,watch}]
    add: inv('sources:add'),                // (path?) -> source | null  (senza path apre il dialogo)
    remove: inv('sources:remove'),          // (id)
    setWatch: inv('sources:setWatch'),      // (id, bool)
  },
  items: {
    query: inv('items:query'),              // (filters) -> {items, total}
    get: inv('items:get'),                  // (id) -> item completo
    facets: inv('items:facets'),            // () -> {formats:[{ext,label,count}], kinds, total, uncollected, missing}
    folder: inv('items:folder'),            // ({sourceId, dir, archiveId}) -> {folders:[{name,dir,count}], items:[...]}
    companions: inv('items:companions'),    // (id) -> [item]
    setNote: inv('items:setNote'),          // (id, text)
    setHidden: inv('items:setHidden'),
    setHiddenDir: inv('items:setHiddenDir'), // ({sourceId, dir}, bool) nasconde tutto il contenuto di una cartella
    setCover: inv('items:setCover'),        // (id, dataUrl|null)
    reveal: inv('items:reveal'),            // (id) mostra in Finder/Esplora risorse
    openDefault: inv('items:openDefault'),  // (id) apre con l'app di sistema
    purgeMissing: inv('items:purgeMissing'),
  },
  tags: {
    list: inv('tags:list'),                 // () -> [{id,name,color,count}]
    add: inv('tags:add'),                   // (itemIds, name)
    remove: inv('tags:remove'),             // (itemIds, tagId)
    rename: inv('tags:rename'),             // (tagId, name)
    delete: inv('tags:delete'),             // (tagId)
    setColor: inv('tags:setColor'),         // (tagId, color)
  },
  collections: {
    list: inv('collections:list'),          // () -> [{id,name,color,count}]
    create: inv('collections:create'),      // (name) -> {id}
    rename: inv('collections:rename'),      // (id, name)
    delete: inv('collections:delete'),      // (id)
    addItems: inv('collections:addItems'),  // (id, itemIds)
    removeItems: inv('collections:removeItems'),
  },
  // ---- scanner.js ----
  scan: { rescan: inv('scan:rescan'), status: inv('scan:status') }, // rescan(sourceId?)
  // ---- thumbs.js ----
  thumbs: { regenerate: inv('thumbs:regenerate'), status: inv('thumbs:status') },
  // ---- duplicates.js ----
  dups: {
    list: inv('dups:list'),                 // () -> {exact:[[item]], geometry:[[item]], probable:[{a,b,reason}]}
    review: inv('dups:review'),             // (aId, bId, 'same'|'different')
  },
  // ---- queue.js ----
  queue: {
    list: inv('queue:list'), add: inv('queue:add'), update: inv('queue:update'),
    remove: inv('queue:remove'), reorder: inv('queue:reorder'), export: inv('queue:export'),
  },
  // ---- backup.js ----
  backup: { create: inv('backup:create'), restore: inv('backup:restore'), list: inv('backup:list'), settings: inv('backup:settings'), setSettings: inv('backup:setSettings') },
  settings: { get: inv('settings:get'), set: inv('settings:set') },
  // ---- threemf.js (convertitore 3MF + scrittura mesh) ----
  threemf: {
    info: inv('threemf:info'),              // (itemId) -> {flavor, plates:[{index,name,objectIds}], colors, objects:[{id,name,extruder}]}
    mesh: inv('threemf:mesh'),              // (itemId) -> {objects:[{id,name,plate,extruder,color,positions:Float32Array}], plates, colors}
    convert: inv('threemf:convert'),        // (itemId|path, target, opts) -> {outputs:[path]}
  },
  mesh: { export: inv('mesh:export') },     // ({name, format:'stl'|'3mf', objects:[{name,positions:Float32Array,color,extruder}]}) -> path|null
  // ---- slicers.js ----
  slicers: {
    detect: inv('slicers:detect'),          // () -> [{id,name,path,resin}]
    open: inv('slicers:open'),              // (slicerId, itemIds)
    setPreferred: inv('slicers:setPreferred'),
    addCustom: inv('slicers:addCustom'),    // () dialogo per scegliere un eseguibile
    removeCustom: inv('slicers:removeCustom'),
  },
  // ---- ai.js ----
  ai: {
    providers: inv('ai:providers'),         // () -> definizioni provider
    getConfig: inv('ai:getConfig'), setConfig: inv('ai:setConfig'),
    test: inv('ai:test'),                   // () -> {ok, message}
    tag: inv('ai:tag'),                     // (itemIds) avvia tagging in background
    cancel: inv('ai:cancel'),
    semantic: inv('ai:semantic'),           // (query, limit) -> [{id, score}]
    embedAll: inv('ai:embedAll'),
    status: inv('ai:status'),
    embedCancel: inv('ai:embedCancel'),
  },
  // ---- tools.js (salvataggi vari) ----
  tools: {
    saveScreenshot: inv('tools:saveScreenshot'), // (dataUrl, suggestedName)
    saveText: inv('tools:saveText'),             // (text, suggestedName, filters)
    pickFile: inv('tools:pickFile'),             // (filters) -> path|null
    revealPath: inv('tools:revealPath'),         // (path)
  },
};

export const startDrag = (ids) => window.rtc.startDrag(ids);
export const onEvent = (fn) => window.rtc.on(fn);
export const fileUrl = (id) => `rtc://file/${id}`;
export const thumbUrl = (id, v = '') => `rtc://thumb/${id}${v ? `?v=${v}` : ''}`;
