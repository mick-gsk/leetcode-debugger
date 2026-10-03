/* Hintergrund (Rahmen): hält den Debugger aktuell, ohne dass ein neues Paket geladen werden muss.
 *
 * Der Debugger-Code (net.js, ui.js, page.js, host.js in der Seite; acorn, tracer.js, engine.js in
 * der Sandbox) wird nicht fest angemeldet, sondern von hier aus:
 *  - Normalfall: aus dem geladenen Ordner, bei JEDEM Seitenaufruf frisch eingespielt
 *    (scripting.executeScript liest die Datei jedes Mal von der Platte; fest angemeldete
 *    Content-Scripts dagegen bleiben bis zum „Aktualisieren“ in chrome://extensions auf dem alten
 *    Stand). Ändert sich eine Datei im Ordner, reicht also F5 auf LeetCode.
 *  - Mit „Nutzerskripts zulassen“ und Token zusätzlich aus GitHub, aber nur, wenn dort ein NEUERER
 *    Stand liegt als im Ordner (Version in manifest.json). Geprüft wird beim Laden einer
 *    LeetCode-Seite (höchstens alle 20 s), beim „Aktualisieren“ und auf Knopfdruck im Fenster.
 * update.json nennt Dateien und Reihenfolge; steigt dort "shell" über SHELL, braucht es einmal ein
 * neues Paket (z. B. neue Berechtigung) – dann bleibt der alte Stand aktiv und das Fenster sagt es. */
'use strict';

const SHELL = 2;
const MATCHES = ['https://leetcode.com/*', 'https://leetcode.cn/*'];
// Öffentliches Repo: Updates ohne Token. dir = Unterordner im Repo, leer = Wurzel
const DEFAULTS = { repo: 'mick-gsk/leetcode-debugger', branch: 'main', dir: '', token: '', api: 'https://api.github.com' };
const MIN_GAP = 20 * 1000;
const IDS = ['lcdbg-early', 'lcdbg-main'];

const local = chrome.runtime.getManifest().version;
const get = async (k) => (await chrome.storage.local.get(k))[k];
const set = (o) => chrome.storage.local.set(o);

function newer(a, b) {   // ist Version a neuer als b?
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function cfg() { return Object.assign({}, DEFAULTS, (await get('cfg')) || {}); }
const srcKey = (c) => [c.api, c.repo, c.branch, c.dir].join('|');

function userScriptsOn() {
  try { chrome.userScripts.getScripts(); return true; } catch (e) { return false; }
}

// jedes Mal frisch lesen: kommt im Ordner eine Datei dazu, gilt das ab dem nächsten Seitenaufruf
async function plan() {
  return (await fetch(chrome.runtime.getURL('update.json'), { cache: 'no-store' })).json();
}

// Welcher Stand soll laufen? GitHub-Stand nur, wenn passend, vollständig und nicht älter als das Paket
async function chosen() {
  const b = await get('bundle'), c = await cfg();
  if (b && b.files && b.src === srcKey(c) && (b.shell || 1) <= SHELL && newer(b.version, local)) return b;
  return null;
}

// ------------------------------------------------------------ Anmelden

let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

const ensure = () => serial(async () => {
  const us = userScriptsOn(), b = us ? await chosen() : null;
  const key = b ? 'us:' + b.sha : 'ordner:' + local;
  const reg = await get('reg');
  const have = us ? await chrome.userScripts.getScripts({ ids: IDS }) : [];
  if (reg && reg.key === key && have.length === (b ? IDS.length : 0)) return reg;

  // erst alles abmelden (auch fest angemeldete Skripte älterer Versionen), sonst liefe der Debugger doppelt
  if (us) { const old = await chrome.userScripts.getScripts(); if (old.length) await chrome.userScripts.unregister({ ids: old.map((s) => s.id) }); }
  const oldCs = await chrome.scripting.getRegisteredContentScripts();
  if (oldCs.length) await chrome.scripting.unregisterContentScripts({ ids: oldCs.map((s) => s.id) });

  if (b) {
    const src = (f) => ({ code: b.files[f] + '\n//# sourceURL=lcdbg/' + f });
    const boot = {
      version: b.version,
      source: `GitHub ${b.repo}@${b.branch} (${b.sha.slice(0, 7)})`,
      engine: b.engine.map((f) => ({ name: f, code: b.files[f] })),
    };
    await chrome.userScripts.register([
      { id: IDS[0], matches: MATCHES, runAt: 'document_start', world: 'MAIN', js: b.early.map(src) },
      { id: IDS[1], matches: MATCHES, runAt: 'document_idle', world: 'MAIN', js: [{ code: 'window.__lcdbgBoot = ' + JSON.stringify(boot) + ';' }].concat(b.main.map(src)) },
    ]);
  }
  const now = { key, mode: b ? 'github' : 'ordner', version: b ? b.version : local, sha: b ? b.sha : null, at: Date.now() };
  await set({ reg: now });
  return now;
});

// Ordner-Stand in einen frisch geladenen Tab einspielen: früh net.js, ab document_idle der Rest
async function inject(tabId, frameId) {
  const p = await plan(), target = { tabId, frameIds: [frameId] };
  await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, files: p.early });
  await chrome.scripting.executeScript({ target, world: 'MAIN', files: p.main });
}

