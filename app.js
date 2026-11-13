// Przebieg — interfejs, synchronizacja z Dyskiem Google, import, widoki.
import * as C from './core.js?v=20261113b';
import * as A from './analysis.js?v=20261113b';
import * as P from './plan.js?v=20261113b';

// ══ KONFIGURACJA ════════════════════════════════════════════════════════════
// Ten sam klient OAuth co FotoPlaner (autoryzowany adres: zadupiezeusa.github.io).
// Uprawnienie drive.file: aplikacja widzi wyłącznie pliki, które sama utworzyła.
const CLIENT_ID = '298351769527-fdtj2ij6f6s657ju43i9aka4bipb68cs.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER = 'Przebieg', RAW_FOLDER = 'surowe', DB_FILE = 'baza.json';
const LS = k => 'przebieg_' + k;   // github.io jest wspólne z FotoPlanerem — klucze z prefiksem
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const DAY = 864e5;

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
const MONTHS_SHORT = ['sty','lut','mar','kwi','maj','cze','lip','sie','wrz','paź','lis','gru'];
const DAYS = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
const SPORT_PL = { running: 'Bieg', trailRunning: 'Bieg terenowy', treadmillRunning: 'Bieżnia', cycling: 'Rower', walking: 'Spacer', hiking: 'Wędrówka', swimming: 'Pływanie', generic: 'Aktywność' };
const fmtDate = ts => { const d = new Date(ts); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };
const fmtDateShort = ts => { const d = new Date(ts); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
const fmtTime = ts => new Date(ts).toLocaleTimeString('pl', { hour: '2-digit', minute: '2-digit' });
const dec1 = v => v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const plural = (n, a, b, c) => n === 1 ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? b : c;
const ICON = {
  home: '<path d="M3.5 10.5L12 4l8.5 6.5V19a1 1 0 0 1-1 1H15v-5.5H9V20H4.5a1 1 0 0 1-1-1z"/>',
  runs: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  plan: '<rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4"/><path d="M8.5 14.5l2.2 2.2 4.8-4.8"/>',
  body: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8 10.5a4 4 0 0 1 8 0"/><path d="M12 10.5l1.6-2.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  fit: '<path d="M13 4l-2 6h5l-6 10 2-7H7z"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8 10.5a4 4 0 0 1 8 0"/><path d="M12 10.5l1.6-2.2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 14h6M9 17h4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
};
const icon = (k, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24">${ICON[k]}</svg>`;
const VIEWS = [
  { key: 'home', label: 'Pulpit', icon: 'home' },
  { key: 'plan', label: 'Plan', icon: 'plan' },
  { key: 'list', label: 'Treningi', icon: 'runs' },
  { key: 'progress', label: 'Postęp', icon: 'trend' },
  { key: 'body', label: 'Ciało', icon: 'body' },
];

// ══ STAN ════════════════════════════════════════════════════════════════════
let db = emptyDb();
let view = 'home', listFilter = 'run', listMode = 'run', progressTab = 'condition', bodyMetric = 'weight', techMetric = 'cadence', openRoute = null;
let pendingFiles = null;
function emptyDb() { return { version: 2, activities: [], deleted: [], body: [], bodyDeleted: [], settings: { ...A.DEFAULT_SETTINGS, updated: 0 }, plan: null, savedAt: 0 }; }
function normalizeDb(d) {
  const e = emptyDb();
  return { ...e, ...d, body: d.body || [], bodyDeleted: d.bodyDeleted || [], settings: { ...A.DEFAULT_SETTINGS, ...(d.settings || {}) } };
}
const acts = () => db.activities;
const S = () => db.settings;
const byId = id => db.activities.find(a => a.id === id);
let typesDirty = true;
function ensureTypes() { if (typesDirty) { A.annotateTypes(acts(), S()); typesDirty = false; } }

// ══ INDEXEDDB (lokalny cache) ═══════════════════════════════════════════════
const idb = (() => {
  let p;
  const open = () => p ||= new Promise((res, rej) => {
    const r = indexedDB.open('przebieg', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('streams'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => { const t = d.transaction(store, mode); const q = fn(t.objectStore(store)); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); });
  };
  return {
    get: (s, k) => tx(s, 'readonly', o => o.get(k)).catch(() => undefined),
    put: (s, k, v) => tx(s, 'readwrite', o => o.put(v, k)).catch(() => {}),
    del: (s, k) => tx(s, 'readwrite', o => o.delete(k)).catch(() => {}),
  };
})();
const clean = d => JSON.parse(JSON.stringify(d, (k, v) => k.startsWith('_') ? undefined : v));
async function persistLocal() { await idb.put('kv', 'db', clean(db)); }
let syncT = null;
function changed() { typesDirty = true; persistLocal(); clearTimeout(syncT); syncT = setTimeout(flushSync, 2500); }
function flushSync() { clearTimeout(syncT); syncT = null; if (token) sync(); }

// ══ TOAST / MODAL ═══════════════════════════════════════════════════════════
let toastT;
function toast(msg, err = false, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block';
  clearTimeout(toastT); toastT = setTimeout(() => t.style.display = 'none', ms);
}
function modal(html, { dismiss = true, sheet = false } = {}) {
  const o = document.createElement('div'); o.className = 'overlay' + (sheet ? ' sheet' : '');
  o.innerHTML = `<div class="modal">${html}</div>`;
  if (dismiss) o.addEventListener('click', e => { if (e.target === o) o.remove(); });
  document.body.appendChild(o);
  o.close = () => o.remove();
  return o;
}

// ══ GOOGLE: LOGOWANIE ═══════════════════════════════════════════════════════
let token = null, tokenExp = 0, tokenClient = null, tokenResolve = null, tokenInFlight = null;
const googleHint = () => localStorage.getItem(LS('google_email')) || '';
function loadGIS() {
  return new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) { res(); return; }
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client';
    s.onload = res; s.onerror = rej; document.head.appendChild(s);
  });
}
function initGIS() {
  if (!window.google?.accounts?.oauth2) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPE,
    ...(googleHint() ? { login_hint: googleHint() } : {}),
    callback: r => {
      const done = tokenResolve; tokenResolve = null;
      if (r.error) { token = null; updateSync(); done?.(false); return; }
      token = r.access_token;
      tokenExp = Date.now() + ((Number(r.expires_in) || 3600) - 120) * 1000;
      localStorage.setItem(LS('connected'), '1');
      updateSync(); showBanner(false);
      if (!googleHint()) setTimeout(rememberAccount, 0);
      done?.(true);
    },
    error_callback: () => { const done = tokenResolve; tokenResolve = null; done?.(false); },
  });
}
async function rememberAccount() {
  try { const r = await driveFetch(`${API}/about?fields=user(emailAddress)`); const d = await r.json(); if (d?.user?.emailAddress) localStorage.setItem(LS('google_email'), d.user.emailAddress); } catch (e) {}
}
async function ensureToken(interactive = false) {
  if (token && Date.now() < tokenExp) return true;
  token = null;
  if (tokenInFlight) return tokenInFlight;
  tokenInFlight = (async () => {
    try {
      if (location.protocol === 'file:') { toast('Logowanie Google działa tylko przez https (GitHub Pages)', true); return false; }
      await loadGIS(); if (!tokenClient) initGIS(); if (!tokenClient) return false;
      return await new Promise(res => {
        let settled = false;
        tokenResolve = ok => { if (settled) return; settled = true; res(ok); };
        setTimeout(() => { if (!settled) { settled = true; tokenResolve = null; res(false); } }, interactive ? 120000 : 10000);
        try {
          const hint = googleHint();
          tokenClient.requestAccessToken(interactive && !hint ? {} : { prompt: '', ...(hint ? { login_hint: hint } : {}) });
        } catch (e) { if (!settled) { settled = true; tokenResolve = null; res(false); } }
      });
    } catch (e) { return false; }
    finally { setTimeout(() => tokenInFlight = null, 0); }
  })();
  return tokenInFlight;
}
async function connect() {
  const ok = await ensureToken(true);
  if (!ok) { toast('Nie udało się połączyć z Google', true); return false; }
  toast('✅ Połączono z Dyskiem Google');
  await sync();
  if (pendingFiles) { const f = pendingFiles; pendingFiles = null; importFiles(f); }
  return true;
}
async function driveFetch(url, opts = {}, retry = true) {
  if (!await ensureToken()) throw new Error('Brak połączenia z kontem Google');
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
  if (r.status === 401) {
    token = null; tokenExp = 0; updateSync();
    if (retry && await ensureToken()) return driveFetch(url, opts, false);
    throw new Error('Sesja Google wygasła — połącz się ponownie');
  }
  if (!r.ok && r.status !== 404) { let m = r.status; try { m = (await r.clone().json()).error?.message || m; } catch (e) {} throw new Error('Drive: ' + m); }
  return r;
}
function disconnect() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null; tokenExp = 0; tokenClient = null; folders = null;
  ['connected', 'google_email', 'folder_id', 'raw_id', 'db_id'].forEach(k => localStorage.removeItem(LS(k)));
  updateSync(); toast('Odłączono konto Google. Dane w tej przeglądarce zostały.');
}
let syncState = 'idle';
function updateSync() {
  const cls = syncState === 'sync' ? 'busy' : syncState === 'err' ? 'err' : token ? 'ok' : '';
  $$('.sync-dot').forEach(d => d.className = 'sync-dot ' + cls);
  const t = $('#side-sync');
  if (t) t.textContent = syncState === 'sync' ? 'Synchronizuję…' : syncState === 'err' ? 'Błąd synchronizacji' : token ? 'Dysk połączony' : 'Połącz z Dyskiem';
}
function showBanner(show, msg = 'Nie połączono z Google — dane mogą być nieaktualne') {
  let b = $('#gbanner');
  if (!show) { b?.remove(); return; }
  if (b) return;
  b = document.createElement('div'); b.id = 'gbanner'; b.className = 'banner';
  b.innerHTML = `<span>☁ ${esc(msg)}</span><button class="btn-sm">Połącz</button><button class="btn-x" title="Ukryj">✕</button>`;
  b.querySelector('.btn-sm').onclick = () => { showBanner(false); connect(); };
  b.querySelector('.btn-x').onclick = () => showBanner(false);
  document.body.appendChild(b);
}

// ══ GOOGLE DRIVE: PLIKI ═════════════════════════════════════════════════════
const q = s => encodeURIComponent(s);
async function findOrCreateFolder(name, parent, lsKey) {
  const cached = localStorage.getItem(LS(lsKey));
  if (cached) {
    const r = await driveFetch(`${API}/files/${cached}?fields=id,trashed`);
    if (r.ok) { const d = await r.json(); if (!d.trashed) return cached; }
  }
  const query = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent}' in parents`;
  const r = await driveFetch(`${API}/files?q=${q(query)}&fields=files(id)&orderBy=createdTime`);
  let id = (await r.json()).files?.[0]?.id;
  if (!id) {
    const c = await driveFetch(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
    id = (await c.json()).id;
  }
  localStorage.setItem(LS(lsKey), id);
  return id;
}
let folders = null;
async function ensureFolders() {
  if (folders) return folders;
  const root = await findOrCreateFolder(FOLDER, 'root', 'folder_id');
  const raw = await findOrCreateFolder(RAW_FOLDER, root, 'raw_id');
  return folders = { root, raw };
}
function multipart(meta, data, type) {
  const b = 'przebieg' + Math.random().toString(36).slice(2);
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`,
    data, `\r\n--${b}--`]);
  return { body, headers: { 'Content-Type': 'multipart/related; boundary=' + b } };
}
async function findDbFile() {
  const { root } = await ensureFolders();
  const cached = localStorage.getItem(LS('db_id'));
  if (cached) {
    const r = await driveFetch(`${API}/files/${cached}?fields=id,trashed,modifiedTime`);
    if (r.ok) { const d = await r.json(); if (!d.trashed) return d; }
  }
  const r = await driveFetch(`${API}/files?q=${q(`name='${DB_FILE}' and trashed=false and '${root}' in parents`)}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  const f = (await r.json()).files?.[0] || null;
  if (f) localStorage.setItem(LS('db_id'), f.id); else localStorage.removeItem(LS('db_id'));
  return f;
}
async function downloadDb() {
  const f = await findDbFile(); if (!f) return null;
  const r = await driveFetch(`${API}/files/${f.id}?alt=media`);
  if (!r.ok) return null;
  return r.json();
}
async function uploadDb(data) {
  const { root } = await ensureFolders();
  const f = await findDbFile();
  const { body, headers } = multipart(f ? { name: DB_FILE } : { name: DB_FILE, parents: [root], mimeType: 'application/json' }, JSON.stringify(clean(data)), 'application/json');
  const r = await driveFetch(f ? `${UPLOAD}/files/${f.id}?uploadType=multipart&fields=id` : `${UPLOAD}/files?uploadType=multipart&fields=id`, { method: f ? 'PATCH' : 'POST', headers, body });
  const j = await r.json(); if (!j.id) throw new Error('Nie zapisano bazy na Drive');
  localStorage.setItem(LS('db_id'), j.id);
}
async function uploadRaw(name, buf, id) {
  const { raw } = await ensureFolders();
  const { body, headers } = multipart({ name, parents: [raw], mimeType: 'application/octet-stream', appProperties: { przebiegId: id } }, buf, 'application/octet-stream');
  const r = await driveFetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers, body });
  const j = await r.json(); if (!j.id) throw new Error('Nie zapisano pliku ' + name);
  return j.id;
}
async function downloadRaw(fileId) {
  const r = await driveFetch(`${API}/files/${fileId}?alt=media`);
  if (!r.ok) throw new Error('Nie znaleziono pliku źródłowego na Drive');
  return r.arrayBuffer();
}
async function trashFile(fileId) {
  try { await driveFetch(`${API}/files/${fileId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); } catch (e) {}
}

// ══ SYNCHRONIZACJA ══════════════════════════════════════════════════════════
// Scalanie: suma po id, nowsza wersja (updated) wygrywa, usunięte nie wracają.
function mergeList(a = [], b = [], deleted) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    if (deleted.has(x.id)) continue;
    const cur = m.get(x.id);
    if (!cur || (x.updated || 0) > (cur.updated || 0)) m.set(x.id, x);
  }
  return [...m.values()];
}
function mergeDb(a, b) {
  a = normalizeDb(a); b = normalizeDb(b);
  const deleted = new Set([...a.deleted, ...b.deleted]);
  const bDel = new Set([...a.bodyDeleted, ...b.bodyDeleted]);
  return {
    version: 2,
    activities: mergeList(a.activities, b.activities, deleted).sort((x, y) => y.start - x.start),
    deleted: [...deleted],
    body: mergeList(a.body, b.body, bDel).sort((x, y) => x.ts - y.ts),
    bodyDeleted: [...bDel],
    settings: (b.settings.updated || 0) > (a.settings.updated || 0) ? b.settings : a.settings,
    plan: ((b.plan?.updated || 0) > (a.plan?.updated || 0) ? b.plan : a.plan) || null,
    savedAt: Math.max(a.savedAt || 0, b.savedAt || 0),
  };
}
const sig = d => { d = normalizeDb(d); return JSON.stringify([d.activities.map(a => a.id + ':' + (a.updated || 0)).sort(), [...d.deleted].sort(), d.body.map(x => x.id + ':' + (x.updated || 0)).sort(), [...d.bodyDeleted].sort(), d.settings.updated || 0, d.plan?.updated || 0]); };
let syncing = null;
async function sync({ quiet = true } = {}) {
  if (syncing) return syncing;
  syncing = (async () => {
    if (!await ensureToken()) { if (localStorage.getItem(LS('connected'))) showBanner(true); return false; }
    syncState = 'sync'; updateSync();
    try {
      const before = sig(db);
      const remote = await downloadDb();
      if (remote) db = mergeDb(db, remote);
      if (!remote || sig(db) !== sig(remote)) { db.savedAt = Date.now(); await uploadDb(db); }
      localStorage.setItem(LS('last_sync'), String(Date.now()));
      await persistLocal();
      syncState = 'idle'; updateSync();
      if (sig(db) !== before) { typesDirty = true; renderAll(); }
      if (!quiet) toast('☁ Zsynchronizowano');
      maybeOfferRecompute();
      return true;
    } catch (e) {
      syncState = 'err'; updateSync();
      toast('Błąd synchronizacji: ' + e.message, true, 5000);
      return false;
    }
  })().finally(() => setTimeout(() => syncing = null, 0));
  return syncing;
}

// ══ IMPORT ══════════════════════════════════════════════════════════════════
let vendor;
const getVendor = async () => vendor ||= await import('./vendor.js?v=20261113b');
async function expandFiles(fileList) {
  const V = await getVendor();
  const out = [];
  const fromZip = (u8, depth) => {
    const files = V.unzipSync(u8, { filter: f => /\.(fit|zip|csv)$/i.test(f.name) });
    for (const [name, data] of Object.entries(files)) {
      if (/\.zip$/i.test(name)) { if (depth < 3) fromZip(data, depth + 1); }
      else out.push({ name: name.split('/').pop(), path: name, buf: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
    }
  };
  for (const f of fileList) {
    const buf = await f.arrayBuffer();
    if (/\.zip$/i.test(f.name)) {
      try { fromZip(new Uint8Array(buf), 0); }
      catch (e) { toast(`Nie udało się rozpakować ${f.name}. Jeśli ZIP jest zabezpieczony hasłem (eksport Zepp), rozpakuj go w telefonie i wgraj sam plik CSV.`, true, 7000); }
    } else out.push({ name: f.name, path: f.name, buf });
  }
  return out;
}
async function importFiles(fileList) {
  if (!fileList?.length) return;
  const m = modal(`<h3>Import</h3><p id="imp-msg">Przygotowuję pliki…</p><div class="progress"><i id="imp-bar"></i></div>`, { dismiss: false });
  const setMsg = (t, p) => { m.querySelector('#imp-msg').textContent = t; if (p != null) m.querySelector('#imp-bar').style.width = (p * 100) + '%'; };
  let items;
  try { items = await expandFiles(fileList); } catch (e) { m.close(); toast('Błąd: ' + e.message, true); return; }
  const fits = items.filter(x => /\.fit$/i.test(x.name));
  // CSV z wagi: z eksportu Zepp bierzemy tylko pliki z pomiarami ciała
  const csvs = items.filter(x => /\.csv$/i.test(x.name));
  if (!fits.length && !csvs.length) { m.close(); toast('Nie znaleziono plików .fit ani .csv', true); return; }
  if (fits.length && !token && !await ensureToken()) {
    m.close(); pendingFiles = fileList;
    showBanner(true, 'Połącz z Google, żeby zapisać treningi na Dysku');
    return;
  }
  const V = await getVendor();
  const added = [], dup = [], bad = [];
  let bodyAdded = 0;
  const deleted = new Set(db.deleted);
  for (let i = 0; i < fits.length; i++) {
    const it = fits[i];
    setMsg(`${i + 1} / ${fits.length}: ${it.name}`, i / Math.max(1, fits.length));
    try {
      let parsed;
      try { parsed = C.parseFit(it.buf, V); }
      catch (err) { const b = C.parseFitBody(it.buf, V); if (b.length) { bodyAdded += addBodyEntries(b); continue; } throw err; }
      const { summary, streams } = C.buildActivity(parsed);
      if (byId(summary.id)) { dup.push(it.name); continue; }
      if (deleted.has(summary.id)) db.deleted = db.deleted.filter(x => x !== summary.id);
      const d = new Date(summary.start), pad = n => String(n).padStart(2, '0');
      const rawName = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}_${summary.sport}.fit`;
      summary.fileId = await uploadRaw(rawName, it.buf, summary.id);
      summary.fileName = it.name;
      if (C.isRun(summary) && S().defaultShoe) summary.shoe = S().defaultShoe;
      summary.updated = Date.now();
      db.activities.push(summary);
      await idb.put('streams', summary.id, streams);
      added.push(summary);
    } catch (e) { bad.push(`${it.name}: ${e.message}`); }
  }
  for (const c of csvs) {
    if (csvs.length > 1 && !/body|weight|waga|scale/i.test(c.path)) continue;
    const entries = A.parseBodyCsv(new TextDecoder().decode(c.buf));
    if (entries.length) bodyAdded += addBodyEntries(entries);
    else if (csvs.length === 1) bad.push(`${c.name}: nie rozpoznano kolumn z datą i wagą`);
  }
  db.activities.sort((a, b) => b.start - a.start);
  setMsg('Zapisuję na Dysku…', 1);
  typesDirty = true;
  await persistLocal();
  if (token) await sync();
  m.close();
  renderAll();
  for (const a of added.slice(0, 15)) fetchWeather(a);
  if (activePlan() && added.length <= 5) {
    for (const a of added.filter(C.isRun).sort((x, y) => x.start - y.start)) {
      const st = P.linkStatus(db.plan, acts(), S(), a);
      if (st.inPlan && !st.off && !st.sure && st.cands.length) await askPlanLink(a);
    }
    renderAll();
  }
  showImportResult(added, dup, bad, bodyAdded);
}
function addBodyEntries(entries) {
  let n = 0;
  const del = new Set(db.bodyDeleted);
  for (const e of entries) {
    const id = A.bodyId(e.ts);
    if (db.body.some(x => x.id === id) || del.has(id)) continue;
    db.body.push({ ...e, id, updated: Date.now() }); n++;
  }
  db.body.sort((a, b) => a.ts - b.ts);
  return n;
}
function showImportResult(added, dup, bad, bodyAdded) {
  ensureTypes();
  let html = `<h3>${added.length ? '✅ Zaimportowano ' + added.length + ' ' + plural(added.length, 'trening', 'treningi', 'treningów') : bodyAdded ? '✅ Pomiary dodane' : 'Brak nowych danych'}</h3>`;
  if (bodyAdded) html += `<p>Pomiary ciała: +${bodyAdded}.</p>`;
  if (added.length && added.length <= 5) {
    const recs = added.flatMap(a => C.newRecordsFor(a, acts()));
    if (recs.length) html += `<div class="pr-list">${recs.map(prItemHtml).join('')}</div>`;
  } else if (added.length > 5) html += `<p>Rekordy i raport kondycji znajdziesz w zakładce <b>Postęp</b>.</p>`;
  if (dup.length) html += `<p style="margin-top:10px">Pominięto ${dup.length} — już są w bazie.</p>`;
  if (bad.length) html += `<p style="margin-top:10px;color:var(--danger)">Błędy (${bad.length}):<br>${bad.slice(0, 5).map(esc).join('<br>')}</p>`;
  html += `<div class="actions">${added.length === 1 ? `<button class="btn" id="open-new">Pokaż raport</button>` : ''}<button class="btn-sm" id="ok-imp">OK</button></div>`;
  const m = modal(html);
  m.querySelector('#ok-imp').onclick = m.close;
  const o = m.querySelector('#open-new'); if (o) o.onclick = () => { m.close(); openDetail(added[0].id); };
}
function prItemHtml(r) {
  if (r.m === 'longest') return `<div class="pr-item">🏆 <span><b>Najdłuższy bieg:</b> ${C.fmtKm(r.distance)} km <span class="muted">(było ${C.fmtKm(r.prevDistance)} km)</span></span></div>`;
  const diff = r.prev ? ` <span class="muted">(−${C.fmtDur(r.prev - r.time)})</span>` : ' <span class="muted">(pierwszy wynik)</span>';
  return `<div class="pr-item">🏆 <span><b>${esc(r.label)}:</b> ${C.fmtDur(r.time)}${diff}</span></div>`;
}

