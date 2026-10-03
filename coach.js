/* Lern-Coach im LeetCode-Editor (Hauptwelt): Syntax-Ghost-Text, API-Karten, Hinweis-Leiter und
 * Review nach „Accepted“. Logik in coach-core.js/coach-api.js; OpenRouter über content.js und den
 * Hintergrund (der Schlüssel bleibt dort). Design: docs/2026-10-03-lerncoach-design.md */
(() => {
  'use strict';
  if (window.__lcdbgCoach) return;
  window.__lcdbgCoach = true;

  const C = window.LCDBG_COACH_CORE, A = window.LCDBG_COACH_API;
  if (!C || !A) { console.warn('[Lern-Coach] coach-core.js/coach-api.js fehlen'); return; }
  const K = C.CONST;
  const log = (...a) => console.info('[Lern-Coach]', ...a);
  const slug = () => (window.LCDBG_HOST ? window.LCDBG_HOST.slug() : (location.pathname.match(/^\/problems\/([^/]+)/) || [])[1] || '');

  // ------------------------------------------------------------ Brücke zum Hintergrund (über content.js)

  let reqId = 0;
  function coachBridge(op, payload, timeoutMs = 30000) {
    return new Promise((resolve) => {
      const id = 'k' + ++reqId + '-' + Date.now();
      const done = (r) => { window.removeEventListener('message', on); clearTimeout(timer); resolve(r); };
      const on = (e) => {
        if (e.source !== window || !e.data || e.data.lcdbgCoach !== 'res' || e.data.id !== id) return;
        done(e.data);
      };
      const timer = setTimeout(() => done({ error: 'timeout' }), timeoutMs);
      window.addEventListener('message', on);
      window.postMessage(Object.assign({ lcdbgCoach: 'req', id, op }, payload), location.origin);
    });
  }

  // Log gebündelt: höchstens alle 500 ms eine Nachricht an den Hintergrund
  let logQueue = [], logTimer = null;
  function logEv(ev, extra) {
    logQueue.push(Object.assign({ t: Date.now(), slug: slug(), ev }, extra));
    if (!logTimer) logTimer = setTimeout(() => { const rows = logQueue; logQueue = []; logTimer = null; coachBridge('log', { rows }); }, 500);
  }

  // ------------------------------------------------------------ Zustand pro Aufgabe (localStorage der Seite)

  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('lcdbg:coach:' + k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lcdbg:coach:' + k, JSON.stringify(v)); } catch (e) { /* egal */ } },
  };
  const ladder = () => Object.assign(C.ladderInit(), store.get(slug(), {}));
  const saveLadder = (s) => store.set(slug(), s);

  let cfg = { hasKey: false, nativeSuggest: false };
  async function refreshCfg() {
    const r = await coachBridge('cfg', {}, 5000);
    if (r && !r.error) cfg = { hasKey: !!r.hasKey, nativeSuggest: !!r.nativeSuggest };
  }

  // ------------------------------------------------------------ Editor finden (wie page.js)

  const M = () => window.monaco;
  const langOf = (model) => {
    try { return model.getLanguageId ? model.getLanguageId() : model.getModeId ? model.getModeId() : null; } catch (e) { return null; }
  };
  const isJs = (model) => !!model && /^(javascript|typescript)$/i.test(langOf(model) || '');

  function findEditor() {
    const m = M() && M().editor;
    if (!m || !m.getEditors) return null;
    const score = (e) => {
      const model = e.getModel && e.getModel();
      if (!model) return -1;
      const node = e.getDomNode && e.getDomNode();
      return (isJs(model) ? 1000 : 0) + (node && node.offsetParent !== null ? 500 : 0) + model.getLineCount();
    };
    const list = m.getEditors().filter((e) => score(e) >= 0).sort((a, b) => score(b) - score(a));
    return list[0] || null;
  }

  let ed = null;
  const active = () => !!ed && isJs(ed.getModel());

  // ------------------------------------------------------------ LeetCode-Vorschläge vor Accepted aus

  let savedSuggest = null;
  function syncSuggest() {
    if (!ed) return;
    const off = active() && !cfg.nativeSuggest && !ladder().accepted;
    try {
      if (off && !savedSuggest) {
        const raw = (ed.getRawOptions && ed.getRawOptions()) || {};
        savedSuggest = {
          quickSuggestions: raw.quickSuggestions === undefined ? true : raw.quickSuggestions,
          suggestOnTriggerCharacters: raw.suggestOnTriggerCharacters === undefined ? true : raw.suggestOnTriggerCharacters,
        };
        ed.updateOptions({ quickSuggestions: false, suggestOnTriggerCharacters: false });
      } else if (!off && savedSuggest) {
        ed.updateOptions(savedSuggest);
        savedSuggest = null;
      }
    } catch (e) { /* ältere Monaco-Versionen: dann eben nicht */ }
  }

  // ------------------------------------------------------------ Ghost-Text

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let explicitAt = 0;   // Alt+Shift+Leertaste: nächste Anfrage ohne Pause

  // Kontext am Cursor; fragt an und gibt einen bewachten Vorschlag zurück (oder null)
  async function ghostFor(model, pos, stillValid) {
    const R = M().Range;
    const before = model.getValueInRange(new R(1, 1, pos.lineNumber, pos.column));
    const L = model.getLineCount();
    const after = model.getValueInRange(new R(pos.lineNumber, pos.column, L, model.getLineMaxColumn(L)));
    const word = model.getWordUntilPosition(pos);
    const r = await coachBridge('llm', { kind: 'ghost', messages: C.ghostMessages({ before, after }), max_tokens: 60 });
    if (!stillValid()) return null;
    if (!r || r.error || !r.text) return null;
    const text = C.parseGhost(r.text, after);
    if (!text) return null;
    const g = C.guardGhost(text, before, (word && word.word) || '');
    if (!g.ok) { logEv('ghostRejected', { reason: g.reason }); return null; }
    return text;
  }

  let acceptCmd = null;
  const inlineProvider = {
    async provideInlineCompletions(model, pos, context, token) {
      const none = { items: [] };
      if (!ed || model !== ed.getModel() || !active() || !cfg.hasKey) return none;
      const explicit = (context && context.triggerKind === 1) || Date.now() - explicitAt < 1000;
      const version = model.getAlternativeVersionId();
      if (!explicit) {
        await sleep(K.PAUSE_MS);
        if (token.isCancellationRequested || model.getAlternativeVersionId() !== version) return none;
      }
      const text = await ghostFor(model, pos, () => !token.isCancellationRequested && model.getAlternativeVersionId() === version);
      if (!text) return none;
      return { items: [{
        insertText: text, text,
        range: new (M().Range)(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        command: acceptCmd ? { id: acceptCmd, title: 'Ghost-Text übernommen' } : undefined,
      }] };
    },
    handleItemDidShow() { logEv('ghostShown', { mode: 'inline' }); },
    freeInlineCompletions() {},
    disposeInlineCompletions() {},
  };

  // Rückfall ohne Inline-API: graue Dekoration an der Cursorstelle, Tab übernimmt
  const ghostCss = document.createElement('style');
  ghostCss.id = 'lcdbg-ghost-css';
  (document.head || document.documentElement).appendChild(ghostCss);
  const cssString = (t) => '"' + String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  let fb = { decos: [], text: null, pos: null, version: null, timer: null };

  function fbClear() {
    clearTimeout(fb.timer);
    if (ed && fb.decos.length) try { fb.decos = ed.deltaDecorations(fb.decos, []); } catch (e) { fb.decos = []; }
    fb.text = null;
    ghostCss.textContent = '';
  }
  function fbShow(text, pos, version) {
    const R = M().Range;
    fb.text = text; fb.pos = pos; fb.version = version;
    ghostCss.textContent = `.lcdbg-ghost::after { content: ${cssString(text)}; color: rgba(160,160,160,.75); font-style: italic; white-space: pre; }`;
    fb.decos = ed.deltaDecorations(fb.decos, [{ range: new R(pos.lineNumber, pos.column, pos.lineNumber, pos.column), options: { afterContentClassName: 'lcdbg-ghost' } }]);
    logEv('ghostShown', { mode: 'fallback' });
  }
  function fbSchedule(explicit) {
    fbClear();
    if (!active() || !cfg.hasKey) return;
    const model = ed.getModel(), version = model.getAlternativeVersionId();
    fb.timer = setTimeout(async () => {
      const pos = ed.getPosition();
      // gültig nur, solange weder Text noch Cursor sich bewegt haben
      const valid = () => ed && ed.getModel() === model && model.getAlternativeVersionId() === version &&
        samePos(ed.getPosition(), pos);
      const text = await ghostFor(model, pos, valid);
      if (text && valid()) fbShow(text, pos, version);
    }, explicit ? 0 : K.PAUSE_MS);
  }
  const samePos = (a, b) => !!a && !!b && a.lineNumber === b.lineNumber && a.column === b.column;

  function fbAccept() {
    const R = M().Range, p = fb.pos, text = fb.text;
    fbClear();
    ed.executeEdits('lcdbg-coach', [{ range: new R(p.lineNumber, p.column, p.lineNumber, p.column), text, forceMoveMarkers: true }]);
    logEv('ghostAccepted', { mode: 'fallback' });
  }

  const hasInline = () => !!(M() && M().languages && typeof M().languages.registerInlineCompletionsProvider === 'function');

  // ------------------------------------------------------------ API-Karten

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mutText = (m) => (m === true ? 'ja' : m === false ? 'nein' : '–');
  const cardCss = document.createElement('style');
  cardCss.textContent = `
    .lcdbg-card { background: #252526; color: #ccc; border: 1px solid #454545; border-radius: 6px; padding: 6px 8px; width: min(440px, 60vw); box-sizing: border-box; white-space: normal;
      font: 12px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.4); z-index: 60; pointer-events: none; }
    .lcdbg-card-item + .lcdbg-card-item { border-top: 1px solid #3a3a3a; margin-top: 4px; padding-top: 4px; }
    .lcdbg-card code { font: 12px Menlo, Consolas, monospace; color: #dcdcaa; white-space: pre-wrap; }
    .lcdbg-card .m { color: #9d9d9d; }
    .lcdbg-card .f { color: #f0b46c; }
    .lcdbg-card .k { color: #9d9d9d; font-size: 11px; }`;
  (document.head || document.documentElement).appendChild(cardCss);

  const cardHtml = (list) => list.map((e) => `<div class="lcdbg-card-item"><code>${esc(e.sig)}</code>` +
    `<div class="m">→ ${esc(e.returns)} · verändert Original: ${mutText(e.mutates)}</div>` +
    `<div class="f">⚠ ${esc(e.pitfall)}</div></div>`).join('') + '<div class="k">Namen selbst tippen · Esc schließt</div>';

  let card = null, cardPos = null, cardOn = false;
  function cardWidget() {
    if (card) return card;
    const node = document.createElement('div');
    node.className = 'lcdbg-card';
    node.style.display = 'none';
    card = {
      getId: () => 'lcdbg.coach.card',
      allowEditorOverflow: true,
      getDomNode: () => node,
      // 1 = ABOVE, 2 = BELOW (ContentWidgetPositionPreference)
      getPosition: () => (cardOn && cardPos ? { position: cardPos, preference: [2, 1] } : null),
    };
    return card;
  }
  function cardHide() {
    if (!card || !cardOn) return;
    cardOn = false;
    card.getDomNode().style.display = 'none';
    try { ed.layoutContentWidget(card); } catch (e) { /* egal */ }
  }
  function cardUpdate() {
    if (!ed || !active()) return cardHide();
    const pos = ed.getPosition(), model = ed.getModel();
    if (!pos) return cardHide();
    const line = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
    const m = line.match(/\.([A-Za-z]+)$/);
    const list = m ? A.lookup(m[1], 4) : [];
    if (!list.length) return cardHide();
    const w = cardWidget();
    w.getDomNode().innerHTML = cardHtml(list);
    w.getDomNode().style.display = '';
    cardPos = { lineNumber: pos.lineNumber, column: pos.column };
    cardOn = true;
    try { ed.layoutContentWidget(w); } catch (e) { /* egal */ }
  }

  const hoverProvider = {
    provideHover(model, position) {
      if (!ed || model !== ed.getModel() || !active()) return null;
      const w = model.getWordAtPosition(position);
      if (!w) return null;
      const list = A.byName(w.word);
      if (!list.length) return null;
      return {
        range: new (M().Range)(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn),
        contents: list.slice(0, 2).map((e) => ({ value: '`' + e.sig + '`  \n→ ' + e.returns + ' · verändert Original: ' + mutText(e.mutates) + '  \n⚠ ' + e.pitfall })),
      };
    },
  };

  // ------------------------------------------------------------ Hinweis-Panel (Leiter)

  const NAMES = { 1: 'Leitfrage', 2: 'Konzept', 3: 'Pseudocode', 4: 'Nächste Zeile' };
  const isDark = () => document.documentElement.classList.contains('dark') ||
    document.documentElement.getAttribute('data-theme') === 'dark' || (document.body && document.body.classList.contains('dark'));
  const PANEL_CSS = `
    :host { all: initial; }
    .wrap { font: 13px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; color: #ccc; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .light { color: #333; }
    button { font: inherit; border: 0; border-radius: 5px; cursor: pointer; padding: 4px 10px; background: #3a3d41; color: #eee; }
    .light button { background: #e4e4e4; color: #222; }
    button:disabled { opacity: .45; cursor: default; }
    button.pri { background: #0e639c; color: #fff; }
    .toggle { background: #252526; border: 1px solid #454545; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
    .light .toggle { background: #f3f3f3; border-color: #c8c8c8; }
    .cpanel { width: min(420px, var(--maxw, 420px)); max-height: var(--maxh, 380px); overflow: auto; background: #252526; border: 1px solid #454545;
      border-radius: 6px; padding: 8px 10px; box-shadow: 0 4px 14px rgba(0,0,0,.4); display: flex; flex-direction: column; gap: 6px; }
    .light .cpanel { background: #f8f8f8; border-color: #c8c8c8; }
    .head { display: flex; align-items: center; gap: 8px; }
    .lvl { font-weight: 600; flex: 1; }
    .x { background: none; padding: 2px 6px; }
    .htext { white-space: pre-wrap; }
    .htext:empty, .verdict:empty, .reveal:empty, .fb:empty, .cstatus:empty, .sefb:empty, .rtext:empty { display: none; }
    .lad, .acc, .selfbox, .revbox { display: flex; flex-direction: column; gap: 6px; }
    .sefb { color: #89d185; white-space: pre-wrap; }
    .light .sefb { color: #2d6a1f; }
    .rtext { white-space: pre-wrap; }
    .rtext pre { font: 12px Menlo, Consolas, monospace; background: rgba(127,127,127,.15); border-radius: 4px; padding: 6px; margin: 4px 0; white-space: pre-wrap; }
    .verdict { font-weight: 600; }
    .reveal { font: 12px Menlo, Consolas, monospace; background: rgba(127,127,127,.15); border-radius: 4px; padding: 4px 6px; white-space: pre-wrap;
      user-select: none; -webkit-user-select: none; }
    .fb { color: #f0b46c; }
    .light .fb { color: #9a5b00; }
    .cstatus { color: #f48771; }
    .light .cstatus { color: #b42318; }
    .row { display: flex; gap: 6px; align-items: flex-start; }
    textarea { flex: 1; font: inherit; min-height: 34px; resize: vertical; background: #1e1e1e; color: inherit; border: 1px solid #454545; border-radius: 4px; padding: 3px 6px; }
    .light textarea { background: #fff; border-color: #c8c8c8; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    [hidden] { display: none !important; }`;

  let panel = null, panelUi = null, panelOpen = false, busyNow = false, fbText = '', statusText = '', lastRun = null, reviewHtml = '';

  function makePanel() {
    const host = document.createElement('div');
    host.className = 'lcdbg-coach';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${PANEL_CSS}</style><div class="wrap">
      <div class="cpanel" hidden>
        <div class="head"><span class="lvl"></span><button class="x" data-c="close" title="Schließen">✕</button></div>
        <div class="lad">
          <div class="htext"></div>
          <div class="verdict"></div>
          <div class="reveal" title="Zum Selbsttippen – nicht kopierbar"></div>
          <div class="fb"></div>
        </div>
        <div class="acc" hidden>
          <div class="selfbox">
            <div>Gelöst! Ein Satz: Warum ist deine Lösung korrekt, und welche Laufzeit hat sie?</div>
            <div class="row"><textarea id="selfexpl" placeholder="Weil … · Laufzeit O(…)"></textarea></div>
            <div class="actions"><button class="pri" data-c="selfexpl">Prüfen lassen</button><button data-c="skipexpl">Überspringen</button></div>
          </div>
          <div class="sefb"></div>
          <div class="revbox">
            <div class="actions"><button data-c="review" data-k="alt">Andere Lösung</button><button data-c="review" data-k="complexity">Komplexität</button>
              <button data-c="review" data-k="idiom">Was ist unidiomatisch?</button></div>
            <div class="row"><textarea id="ask" placeholder="Eigene Frage zur Lösung"></textarea><button data-c="ask">Fragen</button></div>
            <div class="rtext"></div>
          </div>
        </div>
        <div class="cstatus"></div>
        <div class="lad">
          <div class="row"><textarea id="plan" placeholder="Mein Plan: … (zählt als Versuch)"></textarea><button data-c="plan">Plan zählt</button></div>
          <div class="row l4" hidden><textarea id="intent" placeholder="Was soll die nächste Zeile tun?"></textarea><button class="pri" data-c="reveal">Zeile zeigen</button></div>
          <div class="actions"><button class="pri" data-c="next">Nächste Stufe</button><button data-c="escape">Ich komme nicht weiter</button></div>
        </div>
      </div>
      <button class="toggle" data-c="toggle" title="Hinweis auf Abruf (Alt+Shift+H)">💡 Hinweis</button>
    </div>`;
    // Eingaben im Panel nicht an LeetCode/Monaco weiterreichen
    for (const t of ['keydown', 'keyup', 'keypress', 'wheel', 'mousedown', 'pointerdown', 'mouseup'])
      host.addEventListener(t, (e) => e.stopPropagation());
    const $ = (x) => root.querySelector(x);
    const reveal = $('.reveal');
    for (const t of ['copy', 'cut', 'contextmenu', 'dragstart']) reveal.addEventListener(t, (e) => e.preventDefault());
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b || b.disabled) return;
      const c = b.dataset.c;
      if (c === 'toggle' || c === 'close') togglePanel();
      else if (c === 'plan') submitPlan($('#plan').value);
      else if (c === 'next') openLevel({ escape: false });
      else if (c === 'escape') openLevel({ escape: true });
      else if (c === 'reveal') openLevel({ escape: false, reveal: true });
      else if (c === 'selfexpl') selfExplain($('#selfexpl').value);
      else if (c === 'skipexpl') skipExplain();
      else if (c === 'review') review(b.dataset.k);
      else if (c === 'ask') review('ask', $('#ask').value);
    });
    panelUi = { host, root, $ };
    return host;
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    if (panelOpen) logEv('open');
    render();
  }

  function render() {
    if (!panelUi) return;
    const { $, root } = panelUi;
    const S = ladder();
    root.querySelector('.wrap').classList.toggle('light', !isDark());
    $('.cpanel').hidden = !panelOpen;
    $('.lvl').textContent = S.accepted ? 'Gelöst ✓' + (S.assisted ? ' · mit Hilfe (kommt wieder)' : ' · ohne Hilfe')
      : `Stufe ${S.level} von 4` + (S.level ? ' · ' + NAMES[S.level] : '');
    for (const el of root.querySelectorAll('.lad')) el.hidden = !!S.accepted;
    $('.acc').hidden = !S.accepted;
    $('.selfbox').hidden = !S.accepted || !!S.explained;
    $('.revbox').hidden = !S.accepted || !S.explained;
    $('.sefb').textContent = S.selfFb || '';
    $('.rtext').innerHTML = reviewHtml;
    const last = S.last || null;
    $('.htext').textContent = last && last.level < 4 ? last.text : last && last.level === 4 ? last.feedback : '';
    $('.verdict').textContent = last && last.level === 4 ? 'Deine Absicht: ' + last.verdict : '';
    $('.reveal').textContent = last && last.level === 4 ? last.line : '';
    $('.fb').textContent = fbText;
    $('.cstatus').textContent = statusText;
    const l4 = S.level >= 3, can = C.ladderCanOpen(S);
    $('.l4').hidden = !l4;
    $('[data-c="next"]').hidden = l4;
    for (const b of ['next', 'reveal']) {
      const el = $(`[data-c="${b}"]`);
      el.disabled = busyNow || !can;
      el.title = can ? (b === 'next' ? 'Nächste Hinweisstufe' : 'Absicht bewerten lassen, dann die Zeile sehen')
        : 'Erst ein eigener Versuch (🐞, Run oder Plan)';
    }
    $('[data-c="escape"]').disabled = busyNow;
    $('[data-c="plan"]').disabled = busyNow;
    $('[data-c="toggle"]').textContent = S.accepted ? '🎓 Review' : '💡 Hinweis' + (S.level ? ` (${S.level}/4)` : '');
    for (const b of root.querySelectorAll('.acc button')) b.disabled = busyNow;
  }

  function attempt(src, hash) {
    const r = C.ladderAttempt(ladder(), { src, hash });
    if (!r.counted) return false;
    saveLadder(r.state);
    logEv('attempt', { src, codeHash: hash });
    render();
    return true;
  }

  function submitPlan(text) {
    if (ladder().level > 0) { fbText = 'Ab Stufe 2 zählt nur ein Lauf mit geändertem Code (🐞, Run oder Submit).'; return render(); }
    if (!C.planOk(text)) { fbText = `Ein Plan braucht mindestens ${K.PLAN_MIN_WORDS} Wörter.`; return render(); }
    fbText = '';
    attempt('plan', 'plan:' + C.codeHash(text));
    panelUi.$('#plan').value = '';
    render();
  }

  const ERR = {
    nokey: 'Schlüssel im Käfer-Fenster eintragen (OpenRouter).',
    reload: 'Extension wurde neu geladen – Seite neu laden (F5).',
  };
  function errText(r) {
    if (ERR[r.error]) return ERR[r.error];
    if (r.error === 'limit') return `Limit erreicht – wieder in ${Math.max(1, Math.ceil((r.retryInMs || 60000) / 60000))} min.`;
    return `Keine Antwort (${r.error}${r.status ? ' ' + r.status : ''}) – nochmal versuchen.`;
  }

  const codeNow = () => { try { return ed ? ed.getValue() : ''; } catch (e) { return ''; } };
  const guardFor = (level) => (level === 3 ? C.guardPseudo : level < 3 ? C.guardProse : () => ({ ok: true }));

  async function openLevel(o) {
    if (busyNow) return;
    const S = ladder(), now = Date.now();
    const intentText = panelUi.$('#intent').value.trim();
    if (o.reveal && C.wordCount(intentText) < K.INTENT_MIN_WORDS) {
      fbText = `Beschreib die nächste Zeile mit mindestens ${K.INTENT_MIN_WORDS} Wörtern.`;
      return render();
    }
    const opened = C.ladderOpen(S, { escape: !!o.escape, now });
    if (opened.error) { fbText = 'Erst ein eigener Versuch (🐞, Run oder Plan).'; return render(); }
    const level = opened.level, mySlug = slug();
    const intent = level === 4 ? (intentText || '(keine Absicht genannt – Notausgang)') : undefined;
    busyNow = true; statusText = 'Frage nach …'; fbText = ''; render();
    const desc = window.LCDBG_HOST ? await window.LCDBG_HOST.description() : '';
    const ask = (strict) => coachBridge('llm', { kind: 'hint', messages: C.hintMessages({
      level, desc, code: codeNow(), lastRun, history: S.history, intent, strict }) });
    let res = null, msg = '';
    for (const strict of [false, true]) {
      const r = await ask(strict);
      if (r.error) { msg = errText(r); logEv('llmError', { code: r.error }); break; }
      const p = C.parseHint(r.text, level);
      if (!p.ok) { msg = 'Antwort unbrauchbar – nochmal versuchen.'; break; }
      if (level < 4 && !guardFor(level)(p.text).ok) {
        logEv('guardReject', { level, retry: !strict });
        msg = 'Hinweis enthielt Code – verworfen.';
        continue;
      }
      res = p;
      break;
    }
    busyNow = false;
    if (slug() !== mySlug) { statusText = ''; return render(); }   // inzwischen andere Aufgabe
    if (!res) { statusText = msg; return render(); }
    statusText = '';
    const shown = level < 4 ? res.text : res.feedback;
    let st = C.ladderShown(opened.state, { level, text: level < 4 ? res.text : `Absicht: ${intent} → ${res.line}`, now: Date.now() });
    st = Object.assign(st, { last: level < 4 ? { level, text: res.text } : { level, verdict: res.verdict, feedback: res.feedback, line: res.line } });
    st.shownText = shown;
    saveLadder(C.ladderApply(ladder(), S, st));   // Versuche/Accepted während der Anfrage behalten
    logEv('hint', { level });
    if (o.escape) logEv('escape', { level });
    if (opened.fast) logEv('fastClick', { level, ms: now - S.shownAt });
    fbText = opened.feedback || '';
    if (level === 4) panelUi.$('#intent').value = '';
    render();
  }

  // Versuche: 🐞-Prüfung (host.js), Run/Submit (net.js)
  window.addEventListener('lcdbg-run', (e) => {
    const d = e.detail || {};
    if (d.slug !== slug()) return;
    lastRun = d.summary || null;
    attempt('debug', C.codeHash(d.code));
  });
  window.addEventListener('lcdbg-attempt', (e) => {
    const d = e.detail || {};
    if (d.slug === slug()) attempt(d.src, C.codeHash(d.code));
  });
  window.addEventListener('lcdbg-result', (e) => {
    const d = e.detail || {};
    if (d.slug === slug()) lastRun = `LeetCode ${d.src === 'run' ? 'Run' : 'Submit'}: ${d.status || '?'}${d.correct === false ? ' (falsches Ergebnis)' : ''}`;
  });
  window.addEventListener('keydown', (e) => {
    if (!slug() || !e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== 'KeyH') return;
    e.preventDefault(); e.stopPropagation();
    togglePanel();
  }, true);

  // ------------------------------------------------------------ Nach „Accepted“: Selbsterklärung, dann Review

  // Markdown nur so weit, wie Review-Antworten es brauchen: Codeblöcke als <pre>, sonst Text
  const mdHtml = (md) => String(md || '').split(/```[\w-]*\n?/).map((part, i) => (i % 2 ? `<pre>${esc(part.replace(/\n$/, ''))}</pre>` : esc(part))).join('');

  window.addEventListener('lcdbg-accepted', (e) => {
    const d = e.detail || {};
    if (d.slug !== slug()) return;
    const S = ladder();
    if (!S.accepted) { saveLadder(C.ladderAccepted(S)); logEv('accepted', { level: S.level, assisted: S.assisted }); }
    panelOpen = true;
    syncSuggest();
    render();
  });

  async function llmOnce(messages) {
    busyNow = true; statusText = 'Frage nach …'; render();
    const r = await coachBridge('llm', { kind: 'hint', messages });
    busyNow = false; statusText = r.error ? errText(r) : '';
    if (r.error) logEv('llmError', { code: r.error });
    return r.error ? null : r.text;
  }

  async function selfExplain(text) {
    if (C.wordCount(text) < 4) { statusText = 'Ein ganzer Satz bitte (Warum korrekt? Welche Laufzeit?).'; return render(); }
    const desc = window.LCDBG_HOST ? await window.LCDBG_HOST.description() : '';
    const raw = await llmOnce(C.selfExplMessages({ desc, code: codeNow(), explanation: text }));
    if (raw == null) return render();
    const p = C.parseSelfExpl(raw);
    if (!p.ok) { statusText = 'Antwort unbrauchbar – nochmal versuchen.'; return render(); }
    saveLadder(Object.assign(ladder(), { explained: 'done', selfFb: `${p.verdict === 'stimmt' ? '✓' : p.verdict === 'teilweise' ? '≈' : '✗'} ${p.feedback}` }));
    logEv('selfExpl', { verdict: p.verdict });
    panelUi.$('#selfexpl').value = '';
    render();
  }

  function skipExplain() {
    saveLadder(Object.assign(ladder(), { explained: 'skipped' }));
    logEv('selfExplSkipped');
    render();
  }

  async function review(kind, question) {
    if (kind === 'ask' && !String(question || '').trim()) return;
    const desc = window.LCDBG_HOST ? await window.LCDBG_HOST.description() : '';
    const raw = await llmOnce(C.reviewMessages({ kind, desc, code: codeNow(), question }));
    if (raw != null) { reviewHtml = mdHtml(raw); logEv('review', { kind }); if (kind === 'ask') panelUi.$('#ask').value = ''; }
    render();
  }

  // Einhängen: Overlay-Widget unten rechts im Editor, ohne Monaco schwebend unten rechts
  let panelWidget = null, panelEd = null;
  function mountPanel() {
    if (!slug()) { if (panel) panel.style.display = 'none'; return; }
    if (!panel) { panel = makePanel(); render(); }
    panel.style.display = '';
    const e = ed;
    if (e && typeof e.addOverlayWidget === 'function') {
      if (panelEd === e && panel.isConnected) return;
      if (panelEd) try { panelEd.removeOverlayWidget(panelWidget); } catch (err) { /* egal */ }
      panel.style.cssText = 'z-index:50';
      panelWidget = { getId: () => 'lcdbg.coach.panel', getDomNode: () => panel, getPosition: () => ({ preference: 1 }) };
      try { e.addOverlayWidget(panelWidget); panelEd = e; } catch (err) { panelEd = null; }
      try {
        const li = e.getLayoutInfo();
        panel.style.setProperty('--maxw', Math.max(240, li.width - 60) + 'px');
        panel.style.setProperty('--maxh', Math.max(160, Math.round(li.height * 0.6)) + 'px');
      } catch (err) { /* egal */ }
      if (panelEd) return;
    }
    if (!panel.isConnected) {
      panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000';
      document.documentElement.appendChild(panel);
    }
  }

  // ------------------------------------------------------------ Anhängen

  let providersReady = false;
  function registerProviders() {
    if (providersReady || !M() || !M().languages) return;
    providersReady = true;
    for (const lang of ['javascript', 'typescript']) {
      try { if (hasInline()) M().languages.registerInlineCompletionsProvider(lang, inlineProvider); } catch (e) { log('Inline-Vorschläge nicht möglich', e); }
      try { M().languages.registerHoverProvider(lang, hoverProvider); } catch (e) { /* egal */ }
    }
  }

  // Editor-Ereignis abonnieren, wenn es die Methode gibt (ältere Monaco-Versionen, Attrappen)
  const sub = (e, name, fn) => { try { if (typeof e[name] === 'function') e[name](fn); } catch (err) { /* egal */ } };

  function attach(e) {
    ed = e;
    const node = e.getDomNode && e.getDomNode();
    document.querySelectorAll('[data-lcdbg-coach]').forEach((n) => n.removeAttribute('data-lcdbg-coach'));
    savedSuggest = null;
    try { e.updateOptions({ inlineSuggest: { enabled: true } }); } catch (err) { /* egal */ }
    try { acceptCmd = e.addCommand(0, () => logEv('ghostAccepted', { mode: 'inline' })); } catch (err) { acceptCmd = null; }
    try { e.addContentWidget(cardWidget()); } catch (err) { /* egal */ }
    sub(e, 'onKeyDown', (ev) => {
      const KC = M().KeyCode, be = ev.browserEvent || {};
      if (ev.keyCode === KC.Escape) { cardHide(); fbClear(); return; }
      if (be.altKey && be.shiftKey && !be.ctrlKey && !be.metaKey && (be.code === 'Space' || ev.keyCode === KC.Space)) {
        ev.preventDefault(); ev.stopPropagation();
        explicitAt = Date.now();
        if (hasInline()) { try { e.trigger('lcdbg-coach', 'editor.action.inlineSuggest.trigger', {}); } catch (err) { /* egal */ } }
        else fbSchedule(true);
        return;
      }
      if (ev.keyCode === KC.Tab && !be.shiftKey && fb.text && !hasInline()) {
        if (e.getModel().getAlternativeVersionId() === fb.version && samePos(e.getPosition(), fb.pos)) { ev.preventDefault(); ev.stopPropagation(); fbAccept(); }
      }
    });
    sub(e, 'onDidChangeModelContent', () => { if (!hasInline()) fbSchedule(false); cardUpdate(); });
    sub(e, 'onDidChangeCursorPosition', () => {
      cardUpdate();
      if (fb.text && (!fb.pos || e.getPosition().lineNumber !== fb.pos.lineNumber || e.getPosition().column !== fb.pos.column)) fbClear();
    });
    sub(e, 'onDidChangeModelLanguage', () => { cardHide(); fbClear(); syncSuggest(); });
    if (node) node.setAttribute('data-lcdbg-coach', '');
    syncSuggest();
    log('angehängt' + (hasInline() ? '' : ' (Ghost-Text als Dekoration)'));
  }

  // Erster Besuch einer Aufgabe: der Code, der schon im Editor steht (Vorlage), zählt nicht als Versuch
  function seedSlug() {
    const s = slug();
    if (!s || !ed || store.get(s, null)) return;
    let code = '';
    try { code = ed.getValue(); } catch (e) { return; }
    store.set(s, Object.assign(C.ladderInit(), { lastHash: C.codeHash(code) }));
  }

  async function tick() {
    if (M() && M().editor) {
      registerProviders();
      const e = findEditor();
      if (e && e !== ed) attach(e);
      syncSuggest();
    }
    seedSlug();
    mountPanel();
  }

  let lastSlug = slug();
  refreshCfg().then(tick);
  setInterval(tick, 1000);
  setInterval(refreshCfg, 15000);
  // Aufgabenwechsel ohne Neuladen: Zustand der neuen Aufgabe zeigen
  setInterval(() => {
    if (slug() === lastSlug) return;
    lastSlug = slug();
    fbText = ''; statusText = ''; lastRun = null; reviewHtml = '';
    syncSuggest();
    render();
  }, 300);
})();