// ------------------------------------------------------------ Update aus GitHub

function httpError(r, c) {
  if (r.status === 401) return new Error('Token ungültig oder abgelaufen (401). Neues Token eintragen.');
  if (r.status === 404) return new Error(c.token
    ? `Nicht gefunden (404): Repo „${c.repo}“, Zweig „${c.branch}“ oder Ordner „${c.dir}“ stimmt nicht – oder das Token darf dieses Repo nicht lesen.`
    : `Nicht gefunden (404): Repo „${c.repo}“ oder Zweig „${c.branch}“ stimmt nicht. Ist das Repo privat, Token eintragen (Einstellungen unten).`);
  if (r.status === 403 || r.status === 429) return new Error(`GitHub hat abgelehnt (${r.status}), meist das Anfrage-Limit. In einer Stunde geht es wieder${c.token ? '' : ', mit Token sofort'}.`);
  return new Error(`GitHub antwortet mit ${r.status}.`);
}

let running = null;
function check(force) {
  if (!running) running = doCheck(force).finally(() => { running = null; });
  return running;
}

async function doCheck(force) {
  const c = await cfg(), st = (await get('upd')) || {}, key = srcKey(c);
  // gedrosselt nur nach echten Abrufen; war er übersprungen (Schalter fehlte), gleich neu prüfen
  if (!force && !st.skipped && st.src === key && st.at && Date.now() - st.at < MIN_GAP) return st;
  // updatedAt bleibt über spätere Prüfungen erhalten: das Fenster sagt dann weiter „neu laden“
  const save = async (o) => {
    const v = Object.assign({ src: key, at: Date.now(), updatedAt: st.src === key ? st.updatedAt : null, version: st.version }, o);
    await set({ upd: v });
    return v;
  };
  if (!userScriptsOn()) return save({ error: null, skipped: 'userScripts' });

  const [owner, repo] = c.repo.split('/').map((x) => x.trim());
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (c.token.trim()) h.Authorization = 'Bearer ' + c.token.trim();
  const enc = encodeURIComponent, path = (p) => p.split('/').map(enc).join('/');
  const base = `${c.api.replace(/\/+$/, '')}/repos/${enc(owner)}/${enc(repo)}`;
  const before = await chosen();

  try {
    // 1) Letzter Commit, der den Ordner geändert hat (bedingte Anfrage: 304 kostet kein Limit)
    const hh = Object.assign({}, h);
    if (st.etag && st.src === key && before) hh['If-None-Match'] = st.etag;
    const r = await fetch(`${base}/commits?sha=${enc(c.branch)}${c.dir ? '&path=' + path(c.dir) : ''}&per_page=1`, { headers: hh, cache: 'no-store' });
    if (r.status === 304) return save({ etag: st.etag, sha: st.sha, error: null, changed: false });
    if (!r.ok) throw httpError(r, c);
    const list = await r.json();
    if (!Array.isArray(list) || !list.length) throw new Error(c.dir ? `Im Zweig „${c.branch}“ gibt es keinen Ordner „${c.dir}“.` : `Zweig „${c.branch}“ ist leer.`);
    const sha = list[0].sha, etag = r.headers.get('etag');
    if (before && before.sha === sha) return save({ etag, sha, error: null, changed: false });

    // 2) Dateien genau dieses Stands holen
    const raw = async (f) => {
      const x = await fetch(`${base}/contents/${path(c.dir ? c.dir + '/' + f : f)}?ref=${sha}`,
        { headers: Object.assign({}, h, { Accept: 'application/vnd.github.raw+json' }), cache: 'no-store' });
      if (!x.ok) throw x.status === 404 ? new Error(`Datei ${f} fehlt im Stand ${sha.slice(0, 7)}.`) : httpError(x, c);
      return x.text();
    };
    const p = JSON.parse(await raw('update.json'));
    const version = JSON.parse(await raw('manifest.json')).version;
    if ((p.shell || 1) > SHELL) return save({ etag: null, sha, error: null, changed: false, needsPackage: version });
    if (newer(local, version)) return save({ etag, sha, error: null, changed: false, olderThanPackage: version });
    const files = {};
    await Promise.all([...p.early, ...p.main, ...p.engine].map(async (f) => { files[f] = await raw(f); }));
    await set({ bundle: {
      sha, version, src: key, repo: c.repo, branch: c.branch, shell: p.shell || 1,
      early: p.early, main: p.main, engine: p.engine, files, at: Date.now(),
    } });
    await ensure();
    notifyTabs(before ? before.version : local, version);
    return save({ etag, sha, error: null, changed: true, updatedAt: Date.now(), version });
  } catch (e) {
    const msg = e instanceof TypeError ? 'Keine Verbindung zu GitHub.' : e.message;
    return save({ etag: st.etag, sha: st.sha, error: msg });
  }
}