async function getStreams(a) {
  let s = await idb.get('streams', a.id);
  if (s && s.engine === C.ENGINE_VERSION) return s;
  if (!a.fileId) return s || null;
  const buf = await downloadRaw(a.fileId);
  const V = await getVendor();
  const built = C.buildActivity(C.parseFit(buf, V));
  s = built.streams;
  await idb.put('streams', a.id, s);
  // przy okazji uzupełnij brakujące pola nowego silnika
  if ((a.engine || 0) < C.ENGINE_VERSION) { Object.assign(a, built.summary, keepFields(a)); a.updated = Date.now(); changed(); }
  return s;
}
const keepFields = a => ({ id: a.id, fileId: a.fileId, fileName: a.fileName, title: a.title, note: a.note, weather: a.weather, shoe: a.shoe, kind: a.kind });
async function recomputeAll() {
  if (!await ensureToken(true)) { toast('Najpierw połącz się z Google', true); return; }
  const list = acts().filter(a => a.fileId);
  const m = modal(`<h3>Przeliczanie treningów</h3><p id="rc-msg"></p><div class="progress"><i id="rc-bar"></i></div>`, { dismiss: false });
  const V = await getVendor();
  let ok = 0, fail = 0;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    m.querySelector('#rc-msg').textContent = `${i + 1} / ${list.length}`;
    m.querySelector('#rc-bar').style.width = (i / list.length * 100) + '%';
    try {
      const { summary, streams } = C.buildActivity(C.parseFit(await downloadRaw(a.fileId), V));
      Object.assign(a, summary, keepFields(a), { updated: Date.now() });
      await idb.put('streams', a.id, streams); ok++;
    } catch (e) { fail++; }
  }
  typesDirty = true;
  await persistLocal(); await sync(); m.close(); renderAll();
  toast(`♻ Przeliczono ${ok}${fail ? ', błędy: ' + fail : ''}`);
}
let recomputeOffered = false;
function maybeOfferRecompute() {
  if (recomputeOffered) return;
  const old = acts().filter(a => (a.engine || 0) < C.ENGINE_VERSION && a.fileId).length;
  if (!old) return;
  recomputeOffered = true;
  const m = modal(`<h3>Nowe analizy treningów</h3><p>Ta wersja liczy strefy tętna, obciążenie i raport dla każdego biegu. ${old} ${plural(old, 'trening trzeba', 'treningi trzeba', 'treningów trzeba')} raz przeliczyć z oryginalnych plików FIT na Dysku. Zajmie to chwilę.</p><div class="actions"><button class="btn ghost" id="rc-no">Później</button><button class="btn-sm" id="rc-yes">Przelicz teraz</button></div>`);
  m.querySelector('#rc-no').onclick = m.close;
  m.querySelector('#rc-yes').onclick = () => { m.close(); recomputeAll(); };
}

// ══ POGODA (Open-Meteo, bez klucza) ═════════════════════════════════════════
const weatherBusy = new Set();
async function fetchWeather(a) {
  if (!a.startPos || a.weather || weatherBusy.has(a.id) || Date.now() - a.start < 3600e3) return;
  weatherBusy.add(a.id);
  try {
    const mid = a.start + (a.elapsed || a.timer || 0) * 500;
    const day = new Date(mid).toISOString().slice(0, 10);
    const params = `latitude=${a.startPos[0]}&longitude=${a.startPos[1]}&start_date=${day}&end_date=${day}&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation&timezone=GMT`;
    const recent = Date.now() - mid < 80 * DAY;
    const urls = recent ? [`https://api.open-meteo.com/v1/forecast?${params}`, `https://archive-api.open-meteo.com/v1/archive?${params}`]
      : [`https://archive-api.open-meteo.com/v1/archive?${params}`];
    for (const u of urls) {
      try {
        const r = await fetch(u); if (!r.ok) continue;
        const j = await r.json(); const h = j.hourly; if (!h?.time) continue;
        const hr = new Date(mid).getUTCHours() + (new Date(mid).getUTCMinutes() >= 30 ? 1 : 0);
        const i = Math.min(h.time.length - 1, hr);
        if (h.temperature_2m?.[i] == null) continue;
        a.weather = { t: h.temperature_2m[i], feels: h.apparent_temperature?.[i], rh: h.relative_humidity_2m?.[i], wind: h.wind_speed_10m?.[i], prec: h.precipitation?.[i] };
        a.updated = Date.now(); changed();
        if (cur === a) renderReport();
        return;
      } catch (e) {}
    }
  } finally { weatherBusy.delete(a.id); }
}

