/* Läuft in der Hauptwelt der LeetCode-Seite, weil nur dort window.monaco sichtbar ist.
 * Liest den Code, markiert die aktuelle Zeile mit ihren Werten, zeigt beim Überfahren einer
 * Variable ihren Wert und hängt Knopf + Debug-Leiste (ui.js) als Overlay-Widget in den Editor –
 * dieselbe Technik wie Monacos eigene Suchleiste. Führt keinen Nutzercode aus. */
(() => {
  'use strict';
  if (window.__lcdbgPage) return;
  window.__lcdbgPage = true;

  let ed = null, decos = [], state = { active: false, vars: [], inline: [] }, hoverReady = false;
  const bps = new Set();          // Haltepunkte (Zeilen), wie in VS Code per Klick in die Randspalte
  let zoneId = null, zoneEd = null, savedOpts = null, mouseSub = null, lastPad = null;
  let ui = null, widget = null, widgetEd = null, layoutSub = null;
  const post = (m) => window.postMessage(Object.assign({ lcdbgPage: 'event' }, m), location.origin);
  const log = (...a) => console.info('[LeetCode-Debugger]', ...a);

  const style = document.createElement('style');
  style.textContent = `
    .lcdbg-line { background: rgba(255, 255, 0, .13) !important; }
    .vs .lcdbg-line { background: rgba(255, 230, 0, .3) !important; }
    .lcdbg-line-err { background: rgba(244, 135, 113, .22) !important; }
    .lcdbg-arrow, .lcdbg-arrow-err, .lcdbg-bp { display: flex !important; align-items: center; justify-content: center; }
    .lcdbg-arrow::before { content: "➜"; color: #ffcc00; font-size: 13px; line-height: 1; }
    .lcdbg-arrow-err::before { content: "➜"; color: #f48771; font-size: 13px; line-height: 1; }
    .lcdbg-bp::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: #e51400; }
    .lcdbg-bp-hint { cursor: pointer; }
    .lcdbg-iv::after { margin-left: 2.5em; color: rgba(255, 255, 255, .5); font-style: italic; white-space: pre; }
    .vs .lcdbg-iv::after { color: rgba(0, 0, 0, .5); }
    .lcdbg-iv-cur::after { color: #ffcc00 !important; opacity: .95; }
    .vs .lcdbg-iv-cur::after { color: #8a6d00 !important; }
    .lcdbg-iv-err::after { color: #f48771 !important; }
    .lcdbg-overlay { z-index: 50; }`;
  (document.head || document.documentElement).appendChild(style);
  // Werte am Zeilenende über ::after – läuft mit jeder Monaco-Version (das neuere „after“ nicht)
  const dyn = document.createElement('style');
  dyn.id = 'lcdbg-dyn';
  (document.head || document.documentElement).appendChild(dyn);
  const cssString = (t) => '"' + String(t).replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

  const langOf = (model) => {
    try { return model.getLanguageId ? model.getLanguageId() : model.getModeId ? model.getModeId() : null; } catch (e) { return null; }
  };

  function findEditor() {
    const m = window.monaco && window.monaco.editor;
    if (!m || !m.getEditors) return null;
    const score = (e) => {
      const model = e.getModel && e.getModel();
      if (!model) return -1;
      const node = e.getDomNode && e.getDomNode();
      return (/javascript|typescript/i.test(langOf(model) || '') ? 1000 : 0) +
        (node && node.offsetParent !== null ? 500 : 0) + model.getLineCount();
    };
    const list = m.getEditors().filter((e) => score(e) >= 0).sort((a, b) => score(b) - score(a));
    return list[0] || null;
  }

  // Editor finden, im DOM markieren, Widget einhängen
  function mark() {
    const e = findEditor();
    if (!e) return;
    if (e !== ed) { decos = []; ed = e; }
    const node = e.getDomNode && e.getDomNode();
    if (node && !node.hasAttribute('data-lcdbg-editor')) {
      document.querySelectorAll('[data-lcdbg-editor]').forEach((n) => n.removeAttribute('data-lcdbg-editor'));
      node.setAttribute('data-lcdbg-editor', '');
    }
    setupHover();
  }
  setInterval(mark, 1000);

  function revealLine(line) {
    const e = ed || findEditor();
    if (!e || !line) return;
    try {
      e.revealLineInCenter(line);
      e.setSelection({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: e.getModel().getLineMaxColumn(line) });
      e.focus();
    } catch (err) { /* ältere Monaco-Versionen */ }
  }

  const onProblem = () => /^\/problems\/[^/]+/.test(location.pathname);
  const send = (name, extra) => {
    if (name === 'continue') extra = Object.assign({}, extra, { lines: [...bps] });
    // Zeile aus einem Hinweis zeigen: rein im Editor, die Engine braucht davon nichts zu wissen
    if (name === 'reveal') return revealLine(extra.line);
    post({ type: 'action', name, extra });
  };
  let lastView = null, lastHint = null;

  // ---------- Normalfall: Overlay-Widget im Monaco-Editor
  function mountWidget(e) {
    if (!window.LCDBG_UI || typeof e.addOverlayWidget !== 'function') return false;
    if (widgetEd === e && widget && widget.getDomNode().isConnected) {
      widget.getDomNode().style.display = onProblem() ? '' : 'none';
      return true;
    }
    if (widgetEd) {
      try { widgetEd.removeOverlayWidget(widget); } catch (err) { /* alter Editor schon weg */ }
      if (layoutSub) try { layoutSub.dispose(); } catch (err) { /* egal */ }
      widgetEd = null;
    }
    if (!widget) {
      const node = document.createElement('div');
      node.className = 'lcdbg-overlay';
      ui = window.LCDBG_UI({ container: node, mode: 'overlay', send, onLayout: relayout });
      widget = {
        getId: () => 'lcdbg.debugger',
        getDomNode: () => node,
        // 0 = oben rechts (OverlayWidgetPositionPreference.TOP_RIGHT_CORNER)
        getPosition: () => ({ preference: 0 }),
      };
    }
    try { e.addOverlayWidget(widget); } catch (err) { return false; }
    widgetEd = e;
    sizeWidget();
    if (e.onDidLayoutChange) layoutSub = e.onDidLayoutChange(sizeWidget);
    if (lastView) { ui.render(lastView); relayout(); }
    if (lastHint) ui.setHint(lastHint);
    log('Leiste sitzt als Widget im Editor');
    return true;
  }

  function sizeWidget() {
    if (!widgetEd || !widget) return;
    let li = null;
    try { li = widgetEd.getLayoutInfo(); } catch (err) { /* egal */ }
    const node = widget.getDomNode();
    const w = li ? li.width - (li.verticalScrollbarWidth || 14) - 30 : 400;
    const h = li ? li.height - (li.horizontalScrollbarHeight || 10) - 16 : 420;
    node.style.setProperty('--maxw', Math.max(220, w) + 'px');
    node.style.setProperty('--maxh', Math.max(140, Math.round(h * 0.62)) + 'px');
  }

  function relayout() {
    if (widgetEd && widget) try { widgetEd.layoutOverlayWidget(widget); } catch (err) { /* egal */ }
    debugMode(widgetEd, !!(ui && ui.open));
  }

  // Solange der Debugger läuft: Abstand oben (die Leiste verdeckt keinen Code) und Randspalte für Haltepunkte
  function debugMode(e, on) {
    if (!e || !e.updateOptions) return;
    try {
      if (on) {
        if (!savedOpts) {
          const raw = (e.getRawOptions && e.getRawOptions()) || {};
          savedOpts = { padding: raw.padding || { top: 0 }, glyphMargin: !!raw.glyphMargin };
        }
        const top = Math.max(ui ? ui.height : 0, 0) + 12;
        if (top !== lastPad) {
          lastPad = top;
          e.updateOptions({ padding: Object.assign({}, savedOpts.padding, { top }), glyphMargin: true });
        }
        if (!mouseSub && e.onMouseDown) {
          mouseSub = e.onMouseDown((ev) => {
            const t = ev && ev.target;
            // 2 = Glyph-Rand, 4 = Zeilen-Dekorationen (MouseTargetType)
            if (!state.active || !t || !t.position || (t.type !== 2 && t.type !== 4)) return;
            toggleBp(t.position.lineNumber);
          });
        }
      } else if (savedOpts) {
        e.updateOptions({ padding: savedOpts.padding, glyphMargin: savedOpts.glyphMargin });
        savedOpts = null;
        lastPad = null;
      }
    } catch (err) { /* ältere Monaco-Versionen: dann eben ohne */ }
  }

  function toggleBp(line) {
    if (bps.has(line)) bps.delete(line); else bps.add(line);
    paint();
  }

  // ---------- Notlösung ohne Monaco: schwebend über dem Editor-Rechteck
  let floatHost = null, floatUI = null, lastRect = '';
  function ensureFloat() {
    if (!window.LCDBG_UI) return;
    if (!floatHost) {
      floatHost = document.createElement('div');
      floatHost.id = 'lcdbg-host';
      floatHost.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
      floatUI = window.LCDBG_UI({ container: floatHost, mode: 'float', send });
      if (lastView) floatUI.render(lastView);
      if (lastHint) floatUI.setHint(lastHint);
      log('kein Monaco-Editor – Leiste schwebt über der Seite');
    }
    if (!floatHost.isConnected) { document.documentElement.appendChild(floatHost); lastRect = ''; }
    floatHost.style.display = onProblem() ? '' : 'none';
    let best = null, area = 0;
    for (const el of document.querySelectorAll('.monaco-editor')) {
      const r = el.getBoundingClientRect(), a = r.width * r.height;
      if (a > area && r.width > 200 && r.height > 120) { best = el; area = a; }
    }
    floatUI.anchor.classList.toggle('fallback', !best);
    const r = best ? best.getBoundingClientRect()
      : { left: Math.max(0, innerWidth - 520), top: 60, width: Math.min(520, innerWidth), height: innerHeight - 80 };
    const key = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (key === lastRect) return;
    lastRect = key;
    Object.assign(floatUI.anchor.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  }
  function dropFloat() { if (floatHost) floatHost.remove(); }

  function tickUI() {
    const e = findEditor();
    if (e && mountWidget(e)) dropFloat();
    else ensureFloat();
  }
  setInterval(tickUI, 250);

  const activeUI = () => (widgetEd && widget && widget.getDomNode().isConnected ? ui : floatUI);

  function render(view) {
    lastView = view;
    const u = activeUI();
    if (!u) return;
    u.render(view);
    if (u === ui) relayout();
  }

  // Für das Fenster am Käfer-Symbol: wird die Oberfläche gezeigt, oder verdeckt sie etwas?
  function uiStatus() {
    const u = activeUI();
    if (!u) return { widget: false, pillShown: false, covered: null };
    const isWidget = u === ui;
    const box = isWidget ? widget.getDomNode() : (u.open ? u.toolbar : u.pill);
    const r = box.getBoundingClientRect();
    const shown = r.width > 0 && r.height > 0;
    let covered = null;
    if (shown) {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 12));
      const host = isWidget ? widget.getDomNode() : floatHost;
      if (top && !host.contains(top)) covered = top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') +
        (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    }
    return { widget: isWidget, pillShown: shown, covered, monaco: !!window.monaco, editorFound: !!findEditor() || !!document.querySelector('.monaco-editor') };
  }

  function setupHover() {
    if (hoverReady || !window.monaco || !window.monaco.languages || !window.monaco.languages.registerHoverProvider) return;
    hoverReady = true;
    const provider = {
      provideHover(model, position) {
        if (!state.active || !ed || model !== ed.getModel()) return null;
        const w = model.getWordAtPosition(position);
        if (!w) return null;
        const hit = state.vars.find(([n]) => n === w.word);
        if (!hit) return null;
        return {
          range: new window.monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn),
          contents: [{ value: '**' + hit[0] + '** (aktueller Schritt)' }, { value: '```js\n' + hit[1] + '\n```' }],
        };
      },
    };
    for (const lang of ['javascript', 'typescript']) {
      try { window.monaco.languages.registerHoverProvider(lang, provider); } catch (e) { /* egal */ }
    }
  }

  function getCode() {
    mark();
    if (ed) return { code: ed.getValue(), lang: langOf(ed.getModel()) };
    const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels && window.monaco.editor.getModels()) || [];
    if (models.length) {
      const m = models.find((x) => /javascript|typescript/i.test(langOf(x) || '')) || models[0];
      return { code: m.getValue(), lang: langOf(m) };
    }
    // Notlösung: sichtbare Editorzeilen (nur vollständig, wenn der Code ganz sichtbar ist)
    const lines = Array.from(document.querySelectorAll('.monaco-editor .view-lines .view-line'));
    if (lines.length) {
      lines.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
      return { code: lines.map((l) => l.textContent.replace(/ /g, ' ')).join('\n'), lang: null };
    }
    return { error: 'Kein Editor gefunden.' };
  }

  function debugState(m) {
    state = {
      active: !!m.active, vars: m.vars || [], line: m.active ? m.line : null, text: m.text || '',
      error: !!m.error, inline: m.inline || [], exception: m.exception || null,
    };
    if (!state.active && widgetEd) debugMode(widgetEd, false);
    paint();
    if (state.line) try { (ed || findEditor()).revealLineInCenterIfOutsideViewport(state.line); } catch (err) { /* egal */ }
  }

  // Alle Markierungen auf einmal: aktuelle Zeile + Pfeil, Werte neben den Zeilen, Haltepunkte, Fehlerkasten
  function paint() {
    const e = ed || findEditor();
    if (!e || !window.monaco) return;
    const model = e.getModel(), R = window.monaco.Range, n = model.getLineCount();
    const list = [], css = [];
    const line = state.line;
    if (state.active) {
      for (const L of bps) if (L <= n) list.push({ range: new R(L, 1, L, 1), options: { glyphMarginClassName: 'lcdbg-bp', glyphMarginHoverMessage: { value: 'Haltepunkt – Klick entfernt ihn' } } });
      for (const [L, text] of state.inline) {
        if (L > n || L === line) continue;
        list.push({ range: new R(L, 1, L, model.getLineMaxColumn(L)), options: { afterContentClassName: `lcdbg-iv lcdbg-iv-${L}` } });
        css.push(`.lcdbg-iv-${L}::after { content: ${cssString(text)}; }`);
      }
      if (line && line <= n) {
        list.push({ range: new R(line, 1, line, 1), options: {
          isWholeLine: true, className: state.error ? 'lcdbg-line-err' : 'lcdbg-line',
          glyphMarginClassName: state.error ? 'lcdbg-arrow-err' : 'lcdbg-arrow',
        } });
        if (state.text) {
          list.push({ range: new R(line, 1, line, model.getLineMaxColumn(line)), options: {
            afterContentClassName: `lcdbg-iv lcdbg-iv-cur lcdbg-iv-${line}${state.error ? ' lcdbg-iv-err' : ''}`,
          } });
          css.push(`.lcdbg-iv-${line}.lcdbg-iv-cur::after { content: ${cssString(state.text)}; }`);
        }
      }
    }
    dyn.textContent = css.join('\n');
    try { decos = e.deltaDecorations(decos, list); } catch (err) {
      try { decos = e.deltaDecorations(decos, list.filter((d) => !d.options.glyphMarginClassName)); } catch (err2) { decos = []; }
    }
    exceptionZone(e, state.active ? state.exception : null);
  }

  // Fehler wie VS Code: Kasten unter der Zeile, der den Code nach unten schiebt statt ihn zu verdecken
  function exceptionZone(e, ex) {
    if (!e.changeViewZones) return;
    try {
      e.changeViewZones((acc) => {
        if (zoneId !== null && zoneEd) { try { acc.removeZone(zoneId); } catch (err) { /* egal */ } zoneId = null; }
        if (!ex) return;
        const node = document.createElement('div');
        node.className = 'lcdbg-zone';
        node.style.cssText = 'box-sizing:border-box;border-top:2px solid #f48771;border-bottom:2px solid #f48771;' +
          'background:rgba(244,135,113,.12);padding:3px 10px;font:12px/1.45 -apple-system,"Segoe UI",system-ui,sans-serif;' +
          'color:inherit;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;z-index:10;';
        const t = document.createElement('div');
        t.style.cssText = 'color:#f48771;font-weight:600;overflow:hidden;text-overflow:ellipsis';
        t.textContent = '💥 ' + ex.title;
        node.appendChild(t);
        // Der Tipp steht in der Fehlerkarte der Leiste – hier nur als Tooltip, nicht ein zweites Mal
        if (ex.hint) node.title = ex.hint;
        zoneId = acc.addZone({ afterLineNumber: ex.line, heightInPx: 28, domNode: node });
        zoneEd = e;
      });
    } catch (err) { /* ohne Zonen-API: Fehler steht trotzdem in der Leiste */ }
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (ev.source !== window || !m || m.lcdbgPage !== 'req') return;
    let res = {};
    try {
      if (m.type === 'getCode') res = getCode();
      else if (m.type === 'debugState') debugState(m);
      else if (m.type === 'view') render(m.view);
      else if (m.type === 'uiStatus') res = uiStatus();
      else if (m.type === 'hint') {
        lastHint = m.text || null;
        for (const u of [ui, floatUI]) if (u) u.setHint(lastHint);
      }
      else if (m.type === 'toggleBpAtCursor') {
        const e = ed || findEditor();
        const p = e && e.getPosition && e.getPosition();
        if (p) toggleBp(p.lineNumber);
      } else if (m.type === 'breakpoints') res = { lines: [...bps] };
    } catch (err) { res = { error: String((err && err.message) || err) }; }
    window.postMessage(Object.assign({ lcdbgPage: 'res', id: m.id }, res), location.origin);
  });
})();