async function notifyTabs(from, to) {
  try {
    for (const t of await chrome.tabs.query({ url: MATCHES })) chrome.tabs.sendMessage(t.id, { lcdbg: 'updated', from, to }).catch(() => {});
  } catch (e) { /* egal */ }
}

// ------------------------------------------------------------ Zustand fürs Fenster am Käfer-Symbol

async function state() {
  const c = await cfg(), b = await chosen();
  return {
    local, shell: SHELL, userScripts: userScriptsOn(), reg: await get('reg'), upd: (await get('upd')) || null,
    running: b ? { version: b.version, sha: b.sha, branch: b.branch, repo: b.repo, at: b.at } : { version: local, sha: null },
    cfg: { repo: c.repo, branch: c.branch, dir: c.dir, hasToken: !!c.token.trim(), custom: c.api !== DEFAULTS.api ? c.api : null },
    id: chrome.runtime.id,
  };
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || typeof m !== 'object') return;
  if (m.lcdbg === 'pageLoad') {
    const tab = sender.tab;
    ensure()
      .then((r) => r.mode === 'ordner' && tab && inject(tab.id, sender.frameId || 0))
      .catch((e) => console.warn('[LeetCode-Debugger] Einspielen gescheitert:', e))
      .then(() => check(false)).catch(() => {});
    return;
  }
  if (m.lcdbg !== 'bg') return;
  (async () => {
    if (m.op === 'check') { await ensure(); await check(true); }
    else if (m.op === 'saveCfg') {
      const old = await cfg(), n = Object.assign({}, old);
      for (const k of ['repo', 'branch', 'dir', 'api']) if (typeof m.cfg[k] === 'string' && (k === 'dir' || m.cfg[k].trim())) n[k] = m.cfg[k].trim();
      if (m.cfg.clearToken) n.token = '';
      else if (typeof m.cfg.token === 'string' && m.cfg.token.trim()) n.token = m.cfg.token.trim();
      await set({ cfg: n, upd: null });
      await ensure();
      await check(true);
    } else if (m.op === 'openDetails') {
      await chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
    } else await ensure();
    return state();
  })().then(reply, (e) => reply({ error: String(e && e.message || e) }));
  return true;
});

// Beim Laden/„Aktualisieren“ in chrome://extensions und beim Browserstart
chrome.runtime.onInstalled.addListener(() => { ensure().then(() => check(true)).catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { ensure().then(() => check(false)).catch(() => {}); });
ensure().catch(() => {});