// ══ ELEMENTY WSPÓLNE ════════════════════════════════════════════════════════
function activityTitle(a) {
  if (a.title) return a.title;
  if (C.isStrength(a)) return 'Trening siłowy';
  if (a._type && A.TYPES[a._type] && a._type !== 'other') return A.TYPES[a._type].label;
  const h = new Date(a.start).getHours();
  const pora = h < 5 ? 'nocny' : h < 11 ? 'poranny' : h < 17 ? 'popołudniowy' : h < 22 ? 'wieczorny' : 'nocny';
  return C.isRun(a) ? `Bieg ${pora}` : (SPORT_PL[a.sport] || a.sport);
}
const typePill = a => { if (C.isStrength(a)) return `<span class="pill mid"><i></i>Trening siłowy</span>`; const t = A.TYPES[a._type] || A.TYPES.other; return `<span class="pill ${t.tone}"><i></i>${esc(t.label)}</span>`; };
const speedOrPace = a => C.isRun(a) ? { v: C.fmtPace(a.pace), u: '/km' } : { v: a.timer ? (a.distance / a.timer * 3.6).toFixed(1).replace('.', ',') : '–', u: 'km/h' };
function routeThumb(route, size = 58) {
  if (!route || route.length < 2) return `<svg class="thumb" viewBox="0 0 58 58"><path d="M20 38l8-11 6 6 7-9" stroke="#555" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`;
  const k = Math.cos(route[0][0] * Math.PI / 180);
  const xs = route.map(p => p[1] * k), ys = route.map(p => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1, pad = 8, sc = (size - 2 * pad) / span;
  const ox = pad + ((size - 2 * pad) - (maxX - minX) * sc) / 2, oy = pad + ((size - 2 * pad) - (maxY - minY) * sc) / 2;
  const d = xs.map((x, i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * sc).toFixed(1)},${(oy + (ys[i] - minY) * sc).toFixed(1)}`).join('');
  return `<svg class="thumb" viewBox="0 0 ${size} ${size}"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function prMarks() {
  const marks = new Map();
  for (const { m, label } of C.BEST_DISTANCES) for (const p of C.recordProgression(acts(), m)) { if (!marks.has(p.id)) marks.set(p.id, []); marks.get(p.id).push(label); }
  return marks;
}
const chartBase = (extra = {}) => ({
  animation: false, responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000e', borderColor: '#3a3a3e', borderWidth: 1, displayColors: false } },
  ...extra,
});
let viewCharts = [];
function killCharts() { viewCharts.forEach(c => c.destroy()); viewCharts = []; }

// ══ PULPIT ══════════════════════════════════════════════════════════════════
function renderHome() {
  const el = $('#view-home');
  if (!acts().length && !db.body.length) { el.innerHTML = welcomeHtml(); bindWelcome(el); return; }
  ensureTypes();
  const now = Date.now(), s = S();
  const runs = acts().filter(C.isRun);
  const last = runs[0];
  let html = activePlan() ? todayCardHtml(true) : `<div class="card next"><div class="ic">${icon('spark')}</div><div><div class="t">Następny krok</div><p>${esc(A.nextStep(null, acts(), s, now))}</p></div></div>`;
  html += homeExtrasHtml(now);
  if (last) {
    const rep = A.workoutReport(last, acts(), s);
    const sp = speedOrPace(last);
    html += `<div class="sec">Ostatni trening<a data-go="list">Wszystkie ›</a></div>
      <div class="card last" data-id="${last.id}">${routeThumb(last.route)}
        <div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${typePill(last)}<span class="muted small">${fmtDateShort(last.start)}, ${fmtTime(last.start)}</span></div>
        <div class="last-stats num"><span>${C.fmtKm(last.distance)}<small>km</small></span><span>${C.fmtDur(last.timer)}</span><span>${sp.v}<small>${sp.u}</small></span></div>
        <div class="muted small" style="margin-top:6px;line-height:1.45">${esc(rep.summary)} <span style="color:var(--accent);font-weight:700">Raport ›</span></div></div></div>`;
  }
  // tydzień
  const ws = C.weekStart(now);
  const wk = [0, 0, 0, 0, 0, 0, 0];
  runs.filter(a => a.start >= ws).forEach(a => { wk[(new Date(a.start).getDay() + 6) % 7] += a.distance / 1000; });
  const wkKm = wk.reduce((x, y) => x + y, 0), wkN = runs.filter(a => a.start >= ws).length;
  const maxD = Math.max(1, ...wk);
  const series = A.loadSeries(acts(), s, 60, now);
  const today = series[series.length - 1];
  const fl = A.freshnessLabel(today?.tsb ?? 0);
  const ref = A.easyHrMax(s);
  const pNow = A.paceAtHr(acts(), ref, now - 28 * DAY, now), pPrev = A.paceAtHr(acts(), ref, now - 56 * DAY, now - 28 * DAY);
  const bodyR = A.bodyReport(db.body, s, now);
  html += `<div class="sec">Podsumowanie</div><div class="grid2">
    <div class="card pad stat"><div class="lbl">Ten tydzień</div><div class="val num">${dec1(wkKm)}<small>km</small></div><div class="sub">${wkN} ${plural(wkN, 'bieg', 'biegi', 'biegów')}</div>
      <div class="week-bars">${wk.map((v, i) => `<div><b class="${v ? '' : 'zero'}" style="height:${v ? Math.max(8, v / maxD * 100) : 6}%"></b><span>${'PWŚCPSN'[i]}</span></div>`).join('')}</div></div>
    <div class="card pad stat"><div class="lbl">Forma treningowa</div><div class="val num">${Math.round(today?.ctl || 0)}<small>pkt</small></div><div class="sub"><b style="color:${fl.tone === 'ok' ? 'var(--accent)' : fl.tone === 'warn' ? 'var(--warn)' : 'var(--danger)'}">${fl.label}</b> · ${fl.note}</div></div>
    <div class="card pad stat"><div class="lbl">Tempo przy ${ref} bpm</div><div class="val num">${pNow ? C.fmtPace(pNow.pace) : '–'}<small>/km</small></div><div class="sub">${pNow && pPrev ? deltaHtml(pPrev.pace - pNow.pace, 's/km', true) + ' w miesiąc' : 'potrzeba więcej łatwych biegów'}</div></div>
    <div class="card pad stat" data-go="body" style="cursor:pointer"><div class="lbl">Waga (średnia 7 dni)</div><div class="val num">${bodyR ? dec1(bodyR.wNow) : '–'}<small>kg</small></div><div class="sub">${bodyR && bodyR.w30 ? deltaHtml(bodyR.wNow - bodyR.w30, 'kg', false, true) + ' w 30 dni' : bodyR ? 'za mało pomiarów na trend' : 'dodaj pierwszy pomiar'}</div></div>
  </div>`;
  // intensywność 4 tygodnie
  const split = A.intensitySplit(acts(), s, now - 28 * DAY, now);
  const tot = split[0] + split[1] + split[2];
  if (tot > 0) {
    const zs = A.zonesFor(s.lthr);
    html += `<div class="sec">Intensywność · 4 tygodnie</div><div class="card pad">
      <div class="split-bar">${[0, 1, 2].map(i => split[i] ? `<i style="width:${split[i] / tot * 100}%;background:var(--z${[2, 3, 5][i]})"></i>` : '').join('')}</div>
      <div class="legend"><span><i style="background:var(--z2)"></i>Łatwo (do ${zs[2].hi}) ${Math.round(split[0] / tot * 100)}%</span><span><i style="background:var(--z3)"></i>Próg ${Math.round(split[1] / tot * 100)}%</span><span><i style="background:var(--z5)"></i>Powyżej progu ${Math.round(split[2] / tot * 100)}%</span></div>
      <p class="muted small" style="margin-top:10px;line-height:1.5">Cel: ok. 80% czasu łatwo. ${split[0] / tot >= 0.75 ? 'Trzymasz proporcje 👍' : 'Biegasz za mocno — zwolnij większość biegów.'}</p></div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-id]').forEach(x => x.onclick = () => openDetail(x.dataset.id));
  el.querySelectorAll('[data-go]').forEach(x => x.onclick = e => { e.stopPropagation(); setView(x.dataset.go); });
  bindTodayCard(el);
  bindHomeExtras(el);
}
// lower=true → spadek wartości jest dobry (tempo, waga)
function deltaHtml(v, unit, positiveGood = true, lowerGood = false) {
  if (v == null || !Number.isFinite(v)) return '';
  const good = lowerGood ? v < 0 : v > 0;
  const txt = unit === 's/km' ? `${v > 0 ? '−' : '+'}${Math.abs(Math.round(v))} s/km` : `${v > 0 ? '+' : '−'}${dec1(Math.abs(v))} ${unit}`;
  if (Math.abs(v) < (unit === 'kg' ? 0.1 : 2)) return `<span class="delta">bez zmian</span>`;
  return `<span class="delta ${good ? 'up' : 'down'}">${txt}</span>`;
}
function welcomeHtml() {
  return `<div class="welcome">
    <svg width="56" height="56" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#1c1c1e"/><path d="M14 44 L26 28 L34 36 L50 18" stroke="#4ade80" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <h2>Twój dziennik biegowy</h2>
    <p>Wgrywasz pliki FIT z zegarka, a Przebieg pisze raport z każdego biegu, liczy rekordy, kondycję i skład ciała. Wszystko trzyma w folderze <b>„Przebieg”</b> na Twoim Dysku Google.</p>
    <div class="steps">
      <div><b>1. Połącz z Google</b> — aplikacja widzi tylko pliki, które sama utworzy.</div>
      <div><b>2. Wyeksportuj FIT.</b> Zepp: trening → ⋯ → <i>Eksportuj</i> → FIT. Garmin Connect: trening → ⚙ → <i>Eksportuj oryginał</i> (ZIP wgrywasz tak, jak jest).</div>
      <div><b>3. Stuknij „+”</b> albo przeciągnij pliki na okno.</div>
    </div>
    ${token ? `<button class="btn-primary" data-w="import">${icon('plus')} Wgraj pierwsze treningi</button>` : `<button class="btn-primary" data-w="connect">Połącz z Dyskiem Google</button>`}
  </div>`;
}
function bindWelcome(el) {
  el.querySelector('[data-w="connect"]')?.addEventListener('click', connect);
  el.querySelector('[data-w="import"]')?.addEventListener('click', () => $('#file-input').click());
}

// ══ TRENINGI ════════════════════════════════════════════════════════════════
function renderList() {
  const el = $('#view-list');
  if (!acts().length) { el.innerHTML = welcomeHtml(); bindWelcome(el); return; }
  ensureTypes();
  const strN = acts().filter(C.isStrength).length;
  let html = `<div class="seg">${[['run', 'Bieganie'], ['strength', `Siła${strN ? ' (' + strN + ')' : ''}`]].map(([k, l]) => `<button class="${listMode === k ? 'active' : ''}" data-lm="${k}">${l}</button>`).join('')}</div>`;
  if (listMode === 'strength') { el.innerHTML = html + strengthHtml(); bindList(el); return; }
  const runs = acts().filter(C.isRun);
  const others = acts().filter(a => !C.isRun(a) && !C.isStrength(a)).length;
  html += `<div class="chips" style="margin:10px 0 4px">
    ${[['run', `Biegi (${runs.length})`], ['easy', 'Łatwe'], ['hard', 'Mocne'], ...(others ? [['all', `Wszystko (${acts().length})`]] : [])].map(([k, l]) => `<button class="chip ${listFilter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}</div>`;
  const tone = a => (A.TYPES[a._type] || A.TYPES.other).tone;
  const list = listFilter === 'all' ? acts().filter(a => !C.isStrength(a)) : listFilter === 'easy' ? runs.filter(a => tone(a) === 'easy') : listFilter === 'hard' ? runs.filter(a => tone(a) !== 'easy') : runs;
  const marks = prMarks();
  let curM = null;
  for (const a of list) {
    const d = new Date(a.start), key = d.getFullYear() * 12 + d.getMonth();
    if (key !== curM) {
      curM = key;
      const inM = list.filter(x => { const xd = new Date(x.start); return xd.getFullYear() * 12 + xd.getMonth() === key; });
      html += `<div class="month-h">${MONTHS[d.getMonth()]} ${d.getFullYear()}<span class="num">${C.fmtKm(inM.reduce((s, x) => s + x.distance, 0), 1)} km · ${inM.length}×</span></div>`;
    }
    const sp = speedOrPace(a), pr = marks.get(a.id);
    html += `<div class="act" data-id="${a.id}">${routeThumb(a.route)}
      <div class="info">
        <div class="row1">${typePill(a)}${pr ? `<span class="pill gold" title="${esc(pr.join(', '))}">🏆 ${pr.length > 1 ? pr.length + ' rekordy' : esc(pr[0])}</span>` : ''}</div>
        <div class="when">${DAYS[d.getDay()]}, ${fmtDate(a.start)} · ${fmtTime(a.start)}${a.title ? ' · ' + esc(a.title) : ''}</div>
        <div class="stats num"><span>${C.fmtKm(a.distance)}<small>km</small></span><span>${C.fmtDur(a.timer)}</span><span>${sp.v}<small>${sp.u}</small></span>${a.avgHr ? `<span>${a.avgHr}<small>bpm</small></span>` : ''}</div>
      </div></div>`;
  }
  if (!list.length) html += `<div class="empty">Brak treningów w tym filtrze.</div>`;
  el.innerHTML = html;
  bindList(el);
}
function bindList(el) {
  el.querySelectorAll('[data-lm]').forEach(b => b.onclick = () => { listMode = b.dataset.lm; renderList(); });
  el.querySelectorAll('.chip[data-f]').forEach(c => c.onclick = () => { listFilter = c.dataset.f; renderList(); });
  el.querySelectorAll('.act').forEach(c => c.onclick = () => openDetail(c.dataset.id));
}
function strengthHtml() {
  const list = acts().filter(C.isStrength).sort((a, b) => b.start - a.start);
  if (!list.length) return `<div class="empty">Tu pojawią się treningi siłowe z zegarka.<br>W Zepp: trening siłowy → Eksportuj → FIT, a potem „+” → Trening z zegarka.<br><br><span class="small">Jeśli trening siłowy trafił do biegów lub „Inne”, otwórz go i oznacz jako siłowy.</span></div>`;
  const now = Date.now(), ws = C.weekStart(now);
  const weeks = [];
  for (let k = 7; k >= 0; k--) { const f = ws - k * 7 * DAY; const inW = list.filter(a => a.start >= f && a.start < f + 7 * DAY); weeks.push({ f, n: inW.length, min: inW.reduce((x, a) => x + a.timer / 60, 0) }); }
  const thisW = weeks[weeks.length - 1], avgN = weeks.slice(0, -1).reduce((x, w) => x + w.n, 0) / 7;
  const maxN = Math.max(1, ...weeks.map(w => w.n));
  let html = `<div class="grid2" style="margin-top:10px">
    <div class="card pad stat"><div class="lbl">Ten tydzień</div><div class="val num">${thisW.n}<small>${plural(thisW.n, 'trening', 'treningi', 'treningów')}</small></div><div class="sub">${Math.round(thisW.min)} min · śr. ${dec1(avgN)}/tydz.</div></div>
    <div class="card pad stat"><div class="lbl">Ostatnie 8 tygodni</div><div class="week-bars" style="margin-top:6px">${weeks.map(w => `<div title="${fmtDateShort(w.f)}: ${w.n}"><b class="${w.n ? '' : 'zero'}" style="height:${w.n ? Math.max(12, w.n / maxN * 100) : 6}%;background:var(--t-mid)"></b><span>${new Date(w.f).getDate()}</span></div>`).join('')}</div></div>
  </div>
  <p class="muted small" style="margin:12px 4px 0;line-height:1.5">Siła 1–2× w tygodniu w dni bez biegu chroni mięśnie podczas redukcji i stawy przy rosnącym kilometrażu. Treningi siłowe liczą się do obciążenia (forma/zmęczenie).</p>`;
  let curM = null;
  for (const a of list) {
    const d = new Date(a.start), key = d.getFullYear() * 12 + d.getMonth();
    if (key !== curM) { curM = key; const inM = list.filter(x => { const xd = new Date(x.start); return xd.getFullYear() * 12 + xd.getMonth() === key; }); html += `<div class="month-h">${MONTHS[d.getMonth()]} ${d.getFullYear()}<span class="num">${inM.length}× · ${Math.round(inM.reduce((x, y) => x + y.timer / 60, 0))} min</span></div>`; }
    html += `<div class="act" data-id="${a.id}"><svg class="thumb" viewBox="0 0 58 58"><path d="M17 29h24M14 23v12M44 23v12M19 25v8M39 25v8" stroke="#ffb347" stroke-width="3" stroke-linecap="round" fill="none"/></svg>
      <div class="info"><div class="row1">${typePill(a)}${a.te ? `<span class="pill">TE ${dec1(a.te)}</span>` : ''}</div>
      <div class="when">${DAYS[d.getDay()]}, ${fmtDate(a.start)} · ${fmtTime(a.start)}</div>
      <div class="stats num"><span>${C.fmtDur(a.timer)}</span>${a.avgHr ? `<span>${a.avgHr}<small>bpm śr.</small></span>` : ''}${a.calories ? `<span>${a.calories}<small>kcal</small></span>` : ''}<span>${Math.round(A.trainingLoad(a, S()))}<small>pkt</small></span></div></div></div>`;
  }
  return html;
}

// ══ SZCZEGÓŁY TRENINGU ══════════════════════════════════════════════════════
let map = null, mapLayers = [], hoverMarker = null, detailCharts = [], cur = null, curStreams = null, hl = null, hlLayer = null;
const PACE_RAMP = ['#264b8f', '#2f62b5', '#3b82f6', '#60a5fa', '#93c5fd', '#dbeafe'];
function closeDetail(keepHash = false) {
  $('#detail').classList.remove('open');
  detailCharts.forEach(c => c.destroy()); detailCharts = [];
  if (map) { map.remove(); map = null; }
  mapLayers = []; hlLayer = null; cur = null; curStreams = null; hl = null;
  if (!keepHash && location.hash.startsWith('#t=')) history.replaceState(null, '', location.pathname);
}
async function openDetail(id) {
  const a = byId(id); if (!a) return;
  ensureTypes();
  closeDetail(true);
  cur = a;
  if (!location.hash.startsWith('#t=')) history.pushState({ d: id }, '', '#t=' + id);
  $('#detail').classList.add('open');
  const d = new Date(a.start);
  $('#detail-title').innerHTML = `<b>${esc(activityTitle(a))}</b><span>${DAYS[d.getDay()]}, ${fmtDate(a.start)} · ${fmtTime(a.start)}${a.device ? ' · ' + esc(a.device) : ''}</span>`;
  $('#detail-body').scrollTop = 0;
  const run = C.isRun(a), sp = speedOrPace(a);
  if (C.isStrength(a) || (!run && !a.hasGps && !(a.distance > 200))) { strengthDetail(a); return; }
  const allTime = C.recordTables(acts(), 1);
  const stats = [
    ['Dystans', C.fmtKm(a.distance), 'km'], ['Czas', C.fmtDur(a.timer), ''], [run ? 'Tempo' : 'Prędkość', sp.v, sp.u],
    ['Tętno śr.', a.avgHr ?? '–', a.avgHr ? 'bpm' : ''], ['Tętno maks.', a.maxHr ?? '–', a.maxHr ? 'bpm' : ''], ['Przewyższenie', a.ascent ?? '–', 'm'],
    ['Kadencja', a.cadence ?? '–', a.cadence ? (run ? 'kr/min' : 'obr/min') : ''], ['Obciążenie', Math.round(A.trainingLoad(a, S())), 'pkt'],
  ];
  if (a.calories) stats.push(['Kalorie', a.calories, 'kcal']);
  let html = `${a.hasGps ? '<div style="position:relative"><div id="map"></div></div>' : ''}
    <div class="big-stats">${stats.map(([l, v, u]) => `<div><div class="lbl">${l}</div><div class="val num">${v}<small>${u}</small></div></div>`).join('')}</div>
    <div id="report-slot"></div>`;
  const effs = C.BEST_DISTANCES.filter(x => a.bests?.[x.m]);
  if (effs.length) html += `<div class="sec">Najlepsze odcinki w tym biegu</div><div class="effort-chips">${effs.map(x => `<button class="effort-chip ${allTime[x.m]?.[0]?.id === a.id ? 'pb' : ''}" data-m="${x.m}"><div class="l">${x.label}</div><div class="v num">${C.fmtDur(a.bests[x.m])}</div></button>`).join('')}</div>`;
  html += `<div class="sec">Wykresy</div><div class="hover-readout num" id="readout"><span class="muted">Dotknij wykresu, żeby zobaczyć szczegóły</span></div><div id="charts"><div class="card empty">Wczytuję dane…</div></div>`;
  html += `<div class="sec">Międzyczasy</div>${splitsHtml(a)}`;
  html += `<div class="sec">Jak było?</div><div class="card" id="note-slot"></div>`;
  if (run) html += `<div class="sec">Buty</div><div class="card pad" id="shoe-slot"></div>`;
  html += `<div style="display:flex;gap:8px;margin-top:22px;flex-wrap:wrap"><button class="btn" id="d-rename">✎ Zmień nazwę</button>${!run ? '<button class="btn" id="d-kind">To trening siłowy</button>' : ''}<button class="btn danger" id="d-del">Usuń trening</button></div>`;
  $('#detail-inner').innerHTML = html;
  renderReport(); renderNote(); renderShoePick();
  $('#d-kind')?.addEventListener('click', () => { a.kind = 'strength'; a.updated = Date.now(); changed(); openDetail(a.id); renderView(); });
  $('#d-rename').onclick = () => renameActivity(a);
  $('#d-del').onclick = () => deleteActivity(a);
  $$('.effort-chip').forEach(b => b.onclick = () => toggleEffort(b));
  fetchWeather(a);
  try {
    const s = await getStreams(a);
    if (cur !== a) return;
    curStreams = s;
    if (!s) { $('#charts').innerHTML = `<div class="card empty">Brak danych szczegółowych.</div>`; return; }
    if (a.hasGps) drawMap(s);
    drawCharts(s, run);
    renderReport();
  } catch (e) {
    if (cur !== a) return;
    $('#charts').innerHTML = `<div class="card empty">Nie udało się wczytać danych: ${esc(e.message)}<br><button class="btn-sm" style="margin-top:10px" id="retry-s">Połącz i spróbuj ponownie</button></div>`;
    $('#retry-s').onclick = async () => { if (await ensureToken(true)) openDetail(a.id); };
  }
}
function renderReport() {
  const a = cur, slot = $('#report-slot'); if (!a || !slot) return;
  ensureTypes();
  const s = S();
  const rep = A.workoutReport(a, acts(), s);
  const zs = A.zonesFor(s.lthr);
  let html = `<div class="card report"><div class="report-head">${typePill(a)}<b>Raport treningu</b><span class="muted">analiza z Twoich stref</span></div>`;
  if (rep.overview?.length) html += `<div class="overview"><b>Podsumowanie</b>${rep.overview.map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
  if (rep.facts.length) html += `<div class="facts">${rep.facts.map(f => `<span class="pill gold">${esc(f)}</span>`).join('')}</div>`;
  const planHtml = planCardHtml(a, s);
  if (planHtml) html += planHtml;
  html += `<div class="rep-sub">Szczegóły</div>` + rep.paras.map(p => `<p>${esc(p)}</p>`).join('');
  html += `<div class="nextbox"><b>Co dalej:</b> ${esc(rep.next)}</div></div>`;
  if (rep.zones) {
    const tot = rep.zones.reduce((x, y) => x + y, 0) || 1;
    const rows = zs.map((z, i) => ({ name: `${z.short}`, sub: `${z.name} · ${z.lo}–${z.hi}`, v: rep.zones[i + 1], c: `var(--z${i + 1})` }));
    if (rep.zones[0] > 30) rows.unshift({ name: '<Z1', sub: `poniżej ${zs[0].lo}`, v: rep.zones[0], c: 'var(--z0)' });
    html += `<div class="sec">Czas w strefach tętna</div><div class="card"><div class="zone-rows">${rows.reverse().map(r => `<div class="zone-row"><div class="zn" title="${esc(r.sub)}"><b>${r.name}</b>${r.sub.includes(' · ') ? `<span class="zname">${esc(r.sub.split(' · ')[0])} · </span>${esc(r.sub.split(' · ')[1])}` : esc(r.sub)}</div><div class="bar"><i style="width:${r.v / tot * 100}%;background:${r.c}"></i></div><div class="zt num">${C.fmtDur(r.v)}</div></div>`).join('')}</div></div>`;
  }
  if (a.weather) {
    const w = a.weather;
    html += `<div class="weather"><span class="pill">🌡 ${Math.round(w.t)}°C${w.feels != null ? ` (odcz. ${Math.round(w.feels)}°)` : ''}</span><span class="pill">💨 ${Math.round(w.wind)} km/h</span>${w.rh != null ? `<span class="pill">💧 ${Math.round(w.rh)}%</span>` : ''}${w.prec ? `<span class="pill">🌧 ${dec1(w.prec)} mm</span>` : ''}</div>`;
  }
  slot.innerHTML = html;
  slot.querySelectorAll('[data-link]').forEach(b => b.onclick = () => askPlanLink(a).then(() => { renderReport(); }));
}
// ── karta „Plan vs wykonanie” ──
function ringSvg(p, size = 64) {
  const r = size / 2 - 6, c = 2 * Math.PI * r, col = p >= 90 ? 'var(--accent)' : p >= 75 ? '#86efac' : p >= 55 ? 'var(--warn)' : 'var(--danger)';
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#ffffff14" stroke-width="7" fill="none"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${col}" stroke-width="7" fill="none" stroke-linecap="round" stroke-dasharray="${c * p / 100} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="${size * 0.26}" font-weight="800">${p}%</text></svg>`;
}
function planCardHtml(a, s) {
  if (!activePlan() || !C.isRun(a)) return '';
  const st = P.linkStatus(db.plan, acts(), s, a);
  if (!st.inPlan) return '';
  if (st.off || !st.ses) return `<div class="plan-card off"><div class="pc-head">${icon('plan')}<div style="flex:1"><div class="pc-k">${st.off ? 'Bieg poza planem' : 'Bieg nieprzypisany do planu'}</div><div class="muted small">${st.off ? 'Nie liczy się do oceny planu.' : 'Nie pasuje do żadnego treningu w terminie.'}</div></div><button class="pc-chg" data-link>Przypisz</button></div></div>`;
  const ps = st.ses, c = ps.comp || {}, info = P.sessionInfo(ps, s, db.plan);
  const idx = st.sch.sessions.indexOf(ps) + 1, weeks = P.planWeeks(db.plan);
  let html = `<div class="plan-card"><div class="pc-head">${c.pct != null ? ringSvg(c.pct) : ''}<div style="flex:1;min-width:0"><div class="pc-k">Trening z planu · tydzień ${ps.week}/${weeks} · ${idx} z ${st.sch.total}</div><b class="pc-t">${esc(info.title)}</b>${c.verdict ? `<div class="pc-v ${c.pct >= 75 ? 'ok' : c.pct >= 55 ? 'mid' : 'bad'}">${esc(c.verdict)}</div>` : '<div class="muted small">oznaczony ręcznie</div>'}</div><button class="pc-chg" data-link title="Zmień, który to trening">Zmień</button></div>`;
  if (c.parts?.length) {
    html += `<div class="pc-parts">${c.parts.map(p => `<div class="pc-part"><div class="pc-pt"><b>${esc(p.label)}</b><span class="pc-sc ${p.score >= 0.9 ? 'ok' : p.score >= 0.6 ? 'mid' : 'bad'}">${Math.round(p.score * p.share)}/${p.share}</span></div><div class="pc-bar"><i class="${p.score >= 0.9 ? 'ok' : p.score >= 0.6 ? 'mid' : 'bad'}" style="width:${Math.round(p.score * 100)}%"></i></div><div class="pc-pd"><span>plan: ${esc(p.plan)}</span><span>zrobione: <b>${esc(p.done)}</b></span></div></div>`).join('')}</div>`;
    html += `<div class="pc-tip">${esc(c.tip)}</div>`;
  }
  const pr = P.planProgress(db.plan, acts(), s);
  const c1 = v => v.toFixed(1).replace('.', ',');
  html += `<div class="pc-plan"><div class="pc-row"><span>Realizacja planu</span><b>${pr.exec != null ? pr.exec + '%' : '–'}</b></div><div class="progress"><i style="width:${pr.exec || 0}%"></i></div>
    <div class="muted small">${pr.done} z ${pr.total} treningów zrobione${pr.missed ? ` · opuszczone ${pr.missed}` : ''}${pr.quality != null ? ` · średnia ocena wykonania ${pr.quality}%` : ''}</div>`;
  if (pr.form) {
    const f = pr.form;
    html += `<div class="pc-row" style="margin-top:10px"><span>Prognoza ${esc(f.distLabel || '5 km')}</span><b>${C.fmtDur(f.predStart)} → ${C.fmtDur(f.predNow)}</b></div>`;
    if (f.goal) html += `<div class="muted small">cel ${C.fmtDur(f.goal)} · forma ${c1(f.vdStart)} → ${c1(f.vdNow)}${f.progress != null ? ` · ${Math.round(f.progress * 100)}% drogi do celu` : ''}</div>${f.progress != null ? `<div class="progress gold"><i style="width:${Math.round(f.progress * 100)}%"></i></div>` : ''}`;
    else html += `<div class="muted small">forma (VDOT) ${c1(f.vdStart)} → ${c1(f.vdNow)}</div>`;
  }
  if (pr.pace) html += `<div class="pc-row" style="margin-top:10px"><span>Tempo przy tętnie ${pr.pace.ref}</span><b>${C.fmtPace(pr.pace.before)} → ${C.fmtPace(pr.pace.now)}/km</b></div>`;
  html += `<p class="pc-note">${esc(pr.note)}</p></div></div>`;
  return html;
}
// pytanie „który to trening?”
function askPlanLink(run) {
  return new Promise(resolve => {
    const s = S(), st = P.linkStatus(db.plan, acts(), s, run);
    if (!st.inPlan) { resolve(); return; }
    const cands = st.cands;
    const m = modal(`<h3>Który to trening z planu?</h3><p class="muted">Bieg ${esc(fmtDateShort(run.start))}, ${C.fmtKm(run.distance)} km w ${C.fmtDur(run.timer)}.</p>
      <div class="link-opts">${cands.map(x => { const i = P.sessionInfo(x, s, db.plan); return `<button class="link-opt ${st.ses && st.ses.id === x.id ? 'cur' : ''}" data-t="${x.id}"><b>${esc(i.title)}</b><span>${esc(P.DAY_NAMES[new Date(x.date).getDay()])}, ${esc(fmtDateShort(x.date))} · tydz. ${x.week}${x.status === 'overdue' ? ' · zaległy' : x.status === 'missed' ? ' · przepadł' : x.status === 'done' ? ' · obecnie' : ''}</span></button>`; }).join('')}
      <button class="link-opt off ${st.off ? 'cur' : ''}" data-t="off"><b>Poza planem</b><span>nie liczy się do oceny planu</span></button></div>`, { dismiss: false });
    m.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
      db.plan = P.linkRun(db.plan, run.id, b.dataset.t, run.start); changed();
      m.close(); toast(b.dataset.t === 'off' ? 'Oznaczono jako bieg poza planem' : '✓ Przypisano do planu'); resolve();
    });
  });
}
function renderNote() {
  const a = cur, slot = $('#note-slot'); if (!a || !slot) return;
  const n = a.note || {};
  slot.innerHTML = `<div class="note-box">
    <div class="note-row"><span>Odczucie wysiłku (1 = spacer, 10 = maksimum)</span><div class="rpe">${[...Array(10)].map((_, i) => `<button data-rpe="${i + 1}" class="${n.rpe === i + 1 ? 'active' : ''}">${i + 1}</button>`).join('')}</div></div>
    <div class="note-row"><span>Sen poprzedniej nocy</span><div class="chips">${[['bad', 'Słaby'], ['ok', 'OK'], ['good', 'Dobry']].map(([k, l]) => `<button class="chip ${n.sleep === k ? 'active' : ''}" data-sleep="${k}">${l}</button>`).join('')}</div></div>
    <div class="note-row"><span>Kawa w ciągu 2 h przed biegiem</span><div class="chips">${[[true, 'Tak'], [false, 'Nie']].map(([k, l]) => `<button class="chip ${n.coffee === k ? 'active' : ''}" data-coffee="${k}">${l}</button>`).join('')}</div></div>
    <div class="note-row"><span>Notatka</span><textarea id="note-text" placeholder="np. bolała łydka, trasa nad jeziorem…">${esc(n.text || '')}</textarea></div>
  </div>`;
  const save = patch => { a.note = { ...(a.note || {}), ...patch }; a.updated = Date.now(); changed(); renderNote(); renderReport(); };
  slot.querySelectorAll('[data-rpe]').forEach(b => b.onclick = () => save({ rpe: n.rpe === +b.dataset.rpe ? null : +b.dataset.rpe }));
  slot.querySelectorAll('[data-sleep]').forEach(b => b.onclick = () => save({ sleep: n.sleep === b.dataset.sleep ? null : b.dataset.sleep }));
  slot.querySelectorAll('[data-coffee]').forEach(b => b.onclick = () => { const v = b.dataset.coffee === 'true'; save({ coffee: n.coffee === v ? null : v }); });
  let tT; slot.querySelector('#note-text').oninput = e => { clearTimeout(tT); tT = setTimeout(() => { a.note = { ...(a.note || {}), text: e.target.value }; a.updated = Date.now(); changed(); }, 600); };
}
function splitsHtml(a) {
  const sp = a.splits || [];
  if (!sp.length) return '<div class="card empty">Brak międzyczasów</div>';
  const full = sp.filter(s => s.dist >= 900);
  const fastest = full.length ? Math.min(...full.map(s => s.pace)) : null;
  const sps = sp.map(s => s.pace).filter(Boolean).map(p => 1000 / p);
  const maxS = Math.max(...sps), minS = Math.min(...sps);
  const run = C.isRun(a);
  return `<div class="card"><table class="tbl num"><thead><tr><th>km</th><th>${run ? 'Tempo' : 'km/h'}</th><th style="width:40%"></th><th class="r">Tętno</th><th class="r">↑/↓ m</th></tr></thead><tbody>${sp.map(s => {
    const v = 1000 / s.pace, w = maxS > minS ? 35 + 65 * (v - minS) / (maxS - minS) : 100;
    const lbl = s.dist < 990 ? (s.dist / 1000).toFixed(2).replace('.', ',') : s.n;
    return `<tr class="${s.pace === fastest ? 'fast' : ''}"><td>${lbl}</td><td><b>${run ? C.fmtPace(s.pace) : (v * 3.6).toFixed(1).replace('.', ',')}</b></td><td><div class="sbar" style="width:${w}%"></div></td><td class="r">${s.hr ?? '–'}</td><td class="r muted">${s.up}/${s.down}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
// Mapa: OpenStreetMap (bez klucza) przyciemniona filtrem; zapasowy serwer, gdy kafelki nie dochodzą
const TILE_SOURCES = [
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', sub: '' },
  { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, HOT', sub: 'abc' },
];
function addTiles(m, idx = 0) {
  const src = TILE_SOURCES[idx];
  let errors = 0;
  const layer = L.tileLayer(src.url, { maxZoom: 19, attribution: src.attr, ...(src.sub ? { subdomains: src.sub } : {}) });
  layer.on('tileerror', () => {
    if (++errors === 4) {
      m.removeLayer(layer);
      if (idx + 1 < TILE_SOURCES.length) addTiles(m, idx + 1);
      else { const e = document.createElement('div'); e.className = 'map-err'; e.textContent = 'Nie udało się wczytać podkładu mapy (brak internetu?). Trasa jest widoczna.'; $('#map')?.parentElement.appendChild(e); }
    }
  });
  layer.addTo(m);
}
function drawMap(s) {
  const pts = s.lat.map((la, i) => la != null && s.lon[i] != null ? [la, s.lon[i]] : null);
  const valid = pts.filter(Boolean);
  if (valid.length < 2) return;
  if (!window.L) { $('#map').innerHTML = '<div class="empty">Nie wczytano biblioteki mapy (brak internetu?).</div>'; return; }
  map = L.map('map', { zoomControl: true, scrollWheelZoom: false });
  $('#map').classList.add('map-dark');
  addTiles(map);
  const pv = s.pace.filter(p => p != null && p < 1200).sort((a, b) => a - b);
  const qn = f => pv[Math.floor(f * (pv.length - 1))];
  const lo = qn(0.05), hi = qn(0.95);
  const bucket = p => p == null ? 0 : Math.max(0, Math.min(5, Math.round((hi - p) / ((hi - lo) || 1) * 5)));
  let seg = [], b = null;
  const flush = () => { if (seg.length > 1) mapLayers.push(L.polyline(seg, { color: PACE_RAMP[b], weight: 4.5, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(map)); };
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i]) continue;
    const nb = C.isRun(cur) ? bucket(s.pace[i]) : 3;
    if (nb !== b && seg.length) { seg.push(pts[i]); flush(); seg = [seg[seg.length - 1]]; }
    b = nb; seg.push(pts[i]);
  }
  flush();
  const dot = (p, c) => L.circleMarker(p, { radius: 6, color: '#141414', weight: 2, fillColor: c, fillOpacity: 1 }).addTo(map);
  dot(valid[0], '#4ade80'); dot(valid[valid.length - 1], '#ff5f5f');
  hoverMarker = L.circleMarker(valid[0], { radius: 7, color: '#fff', weight: 3, fillColor: '#3b82f6', opacity: 0, fillOpacity: 0 }).addTo(map);
  map.fitBounds(L.latLngBounds(valid), { padding: [18, 18] });
  setTimeout(() => map?.invalidateSize(), 60);
}
let hoverIdx = null;
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    if (hl) {
      const x0 = x.getPixelForValue(hl[0]), x1 = x.getPixelForValue(hl[1]);
      ctx.save(); ctx.fillStyle = '#fbbf241f'; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
      ctx.strokeStyle = '#fbbf2499'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, a.top); ctx.lineTo(x0, a.bottom); ctx.moveTo(x1, a.top); ctx.lineTo(x1, a.bottom); ctx.stroke(); ctx.restore();
    }
    if (hoverIdx == null || !curStreams) return;
    const px = x.getPixelForValue(curStreams.d[hoverIdx] / 1000);
    ctx.save(); ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
    const ds = chart.data.datasets[0], pt = ds.data[hoverIdx];
    if (pt && pt.y != null) { const py = chart.scales.y.getPixelForValue(pt.y); ctx.fillStyle = ds.borderColor; ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  },
};
// tło wykresu tętna: pasy stref
const zoneBands = {
  id: 'zoneBands',
  beforeDatasetsDraw(chart) {
    if (chart._def?.key !== 'hr') return;
    const { ctx, chartArea: a, scales: { y } } = chart;
    const zs = A.zonesFor(S().lthr);
    ctx.save();
    zs.forEach((z, i) => {
      const y0 = Math.max(a.top, y.getPixelForValue(Math.min(z.hi + 1, y.max))), y1 = Math.min(a.bottom, y.getPixelForValue(Math.max(z.lo, y.min)));
      if (y1 > y0) { ctx.fillStyle = ['#ffffff00', '#ffffff04', '#ffffff08', '#e8590c12', '#ff8f5718'][i]; ctx.fillRect(a.left, y0, a.right - a.left, y1 - y0); }
    });
    ctx.restore();
  },
};
function drawCharts(s, run) {
  const host = $('#charts'); host.innerHTML = '';
  const km = s.d.map(v => v / 1000);
  const defs = [];
  if (run && s.pace.some(v => v != null)) {
    const pv = s.pace.filter(p => p != null && p < 1200).sort((a, b) => a - b);
    defs.push({ key: 'pace', title: 'Tempo', color: 'var(--c-pace)', hex: '#3b82f6', data: s.pace.map(p => p != null && p < 1500 ? p : null), reverse: true,
      ...(() => { const lo = Math.max(120, pv[Math.floor(pv.length * 0.01)] - 15), hi = Math.min(1200, pv[Math.floor(pv.length * 0.99)] + 20), st = [15, 30, 60, 120, 300].find(x => (hi - lo) / x <= 4) || 300; return { min: Math.floor(lo / st) * st, max: Math.ceil(hi / st) * st, step: st }; })(),
      fmt: v => C.fmtPace(v), unit: '/km', head: `śr. ${C.fmtPace(cur.pace)} /km` });
  } else if (!run && s.pace.some(v => v != null)) {
    defs.push({ key: 'speed', title: 'Prędkość', color: 'var(--c-pace)', hex: '#3b82f6', data: s.pace.map(p => p ? 3600 / p : null), fmt: v => v.toFixed(1).replace('.', ','), unit: 'km/h', head: '' });
  }
  if (s.hr.some(v => v != null)) {
    const hv = s.hr.filter(v => v != null);
    defs.push({ key: 'hr', title: 'Tętno', color: 'var(--c-hr)', hex: '#e8590c', data: s.hr, min: Math.floor((Math.min(...hv) - 5) / 10) * 10, max: Math.ceil((Math.max(...hv) + 3) / 10) * 10, fmt: v => Math.round(v), unit: 'bpm', head: cur.avgHr ? `śr. ${cur.avgHr} · maks. ${cur.maxHr} bpm` : '' });
  }
  if (s.ele.some(v => v != null)) defs.push({ key: 'ele', title: 'Wysokość', color: 'var(--c-ele)', hex: '#9b5de5', data: s.ele, fill: true, fmt: v => Math.round(v), unit: 'm n.p.m.', head: `↑ ${cur.ascent} m · ↓ ${cur.descent} m` });
  if (!defs.length) { host.innerHTML = `<div class="card empty">Brak danych do wykresów.</div>`; return; }
  const maxKm = km[km.length - 1];
  for (const def of defs) {
    const card = document.createElement('div'); card.className = 'card chart-card';
    card.innerHTML = `<div class="chart-head"><b><i style="background:${def.color}"></i>${def.title}</b><span class="num">${def.head}</span></div><div class="chart-box"><canvas></canvas></div>`;
    host.appendChild(card);
    const ch = new Chart(card.querySelector('canvas'), {
      type: 'line',
      data: { datasets: [{ data: km.map((x, i) => ({ x, y: def.data[i] })), borderColor: def.hex, borderWidth: 2, pointRadius: 0, tension: .15, spanGaps: true, fill: def.fill ? 'start' : false, backgroundColor: def.hex + '33' }] },
      options: chartBase({
        parsing: false, normalized: true,
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { type: 'linear', min: 0, max: maxKm, grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 8, callback: v => Number.isInteger(v) ? v + ' km' : (maxKm < 2 ? v.toFixed(1).replace('.', ',') + ' km' : '') } },
          y: { reverse: !!def.reverse, min: def.min, max: def.max, grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 6, ...(def.step ? { stepSize: def.step } : {}), callback: v => def.fmt(v) } },
        },
        onHover: (e, els) => { if (els.length) setHover(els[0].index); },
      }),
      plugins: [zoneBands, crosshair],
    });
    ch._def = def;
    ch.update('none');
    ch.canvas.addEventListener('mouseleave', () => setHover(null));
    detailCharts.push(ch);
  }
}
function setHover(i) {
  hoverIdx = i;
  detailCharts.forEach(c => c.draw());
  const r = $('#readout'); if (!r || !curStreams) return;
  if (i == null) { hoverMarker?.setStyle({ opacity: 0, fillOpacity: 0 }); return; }
  const s = curStreams;
  const parts = [`<span><b>${(s.d[i] / 1000).toFixed(2).replace('.', ',')}</b> km</span>`, `<span><b>${C.fmtDur(s.t[i])}</b></span>`];
  for (const c of detailCharts) { const v = c._def.data[i]; if (v != null) parts.push(`<span><b>${c._def.fmt(v)}</b> ${c._def.unit}</span>`); }
  r.innerHTML = parts.join('');
  if (hoverMarker && s.lat[i] != null) { hoverMarker.setLatLng([s.lat[i], s.lon[i]]); hoverMarker.setStyle({ opacity: 1, fillOpacity: 1 }); }
}
function toggleEffort(btn) {
  const m = btn.dataset.m, s = curStreams;
  const was = btn.classList.contains('active');
  $$('.effort-chip').forEach(b => b.classList.remove('active'));
  if (hlLayer && map) { map.removeLayer(hlLayer); hlLayer = null; }
  hl = null;
  if (!was && s?.efforts?.[m]) {
    btn.classList.add('active');
    const [i0, i1] = s.efforts[m];
    hl = [s.d[i0] / 1000, s.d[i1] / 1000];
    if (map) {
      const seg = []; for (let i = i0; i <= i1; i++) if (s.lat[i] != null) seg.push([s.lat[i], s.lon[i]]);
      if (seg.length > 1) { hlLayer = L.polyline(seg, { color: '#fbbf24', weight: 7, opacity: .9 }).addTo(map); map.fitBounds(hlLayer.getBounds(), { padding: [24, 24] }); }
    }
  } else if (map && mapLayers.length) map.fitBounds(L.featureGroup(mapLayers).getBounds(), { padding: [18, 18] });
  detailCharts.forEach(c => c.draw());
}
async function renameActivity(a) {
  const t = prompt('Nazwa treningu:', activityTitle(a));
  if (t == null) return;
  a.title = t.trim() || null; a.updated = Date.now();
  changed(); renderAll();
  $('#detail-title b').textContent = activityTitle(a);
}
async function deleteActivity(a) {
  if (!confirm(`Usunąć trening z ${fmtDate(a.start)}?\n\nOryginalny plik FIT trafi do kosza na Dysku Google (można go stamtąd odzyskać).`)) return;
  db.activities = db.activities.filter(x => x.id !== a.id);
  db.deleted = [...new Set([...db.deleted, a.id])];
  await idb.del('streams', a.id);
  closeDetail(); changed(); flushSync(); renderAll();
  if (a.fileId && token) trashFile(a.fileId);
  toast('Usunięto trening');
}

