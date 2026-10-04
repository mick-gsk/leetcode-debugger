/* Läuft in der Hauptwelt: Vermittler zwischen der Engine (unsichtbare Sandbox-Seite engine.html)
 * und page.js (Monaco, Oberfläche aus ui.js). Holt Aufgabentext, Code und gescheiterte
 * Einsendungen, speichert Entwürfe, fängt die Tastenkürzel ab und beantwortet das Fenster am
 * Käfer-Symbol (über content.js). Liegt in der Hauptwelt statt im Content-Script, damit es sich
 * mit dem Rest selbst aktualisieren kann. */
(() => {
  'use strict';
  if (window.__lcdbgHost) return;
  window.__lcdbgHost = true;

  // Vom Hintergrund vorangestellt (Update aus GitHub); fehlt, wenn der Code aus dem Ordner kommt
  const BOOT = window.__lcdbgBoot || {};
  try { delete window.__lcdbgBoot; } catch (e) { window.__lcdbgBoot = undefined; }
  const de = document.documentElement;
  const EXT = de.dataset.lcdbgExt || '';
  const VERSION = BOOT.version || de.dataset.lcdbgVersion || '?';
  const SOURCE = BOOT.source || 'Ordner';

  const slug = () => (location.pathname.match(/^\/problems\/([^/]+)/) || [])[1] || '';

  let engine = null, engineReady = false, lastSlug = '', V = null;

  const log = (...a) => console.info('[LeetCode-Debugger ' + VERSION + ']', ...a);
  log('aktiv auf', location.pathname, '· Code aus', SOURCE);

  // ------------------------------------------------------------ page.js

  let reqId = 0;
  const pending = new Map();
  function askPage(type, extra) {
    return new Promise((resolve) => {
      const id = 'h' + ++reqId;
      pending.set(id, resolve);
      window.postMessage(Object.assign({ lcdbgPage: 'req', id, type }, extra), location.origin);
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ error: 'timeout' }); } }, 1500);
    });
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (e.source === window && m.lcdbgPage === 'res' && pending.has(m.id)) {
      const r = pending.get(m.id);
      pending.delete(m.id);
      r(m);
      return;
    }
    if (e.source === window && m.lcdbgPage === 'event') return onPageEvent(m);
    if (e.source === window && m.lcdbgHost === 'req') return onShell(m);
    if (engine && e.source === engine.contentWindow && m.lcdbg) onEngine(m);
  });

  const toEngine = (msg) => engine && engine.contentWindow && engine.contentWindow.postMessage(Object.assign({ lcdbg: true }, msg), '*');
  const action = (name, extra) => toEngine(Object.assign({ type: 'action', action: name }, extra));

  // ------------------------------------------------------------ Aufgabentext & Speicher

  function descriptionFromDom() {
    const el = document.querySelector('[data-track-load="description_content"]');
    if (el && /(Input|输入)\s*[:：]/.test(el.innerText)) return el.innerText;
    let best = null;
    for (const d of document.querySelectorAll('div')) {
      const t = d.innerText;
      if (t && t.length < 20000 && /Example\s*1/.test(t) && /Input\s*:/.test(t) && /Output\s*:/.test(t) &&
          (!best || t.length < best.length)) best = t;
    }
    return best;
  }

  async function descriptionFromApi() {
    try {
      const r = await fetch('/graphql/', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'query q($titleSlug: String!) { question(titleSlug: $titleSlug) { content translatedContent } }',
          variables: { titleSlug: slug() },
        }),
      });
      const j = await r.json();
      const q = j && j.data && j.data.question;
      const html = q && (q.content || q.translatedContent);
      if (!html) return null;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const n of doc.body.querySelectorAll('p, pre, li, div, br')) n.insertAdjacentText('afterend', '\n');
      return doc.body.textContent;
    } catch (e) {
      return null;
    }
  }

  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('lcdbg:' + k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lcdbg:' + k, JSON.stringify(v)); } catch (e) { /* egal */ } },
  };

  // ------------------------------------------------------------ Gescheiterte Einsendungen

  // Leerraum zählt nicht: das Ergebnisfeld bricht lange Werte um, die Netz-Antwort nicht
  const signature = (sub) => (sub.vars && sub.vars.length ? sub.vars.map((v) => v.value).join('') : String(sub.input || ''))
    .replace(/\s+/g, '');
  const subs = () => store.get('subs:' + slug(), []);

  // Das Ergebnisfeld nach „Submit“ (Wrong Answer / Runtime Error / Time Limit Exceeded …) als Text
  const STATUS = /^(Wrong Answer|Runtime Error|Time Limit Exceeded|Memory Limit Exceeded|Output Limit Exceeded|解答错误|执行出错|超出时间限制|超出内存限制)$/m;
  function resultPanelText() {
    let best = null;
    for (const d of document.querySelectorAll('div')) {
      if (d.closest('[data-lcdbg-editor], .lcdbg-overlay, #lcdbg-host')) continue;
      const t = d.innerText;
      if (!t || t.length > 30000 || !STATUS.test(t) || !/(^|\n)\s*(Input|Last Executed Input|输入|最后执行的输入)\s*(\n|$)/.test(t)) continue;
      if (!best || t.length < best.length) best = t;
    }
    return best;
  }

  // Ergebnisfeld lesen (falls sichtbar) – das Zerlegen übernimmt die Engine
  async function pullPanel() {
    const text = resultPanelText();
    if (!text) return;
    const parsed = await askEngine('parsePanel', { text });
    if (!parsed || !parsed.result) return;
    const sub = Object.assign({ id: 'dom' + Date.now(), at: Date.now(), input: parsed.result.vars.map((v) => v.value).join('\n') }, parsed.result);
    const list = subs(), sig = signature(sub);
    if (list.some((x) => signature(x) === sig)) return;
    store.set('subs:' + slug(), [sub].concat(list).slice(0, 3));
  }

  function pushSubs() { toEngine({ type: 'subs', list: subs() }); hint(); }

  function hint() {
    const bad = subs().length && !(V && V.open);
    askPage('hint', { text: bad ? '🐞 Fehlschlag debuggen' : null });
  }

  window.addEventListener('lcdbg-submission', (e) => {
    if (!e.detail || e.detail.slug !== slug()) return;
    log('gescheiterte Einsendung übernommen');
    if (!engineReady) return hint();
    pushSubs();
    if (V && V.open) action('check');   // offen: gleich mit dem neuen Fall prüfen
  });

  // ------------------------------------------------------------ Engine

  let eReq = 0;
  const ePending = new Map();
  function askEngine(type, extra) {
    if (!engineReady) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = 'q' + ++eReq;
      ePending.set(id, resolve);
      toEngine(Object.assign({ type, qid: id }, extra));
      setTimeout(() => { if (ePending.has(id)) { ePending.delete(id); resolve(null); } }, 1500);
    });
  }

  // LeetCode wechselt Aufgaben ohne Neuladen; der Aufgabentext im DOM kommt erst danach. Steht dort
  // nach einem Wechsel noch derselbe Text wie bei der vorigen Aufgabe, ist er alt: dann per API holen.
  let domSeen = null, elSeen = null;
  const descEl = () => document.querySelector('[data-track-load="description_content"]');
  async function sendInit() {
    const s = slug(), changed = s !== lastSlug;
    lastSlug = s;
    const dom = descriptionFromDom(), stale = changed && dom && dom === domSeen;
    domSeen = dom;
    elSeen = descEl() ? descEl().innerText : null;
    const [code, examplesText] = await Promise.all([
      askPage('getCode'),
      dom && !stale ? dom : descriptionFromApi(),
    ]);
    toEngine({
      type: 'init', slug: s, examplesText, code: code.code || '', lang: code.lang || null,
      draft: store.get('draft:' + s, null), subs: subs(), prefs: {},
    });
  }

  async function onEngine(m) {
    switch (m.type) {
      case 'hello':   // Sandbox geladen: Engine-Code schicken (Update) oder Paket-Dateien laden lassen
        toEngine({ type: 'boot', files: BOOT.engine || null });
        break;
      case 'ready':
        engineReady = true;
        await sendInit();
        if (startAfterReady) { startAfterReady = false; await check(); }
        break;
      case 'getCode': {
        const r = await askPage('getCode');
        toEngine({ type: 'reply', id: m.id, code: r.code, lang: r.lang, error: r.error });
        break;
      }
      case 'answer':
        if (ePending.has(m.qid)) { const r = ePending.get(m.qid); ePending.delete(m.qid); r(m); }
        break;
      case 'saveDraft': store.set('draft:' + m.slug, m.draft); break;
      case 'view': V = m.view; show(); syncEditor(); hint(); break;
    }
  }

  async function check() {
    await pullPanel();
    pushSubs();
    action('check');
  }

  let startAfterReady = false;
  function start() {
    if (!engine) {
      if (!EXT) { log('Adresse der Extension fehlt (content.js lief nicht) – Seite neu laden'); return; }
      engine = document.createElement('iframe');
      engine.src = EXT + 'engine.html';
      engine.title = 'LeetCode-Debugger (unsichtbar)';
      engine.setAttribute('aria-hidden', 'true');
      engine.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-10px;top:-10px;visibility:hidden';
      de.appendChild(engine);
      startAfterReady = true;
      return;
    }
    if (!engineReady) { startAfterReady = true; return; }
    if (slug() !== lastSlug) sendInit().then(check);
    else check();
  }

  // ------------------------------------------------------------ Oberfläche (zeichnet page.js)

  const show = () => askPage('view', { view: V });

  function onPageEvent(m) {
    if (m.type !== 'action') return;
    if (m.name === 'start') return start();
    if (m.name === 'dropSub') {
      store.set('subs:' + slug(), subs().filter((x) => 's:' + x.id !== m.extra.key));
      return pushSubs();
    }
    action(m.name, m.extra || {});
  }

  // Für das Fenster am Käfer-Symbol (Anfrage kommt über content.js)
  async function status() {
    const u = await askPage('uiStatus');
    return {
      version: VERSION, source: SOURCE, onProblem: !!slug(), editorFound: !!u.editorFound, widget: !!u.widget,
      pillShown: !!u.pillShown, open: !!(V && V.open), covered: u.covered || null, pageScript: !u.error,
      subs: subs().length,
    };
  }

  async function onShell(m) {
    if (m.type === 'start') start();
    const res = await status();
    window.postMessage(Object.assign({ lcdbgHost: 'res', id: m.id }, res), location.origin);
  }

  let ticks = 0;
  setInterval(() => {
    if (engine && !engine.isConnected) { engineReady = false; de.appendChild(engine); }
    if (slug() && engineReady && slug() !== lastSlug) sendInit();
    // Aufgabentext hat sich geändert (neue Aufgabe fertig gerendert): neu schicken – die Engine liest
    // die Beispiele nur neu ein, wenn sie anders sind
    else if (engineReady && ++ticks % 4 === 0) {
      const el = descEl();
      if (el && elSeen != null && el.innerText !== elSeen && /(Input|输入)\s*[:：]/.test(el.innerText)) sendInit();
    }
  }, 250);
  setTimeout(hint, 1500);

  function syncEditor() {
    const e = V && V.open && V.editor ? V.editor : { line: null };
    askPage('debugState', {
      line: e.line, text: e.text || '', error: !!e.error, vars: e.vars || [], active: !!(V && V.open),
      inline: e.inline || [], exception: e.exception || null,
    });
  }

  // ------------------------------------------------------------ Tastenkürzel (auch im Editor)

  // Wie in VS Code – nur solange der Debugger offen ist (F5 lädt sonst wie gewohnt neu)
  window.addEventListener('keydown', (e) => {
    if (!slug() || !V || !V.open || e.altKey || e.metaKey) return;
    const k = e.key, sh = e.shiftKey, ct = e.ctrlKey;
    let run = null;
    if (k === 'F10' && !sh && !ct) run = () => action('nav', { kind: 'over' });
    else if (k === 'F11' && !sh && !ct) run = () => action('nav', { kind: 'next' });
    else if (k === 'F11' && sh && !ct) run = () => action('nav', { kind: 'out' });
    else if (k === 'F5' && !sh && !ct) run = async () => action('continue', { lines: (await askPage('breakpoints')).lines || [] });
    else if (k === 'F5' && sh && !ct) run = () => action('close');
    else if (k === 'F5' && sh && ct) run = () => start();
    else if (k === 'F9' && !sh && !ct) run = () => askPage('toggleBpAtCursor');
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }, true);

  window.addEventListener('keydown', (e) => {
    if (!slug() || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
    const nav = { ArrowRight: 'next', ArrowLeft: 'prev', ArrowDown: 'over', ArrowUp: 'out' }[e.key];
    if (e.code === 'KeyD') { e.preventDefault(); e.stopPropagation(); start(); }
    else if (nav && V && V.open && V.step) { e.preventDefault(); e.stopPropagation(); action('nav', { kind: nav }); }
  }, true);
})();
