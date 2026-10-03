/* Oberfläche im Stil des VS-Code-Debuggers: kompakte Werkzeugleiste (Weiter, Prozedurschritt,
 * Einzelschritt, Rücksprung, Zurück, Neustart, Beenden) plus aufklappbare Bereiche
 * (Testfälle; Variablen / Aufrufstapel / Ausgabe / Testaufruf). Läuft in der Hauptwelt:
 * page.js hängt sie als Monaco-Overlay-Widget ein, ohne Monaco schwebt sie über dem Editor.
 * Kennt keine Logik: zeichnet das Ansichtsmodell der Engine und meldet Klicks über send(). */
(() => {
  'use strict';
  if (window.LCDBG_UI) return;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const isDark = () => document.documentElement.classList.contains('dark') ||
    document.documentElement.getAttribute('data-theme') === 'dark' || (document.body && document.body.classList.contains('dark'));

  // Symbole nach dem Vorbild der VS-Code-Codicons (16×16)
  const svg = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
  const S = 'fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    continue: svg(`<path d="M4 3.5v9" ${S}/><path d="M7 3.5l6 4.5-6 4.5z" fill="currentColor"/>`),
    over: svg(`<path d="M3 9.5a5 5 0 0 1 9.6-2" ${S}/><path d="M13 4.5v3.4H9.6" ${S}/><circle cx="8" cy="13" r="1.6" fill="currentColor"/>`),
    into: svg(`<path d="M8 1.8v7.4" ${S}/><path d="M4.8 6.4 8 9.6l3.2-3.2" ${S}/><circle cx="8" cy="13.4" r="1.6" fill="currentColor"/>`),
    out: svg(`<path d="M8 9.8V2.4" ${S}/><path d="M4.8 5.4 8 2.2l3.2 3.2" ${S}/><circle cx="8" cy="13.4" r="1.6" fill="currentColor"/>`),
    back: svg(`<path d="M13 9.5a5 5 0 0 0-9.6-2" ${S}/><path d="M3 4.5v3.4h3.4" ${S}/><circle cx="8" cy="13" r="1.6" fill="currentColor"/>`),
    restart: svg(`<path d="M12.6 8.6A4.7 4.7 0 1 1 11.2 4.4" ${S}/><path d="M11.6 1.8v3h-3" ${S}/>`),
    stop: svg('<rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="currentColor"/>'),
    vars: svg(`<path d="M5 2.8c-1.6 0-1.6 1.2-1.6 2.4S2.6 7.6 2 8c.6.4 1.4 1.2 1.4 2.8S3.4 13.2 5 13.2M11 2.8c1.6 0 1.6 1.2 1.6 2.4s.8 2.4 1.4 2.8c-.6.4-1.4 1.2-1.4 2.8s0 2.4-1.6 2.4" ${S}/><path d="m6.3 6 3.4 4m0-4-3.4 4" ${S}/>`),
  };
  const ICON = { ok: '✓', bad: '✗', err: '!', na: '·' };
  const TITLE = { ok: 'stimmt', bad: 'falsches Ergebnis', err: 'Fehler', na: 'kein Vergleich möglich' };

  window.LCDBG_UI = function createUI(opts) {
    const send = opts.send;
    const container = opts.container;
    const root = container.attachShadow({ mode: 'open' });
    let V = null, menu = false, panel = false, tab = 'vars', lastSel = null;

    root.innerHTML = `<style>${CSS}</style><div class="anchor ${opts.mode}">` +
      '<button class="pill" data-act="start" title="Debugger starten: alle Beispiele prüfen, dann Schritt für Schritt (Alt+Shift+D)">🐞 Debuggen</button>' +
      '<div class="dbg" hidden><div class="tb"></div><div class="drop" hidden></div></div></div>';
    const anchor = root.querySelector('.anchor'), pill = root.querySelector('.pill');
    const dbg = root.querySelector('.dbg'), tb = root.querySelector('.tb'), drop = root.querySelector('.drop');

    // Eingaben in der Leiste nicht an LeetCode/Monaco weiterreichen (Tasten, Mausrad, Klicks)
    for (const t of ['keydown', 'keyup', 'keypress', 'wheel', 'mousedown', 'pointerdown', 'mouseup', 'contextmenu'])
      container.addEventListener(t, (e) => e.stopPropagation());

    const btn = (act, icon, title, extra) => `<button class="ib ${extra && extra.cls || ''}" data-act="${act}"` +
      `${extra && extra.kind ? ` data-kind="${extra.kind}"` : ''} title="${esc(title)}"${extra && extra.disabled ? ' disabled' : ''}>${ICONS[icon]}</button>`;

    function toolbar() {
      const step = V.step, first = !step || step.i === 0, last = !step || step.i === step.n - 1;
      const chip = V.chips.find((c) => c.key === V.sel) || V.chips[0];
      const h = [];
      h.push('<div class="r1">');
      h.push(`<button class="case ${chip.status || ''}" data-act="menu" title="Testfall wählen${V.summary ? ' – ' + esc(V.summary) : ''}">` +
        `<span class="st">${chip.status ? ICON[chip.status] : ''}</span>${esc(chip.label)}<span class="caret">▾</span></button>`);
      h.push('<span class="sep"></span>');
      h.push(btn('continue', 'continue', 'Weiter bis zum nächsten Haltepunkt (F5). Haltepunkt: links neben die Zeilennummer klicken', { cls: 'blue', disabled: last }));
      h.push(btn('nav', 'over', 'Prozedurschritt: Aufruf überspringen (F10)', { cls: 'blue', kind: 'over', disabled: last }));
      h.push(btn('nav', 'into', 'Einzelschritt: nächster Schritt, auch in Funktionen hinein (F11)', { cls: 'blue', kind: 'next', disabled: last }));
      h.push(btn('nav', 'out', 'Rücksprung: bis die Funktion fertig ist (Shift+F11)', { cls: 'blue', kind: 'out', disabled: last }));
      h.push(btn('nav', 'back', 'Schritt zurück (Alt+Shift+←)', { cls: 'blue', kind: 'prev', disabled: first }));
      h.push(btn('check', 'restart', 'Neu starten: Code holen und alle Beispiele prüfen (Strg+Shift+F5)', { cls: 'green', disabled: V.running }));
      h.push(btn('close', 'stop', 'Beenden (Shift+F5)', { cls: 'red' }));
      h.push('<span class="sep"></span>');
      h.push(btn('panel', 'vars', 'Variablen, Aufrufstapel, Ausgabe, Testaufruf', { cls: panel ? 'on' : '' }));
      h.push('</div>');

      // Zeile 2: Ergebnis
      const vd = V.verdict;
      let line2 = '', cls2 = '';
      if (V.running) { line2 = 'Prüfe …'; cls2 = 'muted'; }
      else if (V.warn) { line2 = V.warn; cls2 = 'bad'; }
      else if (vd) {
        cls2 = vd.cls;
        line2 = vd.title.replace(/^(✅|❌|💥|⏱|⚠)\s*/u, '');
        if (vd.rows && (vd.cls === 'bad' || !/stimm/.test(vd.title))) line2 += ' · ' + vd.rows.map(([k, v]) => `${k} ${v}`).join(' · ');
      }
      const tip = line2 + (vd && vd.lead ? '\n\n' + vd.lead : '') + (vd && vd.hint ? '\n\n' + vd.hint : '');
      if (line2) h.push(`<div class="r2 ${cls2}" title="${esc(tip)}">${esc(line2)}</div>`);
      // Erklärung sichtbar statt nur im Tooltip: Wer scheitert, soll lesen können, was genau falsch ist
      if (vd && vd.cls === 'bad' && !V.running) {
        if (vd.detail && vd.detail !== line2) h.push(`<div class="r2x msg">${esc(vd.detail)}</div>`);
        if (vd.hint) h.push(`<div class="r2x">💡 ${esc(vd.hint)}</div>`);
        for (const n of vd.notes || []) h.push(`<div class="r2x note">⚠ Zeile ${n.line}: ${esc(n.message)}</div>`);
      }

      // Zeile 3: aktueller Schritt
      if (step) {
        h.push(`<div class="r3"><span class="pos">${step.i + 1}/${step.n}</span><span class="et" title="${esc(step.sub || step.title)}">${esc(step.title)}</span></div>`);
        h.push(`<input type="range" id="slider" min="0" max="${step.n - 1}" value="${step.i}" aria-label="Schritt" title="Zu einem beliebigen Schritt springen">`);
      }
      return h.join('');
    }

    function caseMenu() {
      const h = ['<div class="menu">'];
      if (V.summary) h.push(`<div class="hd">${esc(V.summary)}</div>`);
      let subHead = false;
      for (const c of V.chips) {
        if (c.sub && !subHead) { subHead = true; h.push('<div class="hd sub">Gescheitert bei LeetCode</div>'); }
        const item = `<button class="item${c.key === V.sel ? ' sel' : ''} ${c.status || ''}" data-act="select" data-key="${esc(c.key)}"` +
          `${c.input ? ` title="${esc(c.input)}"` : ''}>` +
          `<span class="st">${c.status ? ICON[c.status] : c.custom ? '+' : ''}</span>${esc(c.label)}` +
          `<span class="muted">${c.status ? TITLE[c.status] : c.custom ? 'eigenen Aufruf schreiben' : c.input ? esc(c.input) : ''}</span></button>`;
        h.push(c.sub ? `<div class="subrow">${item}<button class="drop-x" data-act="dropSub" data-key="${esc(c.key)}" title="Fall entfernen">✕</button></div>` : item);
      }
      h.push('<button class="item link" data-act="editHarness"><span class="st">✎</span>Testaufruf bearbeiten</button></div>');
      return h.join('');
    }

    function detailPanel() {
      const step = V.step;
      const tabs = [['vars', 'Variablen'], ['stack', 'Aufrufstapel'], ['console', `Ausgabe${V.logs.length ? ' (' + V.logs.length + ')' : ''}`], ['harness', 'Testaufruf']];
      const h = ['<div class="tabs">' + tabs.map(([k, l]) => `<button class="tab${tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}">${esc(l)}</button>`).join('') + '</div>'];
      if (tab === 'vars') {
        if (!step) h.push('<div class="none">Noch kein Lauf.</div>');
        else {
          const local = V.vars.filter((x) => !x.outer), outer = V.vars.filter((x) => x.outer);
          const rows = (list) => list.map((x) => {
            const val = x.old !== null
              ? `<span class="old">${esc(x.old)}</span> <span class="arrow">→</span> ${esc(x.text)}`
              : esc(x.text);
            return `<tr class="${x.changed ? 'chg' : ''}"><td>${esc(x.name)}</td><td class="mono">${val}</td></tr>`;
          }).join('');
          h.push('<table class="vars">');
          h.push(`<tr><th colspan="2">Lokal${step.fn ? ' · ' + esc(step.fn) : ''}</th></tr>`);
          h.push(local.length ? rows(local) : '<tr><td colspan="2" class="none">keine</td></tr>');
          if (outer.length) h.push('<tr><th colspan="2" title="Variablen einer äußeren Funktion, auf die diese Funktion zugreifen kann">Closure</th></tr>' + rows(outer));
          h.push('</table>');
        }
      } else if (tab === 'stack') {
        const st = step && step.stack && step.stack.length ? step.stack : ['(oberste Ebene)'];
        h.push('<div class="list">' + st.map((f, i) => `<div class="frame${i === 0 ? ' cur' : ''}">${i === 0 ? '➜ ' : ''}${esc(f)}</div>`).join('') + '</div>');
      } else if (tab === 'console') {
        h.push(V.logs.length ? '<div class="list">' + V.logs.map((l) =>
          `<button class="log" data-act="go" data-i="${l.step}" title="Zu dieser Ausgabe springen"><span class="ln">${l.line ? 'Z.' + l.line : ''}</span><span class="mono">${esc(l.text)}</span></button>`).join('') + '</div>'
          : '<div class="none">Keine console.log-Ausgaben.</div>');
      } else if (tab === 'harness') {
        if (V.caseInfo) {
          h.push('<div class="rows">' + V.caseInfo.vars.map(([k, v]) => `<span>${esc(k)}</span><span class="mono">${esc(v)}</span>`).join('') +
            `<span>erwartet</span><span class="mono">${esc(V.caseInfo.expected)}</span></div>`);
        }
        h.push(`<textarea id="harness" spellcheck="false" rows="${Math.min(12, Math.max(3, V.harness.text.split('\n').length + 1))}">${esc(V.harness.text)}</textarea>`);
        h.push('<div class="hrow"><button class="primary" data-act="runCase" title="Strg+Enter">▶ Ausführen</button>' +
          '<button class="plain" data-act="resetHarness" title="Aufruf neu aus dem Beispiel erzeugen">Zurücksetzen</button>' +
          '<span class="muted">Letzte Zeile = Ergebnis</span></div>');
      }
      if (V.manualNeeded) h.push('<div class="muted">Code nicht gefunden – hier einfügen:</div><textarea id="manual" spellcheck="false" rows="6"></textarea>');
      if (V.truncated) h.push(`<div class="muted">${esc(V.truncated)}</div>`);
      return h.join('');
    }

    function render(view) {
      if (view !== undefined) V = view;
      anchor.classList.toggle('light', !isDark());
      const open = !!(V && V.open);
      pill.hidden = open;
      dbg.hidden = !open;
      if (!open) { menu = false; panel = false; if (opts.onLayout) opts.onLayout(); return; }
      if (V.sel !== lastSel) {   // anderer Testfall: wieder mit den Variablen anfangen
        if (lastSel === 'eigener' && tab === 'harness') tab = 'vars';
        lastSel = V.sel;
      }
      if (V.manualNeeded || (V.sel === 'eigener' && !V.step)) { panel = true; if (!V.manualNeeded) tab = 'harness'; }

      // Fokus & Cursor im Textfeld über das Neuzeichnen retten
      const active = root.activeElement;
      const keep = active && active.id ? { id: active.id, s: active.selectionStart, e: active.selectionEnd, st: active.scrollTop, v: active.value } : null;
      const scroll = drop.scrollTop;

      tb.innerHTML = toolbar();
      drop.hidden = !(menu || panel);
      drop.className = 'drop' + (menu ? ' narrow' : '');
      if (menu) drop.innerHTML = caseMenu();
      else if (panel) drop.innerHTML = detailPanel();
      drop.scrollTop = scroll;
      if (keep) {
        const el = root.getElementById(keep.id);
        if (el) {
          if (keep.id === 'harness' && V.fromHarness) el.value = keep.v;
          el.focus();
          try { el.setSelectionRange(keep.s, keep.e); } catch (err) { /* Regler */ }
          el.scrollTop = keep.st;
        }
      }
      if (opts.onLayout) opts.onLayout();
    }

    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const a = b.dataset.act;
      if (a === 'start' || a === 'check') { menu = false; return send('start'); }
      if (a === 'menu') { menu = !menu; panel = false; return render(); }
      if (a === 'panel') { panel = !panel; menu = false; return render(); }
      if (a === 'tab') { tab = b.dataset.tab; return render(); }
      if (a === 'editHarness') { menu = false; panel = true; tab = 'harness'; return render(); }
      if (a === 'select') { menu = false; return send('select', { key: b.dataset.key }); }
      if (a === 'dropSub') return send('dropSub', { key: b.dataset.key });
      if (a === 'nav') return send('nav', { kind: b.dataset.kind });
      if (a === 'go') return send('go', { i: +b.dataset.i });
      if (a === 'close') { menu = false; panel = false; }
      send(a);
    });

    let typeTimer = null;
    root.addEventListener('input', (e) => {
      if (e.target.id === 'slider') return send('go', { i: +e.target.value });
      if (e.target.id === 'manual') return send('manualCode', { text: e.target.value });
      if (e.target.id === 'harness') {
        const t = e.target;
        t.rows = Math.min(12, Math.max(3, t.value.split('\n').length + 1));
        clearTimeout(typeTimer);
        typeTimer = setTimeout(() => send('harness', { text: t.value }), 150);
      }
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t.id === 'harness' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        clearTimeout(typeTimer);
        send('harness', { text: t.value });
        send('runCase');
      } else if (t.id === 'harness' && e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        t.setRangeText('  ', t.selectionStart, t.selectionEnd, 'end');
      } else if (e.key === 'Escape') {
        if (menu || panel) { menu = false; panel = false; render(); } else send('close');
      }
    });

    // Hinweis am Knopf, z. B. nach einer gescheiterten Einsendung
    function setHint(text) {
      const t = text || '🐞 Debuggen';
      if (pill.textContent === t) return;
      pill.textContent = t;
      pill.classList.toggle('alert', !!text);
      if (opts.onLayout) opts.onLayout();
    }

    return {
      render, setHint, anchor, pill, root, toolbar: tb, dropdown: drop,
      get open() { return !!(V && V.open); },
      get height() { return dbg.hidden ? 0 : tb.offsetHeight; },
    };
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .anchor {
      --bg: #252526; --bg2: #1e1e1e; --line: #454545; --text: #cccccc; --muted: #9d9d9d; --hover: rgba(90,93,94,.31);
      --blue: #75beff; --green: #89d185; --red: #f48771; --ok: #89d185; --bad: #f48771; --accent: #ffa116;
      --chg: rgba(255,204,0,.14); --mono: Menlo, Consolas, "DejaVu Sans Mono", monospace;
      --sans: -apple-system, "Segoe UI", system-ui, sans-serif;
      font: 12px/1.4 var(--sans); color: var(--text);
    }
    .anchor.light { --bg: #f3f3f3; --bg2: #ffffff; --line: #c8c8c8; --text: #333; --muted: #6f6f6f; --hover: rgba(184,184,184,.35);
      --blue: #007acc; --green: #388a34; --red: #a1260d; --ok: #388a34; --bad: #a1260d; --chg: rgba(255,204,0,.3); }
    button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
    button:disabled { opacity: .35; cursor: default; }
    button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 1px solid var(--blue); outline-offset: 1px; }
    .mono { font-family: var(--mono); word-break: break-word; }
    .muted { color: var(--muted); }

    .pill { pointer-events: auto; background: var(--accent); color: #1a1a1a; border-radius: 4px; padding: 3px 10px;
      font-weight: 600; font-size: 12px; opacity: .85; box-shadow: 0 1px 4px rgba(0,0,0,.3); animation: pulse 1.2s ease-out 3; }
    .pill:hover { opacity: 1; }
    .pill.alert { background: #f48771; opacity: 1; animation: pulse-bad 1.2s ease-out 4; }
    @keyframes pulse-bad { 0% { box-shadow: 0 0 0 0 rgba(244,135,113,.75); } 100% { box-shadow: 0 0 0 10px rgba(244,135,113,0); } }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,161,22,.7); } 100% { box-shadow: 0 0 0 10px rgba(255,161,22,0); } }

    .dbg { position: relative; pointer-events: auto; }
    .tb { background: var(--bg); border: 1px solid var(--line); border-radius: 5px; box-shadow: 0 2px 8px rgba(0,0,0,.36);
      padding: 3px 6px 4px; display: flex; flex-direction: column; gap: 1px; min-width: 330px; max-width: var(--maxw, 520px); }
    .r1 { display: flex; align-items: center; gap: 1px; }
    .ib { width: 26px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; }
    .ib:hover:not(:disabled) { background: var(--hover); }
    .ib.on { background: var(--hover); color: var(--blue); }
    .ib.blue { color: var(--blue); } .ib.green { color: var(--green); } .ib.red { color: var(--red); }
    .sep { width: 1px; height: 16px; background: var(--line); margin: 0 4px; }
    .case { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 6px; border-radius: 4px; max-width: 150px; white-space: nowrap; }
    .case:hover { background: var(--hover); }
    .caret { color: var(--muted); font-size: 10px; }
    .st { font-weight: 700; width: 10px; text-align: center; }
    .ok .st { color: var(--ok); } .bad .st, .err .st { color: var(--bad); }
    .r2 { padding: 0 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    .r2.ok { color: var(--ok); } .r2.bad { color: var(--bad); } .r2.muted { color: var(--muted); font-weight: 400; }
    .r2x { padding: 1px 4px; white-space: normal; line-height: 1.4; font-size: 12px; overflow-wrap: anywhere; }
    .r2x.msg { color: var(--bad); font-family: var(--mono, Consolas, monospace); }
    .r2x.note { color: var(--warn, #cca700); }
    .r3 { display: flex; gap: 8px; padding: 0 4px; color: var(--muted); white-space: nowrap; overflow: hidden; }
    .pos { color: var(--text); font-variant-numeric: tabular-nums; }
    .et { overflow: hidden; text-overflow: ellipsis; }
    #slider { width: 100%; height: 10px; margin: 1px 0 0; accent-color: var(--blue); }

    .drop { position: absolute; right: 0; top: calc(100% + 4px); width: min(400px, var(--maxw, 400px)); max-height: var(--maxh, 360px);
      overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 5px; box-shadow: 0 4px 14px rgba(0,0,0,.4);
      padding: 6px; display: flex; flex-direction: column; gap: 6px; z-index: 2; }
    .drop.narrow { width: 260px; }
    .menu { display: flex; flex-direction: column; }
    .menu .hd { color: var(--muted); padding: 2px 6px 4px; }
    .item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; text-align: left; }
    .item:hover, .item.sel { background: var(--hover); }
    .item .muted { margin-left: auto; font-size: 11px; }
    .hd.sub { border-top: 1px solid var(--line); margin-top: 3px; padding-top: 6px; }
    .subrow { display: flex; align-items: center; }
    .subrow .item { flex: 1; min-width: 0; }
    .subrow .item .muted { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; }
    .drop-x { color: var(--muted); width: 22px; height: 22px; border-radius: 4px; flex: none; }
    .drop-x:hover { background: var(--hover); color: var(--text); }
    .item.link { color: var(--blue); border-top: 1px solid var(--line); border-radius: 0; margin-top: 3px; padding-top: 6px; }

    .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--line); }
    .tab { padding: 3px 8px; color: var(--muted); border-bottom: 1px solid transparent; margin-bottom: -1px; text-transform: uppercase; font-size: 11px; letter-spacing: .03em; }
    .tab.on { color: var(--text); border-bottom-color: var(--blue); }
    table.vars { width: 100%; border-collapse: collapse; }
    .vars th { text-align: left; font: 600 11px var(--sans); color: var(--muted); padding: 4px 4px 2px; }
    .vars td { padding: 1px 4px; vertical-align: top; }
    .vars td:first-child { color: #9cdcfe; font-family: var(--mono); white-space: nowrap; width: 1%; }
    .light .vars td:first-child { color: #001080; }
    .vars tr.chg td { background: var(--chg); }
    .vars .old { color: var(--muted); text-decoration: line-through; }
    .vars .arrow { color: var(--muted); }
    .none { color: var(--muted); padding: 4px; }
    .list { display: flex; flex-direction: column; }
    .frame { padding: 2px 4px; font-family: var(--mono); }
    .frame.cur { background: var(--hover); color: #ffcc00; }
    .light .frame.cur { color: #8a6d00; }
    .log { display: flex; gap: 8px; text-align: left; padding: 2px 4px; border-bottom: 1px solid var(--line); }
    .log:hover { background: var(--hover); }
    .ln { color: var(--muted); font-size: 11px; flex: none; }
    .rows { display: grid; grid-template-columns: auto 1fr; gap: 1px 10px; }
    .rows > span:nth-child(odd) { color: var(--muted); }
    textarea { width: 100%; resize: vertical; background: var(--bg2); color: var(--text); border: 1px solid var(--line);
      border-radius: 3px; padding: 5px; font: 12px/1.5 var(--mono); }
    .hrow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .primary { background: #0e639c; color: #fff; border-radius: 2px; padding: 3px 10px; }
    .primary:hover { background: #1177bb; }
    .plain { color: var(--blue); }

    /* frei schwebend (ohne Monaco): an das Editor-Rechteck geheftet */
    .float { position: fixed; pointer-events: none; }
    .float .pill { position: absolute; top: 6px; right: 22px; }
    .float .dbg { position: absolute; top: 6px; right: 22px; }
    .float.fallback .pill { top: auto; bottom: 16px; right: 16px; font-size: 13px; padding: 7px 14px; opacity: 1; }
    /* als Monaco-Widget: Monaco setzt die Position */
    .overlay { display: flex; justify-content: flex-end; padding: 4px 6px 0 0; }
  `;
})();