// ══ POSTĘP ══════════════════════════════════════════════════════════════════
function renderProgress() {
  killCharts();
  const el = $('#view-progress');
  if (!acts().filter(C.isRun).length) { el.innerHTML = `<div class="empty">Postęp pojawi się po wgraniu pierwszych biegów.</div>`; return; }
  ensureTypes();
  let html = `<div class="seg scroll">${[['condition', 'Kondycja'], ['records', 'Rekordy'], ['tech', 'Technika'], ['routes', 'Trasy'], ['badges', 'Odznaki'], ['stats', 'Statystyki']].map(([k, l]) => `<button class="${progressTab === k ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div><div id="prog-body"></div>`;
  el.innerHTML = html;
  el.querySelectorAll('.seg button').forEach(b => b.onclick = () => { progressTab = b.dataset.t; renderProgress(); });
  el.querySelector('.seg button.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  const pb = $('#prog-body');
  if (progressTab === 'condition') renderCondition(pb);
  else if (progressTab === 'records') renderRecords(pb);
  else if (progressTab === 'tech') renderTechnique(pb);
  else if (progressTab === 'routes') renderRoutes(pb);
  else if (progressTab === 'badges') renderBadges(pb);
  else renderStats(pb);
}
function renderCondition(el) {
  const s = S(), now = Date.now();
  const rep = A.conditionReport(acts(), s, now);
  const icons = ['📏', '❤️', '⚡', '🎯', '🔋'];
  let html = `<div class="sec">Raport kondycji · ostatnie 4 tygodnie</div><div class="card"><ul class="lines">${rep.lines.map((l, i) => `<li><span class="ic">${icons[i] || '•'}</span><span>${esc(l)}</span></li>`).join('')}</ul></div>`;
  const trend = A.paceAtHrTrend(acts(), s, 16, now);
  html += `<div class="sec">Tempo przy ${trend.ref} bpm</div><div class="card chart-card"><div class="chart-head"><b><i style="background:var(--c-pace)"></i>Tempo przy stałym tętnie</b><span>wyżej = szybciej · okno 3 tyg.</span></div><div class="chart-box" style="height:170px"><canvas id="ch-pah"></canvas></div></div>`;
  html += `<div class="sec">Forma i zmęczenie · 90 dni</div><div class="card chart-card"><div class="chart-head"><b>Obciążenie treningowe</b><span id="tsb-now"></span></div><div class="chart-box" style="height:170px"><canvas id="ch-load"></canvas></div>
    <div class="legend" style="padding:8px 4px 6px"><span><i style="background:#3b82f6;height:3px"></i>Forma (42 dni)</span><span><i style="background:#e8590c;height:3px"></i>Zmęczenie (7 dni)</span></div></div>`;
  html += `<div class="sec">Intensywność tygodniowo</div><div class="card chart-card"><div class="chart-head"><b>Minuty w strefach</b><span>cel: ok. 80% łatwo</span></div><div class="chart-box" style="height:170px"><canvas id="ch-int"></canvas></div>
    <div class="legend" style="padding:8px 4px 6px"><span><i style="background:var(--z2)"></i>Łatwo</span><span><i style="background:var(--z3)"></i>Próg</span><span><i style="background:var(--z5)"></i>Powyżej progu</span></div></div>`;
  html += bestConditionsHtml();
  el.innerHTML = html;
  // wykres: tempo przy tętnie
  const pts = trend.points;
  viewCharts.push(new Chart($('#ch-pah'), {
    type: 'line', data: { labels: pts.map(p => p.week), datasets: [{ data: pts.map(p => p.pace), borderColor: '#3b82f6', borderWidth: 2, pointRadius: pts.map(p => p.pace ? 3 : 0), pointBackgroundColor: '#3b82f6', spanGaps: true, tension: .25 }] },
    options: chartBase({
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000e', displayColors: false, callbacks: { title: it => 'tydzień od ' + fmtDateShort(pts[it[0].dataIndex].week), label: it => `${C.fmtPace(it.parsed.y)} /km przy ${trend.ref} bpm` } } },
      scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, callback: (v, i) => fmtDateShort(pts[i].week) } },
        y: { reverse: true, grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 5, callback: v => C.fmtPace(v) } } },
    }),
  }));
  // forma / zmęczenie
  const ls = A.loadSeries(acts(), s, 90, now);
  const fl = A.freshnessLabel(ls[ls.length - 1].tsb);
  $('#tsb-now').innerHTML = `świeżość ${Math.round(ls[ls.length - 1].tsb)} · <b style="color:var(--text)">${fl.label}</b>`;
  viewCharts.push(new Chart($('#ch-load'), {
    type: 'line',
    data: { labels: ls.map(x => x.day), datasets: [
      { label: 'Forma', data: ls.map(x => x.ctl), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: .3 },
      { label: 'Zmęczenie', data: ls.map(x => x.atl), borderColor: '#e8590c', borderWidth: 2, pointRadius: 0, tension: .3 }] },
    options: chartBase({
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000e', callbacks: { title: it => fmtDate(ls[it[0].dataIndex].day), label: it => ` ${it.dataset.label}: ${Math.round(it.parsed.y)}`, afterBody: it => 'Świeżość: ' + Math.round(ls[it[0].dataIndex].tsb) } } },
      scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, callback: (v, i) => fmtDateShort(ls[i].day) } },
        y: { beginAtZero: true, grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 5 } } },
    }),
  }));
  // intensywność tygodniowa (12 tygodni)
  const weeks = [];
  const ws0 = C.weekStart(now);
  for (let k = 11; k >= 0; k--) { const from = ws0 - k * 7 * DAY; weeks.push({ from, v: A.intensitySplit(acts(), s, from, from + 7 * DAY).map(x => x / 60) }); }
  const cols = ['#7a4a2a', '#b45a1e', '#ff8f57'], names = ['Łatwo', 'Próg', 'Powyżej progu'];
  viewCharts.push(new Chart($('#ch-int'), {
    type: 'bar',
    data: { labels: weeks.map(w => w.from), datasets: [0, 1, 2].map(i => ({ label: names[i], data: weeks.map(w => w.v[i]), backgroundColor: cols[i], borderColor: '#1c1c1e', borderWidth: { top: 2 }, borderSkipped: 'bottom', borderRadius: i === 2 ? { topLeft: 4, topRight: 4 } : 0, barPercentage: .8, categoryPercentage: .9 })) },
    options: chartBase({
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000e', callbacks: { title: it => 'tydzień od ' + fmtDateShort(weeks[it[0].dataIndex].from), label: it => ` ${it.dataset.label}: ${Math.round(it.parsed.y)} min` } } },
      scales: { x: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, callback: (v, i) => fmtDateShort(weeks[i].from) } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 5 } } },
    }),
  }));
}
let openRec = new Set();
function renderRecords(el) {
  const runs = acts().filter(C.isRun);
  const tables = C.recordTables(acts(), 10);
  const form = C.currentForm(acts());
  let html = `<div class="sec">Prognoza na zawody</div>`;
  if (form) {
    html += `<div class="card pad"><div class="form-top"><div class="vd num">${dec1(form.vdot)}<small>VDOT</small></div><div class="muted small">z: ${esc(form.label)} w ${C.fmtDur(form.time)} (${fmtDate(form.start)})</div></div>
      <div class="predict">${form.predict.map(p => `<div><div class="l">${{ 5000: '5 km', 10000: '10 km', 21097.5: 'Półmaraton', 42195: 'Maraton' }[p.m]}</div><div class="v num">${C.fmtDur(p.time)}</div><div class="p num">${C.fmtPace(p.time / p.m * 1000)} /km</div></div>`).join('')}</div>
      <p class="muted" style="font-size:12px;margin-top:10px;line-height:1.5">Tabele VDOT Danielsa, najlepszy odcinek ≥ 3 km z 90 dni. Dłuższe dystanse zakładają trening wytrzymałościowy.</p></div>`;
  } else html += `<div class="card empty">Brak biegu ≥ 3 km z ostatnich 90 dni.</div>`;
  html += `<div class="sec">Rekordy życiowe</div><div class="card">`;
  for (const { m, label } of C.BEST_DISTANCES) {
    const t = tables[m], best = t[0];
    if (!best) { html += `<div class="rec-row none"><div class="rec-head"><div class="d">${label}</div><div class="t">—</div><div class="p"></div></div></div>`; continue; }
    html += `<div class="rec-row ${openRec.has(m) ? 'open' : ''}" data-m="${m}">
      <div class="rec-head"><div class="d">${label}</div><div class="t num">${C.fmtDur(best.time)}</div><div class="p num">${C.fmtPace(best.time / m * 1000)} /km</div><div class="w">${fmtDate(best.start)}</div><div class="chev">▶</div></div>
      <div class="rec-body"><div class="chart-box" style="height:120px"><canvas data-prog="${m}"></canvas></div>
      <div style="margin-top:8px">${t.map((e, i) => `<div class="top-item num" data-id="${e.id}"><span class="n">${i + 1}.</span><span class="tm">${C.fmtDur(e.time)}</span><span class="dt">${fmtDate(e.start)}</span><span class="muted">${C.fmtPace(e.time / m * 1000)}</span></div>`).join('')}</div></div></div>`;
  }
  html += `</div>`;
  const maxBy = f => runs.reduce((b, a) => (f(a) > f(b) ? a : b), runs[0]);
  const longest = maxBy(a => a.distance), longestT = maxBy(a => a.timer), highest = maxBy(a => a.ascent || 0);
  const weeks = C.totalsBy(acts(), a => C.weekStart(a.start)).sort((a, b) => b.km - a.km)[0];
  const months = C.totalsBy(acts(), a => { const d = new Date(a.start); return d.getFullYear() * 100 + d.getMonth(); }).sort((a, b) => b.km - a.km)[0];
  html += `<div class="sec">Inne rekordy</div><div class="grid3">
    <div class="card pad stat" data-id="${longest.id}" style="cursor:pointer"><div class="lbl">Najdłuższy bieg</div><div class="val num">${C.fmtKm(longest.distance)}<small>km</small></div><div class="sub">${fmtDate(longest.start)}</div></div>
    <div class="card pad stat" data-id="${longestT.id}" style="cursor:pointer"><div class="lbl">Najdłuższy czas</div><div class="val num">${C.fmtDur(longestT.timer)}</div><div class="sub">${fmtDate(longestT.start)}</div></div>
    <div class="card pad stat" data-id="${highest.id}" style="cursor:pointer"><div class="lbl">Największe przewyższenie</div><div class="val num">${highest.ascent || 0}<small>m</small></div><div class="sub">${fmtDate(highest.start)}</div></div>
    <div class="card pad stat"><div class="lbl">Najwięcej w tygodniu</div><div class="val num">${dec1(weeks.km)}<small>km</small></div><div class="sub">od ${fmtDate(weeks.key)}</div></div>
    <div class="card pad stat"><div class="lbl">Najwięcej w miesiącu</div><div class="val num">${dec1(months.km)}<small>km</small></div><div class="sub">${MONTHS[months.key % 100]} ${Math.floor(months.key / 100)}</div></div>
    <div class="card pad stat"><div class="lbl">Wszystkie biegi</div><div class="val num">${Math.round(runs.reduce((s, a) => s + a.distance, 0) / 1000)}<small>km</small></div><div class="sub">${runs.length} ${plural(runs.length, 'bieg', 'biegi', 'biegów')}</div></div>
  </div>`;
  el.innerHTML = html;
  el.querySelectorAll('.rec-row[data-m] .rec-head').forEach(h => h.onclick = () => { const m = Number(h.parentElement.dataset.m); openRec.has(m) ? openRec.delete(m) : openRec.add(m); renderProgress(); });
  el.querySelectorAll('[data-id]').forEach(x => x.onclick = e => { e.stopPropagation(); openDetail(x.dataset.id); });
  el.querySelectorAll('canvas[data-prog]').forEach(cv => {
    const prog = C.recordProgression(acts(), Number(cv.dataset.prog));
    const pts = prog.map(p => ({ x: p.start, y: p.time }));
    if (pts.length) pts.push({ x: Date.now(), y: pts[pts.length - 1].y });
    viewCharts.push(new Chart(cv, {
      type: 'line',
      data: { datasets: [{ data: pts, stepped: 'before', borderColor: '#fbbf24', borderWidth: 2, pointRadius: pts.map((_, i) => i < prog.length ? 4 : 0), pointBackgroundColor: '#fbbf24', pointBorderColor: '#1c1c1e', pointBorderWidth: 2, pointHitRadius: 14 }] },
      options: chartBase({ parsing: false,
        plugins: { legend: { display: false }, tooltip: { displayColors: false, backgroundColor: '#000e', filter: it => it.dataIndex < prog.length, callbacks: { title: it => fmtDate(it[0].parsed.x), label: it => 'Rekord: ' + C.fmtDur(it.parsed.y) } } },
        scales: { x: { type: 'linear', grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 5, callback: v => { const d = new Date(v); return MONTHS_SHORT[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2); } } },
          y: { reverse: true, grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 4, callback: v => C.fmtDur(v) } } } }),
    }));
  });
}
let statYear = new Date().getFullYear();
const HEAT = ['#262628', '#1d4d33', '#22743f', '#2ea24f', '#4ade80'];
function renderStats(el) {
  const runs = acts().filter(C.isRun);
  const years = [...new Set(runs.map(a => new Date(a.start).getFullYear()))].sort((a, b) => b - a);
  if (!years.includes(statYear)) statYear = years[0];
  const weekly = C.weeklyTotals(acts(), 26);
  const avg12 = weekly.slice(-12).reduce((s, w) => s + w.km, 0) / 12;
  el.innerHTML = `<div class="sec">Kilometry tygodniowo · 26 tygodni</div>
    <div class="card chart-card"><div class="chart-head"><b><i style="background:var(--accent)"></i>km / tydzień</b><span class="num">śr. z 12 tyg.: ${dec1(avg12)} km</span></div><div class="chart-box" style="height:170px"><canvas id="ch-weekly"></canvas></div></div>
    <div class="sec">Rok do roku · narastająco</div>
    <div class="card chart-card"><div class="chart-head"><b>Kilometry od 1 stycznia</b><span class="num" id="yoy-head"></span></div><div class="chart-box" style="height:190px"><canvas id="ch-yoy"></canvas></div><div class="legend" id="yoy-legend" style="padding:8px 4px 4px"></div></div>
    <div class="sec">Kalendarz biegów</div>
    <div class="chips" style="margin-bottom:8px">${years.map(y => `<button class="chip ${y === statYear ? 'active' : ''}" data-y="${y}">${y}</button>`).join('')}</div>
    <div class="card heat-wrap">${heatmapSvg(statYear)}<div class="heat-legend">mniej ${HEAT.map(c => `<i style="background:${c}"></i>`).join('')} więcej</div></div>
    <div class="sec">Podsumowanie lat</div>${yearsTable()}
    <div class="sec">${statYear} · miesiące</div>${monthsTable(statYear)}`;
  el.querySelectorAll('[data-y]').forEach(b => b.onclick = () => { statYear = Number(b.dataset.y); renderProgress(); });
  bindHeatTips(el);
  const hw = el.querySelector('.heat-wrap');
  if (hw && statYear === new Date().getFullYear()) { const frac = (Date.now() - new Date(statYear, 0, 1)) / 31536e6; hw.scrollLeft = Math.max(0, hw.scrollWidth * frac - hw.clientWidth + 60); }
  viewCharts.push(new Chart($('#ch-weekly'), {
    type: 'bar',
    data: { labels: weekly.map(w => w.week), datasets: [{ data: weekly.map(w => w.km), backgroundColor: weekly.map((w, i) => i === weekly.length - 1 ? '#4ade80' : '#4ade8099'), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', barPercentage: .82, categoryPercentage: 1 }] },
    options: chartBase({
      plugins: { legend: { display: false }, tooltip: { displayColors: false, backgroundColor: '#000e', callbacks: { title: it => { const s = weekly[it[0].dataIndex].week; return fmtDate(s) + ' – ' + fmtDate(s + 6 * DAY); }, label: it => { const w = weekly[it.dataIndex]; return `${dec1(w.km)} km · ${w.count} ${plural(w.count, 'bieg', 'biegi', 'biegów')} · ${C.fmtDur(w.time)}`; } } } },
      scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, callback: (v, i) => fmtDateShort(weekly[i].week) } },
        y: { beginAtZero: true, grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 5 } } },
    }),
  }));
  const thisY = new Date().getFullYear();
  const cum = y => {
    const s = new Date(y, 0, 1).getTime(), out = [];
    const rs = runs.filter(a => new Date(a.start).getFullYear() === y).sort((a, b) => a.start - b.start);
    let acc = 0, j = 0;
    const days = y === thisY ? Math.floor((Date.now() - s) / DAY) + 1 : (new Date(y, 11, 31) - s) / DAY + 1;
    for (let d = 0; d < days; d++) { const e = s + (d + 1) * DAY; while (j < rs.length && rs[j].start < e) acc += rs[j++].distance / 1000; out.push({ x: d, y: acc }); }
    return out;
  };
  const cy = cum(thisY), py = cum(thisY - 1);
  const ds = [{ label: String(thisY), data: cy, borderColor: '#4ade80', borderWidth: 2, pointRadius: 0 }];
  if (py[py.length - 1]?.y > 0) ds.push({ label: String(thisY - 1), data: py, borderColor: '#8a8a8a', borderWidth: 2, borderDash: [5, 4], pointRadius: 0 });
  const today = cy.length - 1, last = py[Math.min(today, py.length - 1)]?.y || 0, now = cy[today]?.y || 0;
  $('#yoy-head').textContent = ds.length > 1 ? `${Math.round(now)} km vs ${Math.round(last)} km rok temu` : `${Math.round(now)} km`;
  $('#yoy-legend').innerHTML = ds.map(d => `<span><i style="background:${d.borderColor};height:3px"></i>${d.label}</span>`).join('');
  viewCharts.push(new Chart($('#ch-yoy'), {
    type: 'line', data: { datasets: ds },
    options: chartBase({ parsing: false,
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000e', callbacks: { title: it => fmtDateShort(new Date(thisY, 0, 1 + it[0].parsed.x)), label: it => ` ${it.dataset.label}: ${dec1(it.parsed.y)} km` } } },
      scales: {
        x: { type: 'linear', min: 0, max: 365, grid: { color: '#ffffff0d' }, border: { display: false }, afterBuildTicks: ax => { ax.ticks = Array.from({ length: 12 }, (_, i) => ({ value: Math.round((new Date(thisY, i, 1) - new Date(thisY, 0, 1)) / DAY) })); }, ticks: { color: '#7a7a80', font: { size: 10.5 }, autoSkip: true, maxRotation: 0, callback: v => MONTHS_SHORT[new Date(thisY, 0, 1 + v).getMonth()] } },
        y: { beginAtZero: true, grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 5 } },
      } }),
  }));
}
function heatmapSvg(year) {
  const runs = acts().filter(a => C.isRun(a) && new Date(a.start).getFullYear() === year);
  const perDay = new Map();
  for (const a of runs) { const d = new Date(a.start); const k = `${d.getMonth()}-${d.getDate()}`; const o = perDay.get(k) || { km: 0, n: 0 }; o.km += a.distance / 1000; o.n++; perDay.set(k, o); }
  const level = km => !km ? 0 : km < 5 ? 1 : km < 10 ? 2 : km < 16 ? 3 : 4;
  const cell = 12, gap = 3, left = 22, top = 16;
  const jan1 = new Date(year, 0, 1), off = (jan1.getDay() + 6) % 7;
  const days = (new Date(year + 1, 0, 1) - jan1) / DAY;
  const cols = Math.ceil((days + off) / 7);
  let s = `<svg width="${left + cols * (cell + gap)}" height="${top + 7 * (cell + gap)}" style="display:block">`;
  ['pn', '', 'śr', '', 'pt', '', 'nd'].forEach((t, i) => { if (t) s += `<text x="0" y="${top + i * (cell + gap) + 10}" font-size="9" fill="#777">${t}</text>`; });
  let lastM = -1;
  for (let i = 0; i < days; i++) {
    const d = new Date(year, 0, 1 + i), c = Math.floor((i + off) / 7), r = (i + off) % 7;
    if (d.getMonth() !== lastM) { s += `<text x="${left + c * (cell + gap)}" y="10" font-size="9" fill="#777">${MONTHS_SHORT[d.getMonth()]}</text>`; lastM = d.getMonth(); }
    const o = perDay.get(`${d.getMonth()}-${d.getDate()}`);
    s += `<rect x="${left + c * (cell + gap)}" y="${top + r * (cell + gap)}" width="${cell}" height="${cell}" rx="3" fill="${HEAT[level(o?.km)]}" data-tip="${fmtDate(d.getTime())}: ${o ? dec1(o.km) + ' km' + (o.n > 1 ? ' (' + o.n + ' biegi)' : '') : 'bez biegu'}"/>`;
  }
  return s + '</svg>';
}
function bindHeatTips(el) {
  const tip = $('#tip');
  el.querySelectorAll('rect[data-tip]').forEach(r => {
    const show = () => { tip.textContent = r.dataset.tip; tip.style.display = 'block'; const b = r.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, b.left + b.width / 2 - tip.offsetWidth / 2)) + 'px'; tip.style.top = (b.top - tip.offsetHeight - 6) + 'px'; };
    r.addEventListener('mouseenter', show); r.addEventListener('click', show);
    r.addEventListener('mouseleave', () => tip.style.display = 'none');
  });
}
function yearsTable() {
  const t = C.totalsBy(acts(), a => new Date(a.start).getFullYear());
  return `<div class="card"><table class="tbl num"><thead><tr><th>Rok</th><th class="r">km</th><th class="r">Biegi</th><th class="r">Czas</th><th class="r">Śr. tempo</th></tr></thead><tbody>${t.map(y => `<tr class="click ${y.key === statYear ? 'sel' : ''}" data-y="${y.key}"><td><b>${y.key}</b></td><td class="r">${Math.round(y.km)}</td><td class="r">${y.count}</td><td class="r">${C.fmtDur(y.time)}</td><td class="r">${C.fmtPace(y.time / y.km)}</td></tr>`).join('')}</tbody></table></div>`;
}
function monthsTable(year) {
  const t = C.totalsBy(acts().filter(a => new Date(a.start).getFullYear() === year), a => new Date(a.start).getMonth());
  const m = new Map(t.map(x => [x.key, x]));
  const maxKm = Math.max(1, ...t.map(x => x.km));
  const firstM = t.length ? Math.min(...t.map(x => x.key)) : 0;
  let rows = '';
  for (let i = firstM; i < 12; i++) {
    const x = m.get(i);
    if (!x && year === new Date().getFullYear() && i > new Date().getMonth()) continue;
    rows += `<tr><td>${MONTHS[i]}</td><td style="width:36%"><div class="sbar" style="width:${x ? Math.max(3, x.km / maxKm * 100) : 0}%;background:var(--accent)"></div></td><td class="r">${x ? dec1(x.km) : '–'}</td><td class="r">${x ? x.count : '–'}</td></tr>`;
  }
  return `<div class="card"><table class="tbl num"><thead><tr><th>Miesiąc</th><th></th><th class="r">km</th><th class="r">Biegi</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ══ CIAŁO ═══════════════════════════════════════════════════════════════════
const BODY_METRICS = [
  { k: 'weight', l: 'Waga', u: 'kg' }, { k: 'fat', l: 'Tłuszcz', u: '%' }, { k: 'fatkg', l: 'Masa tłuszczu', u: 'kg' },
  { k: 'muscle', l: 'Mięśnie', u: 'kg' }, { k: 'waist', l: 'Pas', u: 'cm' }, { k: 'visceral', l: 'Trzewny', u: '' }, { k: 'water', l: 'Woda', u: '%' },
];
function renderBody() {
  killCharts();
  const el = $('#view-body');
  const list = db.body.map(e => ({ ...e, fatkg: e.fat != null ? e.weight * e.fat / 100 : null }));
  if (!list.length) {
    el.innerHTML = `<div class="welcome"><h2>Skład ciała</h2><p>Śledź wagę, tłuszcz, mięśnie i obwód pasa. Trend tygodniowy powie więcej niż pojedyncze ważenie.</p>
      <div class="steps"><div><b>Ręcznie:</b> stuknij „Dodaj pomiar” po ważeniu (rano, po toalecie, przed jedzeniem).</div>
      <div><b>Z wagi Zepp:</b> w aplikacji Zepp w ustawieniach konta zamów eksport danych — przyjdzie mailem jako ZIP. Wgraj go albo sam plik <b>BODY…csv</b> (gdy ZIP ma hasło, najpierw go rozpakuj).</div></div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn-primary" id="b-add">${icon('plus')} Dodaj pomiar</button><button class="btn" id="b-imp">Import z Zepp</button></div></div>`;
    $('#b-add').onclick = () => bodyForm(); $('#b-imp').onclick = () => $('#file-input').click();
    return;
  }
  const s = S(), now = Date.now();
  const rep = A.bodyReport(db.body, s, now);
  const last = list[list.length - 1];
  const prevBy = (k, days) => { const t = last.ts - days * DAY; const c = list.filter(e => e[k] != null && e.ts <= t); return c.length ? c[c.length - 1][k] : null; };
  const cell = (lbl, v, u, k, lower = true) => { const p = prevBy(k, 30); return `<div class="stat"><div class="lbl">${lbl}</div><div class="val num">${v == null ? '–' : (k === 'visceral' ? Math.round(v) : dec1(v))}<small>${u}</small></div><div class="sub">${v != null && p != null ? deltaHtml(v - p, u || 'pkt', false, lower) + ' / 30 dni' : '&nbsp;'}</div></div>`; };
  let html = `<div style="display:flex;gap:8px;margin:6px 0 2px;flex-wrap:wrap"><button class="btn-primary" id="b-add">${icon('plus')} Dodaj pomiar</button><button class="btn" id="b-imp">Import z Zepp</button></div>
    <div class="sec">Ostatni pomiar · ${fmtDate(last.ts)}</div>
    <div class="card"><div class="body-hero">
      ${cell('Waga', last.weight, 'kg', 'weight')}${cell('Tłuszcz', last.fat, '%', 'fat')}${cell('Mięśnie', last.muscle, 'kg', 'muscle', false)}${cell('Pas', [...list].reverse().find(e => e.waist != null)?.waist, 'cm', 'waist')}
    </div></div>
    <div class="grid3 tight" style="margin-top:10px">
      <div class="card pad stat"><div class="lbl">BMI</div><div class="val num">${rep.bmi ? dec1(rep.bmi) : '–'}</div><div class="sub">${rep.bmi ? (rep.bmi < 25 ? 'w normie' : rep.bmi < 30 ? 'nadwaga' : 'otyłość') : 'podaj wzrost w ustawieniach'}</div></div>
      <div class="card pad stat"><div class="lbl">Tłuszcz trzewny</div><div class="val num">${last.visceral != null ? Math.round(last.visceral) : '–'}</div><div class="sub">${last.visceral != null ? (last.visceral <= 9 ? 'norma (≤ 9)' : 'powyżej normy 9') : '&nbsp;'}</div></div>
      <div class="card pad stat"><div class="lbl">Trend wagi</div><div class="val num">${rep.slope != null ? (rep.slope > 0 ? '+' : '') + dec1(rep.slope) : '–'}<small>kg/tydz.</small></div><div class="sub">z 4 tygodni</div></div>
    </div>
    ${goalsHtml(list)}
    <div class="sec">Analiza</div><div class="card"><ul class="lines">${rep.lines.map(l => `<li><span class="ic">•</span><span>${esc(l)}</span></li>`).join('')}</ul></div>
    <div class="sec">Wykres</div>
    <div class="chips" style="margin-bottom:8px">${BODY_METRICS.filter(m => list.some(e => e[m.k] != null)).map(m => `<button class="chip ${bodyMetric === m.k ? 'active' : ''}" data-bm="${m.k}">${m.l}</button>`).join('')}</div>
    <div class="card chart-card"><div class="chart-head"><b><i style="background:var(--accent)"></i><span id="bm-title"></span></b><span>kropki: pomiary · linia: średnia 7 dni</span></div><div class="chart-box" style="height:200px"><canvas id="ch-body"></canvas></div></div>
    <div class="sec">Historia</div><div class="card">${[...list].reverse().slice(0, 60).map(e => `<div class="entry" data-bid="${e.id}"><span class="dt">${fmtDate(e.ts)}</span><span class="w num">${dec1(e.weight)} kg</span><span class="rest">${[e.fat != null ? dec1(e.fat) + '% tł.' : '', e.muscle != null ? dec1(e.muscle) + ' kg mięśni' : '', e.waist != null ? 'pas ' + dec1(e.waist) + ' cm' : ''].filter(Boolean).join(' · ')}</span></div>`).join('')}</div>`;
  el.innerHTML = html;
  $('#b-add').onclick = () => bodyForm(); $('#b-imp').onclick = () => $('#file-input').click();
  el.querySelectorAll('[data-goal]').forEach(b => b.onclick = goalsForm);
  el.querySelectorAll('[data-bm]').forEach(b => b.onclick = () => { bodyMetric = b.dataset.bm; renderBody(); });
  el.querySelectorAll('[data-bid]').forEach(r => r.onclick = () => bodyForm(db.body.find(x => x.id === r.dataset.bid)));
  if (!list.some(e => e[bodyMetric] != null)) bodyMetric = 'weight';
  const met = BODY_METRICS.find(m => m.k === bodyMetric);
  $('#bm-title').textContent = met.l + (met.u ? ` (${met.u})` : '');
  const tr = A.bodyTrend(list, bodyMetric);
  viewCharts.push(new Chart($('#ch-body'), {
    type: 'line',
    data: { datasets: [
      { data: tr.map(p => ({ x: p.ts, y: p.avg })), borderColor: '#4ade80', borderWidth: 2.5, pointRadius: 0, tension: .3 },
      { data: tr.map(p => ({ x: p.ts, y: p.v })), showLine: false, pointRadius: 3.5, pointBackgroundColor: '#4ade8066', pointBorderColor: '#1c1c1e', pointBorderWidth: 1, pointHitRadius: 10 }] },
    options: chartBase({ parsing: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000e', displayColors: false, filter: it => it.datasetIndex === 1, callbacks: { title: it => fmtDate(it[0].parsed.x), label: it => `${dec1(it.parsed.y)} ${met.u} · średnia 7 dni ${dec1(tr[it.dataIndex].avg)}` } } },
      scales: { x: { type: 'linear', grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 6, callback: v => fmtDateShort(v) } },
        y: { grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 5, callback: v => dec1(v) } } } }),
  }));
}
function bodyForm(e = null) {
  const last = db.body[db.body.length - 1] || {};
  const d = new Date(e ? e.ts : Date.now());
  const pad = n => String(n).padStart(2, '0');
  const dt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const f = (k, l, ph, step = '0.1') => `<label>${l}<input type="number" inputmode="decimal" step="${step}" data-k="${k}" value="${e?.[k] ?? ''}" placeholder="${ph ?? ''}"></label>`;
  const m = modal(`<h3>${e ? 'Edytuj pomiar' : 'Nowy pomiar'}</h3>
    <div class="form">
      <label class="full">Data i godzina<input type="datetime-local" id="bf-dt" value="${dt}"></label>
      ${f('weight', 'Waga (kg) *', last.weight ? dec1(last.weight).replace(',', '.') : '')}${f('fat', 'Tłuszcz (%)', last.fat ?? '')}
      ${f('muscle', 'Mięśnie (kg)', last.muscle ?? '')}${f('waist', 'Obwód pasa (cm)', last.waist ?? '')}
      ${f('water', 'Woda (%)', last.water ?? '')}${f('visceral', 'Tłuszcz trzewny', last.visceral ?? '', '1')}
      ${f('bone', 'Kości (kg)', last.bone ?? '')}${f('bmr', 'Metabolizm (kcal)', last.bmr ?? '', '1')}
    </div>
    <p class="hint">Szare wartości to ostatni pomiar — wpisz tylko to, co pokazała waga. Obwód pasa mierz rano, na wysokości pępka.</p>
    <div class="actions">${e ? '<button class="btn danger" id="bf-del">Usuń</button><span style="flex:1"></span>' : ''}<button class="btn ghost" id="bf-cancel">Anuluj</button><button class="btn-sm" id="bf-save">Zapisz</button></div>`, { sheet: true });
  m.querySelector('#bf-cancel').onclick = m.close;
  m.querySelector('#bf-save').onclick = () => {
    const v = {};
    m.querySelectorAll('[data-k]').forEach(i => { const n = parseFloat(i.value.replace(',', '.')); if (Number.isFinite(n)) v[i.dataset.k] = n; });
    if (!v.weight || v.weight < 25 || v.weight > 300) { toast('Podaj wagę', true); return; }
    const ts = new Date(m.querySelector('#bf-dt').value).getTime() || Date.now();
    if (e) { for (const k of ['weight', 'fat', 'muscle', 'waist', 'water', 'visceral', 'bone', 'bmr']) { if (v[k] != null) e[k] = v[k]; else delete e[k]; } e.ts = ts; e.updated = Date.now(); }
    else { const id = A.bodyId(ts); db.body = db.body.filter(x => x.id !== id); db.body.push({ id, ts, ...v, source: 'manual', updated: Date.now() }); }
    db.body.sort((a, b) => a.ts - b.ts);
    m.close(); changed(); renderAll(); toast('✅ Zapisano pomiar');
  };
  m.querySelector('#bf-del')?.addEventListener('click', () => {
    db.body = db.body.filter(x => x.id !== e.id); db.bodyDeleted = [...new Set([...db.bodyDeleted, e.id])];
    m.close(); changed(); renderAll();
  });
}

