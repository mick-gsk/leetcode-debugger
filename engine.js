/* Engine – läuft unsichtbar in einer Sandbox-Seite (eigener, leerer Ursprung, eval erlaubt).
 * Hält den Zustand (Beispiele, Läufe, aktueller Schritt) und schickt nach jeder Änderung ein
 * fertiges Ansichtsmodell an content.js, das die Leiste im Editor zeichnet.
 * Bekommt von dort nur Aktionen (prüfen, Beispiel wählen, weiter, zurück …). */
(() => {
  'use strict';
  const T = window.LCTracer;
  const short = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

  const CUSTOM = 'eigener';
  const S = {
    slug: '', examples: [], subs: [], harness: {}, sel: '0', status: {}, prefs: {},
    run: null, i: 0, code: '', lang: null, running: false, play: null,
    open: false, summary: null, allOk: false, message: null, manualNeeded: false, manualCode: '',
    sections: { vars: true, console: false, harness: false },
  };

  // ------------------------------------------------------------ Verbindung

  let reqId = 0;
  const pending = new Map();
  const send = (msg) => window.parent.postMessage(Object.assign({ lcdbg: true }, msg), '*');
  const ask = (type, extra) => new Promise((resolve) => {
    const id = ++reqId;
    pending.set(id, resolve);
    send(Object.assign({ type, id }, extra));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ error: 'Keine Antwort von der Seite.' }); } }, 3000);
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !e.data || !e.data.lcdbg) return;
    const m = e.data;
    if (m.type === 'reply' && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m); }
    else if (m.type === 'init') init(m);
    else if (m.type === 'action') act(m);
    else if (m.type === 'parsePanel') send({ type: 'answer', qid: m.qid, result: T.parseResultPanel(m.text) });
    else if (m.type === 'subs') {
      S.subs = m.list || [];
      if (S.sel !== CUSTOM && !caseOf(S.sel)) S.sel = cases().length ? cases()[0].key : CUSTOM;
      view();
    }
  });

  // ------------------------------------------------------------ Zustand

  function init(m) {
    S.prefs = m.prefs || {};
    const sameProblem = S.slug === m.slug && (S.examples.length || S.code);
    S.slug = m.slug;
    if (m.code) S.code = m.code;
    S.lang = m.lang || S.lang;
    if (m.subs) S.subs = m.subs;
    if (!sameProblem) {
      S.examples = T.parseExamples(m.examplesText || '');
      S.harness = (m.draft && m.draft.harness) || {};
      S.sel = S.examples.length ? '0' : CUSTOM;
      S.status = {};
      S.run = null;
      S.open = false;
      S.message = null;
      S.summary = null;
    }
    view();
  }

  // Alle Testfälle: Beispiele aus dem Aufgabentext, dann gescheiterte Einsendungen (neueste zuerst)
  function cases() {
    const out = S.examples.map((ex, k) => ({ key: String(k), label: `Beispiel ${k + 1}`, ex }));
    S.subs.forEach((sub, k) => {
      const label = S.subs.length > 1 ? `Einsendung ${k + 1}` : 'Einsendung';
      out.push({ key: 's:' + sub.id, label, ex: T.submissionCase(Object.assign({ label }, sub), S.code), sub: true });
    });
    return out;
  }
  const caseOf = (key) => (key === CUSTOM ? null : cases().find((c) => c.key === key) || null);
  const guess = (key) => T.guessHarness(S.code, (caseOf(key) || {}).ex || null, S.slug);
  const harnessOf = (key) => (S.harness[key] !== undefined ? S.harness[key] : guess(key));
  const expectedFor = (key) => { const c = caseOf(key); return c ? c.ex.output : null; };
  const cmpOpts = () => ({ timed: T.timed(S.slug) });
  const labelOf = (key) => (key === CUSTOM ? 'Eigener Test' : (caseOf(key) || { label: 'Testfall' }).label);

  let saveTimer = null;
  function saveDraft() {
    clearTimeout(saveTimer);
    const harness = {};
    for (const k of Object.keys(S.harness)) if (!k.startsWith('s:') || S.subs.some((x) => 's:' + x.id === k)) harness[k] = S.harness[k];
    saveTimer = setTimeout(() => send({ type: 'saveDraft', slug: S.slug, draft: { harness } }), 400);
  }

  function setHarness(text) {
    if (text === guess(S.sel)) delete S.harness[S.sel]; else S.harness[S.sel] = text;
    saveDraft();
  }

  function statusOf(run, key) {
    if (run.error || run.timedOut) return 'err';
    const c = run.hasResult ? T.compare(run.result, expectedFor(key), cmpOpts()) : null;
    return c === true ? 'ok' : c === false ? 'bad' : 'na';
  }

  async function fetchCode() {
    const r = await ask('getCode');
    if (r.code && r.code.trim()) {
      S.code = r.code;
      S.lang = r.lang || null;
      S.manualNeeded = false;
      return S.code;
    }
    S.manualNeeded = true;
    if (S.manualCode.trim()) { S.code = S.manualCode; return S.code; }
    throw new Error('Der Code im Editor wurde nicht gefunden. Füg ihn unter „Code einfügen“ ein.');
  }

  async function busy(fn) {
    if (S.running) return;
    S.running = true;
    S.open = true;
    stopPlay();
    view();
    try { S.message = null; await fn(); } catch (e) { S.message = e.message; }
    finally { S.running = false; view(); }
  }

  function checkAll() {
    return busy(async () => {
      const code = await fetchCode();
      const all = cases();
      if (!all.length) {
        S.sel = CUSTOM;
        S.sections.harness = true;
        const run = await T.run(code, harnessOf(CUSTOM));
        S.status[CUSTOM] = statusOf(run, CUSTOM);
        S.summary = 'Keine Beispiele im Aufgabentext gefunden – schreib unter „Testaufruf“ einen eigenen.';
        S.allOk = false;
        return setRun(run);
      }
      let firstBad = null;
      for (const c of all) {
        const run = await T.run(code, harnessOf(c.key), { maxRecord: 300 });
        S.status[c.key] = statusOf(run, c.key);
        if (firstBad === null && S.status[c.key] !== 'ok' && S.status[c.key] !== 'na') firstBad = c.key;
      }
      const n = all.length, okCount = all.filter((c) => S.status[c.key] === 'ok').length;
      if (firstBad !== null) S.sel = firstBad;
      else if (S.sel === CUSTOM || !caseOf(S.sel)) S.sel = all[0].key;
      S.allOk = okCount === n;
      const w = S.subs.length ? ['Der Testfall stimmt.', 'Testfälle', 'Testfällen'] : ['Das Beispiel stimmt.', 'Beispiele', 'Beispielen'];
      S.summary = S.allOk ? (n === 1 ? w[0] : `Alle ${n} ${w[1]} stimmen.`) : `${okCount} von ${n} ${w[2]} stimmen.`;
      setRun(await T.run(code, harnessOf(S.sel)));
    });
  }

  function runSelected() {
    return busy(async () => {
      const code = await fetchCode();
      const run = await T.run(code, harnessOf(S.sel));
      S.status[S.sel] = statusOf(run, S.sel);
      S.summary = null;
      S.allOk = false;
      setRun(run);
    });
  }

  function setRun(run) {
    S.run = run;
    S.i = run.error ? Math.max(0, run.steps.length - 1) : 0;
  }

  // ------------------------------------------------------------ Schritte

  function nav(kind) {
    const run = S.run;
    if (!run || !run.steps.length) return;
    const st = run.steps, i = S.i, d = st[i].depth;
    let j = i;
    if (kind === 'first') j = 0;
    else if (kind === 'last') j = st.length - 1;
    else if (kind === 'prev') j = i - 1;
    else if (kind === 'next') j = i + 1;
    else if (kind === 'over') { j = i + 1; while (j < st.length - 1 && st[j].depth > d) j++; }
    else if (kind === 'out') { j = i + 1; while (j < st.length - 1 && st[j].depth >= d) j++; }
    S.i = Math.max(0, Math.min(st.length - 1, j));
  }

  function stopPlay() { if (S.play) { clearInterval(S.play); S.play = null; } }
  function togglePlay() {
    if (S.play) return stopPlay();
    if (!S.run || !S.run.steps.length) return;
    if (S.i >= S.run.steps.length - 1) S.i = 0;
    S.play = setInterval(() => {
      if (S.i >= S.run.steps.length - 1) stopPlay(); else S.i++;
      view();
    }, 650);
  }

  // ------------------------------------------------------------ Aktionen

  function act(m) {
    switch (m.action) {
      case 'check': return checkAll();
      case 'select':
        if (S.running) return;
        S.sel = String(m.key);
        S.sections.harness = S.sel === CUSTOM;
        if (S.sel === CUSTOM && !S.status[CUSTOM]) { S.run = null; S.summary = null; return view(); }
        return runSelected();
      case 'runCase': return runSelected();
      case 'harness': setHarness(String(m.text)); return view(true);
      case 'resetHarness': delete S.harness[S.sel]; saveDraft(); return view();
      case 'manualCode': S.manualCode = String(m.text); return;
      case 'nav': stopPlay(); nav(m.kind); return view();
      case 'go': stopPlay(); if (S.run) S.i = Math.max(0, Math.min(S.run.steps.length - 1, +m.i)); return view();
      case 'play': togglePlay(); return view();
      case 'section': S.sections[m.name] = !S.sections[m.name]; return view();
      case 'continue': {
        // wie F5 in VS Code: bis zum nächsten Haltepunkt, sonst bis zum Ende
        stopPlay();
        if (!S.run || !S.run.steps.length) return;
        const bp = new Set((m.lines || []).map(Number)), st = S.run.steps;
        let j = S.i + 1;
        while (j < st.length - 1 && !((st[j].kind === 'line' || st[j].kind === 'call') && bp.has(st[j].line))) j++;
        S.i = Math.min(j, st.length - 1);
        return view();
      }
      case 'close': stopPlay(); S.open = false; return view();
    }
  }

  // ------------------------------------------------------------ Ansichtsmodell

  function changedVars(i) {
    const st = S.run.steps, s = st[i];
    let prev = null;
    for (let j = i - 1; j >= 0; j--) if (st[j].frame === s.frame && st[j].kind !== 'log') { prev = st[j]; break; }
    const old = new Map((prev ? prev.vars : []).map((v) => [v.name, v.text]));
    const out = new Map();
    for (const v of s.vars) {
      if (s.kind === 'call' && !v.outer) out.set(v.name, null);
      else if (prev && old.has(v.name) && old.get(v.name) !== v.text) out.set(v.name, old.get(v.name));
      else if (prev && !old.has(v.name) && !v.outer) out.set(v.name, null);
    }
    return out;
  }

  const lineText = (n) => (S.run && n ? (S.run.src.split('\n')[n - 1] || '').trim() : '');
  const params = (s) => (s.params.length ? s.params.map((p) => {
    const v = s.vars.find((x) => x.name === p);
    return v ? `${p} = ${v.text}` : p;
  }).join(', ') : 'ohne Argumente');

  function describe(s) {
    switch (s.kind) {
      case 'call': return [`${s.name} wird aufgerufen`, params(s)];
      case 'return': return [`${s.fn || 'Die Funktion'} gibt ${short(s.value, 60)} zurück`, lineText(s.line)];
      case 'line': return [`Als Nächstes: Zeile ${s.line}`, lineText(s.line)];
      case 'log': return ['console.log gibt aus', s.text];
      case 'error': return [`Hier knallt es: ${s.error.name}`, s.error.message];
      case 'timeout': return ['Abgebrochen', 'Ein Promise oder Timer ist nach 4 s noch nicht fertig.'];
      case 'done': return [`Fertig – Ergebnis: ${short(s.value, 60)}`, ''];
    }
    return [s.kind, ''];
  }

  function inlineText(s, chg) {
    switch (s.kind) {
      case 'call': return '→ ' + params(s);
      case 'return': return '← gibt ' + s.value + ' zurück';
      case 'log': return '🖨 ' + s.text;
      case 'error': return '💥 ' + s.error.message;
      case 'done': return '✔ ' + s.value;
    }
    const parts = [];
    for (const v of s.vars) if (chg.has(v.name)) parts.push(`${v.name} = ${v.text}`);
    return parts.join(' · ');
  }

  function verdict() {
    const run = S.run, key = S.sel;
    if (S.message) return { cls: 'bad', title: S.message };
    if (!run) return null;
    const label = labelOf(key), lc = (caseOf(key) || {}).ex;
    const lcNote = lc && lc.leetcode ? lc.leetcode : null;
    const where = (line) => (line ? (line >= run.firstHarnessLine ? ` im Testaufruf (Zeile ${line})` : ` in Zeile ${line}`) : '');
    if (run.error) {
      const e = run.error;
      const what = e.kind === 'syntax' ? 'Syntaxfehler' : e.kind === 'limit' ? 'abgebrochen' : `Fehler (${e.name})`;
      return { cls: 'bad', title: `💥 ${label}: ${what}${where(e.line)}`, detail: e.message, hint: T.hint(e) };
    }
    if (run.timedOut) return { cls: 'bad', title: `⏱ ${label}: nach 4 s abgebrochen`, hint: 'Ein Promise oder Timer wurde nie fertig. Prüf, ob resolve bzw. der Callback überhaupt aufgerufen wird.' };
    if (!run.hasResult) return { cls: '', title: `${label}: kein Ergebnis`, hint: 'Die letzte Zeile im Testaufruf ist kein Ausdruck, deshalb gibt es nichts zu vergleichen.' };
    const exp = expectedFor(key);
    const c = T.compare(run.result, exp, cmpOpts());
    // Lokal richtig, bei LeetCode falsch: Code seitdem geändert, oder Zustand bleibt zwischen Testfällen übrig
    if (c === true && lcNote && lcNote.got != null && T.compare(run.result, lcNote.got, cmpOpts()) === false && lcNote.code && lcNote.code.replace(/\s+/g, '') === S.code.replace(/\s+/g, '')) return {
      cls: 'bad', title: `⚠ ${label}: lokal richtig, bei LeetCode falsch`, rows: [['erwartet', exp], ['LeetCode bekam', short(lcNote.got, 60)]],
      hint: 'Derselbe Code liefert lokal das richtige Ergebnis. Typische Ursache: Variablen außerhalb der Funktion behalten ihren Wert zwischen den Testfällen von LeetCode.',
    };
    if (c === true) return { cls: 'ok', title: S.allOk ? `✅ ${S.summary}` : `✅ ${label} stimmt`, rows: [['Ergebnis', run.resultText]] };
    if (c === false) return {
      cls: 'bad', title: `❌ ${label}: falsches Ergebnis`, rows: [['erwartet', exp], ['bekommen', run.resultText]],
      lead: lcNote ? `Diesen Fall hat LeetCode bei der Einsendung gemeldet (${lcNote.status || 'Fehlschlag'}).` : null,
      hint: 'Spring ans Ende (⏭) und geh mit ◀ rückwärts. Der erste Wert, der nicht deiner Erwartung entspricht, zeigt auf den Fehler.',
    };
    return { cls: '', title: label, rows: [['Ergebnis', run.resultText]].concat(exp ? [['laut Aufgabe', exp]] : []) };
  }

  // Werte neben den Zeilen der aktuellen Funktion, wie die Inline-Werte in VS Code
  function inlineValues(i, curLine) {
    const run = S.run, st = run.steps, s = st[i];
    if (!curLine) return [];
    let from = 1;
    for (let j = i; j >= 0; j--) if (st[j].kind === 'call' && st[j].frame === s.frame) { from = st[j].line; break; }
    const out = [];
    for (let L = from; L < curLine && L < run.firstHarnessLine; L++) {
      const t = lineValues(s, L);
      if (t) out.push([L, t]);
    }
    return out.slice(-60);
  }

  // „name = wert“ für die Variablen, die in Zeile L vorkommen
  function lineValues(s, L) {
    const raw = S.run.src.split('\n')[L - 1] || '';
    if (/^\s*(\*|\/\*)/.test(raw)) return '';
    const code = raw.replace(/\/\/.*$/, '').replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    const vals = new Map(s.vars.map((x) => [x.name, x.text]));
    const seen = new Set(), parts = [];
    for (const m of code.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)) {
      const n = m[0];
      if (seen.has(n) || !vals.has(n)) continue;
      seen.add(n);
      const t = vals.get(n);
      if (/^(function|ƒ|\(|[\w$]+\s*=>|async)/.test(t) && n !== 'fn') continue;   // Funktionen nur kurz bei fn
      parts.push(`${n} = ${short(t, 40)}`);
      if (parts.length >= 4) break;
    }
    return parts.join(', ');
  }

  let viewQueued = false, keepHarness = false;
  function view(fromHarness) {
    keepHarness = keepHarness || !!fromHarness;
    if (viewQueued) return;
    viewQueued = true;
    Promise.resolve().then(() => { viewQueued = false; const k = keepHarness; keepHarness = false; send({ type: 'view', view: build(k) }); });
  }

  function build(fromHarness) {
    const run = S.run;
    const v = {
      open: S.open, running: S.running, slug: S.slug,
      warn: S.lang && !/^(javascript|js)$/i.test(S.lang)
        ? `Im Editor ist „${S.lang}“ eingestellt. Der Debugger kann nur JavaScript ausführen.` : null,
      manualNeeded: S.manualNeeded,
      chips: cases().map((c) => ({ key: c.key, label: c.label, status: S.status[c.key] || null, sub: !!c.sub, input: c.sub ? short(c.ex.input, 60) : null }))
        .concat([{ key: CUSTOM, label: 'Eigener Test', status: S.status[CUSTOM] || null, custom: true }]),
      sel: String(S.sel),
      summary: S.allOk ? null : S.summary,
      verdict: verdict(),
      sections: S.sections,
      playing: !!S.play,
      fromHarness,
      harness: { text: harnessOf(S.sel), edited: S.harness[S.sel] !== undefined },
      caseInfo: (() => {
        const c = caseOf(S.sel);
        return c ? { vars: c.ex.vars.map((x) => [x.name, short(x.value, 140)]), expected: c.ex.output == null ? '–' : short(c.ex.output, 140) } : null;
      })(),
      step: null, vars: [], logs: [], editor: { line: null },
    };
    if (run && run.steps.length) {
      const s = run.steps[S.i], chg = changedVars(S.i);
      const [title, sub] = describe(s);
      v.step = {
        i: S.i, n: run.steps.length, title, sub, kind: s.kind, fn: s.fn,
        where: s.stack && s.stack.length ? s.stack.join(' › ') : 'oberste Ebene',
        stack: (s.stack || []).slice().reverse(),
      };
      v.vars = s.vars.map((x) => ({
        name: x.name, text: short(x.text, 400), outer: x.outer,
        changed: chg.has(x.name), old: chg.has(x.name) && chg.get(x.name) !== null ? short(chg.get(x.name), 120) : null,
      }));
      v.logs = run.logs.map((l) => ({ text: short(l.text, 300), line: l.line, step: run.steps.findIndex((x, i) => i >= l.step && x.kind === 'log') }));
      const inEditor = s.line && s.line < run.firstHarnessLine;
      v.editor = {
        line: inEditor ? s.line : null, error: s.kind === 'error',
        text: short(inlineText(s, chg) || (inEditor ? lineValues(s, s.line) : ''), 140),
        vars: s.vars.map((x) => [x.name, short(x.text, 300)]),
        inline: inlineValues(S.i, inEditor ? s.line : null),
        exception: s.kind === 'error' && inEditor
          ? { line: s.line, title: `${s.error.name}: ${s.error.message}`, hint: T.hint(s.error) } : null,
      };
      v.truncated = run.truncated ? `Nur die ersten ${run.steps.length} von ${run.totalSteps} Schritten aufgezeichnet.` : null;
    }
    return v;
  }

  send({ type: 'ready' });
})();
