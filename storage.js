/* storage.js: everything that keeps the adventurer's entries safe.
   Nothing in here knows about the screen. See HANDOVER section 5.

   Written to two places on every change:
   - localStorage, straight away and synchronously, so a flat battery one
     moment later loses nothing
   - IndexedDB, about 300ms later, which also holds photo and drawing Blobs

   Classic script rather than an ES module, and no newer syntax, so that it
   runs on an older Silk browser. */
(function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const IDB_DELAY_MS = 300;
  const PREV_EVERY_MS = 5 * 60 * 1000;   // how far back the one step back reaches
  const BACKUP_FORMAT = 'orlando-adventure-backup';

  let ns = 'orlando';                    // storage prefix, tests use their own
  let appVersion = '';
  let state = null;
  let dbPromise = null;
  let idbTimer = null;
  let prevRotatedAt = 0;
  const health = { localOk: true, idbOk: true, loadedFrom: '' };
  const listeners = { error: [], external: [] };

  function key(name) { return ns + '.' + name; }
  function emit(name, value) { listeners[name].forEach(function (fn) { fn(value); }); }

  function blankState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      profile: { name: '', age: null, heightCm: 135, excitedAbout: '', nervousAbout: '' },
      ticks: {},
      challenges: {},
      diary: {},
      text: {},
      photos: {},
      drawings: {},
      activities: {},
      meta: { lastSaved: '', saveCount: 0, appVersion: '', deviceLabel: '', lastBackup: '', nudgeHiddenOn: '' }
    };
  }

  function isState(s) {
    return !!s && typeof s === 'object' && typeof s.schemaVersion === 'number' &&
      !!s.ticks && typeof s.ticks === 'object' && !!s.meta && typeof s.meta === 'object';
  }

  // Later schema changes go here as steps. A state from a newer app than this
  // one is left alone, never trimmed.
  function migrate(s) {
    const blank = blankState();
    Object.keys(blank).forEach(function (k) {
      if (s[k] === undefined) s[k] = blank[k];
    });
    Object.keys(blank.profile).forEach(function (k) {
      if (s.profile[k] === undefined) s.profile[k] = blank.profile[k];
    });
    Object.keys(blank.meta).forEach(function (k) {
      if (s.meta[k] === undefined) s.meta[k] = blank.meta[k];
    });
    return s;
  }

  // saveCount goes first because a tablet clock can jump backwards after a
  // flat battery, and the clock would then pick the older copy.
  function isNewer(a, b) {
    if (!b) return true;
    if (!a) return false;
    const ca = a.meta.saveCount || 0;
    const cb = b.meta.saveCount || 0;
    if (ca !== cb) return ca > cb;
    return (a.meta.lastSaved || '') > (b.meta.lastSaved || '');
  }

  /* ---------- localStorage ---------- */

  function readLocal(name) {
    try {
      const raw = localStorage.getItem(key(name));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (isState(parsed)) return parsed;
      console.error('Stored copy has the wrong shape:', name);
    } catch (err) {
      console.error('Could not read stored copy:', name, err);
    }
    return null;
  }

  /* ---------- IndexedDB ---------- */

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB is not available')); return; }
      const req = indexedDB.open(key('db'), 1);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = function () {
        const db = req.result;
        db.onclose = function () { dbPromise = null; };
        db.onversionchange = function () { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB is blocked')); };
    }).catch(function (err) {
      dbPromise = null;
      throw err;
    });
    return dbPromise;
  }

  function idbDo(storeName, mode, work) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(storeName, mode);
        const req = work(tx.objectStore(storeName));
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  function idbGet(storeName, k) { return idbDo(storeName, 'readonly', function (s) { return s.get(k); }); }
  function idbPut(storeName, k, v) { return idbDo(storeName, 'readwrite', function (s) { return s.put(v, k); }); }

  function writeIdbNow() {
    clearTimeout(idbTimer);
    idbTimer = null;
    return idbPut('kv', 'state', JSON.parse(JSON.stringify(state))).then(function () {
      health.idbOk = true;
    }, function (err) {
      health.idbOk = false;
      console.error('IndexedDB save failed:', err);
      throw err;
    });
  }

  /* ---------- saving ---------- */

  function rotatePrevious(now) {
    if (now - prevRotatedAt < PREV_EVERY_MS) return;
    const current = localStorage.getItem(key('state'));
    if (!current) return;
    localStorage.setItem(key('state.prev'), current);
    prevRotatedAt = now;
  }

  function saveNow() {
    if (!state) return;
    const now = Date.now();
    state.meta.lastSaved = new Date(now).toISOString();
    state.meta.saveCount = (state.meta.saveCount || 0) + 1;
    state.meta.appVersion = appVersion;
    const json = JSON.stringify(state);
    try {
      rotatePrevious(now);
      localStorage.setItem(key('state'), json);
      health.localOk = true;
      clearTimeout(idbTimer);
      idbTimer = setTimeout(function () { writeIdbNow().catch(function () {}); }, IDB_DELAY_MS);
    } catch (err) {
      // localStorage full or blocked, so the other copy must take this one
      health.localOk = false;
      console.error('localStorage save failed:', err);
      writeIdbNow().catch(function () { emit('error', err); });
    }
  }

  // Take on anything another open tab of the app has written, otherwise this
  // tab's older copy would overwrite it on the next tick.
  function catchUp() {
    const stored = readLocal('state');
    if (stored && state && isNewer(stored, state)) {
      state = migrate(stored);
      emit('external', state);
      return true;
    }
    return false;
  }

  // All changes to the saved state go through here.
  function update(change) {
    catchUp();
    change(state);
    saveNow();
    return state;
  }

  function flush() {
    if (!state || !idbTimer) return;
    writeIdbNow().catch(function () {});
  }

  /* ---------- loading ---------- */

  async function load() {
    const local = readLocal('state');
    let stored = null;
    try {
      // Never leave a blank screen if the browser's IndexedDB hangs
      const limit = local ? 2000 : 10000;
      stored = await Promise.race([
        idbGet('kv', 'state'),
        new Promise(function (resolve, reject) {
          setTimeout(function () { reject(new Error('IndexedDB read timed out')); }, limit);
        })
      ]);
      if (stored && !isState(stored)) { console.error('IndexedDB copy has the wrong shape'); stored = null; }
      health.idbOk = true;
    } catch (err) {
      health.idbOk = false;
      console.error('Could not read IndexedDB:', err);
    }

    let chosen = null;
    if (local || stored) {
      chosen = isNewer(local, stored) ? local : stored;
      health.loadedFrom = chosen === local ? 'localStorage' : 'IndexedDB';
    } else {
      chosen = readLocal('state.prev');
      if (chosen) {
        health.loadedFrom = 'one step back';
        console.error('Both main copies were unreadable, used the one step back copy');
      }
    }
    const isFirstRun = !chosen;
    if (!chosen) {
      chosen = blankState();
      health.loadedFrom = 'new';
    }
    state = migrate(chosen);

    // Bring both copies level with whichever one won
    const prevCopy = readLocal('state.prev');
    prevRotatedAt = prevCopy ? (Date.parse(prevCopy.meta.lastSaved) || 0) : 0;
    if (local !== chosen || stored === null) {
      if (isFirstRun) state.meta.lastSaved = new Date().toISOString();
      try {
        localStorage.setItem(key('state'), JSON.stringify(state));
      } catch (err) {
        health.localOk = false;
        console.error('localStorage write on load failed:', err);
      }
      writeIdbNow().catch(function () {});
    } else if (stored !== chosen) {
      writeIdbNow().catch(function () {});
    }
    return state;
  }

  // Log keys that the content does not know about. Never delete them, they may
  // belong to a newer version.
  function validate(knownIds) {
    const unknown = [];
    ['ticks', 'text', 'photos', 'drawings', 'diary', 'challenges'].forEach(function (section) {
      Object.keys(state[section] || {}).forEach(function (id) {
        if (!knownIds.has(id)) unknown.push(section + ':' + id);
      });
    });
    if (unknown.length) console.warn('Saved entries with no matching content:', unknown);
    return unknown;
  }

  /* ---------- photo and drawing Blobs, used from Tier 2 ---------- */

  function putBlob(blob, wantedKey) {
    const k = wantedKey || 'blob-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    return idbPut('blobs', k, blob).then(function () { return k; });
  }
  function getBlob(k) { return idbGet('blobs', k); }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(url) {
    const comma = url.indexOf(',');
    const header = url.slice(0, comma);
    const type = (header.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(url.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type });
  }

  /* ---------- backup and restore ---------- */

  function blobKeysIn(s) {
    const keys = [];
    [s.photos, s.drawings].forEach(function (group) {
      Object.keys(group || {}).forEach(function (id) { if (group[id]) keys.push(group[id]); });
    });
    return keys;
  }

  async function exportBackup() {
    const blobs = {};
    const keys = blobKeysIn(state);
    for (let i = 0; i < keys.length; i++) {
      const blob = await getBlob(keys[i]);
      if (blob) blobs[keys[i]] = await blobToDataUrl(blob);
      else console.error('A saved picture is missing from storage:', keys[i]);
    }
    const now = new Date();
    const name = (state.profile.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    return {
      filename: (name ? name + '-' : '') + 'orlando-backup-' + stamp + '.json',
      text: JSON.stringify({
        format: BACKUP_FORMAT,
        schemaVersion: state.schemaVersion,
        exportedAt: now.toISOString(),
        appVersion: appVersion,
        state: state,
        blobs: blobs
      })
    };
  }

  function summarise(s, blobs, when) {
    return {
      exportedAt: when || '',
      name: (s.profile && s.profile.name) || '',
      ticks: Object.keys(s.ticks).length,
      diaryDays: Object.keys(s.diary || {}).filter(function (id) {
        const d = s.diary[id];
        return d && (d.where || d.best || d.bravest || d.stars);
      }).length,
      photos: Object.keys(s.photos || {}).length,
      drawings: Object.keys(s.drawings || {}).length,
      pictures: Object.keys(blobs || {}).length
    };
  }

  // Throws a plain message if this is not a backup, and changes nothing.
  function readBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('That file is not a backup from this app.');
    }
    if (!parsed || parsed.format !== BACKUP_FORMAT || !isState(parsed.state)) {
      throw new Error('That file is not a backup from this app.');
    }
    if (parsed.schemaVersion > SCHEMA_VERSION) {
      throw new Error('That backup came from a newer version. Update the app first.');
    }
    return { parsed: parsed, summary: summarise(parsed.state, parsed.blobs, parsed.exportedAt) };
  }

  async function applyBackup(parsed) {
    const blobs = parsed.blobs || {};
    const blobKeys = Object.keys(blobs);
    for (let i = 0; i < blobKeys.length; i++) {
      await putBlob(dataUrlToBlob(blobs[blobKeys[i]]), blobKeys[i]);
    }
    const count = state.meta.saveCount || 0;
    localStorage.setItem(key('state.before-restore'), JSON.stringify(state));
    state = migrate(JSON.parse(JSON.stringify(parsed.state)));
    state.meta.saveCount = count;
    saveNow();
    await writeIdbNow();
    return state;
  }

  function hasUndoRestore() { return !!readLocal('state.before-restore'); }

  async function undoRestore() {
    const before = readLocal('state.before-restore');
    if (!before) return null;
    const count = state.meta.saveCount || 0;
    state = migrate(before);
    state.meta.saveCount = count;
    saveNow();
    await writeIdbNow();
    localStorage.removeItem(key('state.before-restore'));
    return state;
  }

  /* ---------- protecting the storage ---------- */

  async function requestPersist() {
    if (!navigator.storage || !navigator.storage.persist) return null;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch (err) {
      console.error('persist request failed:', err);
      return null;
    }
  }

  async function storageInfo() {
    const info = { persisted: null, usageMb: null, quotaMb: null };
    try {
      if (navigator.storage && navigator.storage.persisted) info.persisted = await navigator.storage.persisted();
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        info.usageMb = Math.round((est.usage || 0) / 1048576 * 10) / 10;
        info.quotaMb = Math.round((est.quota || 0) / 1048576);
      }
    } catch (err) {
      console.error('storage info failed:', err);
    }
    return info;
  }

  /* ---------- wiring ---------- */

  function init(options) {
    options = options || {};
    if (options.ns) ns = options.ns;
    appVersion = options.appVersion || '';

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
      else catchUp();
    });
    addEventListener('pagehide', flush);
    addEventListener('pageshow', catchUp);
    addEventListener('storage', function (e) {
      if (e.key === key('state')) catchUp();
    });
  }

  window.Store = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    init: init,
    load: load,
    update: update,
    saveNow: saveNow,
    flush: flush,
    catchUp: catchUp,
    validate: validate,
    get state() { return state; },
    health: health,
    on: function (name, fn) { listeners[name].push(fn); },
    putBlob: putBlob,
    getBlob: getBlob,
    exportBackup: exportBackup,
    readBackup: readBackup,
    applyBackup: applyBackup,
    hasUndoRestore: hasUndoRestore,
    undoRestore: undoRestore,
    requestPersist: requestPersist,
    storageInfo: storageInfo
  };
})();