// ══ PLAN ════════════════════════════════════════════════════════════════════
const activePlan = () => (db.plan && !db.plan.ended ? db.plan : null);
const fmtDay = t => { const d = new Date(t); return `${P.DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
function relDay(t) {
  const diff = Math.round((P.dayStart(t) - P.dayStart(Date.now())) / DAY);
  return diff === 0 ? 'dziś' : diff === 1 ? 'jutro' : diff === 2 ? 'pojutrze' : fmtDay(t);
}
function todayCardHtml(compact = false) {
  const sch = P.planSchedule(db.plan, acts(), S());
  if (sch.finished) return `<div class="card next"><div class="ic">${icon('plan')}</div><div><div class="t">Plan ukończony 🎉</div><p>Wszystkie ${sch.total} treningów za Tobą. W zakładce Plan założysz kolejny.</p></div></div>`;
  const n = sch.next, info = P.sessionInfo(n, S(), db.plan);
  const isToday = n.status === 'today';
  const GEN = ['niedzieli', 'poniedziałku', 'wtorku', 'środy', 'czwartku', 'piątku', 'soboty'];
  const dl = Math.round((P.dayStart(n.deadline) - P.dayStart(Date.now())) / DAY);
  const until = dl <= 0 ? 'dziś' : dl === 1 ? 'do jutra' : `do ${GEN[new Date(n.deadline).getDay()]}`;
  const when = n.status === 'overdue' ? `Zaległy z: ${fmtDay(n.planned)} · nadrób ${until}` : isToday ? (n.moved ? 'Dziś (przełożony)' : 'Dziś w planie') : `Następny: ${relDay(n.date)}${n.moved ? ' (przełożony)' : ''}`;
  return `<div class="card today ${n.status === 'overdue' ? 'overdue' : ''}">
    <div class="today-top"><span class="pill ${info.tone}"><i></i>${esc(when)}</span><span class="muted small">Tydzień ${n.week}/${P.planWeeks(db.plan)}${n.light ? ' · lżejszy' : ''}</span></div>
    <h3>${esc(info.title)}</h3>
    <ul class="steps">${info.steps.slice(0, compact ? 2 : 9).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    ${isToday || n.status === 'overdue' ? `<div class="today-actions"><button class="btn" data-pa="done">✓ Zrobione bez zegarka</button><button class="btn ghost" data-pa="tomorrow">Jutro</button><button class="btn ghost" data-pa="skip">Pomiń</button></div>` : ''}
    ${compact ? `<a class="today-more" data-go="plan">Cały plan ›</a>` : ''}
  </div>`;
}
function bindTodayCard(el) {
  el.querySelectorAll('[data-pa]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const sch = P.planSchedule(db.plan, acts(), S()); const n = sch.next; if (!n) return;
    const pl = db.plan;
    if (b.dataset.pa === 'done') { pl.marks = { ...pl.marks, [n.id]: { s: 'done', ts: Date.now() } }; toast('✓ Odhaczone'); }
    if (b.dataset.pa === 'skip') { if (!confirm('Pominąć ten trening? Pozostałe zostają na swoich dniach.')) return; pl.marks = { ...pl.marks, [n.id]: { s: 'skip', ts: Date.now() } }; }
    if (b.dataset.pa === 'tomorrow') { pl.moves = { ...(pl.moves || {}), [n.id]: P.dayStart(Date.now()) + DAY + 3600e3 }; toast('Przełożone na jutro — reszta planu bez zmian'); }
    pl.updated = Date.now(); changed(); renderView();
  });
  el.querySelectorAll('[data-go]').forEach(x => x.onclick = e => { e.stopPropagation(); setView(x.dataset.go); });
}
function renderPlan() {
  const el = $('#view-plan');
  if (!activePlan()) { planWizard(el); return; }
  const s = S();
  const sch = P.planSchedule(db.plan, acts(), s);
  const pctDone = Math.round(sch.closed / sch.total * 100);
  const prog = P.planProgress(db.plan, acts(), s);
  const missedN = sch.sessions.filter(x => x.status === 'missed').length;
  let html = `<div class="card pad"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap"><b style="font-size:16px">${esc(P.planLabel(db.plan))}</b><span class="muted small">${db.plan.days.map(d => P.DAY_SHORT[d]).join(' · ')}</span></div>
    <div class="progress" style="height:8px"><i style="width:${pctDone}%"></i></div>
    <div class="muted small" style="margin-top:8px">Zrobione ${sch.done} z ${sch.total}${missedN ? ` · przepadło ${missedN}` : ''} · tydzień ${Math.min(sch.week, P.planWeeks(db.plan))} z ${P.planWeeks(db.plan)}</div>
    ${prog.exec != null ? `<div class="plan-exec">${ringSvg(prog.exec, 56)}<div><b>Realizacja planu</b><div class="muted small">${prog.quality != null ? `średnia ocena wykonania ${prog.quality}%` : ''}${prog.missed ? ` · opuszczone ${prog.missed} (liczą się jako 0%)` : ''}</div><div class="small" style="margin-top:4px;line-height:1.45">${esc(prog.note)}</div></div></div>` : ''}${planMetaHtml(db.plan)}</div>
    <div class="sec">Najbliższy trening</div>${todayCardHtml(false)}`;
  const upcoming = sch.open.slice(1, 8);
  if (upcoming.length) html += `<div class="sec">Kolejne</div><div class="card">${upcoming.map(x => { const i = P.sessionInfo(x, s, db.plan); return `<details class="pl-row"><summary><span class="pl-date">${esc(relDay(x.date))}</span><span class="pill ${i.tone}"><i></i>${esc(i.short)}</span><span class="pl-t">${esc(i.title)}</span></summary><ul class="steps">${i.steps.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>`; }).join('')}</div>`;
  const done = sch.sessions.filter(x => ['done', 'skipped', 'missed'].includes(x.status)).sort((a, b) => (b.at || b.planned) - (a.at || a.planned));
  if (done.length) html += `<div class="sec">Zrobione</div><div class="card">${done.map(x => { const i = P.sessionInfo(x, s, db.plan); return `<div class="pl-row done" ${x.runId ? `data-id="${x.runId}"` : ''}><span class="pl-date">${fmtDateShort(x.at || x.planned)}</span><span class="pl-t">${esc(i.title)}<small>${x.status === 'skipped' ? 'pominięty' : x.status === 'missed' ? 'przepadł — nie nadrobiony na czas' : esc((x.comp ? x.comp.label : 'oznaczony ręcznie') + (x.runId && P.dayStart(x.at) < x.planned ? ` · zrobiony dzień wcześniej (plan: ${P.DAY_SHORT[new Date(x.planned).getDay()]})` : x.runId && P.dayStart(x.at) > x.planned ? ` · nadrobiony (plan: ${P.DAY_SHORT[new Date(x.planned).getDay()]})` : ''))}</small></span><span class="pl-st ${x.status !== 'done' ? 'skip' : x.comp && !x.comp.ok ? 'warn' : 'ok'}">${x.status !== 'done' ? '–' : x.comp?.pct != null ? x.comp.pct : '✓'}</span></div>`; }).join('')}</div>`;
  html += `<div class="sec">Jak działa plan</div><div class="card pad"><p class="muted" style="font-size:13.5px;line-height:1.6">Każdy trening ma swój stały dzień. Jeśli go opuścisz, przesuwa się <b>tylko ten jeden</b> — pokaże się jako <b>zaległy</b> i możesz go nadrobić do dnia przed kolejnym treningiem (np. czwartek → piątek lub sobota). Reszta planu zostaje na swoich dniach. Każdy wgrany bieg zalicza trening z planu i dostaje ocenę wykonania 0–100% (intensywność, czas, struktura, termin) — gdy nie wiadomo, który to trening, aplikacja zapyta; przycisk „Jutro” przekłada tylko bieżący trening.</p>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" id="pl-chdays">Zmień dni</button><button class="btn" id="pl-days">Dopasuj plan</button><button class="btn danger" id="pl-del">Zakończ plan</button></div></div>`;
  el.innerHTML = html;
  bindTodayCard(el);
  el.querySelectorAll('.pl-row.done[data-id]').forEach(r => r.onclick = () => openDetail(r.dataset.id));
  $('#pl-days').onclick = () => planWizard(null);
  $('#pl-chdays').onclick = changeDaysForm;
  $('#pl-del').onclick = () => { if (!confirm('Zakończyć plan? Historia treningów zostaje.')) return; db.plan = { ...db.plan, ended: Date.now(), updated: Date.now() }; changed(); renderView(); };
}
// ══ PULPIT: DODATKI (próg, tydzień, buty) ═══════════════════════════════════
function homeExtrasHtml(now) {
  const s = S();
  let html = '';
  const lt = A.estimateThreshold(acts(), s, now);
  if (lt) html += `<div class="card pad notice" style="margin-top:10px"><b>📈 Twój próg mógł wzrosnąć do ${lt.lthr} bpm</b>
    <p class="muted small" style="margin-top:4px;line-height:1.5">W biegu z ${fmtDate(lt.start)} trzymałeś równe ${lt.lthr} bpm przez 20 minut (tempo ${C.fmtPace(lt.pace)}/km). Teraz masz ustawione ${s.lthr}. Sprawdź też w Zepp, co pokazuje zegarek.</p>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn-sm" data-lt="yes" data-v="${lt.lthr}" data-p="${lt.pace}" data-r="${lt.runId}">Zaktualizuj</button><button class="btn ghost" data-lt="no" data-r="${lt.runId}">Nie teraz</button></div></div>`;
  const warn = A.shoeStats(acts(), s).filter(x => x.warn && !x.retired);
  for (const sh of warn) html += `<div class="card pad notice" style="margin-top:10px"><b>👟 ${esc(sh.name)}: ${Math.round(sh.km)} km</b><p class="muted small" style="margin-top:4px">Zbliżasz się do limitu ${sh.limit} km — amortyzacja słabnie. Pomyśl o nowej parze.</p></div>`;
  // podsumowanie tygodnia: w niedzielę bieżący, w pn–śr poprzedni
  const wd = new Date(now).getDay();
  if (wd === 0 || wd <= 3) {
    const from = wd === 0 ? C.weekStart(now) : C.weekStart(now) - 7 * DAY;
    const sch = activePlan() ? P.planSchedule(db.plan, acts(), s, now).sessions : null;
    const w = A.weekSummary(acts(), db.body, s, from, sch);
    const kmDelta = w.prevKm ? w.km - w.prevKm : null;
    html += `<div class="sec">${wd === 0 ? 'Ten tydzień' : 'Poprzedni tydzień'} · ${fmtDateShort(from)}–${fmtDateShort(from + 6 * DAY)}</div>
      <div class="card"><div class="week-sum">
        <div><span>Bieganie</span><b class="num">${dec1(w.km)} km</b><small>${w.runs}× ${kmDelta != null ? deltaHtml(kmDelta, 'km') : ''}</small></div>
        ${w.plan ? `<div><span>Plan</span><b class="num">${w.plan.done}/${w.plan.total}</b><small>${w.plan.ok} zgodnie</small></div>` : ''}
        <div><span>Łatwo</span><b class="num">${w.easy != null ? Math.round(w.easy * 100) + '%' : '–'}</b><small>cel 80%</small></div>
        <div><span>Siła</span><b class="num">${w.strength}×</b><small>&nbsp;</small></div>
        ${w.wNow ? `<div><span>Waga śr.</span><b class="num">${dec1(w.wNow)}</b><small>${w.wPrev ? deltaHtml(w.wNow - w.wPrev, 'kg', false, true) : '&nbsp;'}</small></div>` : ''}
      </div><p class="week-tip">${esc(w.tip)}</p></div>`;
  }
  return html;
}
function bindHomeExtras(el) {
  el.querySelectorAll('[data-lt]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const s = S();
    if (b.dataset.lt === 'yes') { const p = +b.dataset.p; db.settings = { ...s, lthr: +b.dataset.v, thrPace: p && p < s.thrPace ? p : s.thrPace, updated: Date.now() }; toast(`✅ Próg ${b.dataset.v} bpm — strefy przeliczone`); }
    else db.settings = { ...s, ltDismissed: b.dataset.r, updated: Date.now() };
    changed(); renderView();
  });
}

// ══ SZCZEGÓŁY: TRENING SIŁOWY ═══════════════════════════════════════════════
function strengthDetail(a) {
  const s = S();
  const zt = A.zoneTimes(a, s.lthr);
  const stats = [['Czas', C.fmtDur(a.timer), ''], ['Tętno śr.', a.avgHr ?? '–', a.avgHr ? 'bpm' : ''], ['Tętno maks.', a.maxHr ?? '–', a.maxHr ? 'bpm' : ''],
    ['Kalorie', a.calories ?? '–', a.calories ? 'kcal' : ''], ['Obciążenie', Math.round(A.trainingLoad(a, s)), 'pkt'], ['Training Effect', a.te != null ? dec1(a.te) : '–', '']];
  const zs = A.zonesFor(s.lthr);
  let html = `<div class="big-stats" style="grid-template-columns:repeat(3,1fr)">${stats.map(([l, v, u]) => `<div><div class="lbl">${l}</div><div class="val num">${v}<small>${u}</small></div></div>`).join('')}</div>`;
  const isStr = C.isStrength(a);
  html += `<div class="card report"><div class="report-head">${typePill(a)}<b>Podsumowanie</b></div><p>${isStr
    ? `Trening siłowy ${Math.round(a.timer / 60)} min${a.avgHr ? `, średnie tętno ${a.avgHr} bpm` : ''}. ${a.avgHr && a.avgHr > zs[2].lo ? 'Sporo pracy w wysokich strefach — obwody lub krótkie przerwy.' : 'Spokojne tętno — klasyczna siła z przerwami między seriami.'} Najlepiej w dzień bez biegu albo po łatwym bieganiu; przed akcentem (progiem, interwałami) zostaw dzień przerwy.`
    : `Aktywność bez trasy GPS. Jeśli to trening siłowy, oznacz go niżej — trafi do zakładki Siła.`}</p></div>`;
  if (zt && zt.some(Boolean)) {
    const tot = zt.reduce((x, y) => x + y, 0) || 1;
    html += `<div class="sec">Czas w strefach tętna</div><div class="card"><div class="zone-rows">${zs.map((z, i) => ({ z, v: zt[i + 1], c: `var(--z${i + 1})` })).reverse().map(r => `<div class="zone-row"><div class="zn"><b>${r.z.short}</b><span class="zname">${esc(r.z.name)} · </span>${r.z.lo}–${r.z.hi}</div><div class="bar"><i style="width:${r.v / tot * 100}%;background:${r.c}"></i></div><div class="zt num">${C.fmtDur(r.v)}</div></div>`).join('')}</div></div>`;
  }
  html += `<div style="display:flex;gap:8px;margin-top:22px;flex-wrap:wrap"><button class="btn" id="d-rename">✎ Zmień nazwę</button><button class="btn" id="d-kind">${isStr ? 'To nie jest trening siłowy' : 'To trening siłowy'}</button><button class="btn danger" id="d-del">Usuń trening</button></div>`;
  $('#detail-inner').innerHTML = html;
  $('#d-rename').onclick = () => renameActivity(a);
  $('#d-del').onclick = () => deleteActivity(a);
  $('#d-kind').onclick = () => { a.kind = isStr ? 'other' : 'strength'; a.updated = Date.now(); changed(); openDetail(a.id); renderView(); };
}
function renderShoePick() {
  const a = cur, slot = $('#shoe-slot'); if (!a || !slot) return;
  const shoes = (S().shoes || []).filter(x => !x.retired || x.id === a.shoe);
  if (!shoes.length) { slot.innerHTML = `<p class="muted small">Dodaj buty w Ustawieniach (suwaki u góry → Buty), żeby liczyć ich przebieg.</p>`; return; }
  slot.innerHTML = `<div class="chips">${shoes.map(x => `<button class="chip ${a.shoe === x.id ? 'active' : ''}" data-shoe="${x.id}">${esc(x.name)}</button>`).join('')}<button class="chip ${!a.shoe ? 'active' : ''}" data-shoe="">bez przypisania</button></div>`;
  slot.querySelectorAll('[data-shoe]').forEach(b => b.onclick = () => { a.shoe = b.dataset.shoe || null; a.updated = Date.now(); changed(); renderShoePick(); });
}

// ══ POSTĘP: KIEDY NAJLEPIEJ, TECHNIKA, TRASY, ODZNAKI ═══════════════════════
function bestConditionsHtml() {
  const bc = A.bestConditions(acts());
  let html = `<div class="sec">Kiedy biegasz najlepiej</div><div class="card pad">`;
  if (!bc) return html + `<p class="muted" style="font-size:14px;line-height:1.55">Potrzeba co najmniej 4 biegów z tętnem. Liczę metry przebiegnięte na jedno uderzenie serca — im więcej, tym lepsza forma tego dnia.</p></div>`;
  const grp = (title, rows, empty) => `<div class="bc-group"><div class="bc-title">${title}</div>${rows.length ? rows.map(r => `<div class="bc-row"><span>${esc(r.label)} <small class="muted">(${r.n})</small></span><div class="bc-bar"><i style="${r.diff >= 0 ? 'left:50%' : `right:50%`};width:${Math.min(50, Math.abs(r.diff) * 5)}%;background:${r.diff >= 0 ? 'var(--accent)' : 'var(--warn)'}"></i></div><b class="num" style="color:${r.diff >= 0 ? 'var(--accent)' : 'var(--warn)'}">${r.diff >= 0 ? '+' : ''}${dec1(r.diff)}%</b></div>`).join('') : `<p class="muted small">${empty}</p>`}</div>`;
  html += `<p class="muted small" style="line-height:1.5;margin-bottom:6px">Wydajność względem Twojej średniej: metry na uderzenie serca. Plus = przy tym samym wysiłku biegniesz szybciej.</p>`;
  html += grp('Pora dnia', bc.time, 'Biegasz zwykle o jednej porze.');
  html += grp('Pogoda', bc.temp, 'Pogoda dociąga się przy otwieraniu treningów z GPS.');
  html += grp('Kawa przed biegiem', bc.coffee, 'Zaznaczaj kawę w notatce po biegu (min. 2 biegi z kawą i 2 bez).');
  html += grp('Sen', bc.sleep, 'Zaznaczaj sen w notatce po biegu.');
  return html + `</div>`;
}
function renderTechnique(el) {
  const rep = A.techniqueReport(acts());
  if (!rep) { el.innerHTML = `<div class="empty">Technika pojawi się po 2 biegach z danymi o kroku (kadencja, kontakt z podłożem).</div>`; return; }
  const rows = rep.rows;
  let html = `<div class="sec">Ostatnie 4 tygodnie vs wcześniej</div><div class="card"><table class="tbl num"><thead><tr><th>Wskaźnik</th><th class="r">Teraz</th><th class="r">Wcześniej</th><th class="r"></th></tr></thead><tbody>${rows.map(r => {
    const d = r.now != null && r.prev != null ? r.now - r.prev : null;
    const good = d == null || r.better == null || Math.abs(d) < 1e-9 ? null : (r.better === 'up' ? d > 0 : d < 0);
    return `<tr class="click" data-tm="${r.k}"><td>${r.label} <small class="muted">${r.unit}</small></td><td class="r"><b>${r.now != null ? r.fmt(r.now) : '–'}</b></td><td class="r muted">${r.prev != null ? r.fmt(r.prev) : '–'}</td><td class="r">${good == null ? '' : good ? '<span class="delta up">▲</span>' : '<span class="delta down">▼</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  html += `<div class="sec">Wykres</div><div class="chips" style="margin-bottom:8px">${rows.map(r => `<button class="chip ${techMetric === r.k ? 'active' : ''}" data-tm="${r.k}">${r.label}</button>`).join('')}</div>
    <div class="card chart-card"><div class="chart-head"><b><i style="background:var(--c-pace)"></i>${esc(A.TECH[techMetric]?.label || '')}</b><span>każdy bieg osobno · kolor = tempo</span></div><div class="chart-box" style="height:190px"><canvas id="ch-tech"></canvas></div></div>`;
  html += `<div class="sec">Wskazówki</div><div class="card"><ul class="lines">${rep.tips.map(t => `<li><span class="ic">👟</span><span>${esc(t)}</span></li>`).join('')}</ul></div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => { techMetric = b.dataset.tm; renderProgress(); });
  if (!rows.some(r => r.k === techMetric)) techMetric = rows[0].k;
  const def = A.TECH[techMetric];
  const pts = rep.series.filter(x => x[techMetric] != null);
  const paces = pts.map(x => x.pace).filter(Boolean), pMin = Math.min(...paces), pMax = Math.max(...paces);
  const col = p => { const t = pMax > pMin ? (pMax - p) / (pMax - pMin) : 0.5; return PACE_RAMP[Math.round(1 + t * 4)]; };
  viewCharts.push(new Chart($('#ch-tech'), {
    type: 'scatter',
    data: { datasets: [{ data: pts.map(x => ({ x: x.start, y: x[techMetric] * (def.scale || 1) })), pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: pts.map(x => col(x.pace)), pointBorderColor: '#1c1c1e', pointBorderWidth: 1.5 }] },
    options: chartBase({ parsing: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#000e', displayColors: false, callbacks: { title: it => fmtDate(it[0].parsed.x), label: it => `${def.fmt(pts[it.dataIndex][techMetric])} ${def.unit} · tempo ${C.fmtPace(pts[it.dataIndex].pace)}/km` } } },
      scales: { x: { type: 'linear', grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 6, callback: v => fmtDateShort(v) } },
        y: { grid: { color: '#ffffff0d' }, border: { display: false }, ticks: { color: '#7a7a80', font: { size: 10.5 }, maxTicksLimit: 5 } } } }),
  }));
}
function renderRoutes(el) {
  const routes = A.findRoutes(acts(), S().routeNames || {});
  if (!routes.length) { el.innerHTML = `<div class="empty">Trasy pojawią się, gdy przebiegniesz tę samą pętlę co najmniej 2 razy (start w tym samym miejscu, podobny przebieg i dystans).</div>`; return; }
  let html = `<div class="sec">Twoje stałe trasy</div>`;
  for (const r of routes) {
    const open = openRoute === r.id;
    html += `<div class="card route ${open ? 'open' : ''}" style="margin-bottom:10px"><div class="route-head" data-rt="${r.id}">${routeThumb(r.route)}
      <div style="flex:1;min-width:0"><b>${esc(r.name)}</b><div class="muted small" style="margin-top:3px">${r.runs.length}× · najlepiej ${C.fmtDur(r.best.timer)} (${C.fmtPace(r.best.pace)}/km, ${fmtDateShort(r.best.start)})</div>
      <div class="muted small">ostatnio ${C.fmtDur(r.last.timer)} · ${fmtDateShort(r.last.start)}</div></div><span class="chev">${open ? '▾' : '▸'}</span></div>`;
    if (open) {
      html += `<div class="route-body"><div class="bc-title" style="margin:4px 0 6px">Ranking (tempo)</div>${r.ranking.slice(0, 10).map((x, i) => `<div class="top-item num" data-id="${x.id}"><span class="n">${i + 1}.</span><span class="tm">${C.fmtDur(x.timer)}</span><span class="dt">${fmtDate(x.start)}</span><span class="muted">${C.fmtPace(x.pace)}${x.avgHr ? ' · ' + x.avgHr + ' bpm' : ''}</span></div>`).join('')}`;
      if (r.last.id !== r.best.id) {
        const cmp = A.routeCompare(r.last, r.best);
        if (cmp.length) html += `<div class="bc-title" style="margin:14px 0 6px">Ostatni bieg vs najlepszy — km po km</div>${cmp.map(c => `<div class="bc-row"><span>km ${c.km}</span><div class="bc-bar"><i style="${c.d <= 0 ? 'left:50%' : 'right:50%'};width:${Math.min(50, Math.abs(c.d) / 2)}%;background:${c.d <= 0 ? 'var(--accent)' : 'var(--warn)'}"></i></div><b class="num" style="color:${c.d <= 0 ? 'var(--accent)' : 'var(--warn)'}">${c.d <= 0 ? '−' : '+'}${Math.abs(Math.round(c.d))} s</b></div>`).join('')}<p class="muted small" style="margin-top:6px">Na mecie: ${cmp[cmp.length - 1].acc <= 0 ? 'szybciej' : 'wolniej'} o ${C.fmtDur(Math.abs(cmp[cmp.length - 1].acc))}.</p>`;
      } else html += `<p class="muted small" style="margin-top:10px">Ostatni bieg na tej trasie jest Twoim najlepszym 🏆</p>`;
      html += `<button class="btn ghost" data-rname="${r.id}" style="margin-top:12px">✎ Nazwij trasę</button></div>`;
    }
    html += `</div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-rt]').forEach(h => h.onclick = () => { openRoute = openRoute === h.dataset.rt ? null : h.dataset.rt; renderProgress(); });
  el.querySelectorAll('.top-item[data-id]').forEach(x => x.onclick = () => openDetail(x.dataset.id));
  el.querySelectorAll('[data-rname]').forEach(b => b.onclick = () => {
    const r = routes.find(x => x.id === b.dataset.rname);
    const t = prompt('Nazwa trasy:', r.name); if (t == null) return;
    const names = { ...(S().routeNames || {}) }; if (t.trim()) names[r.id] = t.trim(); else delete names[r.id];
    db.settings = { ...S(), routeNames: names, updated: Date.now() }; changed(); renderProgress();
  });
}
function renderBadges(el) {
  const sch = activePlan() ? P.planSchedule(db.plan, acts(), S()) : null;
  const ch = A.monthChallenges(acts(), S());
  const bs = A.badges(acts(), db.body, S(), sch);
  const got = bs.filter(b => b.earned), todo = bs.filter(b => !b.earned);
  let html = `<div class="sec">Wyzwania · ${MONTHS[new Date().getMonth()]}<span class="muted small">zostało ${ch.daysLeft} ${plural(ch.daysLeft, 'dzień', 'dni', 'dni')}</span></div><div class="card">${ch.items.map(i => {
    const p = Math.min(1, i.cur / i.target);
    return `<div class="chal"><span class="chal-ic">${i.icon}</span><div style="flex:1"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(i.name)}</b><span class="num muted small">${esc(i.text)}</span></div><div class="progress" style="margin-top:7px"><i style="width:${p * 100}%;${p >= 1 ? 'background:var(--gold)' : ''}"></i></div></div></div>`;
  }).join('')}</div>`;
  html += `<div class="sec">Zdobyte · ${got.length}/${bs.length}</div><div class="badges">${got.map(b => `<div class="badge"><span>${b.icon}</span><b>${esc(b.name)}</b><small>${b.date && b.date < Date.now() - 60e3 ? fmtDate(b.date) : esc(b.desc)}</small></div>`).join('') || '<p class="muted">Jeszcze nic — pierwszy bieg odblokuje pierwszą odznakę.</p>'}</div>`;
  html += `<div class="sec">Do zdobycia</div><div class="badges">${todo.map(b => `<div class="badge locked"><span>${b.icon}</span><b>${esc(b.name)}</b><small>${esc(b.prog || b.desc)}</small></div>`).join('')}</div>`;
  el.innerHTML = html;
}

// ══ CIAŁO: CELE ═════════════════════════════════════════════════════════════
function goalsHtml(list) {
  const g = S().goals || {};
  if (!g.weight && !g.waist) return `<div class="card pad" style="margin-top:10px;display:flex;align-items:center;gap:12px"><span style="font-size:22px">🎯</span><div style="flex:1"><b>Ustaw cel</b><div class="muted small">waga lub obwód pasa — pokażę, kiedy go osiągniesz</div></div><button class="btn" data-goal>Ustaw</button></div>`;
  const row = (k, unit, label) => {
    if (!g[k]) return '';
    const f = A.goalForecast(list, k, g[k]);
    if (!f) return `<div class="goal"><div class="goal-top"><b>${label}: cel ${dec1(g[k])} ${unit}</b></div><p class="muted small">Brak pomiarów ${k === 'waist' ? 'pasa' : 'wagi'}.</p></div>`;
    return `<div class="goal"><div class="goal-top"><b>${label}: ${dec1(f.cur)} → ${dec1(f.goal)} ${unit}</b><span class="muted small">${f.done ? '' : 'zostało ' + dec1(f.left) + ' ' + unit}</span></div>
      <div class="progress" style="height:8px"><i style="width:${f.progress * 100}%;${f.done ? 'background:var(--gold)' : ''}"></i></div><p class="muted small" style="margin-top:7px">${esc(f.text)}</p></div>`;
  };
  return `<div class="sec">Cele<a data-goal>Zmień</a></div><div class="card pad">${row('weight', 'kg', 'Waga')}${row('waist', 'cm', 'Pas')}</div>`;
}
function goalsForm() {
  const g = S().goals || {};
  const m = modal(`<h3>Cele</h3><p>Zostaw puste, jeśli nie chcesz danego celu. Bezpieczne tempo redukcji to 0,3–0,7 kg tygodniowo.</p>
    <div class="form"><label>Waga docelowa (kg)<input type="number" inputmode="decimal" step="0.1" id="g-w" value="${g.weight ?? ''}"></label><label>Pas docelowy (cm)<input type="number" inputmode="decimal" step="0.5" id="g-p" value="${g.waist ?? ''}"></label></div>
    <div class="actions"><button class="btn ghost" id="g-c">Anuluj</button><button class="btn-sm" id="g-s">Zapisz</button></div>`, { sheet: true });
  m.querySelector('#g-c').onclick = m.close;
  m.querySelector('#g-s').onclick = () => {
    const v = id => { const n = parseFloat(m.querySelector(id).value.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
    db.settings = { ...S(), goals: { weight: v('#g-w'), waist: v('#g-p') }, updated: Date.now() }; m.close(); changed(); renderView();
  };
}

// ══ BUTY ════════════════════════════════════════════════════════════════════
function shoesForm() {
  const draw = () => {
    const st = A.shoeStats(acts(), S());
    const def = S().defaultShoe;
    return `<h3>Buty</h3><p>Nowe biegi dostają domyślną parę. W szczegółach biegu możesz ją zmienić.</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">${st.length ? st.map(x => `<div class="card pad" style="${x.retired ? 'opacity:.55' : ''}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(x.name)}${def === x.id ? ' <span class="pill easy" style="margin-left:4px">domyślne</span>' : ''}</b><span class="num">${Math.round(x.km)} / ${x.limit} km</span></div>
        <div class="progress" style="height:8px"><i style="width:${Math.min(100, x.ratio * 100)}%;${x.warn ? 'background:var(--warn)' : ''}"></i></div>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">${!x.retired && def !== x.id ? `<button class="btn ghost" data-sh="def" data-id="${x.id}">Ustaw domyślne</button>` : ''}<button class="btn ghost" data-sh="${x.retired ? 'unret' : 'ret'}" data-id="${x.id}">${x.retired ? 'Przywróć' : 'Wycofaj'}</button><button class="btn ghost" data-sh="all" data-id="${x.id}">Przypisz biegom bez butów</button></div></div>`).join('') : '<p class="muted">Brak butów.</p>'}</div>
      <div class="form" style="margin-top:14px"><label class="full">Nazwa<input id="sh-n" placeholder="np. Nike Pegasus 41"></label><label>Limit (km)<input id="sh-l" type="number" inputmode="numeric" value="700"></label><label>Już przebiegnięte (km)<input id="sh-k" type="number" inputmode="numeric" value="0"></label></div>
      <div class="actions"><button class="btn ghost" id="sh-close">Zamknij</button><button class="btn-sm" id="sh-add">Dodaj parę</button></div>`;
  };
  const m = modal(draw(), { sheet: true });
  const save = (shoes, extra = {}) => { db.settings = { ...S(), shoes, ...extra, updated: Date.now() }; changed(); };
  const bind = () => {
    m.querySelector('.modal').innerHTML = draw();
    m.querySelector('#sh-close').onclick = () => { m.close(); renderView(); };
    m.querySelector('#sh-add').onclick = () => {
      const name = m.querySelector('#sh-n').value.trim(); if (!name) { toast('Podaj nazwę butów', true); return; }
      const sh = { id: 's' + Date.now().toString(36), name, limit: +m.querySelector('#sh-l').value || 700, startKm: +m.querySelector('#sh-k').value || 0, added: Date.now() };
      save([...(S().shoes || []), sh], S().defaultShoe ? {} : { defaultShoe: sh.id }); bind();
    };
    m.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => {
      const id = b.dataset.id, shoes = (S().shoes || []).map(x => ({ ...x }));
      const x = shoes.find(y => y.id === id);
      if (b.dataset.sh === 'def') save(shoes, { defaultShoe: id });
      if (b.dataset.sh === 'ret') { x.retired = true; save(shoes, S().defaultShoe === id ? { defaultShoe: null } : {}); }
      if (b.dataset.sh === 'unret') { x.retired = false; save(shoes); }
      if (b.dataset.sh === 'all') { let n = 0; acts().forEach(a => { if (C.isRun(a) && !a.shoe) { a.shoe = id; a.updated = Date.now(); n++; } }); changed(); toast(`Przypisano ${n} ${plural(n, 'bieg', 'biegi', 'biegów')}`); }
      bind();
    });
  };
  bind();
}

// ══ PLAN: GENERATOR ═════════════════════════════════════════════════════════
function planMetaHtml(pl) {
  const m = pl.meta; if (!m) return '';
  const p = m.paces;
  return `${m.check ? `<p class="small" style="margin-top:10px;line-height:1.5;color:${m.check.level === 'ok' ? 'var(--accent)' : 'var(--warn)'}">${esc(m.check.text)}</p>` : ''}
    <div class="muted small" style="margin-top:8px;line-height:1.5">Tempa: ${p.easy ? `łatwe ${C.fmtPace(p.easy[0])}–${C.fmtPace(p.easy[1])}` : 'łatwe wg tętna'} · próg ${C.fmtPace(p.thr)} · szybkie ${C.fmtPace(p.int)} /km. Zawsze ważniejsze jest tętno.</div>`;
}
function changeDaysForm() {
  const pl = db.plan, n = pl.days.length;
  let days = [...pl.days], longDay = pl.longDay ?? pl.meta?.opts?.longDay ?? days[days.length - 1];
  const m = modal('<div id="cd"></div>', { sheet: true });
  const root = m.querySelector('.modal');
  const draw = () => {
    if (!days.includes(longDay)) longDay = days.includes(0) ? 0 : days[days.length - 1];
    root.innerHTML = `<h3>Zmień dni treningowe</h3><p>Zrobione treningi zostają w historii. Pozostałe przejdą na nowe dni, w tych samych tygodniach planu — w bieżącym tygodniu tylko na dni, które jeszcze nie minęły.</p>
      <div class="wiz-q">Wybierz ${n} ${plural(n, 'dzień', 'dni', 'dni')}</div><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${days.includes(d) ? 'active' : ''}" data-cd="${d}">${P.DAY_SHORT[d]}</button>`).join('')}</div>
      <div class="wiz-q">Dzień długiego biegu</div><div class="chips">${[...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => `<button class="chip ${longDay === d ? 'active' : ''}" data-cl="${d}">${P.DAY_SHORT[d]}</button>`).join('')}</div>
      <p class="hint">Chcesz biegać częściej lub rzadziej? Użyj „Dopasuj plan” — wtedy plan ułoży się od nowa pod nową liczbę dni.</p>
      <div class="actions"><button class="btn ghost" id="cd-x">Anuluj</button><button class="btn-sm" id="cd-ok">Zapisz</button></div>`;
    root.querySelectorAll('[data-cd]').forEach(b => b.onclick = () => { const d = +b.dataset.cd; days = days.includes(d) ? days.filter(x => x !== d) : [...days, d]; draw(); });
    root.querySelectorAll('[data-cl]').forEach(b => b.onclick = () => { longDay = +b.dataset.cl; draw(); });
    root.querySelector('#cd-x').onclick = m.close;
    root.querySelector('#cd-ok').onclick = () => {
      if (days.length !== n) { toast(`Wybierz dokładnie ${n} ${plural(n, 'dzień', 'dni', 'dni')}`, true); return; }
      db.plan = P.changePlanDays(pl, acts(), S(), days, longDay);
      m.close(); changed(); renderView(); toast('✅ Dni zmienione — reszta planu bez zmian');
    };
  };
  draw();
}
let wiz = null;
function planWizard(el) {
  const prev = activePlan()?.meta?.opts;
  const wd0 = (new Date().getDay() + 6) % 7;   // pn=0
  wiz = { goal: prev?.goal || 'base', weeks: prev?.weeks || 12, target: prev?.target || null, days: prev?.days || activePlan()?.days || [2, 4, 0], longDay: prev?.longDay ?? 0, maxMin: prev?.maxMin ?? 60, noIntervals: !!prev?.noIntervals, raceDate: '',
    startMode: wd0 === 0 ? 'today' : wd0 <= 2 ? 'thisMon' : 'nextMon', startDate: '' };
  const startTs = () => { const m = P.mondayOfWeek(Date.now()); return wiz.startMode === 'today' ? P.dayStart(Date.now()) : wiz.startMode === 'thisMon' ? m : wiz.startMode === 'nextMon' ? m + 7 * DAY + 3600e3 : (wiz.startDate ? P.dayStart(new Date(wiz.startDate + 'T12:00').getTime()) : P.dayStart(Date.now())); };
  const host = el ? null : modal('<div id="wiz"></div>', { sheet: true });
  const root = el || host.querySelector('.modal');
  const hist = P.analyzeHistory(acts(), S());
  const draw = () => {
    const G = P.GOALS[wiz.goal];
    if (!wiz.days.includes(wiz.longDay)) wiz.longDay = wiz.days.includes(0) ? 0 : wiz.days.includes(6) ? 6 : wiz.days[wiz.days.length - 1];
    root.innerHTML = `<div class="${el ? 'card pad' : ''}" style="${el ? 'margin-top:6px' : ''}">
      <h3 style="font-size:19px;margin-bottom:4px">${activePlan() ? 'Dopasuj plan' : 'Ułóż plan biegowy'}</h3>
      <p class="muted small" style="line-height:1.5">Plan powstaje z Twoich ostatnich treningów i odpowiedzi poniżej.</p>
      <div class="wiz-hist">${hist.lines.map(l => `<div>• ${esc(l)}</div>`).join('')}</div>
      <div class="wiz-q">Od kiedy zaczynamy</div><div class="chips">${[['thisMon', `Ten poniedziałek (${fmtDateShort(P.mondayOfWeek(Date.now()))})`], ['today', 'Dziś'], ['nextMon', `Najbliższy poniedziałek (${fmtDateShort(P.mondayOfWeek(Date.now()) + 7 * DAY + 3600e3)})`], ['date', 'Inna data']].filter(([k]) => !(k === 'thisMon' && P.mondayOfWeek(Date.now()) === P.dayStart(Date.now()))).map(([k, l]) => `<button class="chip ${wiz.startMode === k ? 'active' : ''}" data-ws="${k}">${l}</button>`).join('')}</div>
      ${wiz.startMode === 'date' ? `<div class="form" style="margin-top:8px"><label class="full"><input type="date" id="wz-s" value="${wiz.startDate}"></label></div>` : ''}
      ${wiz.startMode === 'thisMon' ? `<p class="muted small" style="margin-top:6px;line-height:1.5">Treningi z dni, które już minęły, pokażą się jako zaległe — bieg zrobiony w tym tygodniu zaliczy najstarszy z nich.</p>` : ''}
      <div class="wiz-q">Cel</div><div class="chips">${Object.entries(P.GOALS).map(([k, g]) => `<button class="chip ${wiz.goal === k ? 'active' : ''}" data-wg="${k}">${esc(g.label)}</button>`).join('')}</div>
      ${G.dist ? `<div class="wiz-q">Wynik docelowy (opcjonalnie)</div><div class="form" style="margin-top:0"><label class="full"><input id="wz-t" placeholder="${wiz.goal === 'hm' ? 'np. 2:15:00' : wiz.goal === '10k' ? 'np. 59:00' : 'np. 28:00'}" value="${wiz.target ? C.fmtDur(wiz.target) : ''}" inputmode="numeric"></label></div>` : ''}
      <div class="wiz-q">Ile tygodni${G.dist ? ' (albo data biegu)' : ''}</div><div class="chips">${[8, 10, 12, 16].map(w => `<button class="chip ${wiz.weeks === w && !wiz.raceDate ? 'active' : ''}" data-ww="${w}">${w} tyg.</button>`).join('')}</div>
      ${G.dist ? `<div class="form" style="margin-top:8px"><label class="full">Data zawodów<input type="date" id="wz-d" value="${wiz.raceDate}"></label></div>` : ''}
      <div class="wiz-q">Stałe dni biegowe (2–4)</div><div class="chips">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${wiz.days.includes(d) ? 'active' : ''}" data-wd="${d}">${P.DAY_SHORT[d]}</button>`).join('')}</div>
      <div class="wiz-q">Dzień długiego biegu</div><div class="chips">${[...wiz.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => `<button class="chip ${wiz.longDay === d ? 'active' : ''}" data-wl="${d}">${P.DAY_SHORT[d]}</button>`).join('')}</div>
      <div class="wiz-q">Maksymalnie w pozostałe dni</div><div class="chips">${[[30, '30 min'], [45, '45 min'], [60, '60 min'], [0, 'bez limitu']].map(([v, l]) => `<button class="chip ${wiz.maxMin === v ? 'active' : ''}" data-wm="${v}">${l}</button>`).join('')}</div>
      <div class="wiz-q">Preferencje</div><div class="chips"><button class="chip ${wiz.noIntervals ? 'active' : ''}" data-wi>Nie lubię interwałów</button></div>
      <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap"><button class="btn-primary" id="wz-go">Pokaż plan</button>${!el ? '<button class="btn ghost" id="wz-x">Anuluj</button>' : ''}</div></div>`;
    const re = () => { readTarget(); draw(); };
    root.querySelectorAll('[data-wg]').forEach(b => b.onclick = () => { wiz.goal = b.dataset.wg; wiz.target = null; draw(); });
    root.querySelectorAll('[data-ws]').forEach(b => b.onclick = () => { wiz.startMode = b.dataset.ws; re(); });
    root.querySelector('#wz-s')?.addEventListener('change', e => { wiz.startDate = e.target.value; re(); });
    root.querySelectorAll('[data-ww]').forEach(b => b.onclick = () => { wiz.weeks = +b.dataset.ww; wiz.raceDate = ''; re(); });
    root.querySelectorAll('[data-wd]').forEach(b => b.onclick = () => { const d = +b.dataset.wd; wiz.days = wiz.days.includes(d) ? wiz.days.filter(x => x !== d) : [...wiz.days, d]; re(); });
    root.querySelectorAll('[data-wl]').forEach(b => b.onclick = () => { wiz.longDay = +b.dataset.wl; re(); });
    root.querySelectorAll('[data-wm]').forEach(b => b.onclick = () => { wiz.maxMin = +b.dataset.wm; re(); });
    root.querySelector('[data-wi]').onclick = () => { wiz.noIntervals = !wiz.noIntervals; re(); };
    root.querySelector('#wz-d')?.addEventListener('change', e => { wiz.raceDate = e.target.value; if (wiz.raceDate) { const w = Math.round((new Date(wiz.raceDate) - P.dayStart(Date.now())) / (7 * DAY)); wiz.weeks = Math.max(6, Math.min(20, w)); } re(); });
    root.querySelector('#wz-x')?.addEventListener('click', () => host.close());
    root.querySelector('#wz-go').onclick = () => {
      readTarget();
      if (wiz.days.length < 2 || wiz.days.length > 4) { toast('Wybierz od 2 do 4 dni', true); return; }
      if (wiz.raceDate && new Date(wiz.raceDate) - Date.now() < 5 * 7 * DAY) { toast('Do zawodów zostało mniej niż 5 tygodni — wybierz liczbę tygodni lub późniejszą datę', true, 5000); return; }
      if (wiz.startMode === 'date' && !wiz.startDate) { toast('Wybierz datę startu', true); return; }
      preview(P.generatePlan({ ...wiz, start: startTs() }, hist, S()));
    };
  };
  const readTarget = () => {
    const v = root.querySelector('#wz-t')?.value.trim();
    if (v == null) return;
    const m = v.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
    wiz.target = m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] : null;
  };
  const preview = pl => {
    const byW = {}; for (const x of pl.sessions) (byW[x.week] ||= []).push(x);
    const kindShort = x => P.sessionInfo(x, S(), pl).short;
    root.innerHTML = `<div class="${el ? 'card pad' : ''}" style="${el ? 'margin-top:6px' : ''}">
      <h3 style="font-size:19px">${esc(pl.label)}</h3>
      <div class="muted small" style="margin-top:2px">${pl.meta.weeks} tygodni · ${pl.days.map(d => P.DAY_SHORT[d]).join(' · ')} · długi bieg: ${P.DAY_SHORT[wiz.longDay]}</div>
      ${planMetaHtml(pl)}
      <div class="wiz-weeks">${Object.entries(byW).map(([w, xs]) => `<div class="wiz-week ${xs[0].light ? 'light' : ''}"><b>T${w}</b><div>${xs.map(x => `<span class="pill ${P.sessionInfo(x, S(), pl).tone}">${esc(kindShort(x))}</span>`).join('')}</div><span class="num muted small">${xs.reduce((a, x) => a + x.min, 0)}′</span></div>`).join('')}</div>
      <p class="muted small" style="margin-top:10px;line-height:1.5">Szare tygodnie są lżejsze. Plan startuje ${P.dayStart(pl.start) === P.dayStart(Date.now()) ? 'dziś' : fmtDay(pl.start)}; ${activePlan() ? 'obecny plan zostanie zakończony (treningi i historia zostają).' : 'opuszczony trening możesz nadrobić do dnia przed kolejnym.'}</p>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn-primary" id="wz-save">Zapisz plan</button><button class="btn ghost" id="wz-back">Wróć</button></div></div>`;
    root.querySelector('#wz-back').onclick = draw;
    root.querySelector('#wz-save').onclick = () => { db.plan = pl; changed(); host?.close(); setView('plan'); toast('✅ Plan zapisany'); };
  };
  draw();
}

// ══ USTAWIENIA ══════════════════════════════════════════════════════════════
function settingsForm() {
  const s = S();
  const zs = () => A.zonesFor(+m.querySelector('[data-s=lthr]').value || s.lthr);
  const m = modal(`<h3>Ustawienia</h3>
    <p>Strefy liczę od progu mleczanowego — tak jak Twój zegarek Zepp w trybie „strefa tętna progu mleczanowego”.</p>
    <div class="form">
      <label>Tętno progu (bpm)<input type="number" inputmode="numeric" data-s="lthr" value="${s.lthr}"></label>
      <label>Tempo progu (min:s/km)<input type="text" inputmode="numeric" data-s="thrPace" value="${C.fmtPace(s.thrPace)}"></label>
      <label>Tętno spoczynkowe<input type="number" inputmode="numeric" data-s="restHr" value="${s.restHr}"></label>
      <label>Tętno maksymalne<input type="number" inputmode="numeric" data-s="maxHr" value="${s.maxHr}"></label>
      <label class="full">Wzrost (cm) — do BMI<input type="number" inputmode="numeric" data-s="height" value="${s.height ?? ''}"></label>
    </div>
    <div class="card" style="margin-top:12px"><div class="zone-rows" id="zone-preview"></div></div>
    <p class="hint">Gdy Zepp zaktualizuje próg (automatyczna aktualizacja), wpisz tu nową wartość — raporty i strefy przeliczą się dla wszystkich treningów. Przebieg sam podpowie wyższy próg, gdy wykryje go w biegu.</p>
    <button class="sheet-opt" id="st-shoes"><span class="ic">👟</span><span><b>Buty</b><span>${(s.shoes || []).filter(x => !x.retired).length || 'Brak'} ${plural((s.shoes || []).filter(x => !x.retired).length, 'para', 'pary', 'par')} · licznik kilometrów</span></span></button>
    <div class="actions"><button class="btn ghost" id="st-cancel">Anuluj</button><button class="btn-sm" id="st-save">Zapisz</button></div>`, { sheet: true });
  m.querySelector('#st-shoes').onclick = () => { m.close(); shoesForm(); };
  const prev = () => { m.querySelector('#zone-preview').innerHTML = zs().map((z, i) => `<div class="zone-row" style="grid-template-columns:1fr 70px"><div class="zn"><b>${z.short}</b>${z.name}</div><div class="zt num">${z.lo}–${z.hi}</div></div>`).reverse().join(''); };
  prev(); m.querySelector('[data-s=lthr]').oninput = prev;
  m.querySelector('#st-cancel').onclick = m.close;
  m.querySelector('#st-save').onclick = () => {
    const g = k => m.querySelector(`[data-s=${k}]`).value.trim();
    const pace = g('thrPace').match(/^(\d{1,2})[:.,](\d{2})$/);
    const next = { ...s, lthr: +g('lthr') || s.lthr, restHr: +g('restHr') || s.restHr, maxHr: +g('maxHr') || s.maxHr, height: +g('height') || null, thrPace: pace ? +pace[1] * 60 + +pace[2] : s.thrPace, updated: Date.now() };
    if (next.lthr < 100 || next.lthr > 220) { toast('Podaj realne tętno progu (100–220)', true); return; }
    db.settings = next; m.close(); changed(); renderAll(); toast('✅ Zapisano — strefy przeliczone');
  };
}
function driveMenu(anchor) {
  if (!token && !localStorage.getItem(LS('connected'))) { connect(); return; }
  $('.drive-menu')?.remove();
  const mnu = document.createElement('div'); mnu.className = 'drive-menu';
  mnu.innerHTML = `<button data-a="sync">🔄 Synchronizuj teraz</button><button data-a="recompute">♻ Przelicz wszystkie treningi</button><button data-a="export">⬇ Pobierz bazę (JSON)</button><button data-a="status">ℹ Status synchronizacji</button><hr><button data-a="disconnect" style="color:var(--danger)">✕ Odłącz konto Google</button>`;
  document.body.appendChild(mnu);
  const r = anchor.getBoundingClientRect();
  const left = Math.min(innerWidth - mnu.offsetWidth - 10, Math.max(10, r.right - mnu.offsetWidth));
  mnu.style.left = left + 'px';
  mnu.style.top = (r.bottom + mnu.offsetHeight + 8 > innerHeight ? r.top - mnu.offsetHeight - 6 : r.bottom + 6) + 'px';
  setTimeout(() => document.addEventListener('click', function off(e) { if (!mnu.contains(e.target)) { mnu.remove(); document.removeEventListener('click', off); } }), 0);
  mnu.onclick = async e => {
    const act = e.target.closest('button')?.dataset.a; if (!act) return;
    mnu.remove();
    if (act === 'sync') { if (!token) await ensureToken(true); sync({ quiet: false }); }
    if (act === 'recompute') recomputeAll();
    if (act === 'disconnect') { if (confirm('Odłączyć konto Google w tej przeglądarce?')) disconnect(); }
    if (act === 'export') {
      const blob = new Blob([JSON.stringify(clean(db), null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `przebieg-baza-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    if (act === 'status') {
      const last = localStorage.getItem(LS('last_sync'));
      const mm = modal(`<h3>Synchronizacja</h3><p>Konto Google: <b>${token ? '✅ połączone' : '❌ brak połączenia'}</b>${googleHint() ? ' (' + esc(googleHint()) + ')' : ''}<br>Ostatnia synchronizacja: <b>${last ? new Date(Number(last)).toLocaleString('pl') : 'nigdy'}</b><br>Treningi: <b>${acts().length}</b> · pomiary ciała: <b>${db.body.length}</b><br><br>Na Dysku: <b>Przebieg/surowe</b> (oryginały FIT) i <b>Przebieg/baza.json</b> (wszystko inne).</p><div class="actions"><button class="btn-sm">OK</button></div>`);
      mm.querySelector('.btn-sm').onclick = mm.close;
    }
  };
}
function addSheet() {
  const m = modal(`<h3>Dodaj</h3>
    <button class="sheet-opt" data-o="fit"><span class="ic">${icon('fit')}</span><span><b>Trening z zegarka</b><span>Plik .fit albo ZIP (Zepp, Garmin, Coros…)</span></span></button>
    <button class="sheet-opt" data-o="body"><span class="ic">${icon('scale')}</span><span><b>Pomiar ciała</b><span>Waga, tłuszcz, mięśnie, obwód pasa</span></span></button>
    <button class="sheet-opt" data-o="csv"><span class="ic">${icon('file')}</span><span><b>Import pomiarów z wagi</b><span>CSV lub ZIP z eksportu danych Zepp</span></span></button>`, { sheet: true });
  m.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { m.close(); if (b.dataset.o === 'body') bodyForm(); else $('#file-input').click(); });
}

// ══ NAWIGACJA / START ═══════════════════════════════════════════════════════
function buildNav() {
  $('#side-nav').innerHTML = VIEWS.map(v => `<button class="nav-item" data-view="${v.key}">${icon(v.icon)}${v.label}</button>`).join('');
  $('#tabbar').innerHTML = VIEWS.map(v => `<button class="tab" data-view="${v.key}">${icon(v.icon)}${v.label}</button>`).join('');
}
function setView(v) {
  view = v;
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $('#page-title').textContent = VIEWS.find(x => x.key === v).label;
  renderView(); $('#main').scrollTop = 0;
}
function renderView() {
  if (view !== 'progress' && view !== 'body') killCharts();
  if (view === 'home') renderHome(); else if (view === 'plan') renderPlan(); else if (view === 'list') renderList(); else if (view === 'progress') renderProgress(); else renderBody();
}
function renderAll() { renderView(); if (cur && $('#detail').classList.contains('open')) renderReport(); }

buildNav();
document.addEventListener('click', e => {
  const b = e.target.closest('[data-view],[data-act]'); if (!b) return;
  if (b.dataset.view && (b.classList.contains('tab') || b.classList.contains('nav-item'))) setView(b.dataset.view);
  else if (b.dataset.act === 'add') addSheet();
  else if (b.dataset.act === 'settings') settingsForm();
  else if (b.dataset.act === 'drive') { e.stopPropagation(); driveMenu(b); }
});
$('#file-input').onchange = e => { const f = [...e.target.files]; e.target.value = ''; importFiles(f); };
$('#detail-back').onclick = () => history.state?.d ? history.back() : closeDetail();
window.addEventListener('popstate', () => { if (!location.hash.startsWith('#t=')) closeDetail(); else openDetail(location.hash.slice(3)); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#detail').classList.contains('open')) $('#detail-back').click(); });
let dragN = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragN++; $('#drop-hint').style.display = 'flex'; } });
window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop-hint').style.display = 'none'; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('#drop-hint').style.display = 'none'; const f = [...(e.dataTransfer?.files || [])]; if (f.length) importFiles(f); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && token) sync();
  else if (document.visibilityState === 'hidden' && syncT) flushSync();   // wyślij zmiany przed zamknięciem
});

(async function start() {
  const local = await idb.get('kv', 'db');
  if (local?.activities) db = normalizeDb(local);
  setView('home');
  updateSync();
  if (location.hash.startsWith('#t=')) openDetail(location.hash.slice(3));
  if (localStorage.getItem(LS('connected'))) sync();
})();

// hak testowy: wczytanie bazy bez logowania (podgląd lokalny)
window.__przebieg = { setDb: async d => { db = normalizeDb(d); typesDirty = true; await persistLocal(); renderAll(); }, putStreams: (id, s) => idb.put('streams', id, s), open: openDetail, setView };
