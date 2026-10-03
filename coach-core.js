/* Lern-Coach, reine Logik ohne DOM: Wächter (was ein Vorschlag/Hinweis enthalten darf), die
 * Hinweis-Leiter als Zustandsautomat, Prompts und Antwort-Parser. Läuft in der Hauptwelt der
 * LeetCode-Seite (coach.js) und in Node (test/coach.test.js). Begründung der Regeln:
 * docs/2026-10-03-lerncoach-design.md. */
(() => {
  'use strict';

  // Schwellen sind gesetzt, nicht belegt (siehe Spec, „Annahmen“)
  const CONST = {
    PAUSE_MS: 1500, PLAN_MIN_WORDS: 6, INTENT_MIN_WORDS: 3, WORDS_PER_SEC: 4, GHOST_MAX_CHARS: 80,
    GHOST_BEFORE_CHARS: 2000, GHOST_AFTER_CHARS: 600, DESC_MAX_CHARS: 4000,
  };

  // ------------------------------------------------------------ Tokenizer (klein, reicht für eine Zeile)

  const KW = new Set(('break case catch class const continue debugger default delete do else export extends finally for ' +
    'function if import in instanceof new return super switch this throw try typeof var void while with yield let async ' +
    'await of null true false').split(' '));
  const OPS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=',
    '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
    '+', '-', '*', '/', '%', '<', '>', '=', '!', '~', '&', '|', '^', '?', ':'];
  const ID = /^[\p{L}_$][\p{L}\p{N}_$]*/u;

  function tokenize(src) {
    const out = [];
    let s = String(src);
    while (s.length) {
      const ws = s.match(/^\s+/);
      if (ws) { s = s.slice(ws[0].length); continue; }
      let m;
      if ((m = s.match(/^\/\/[^\n]*/) || s.match(/^\/\*[\s\S]*?(\*\/|$)/))) out.push({ type: 'comment', value: m[0] });
      else if ((m = s.match(/^`(?:\\[\s\S]|[^`\\])*`?/))) out.push({ type: 'tpl', value: m[0] });
      else if ((m = s.match(/^"(?:\\.|[^"\\\n])*"?/) || s.match(/^'(?:\\.|[^'\\\n])*'?/))) out.push({ type: 'str', value: m[0] });
      else if ((m = s.match(/^(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?n?|\.\d+)/))) out.push({ type: 'num', value: m[0] });
      else if ((m = s.match(ID))) out.push({ type: KW.has(m[0]) ? 'kw' : 'id', value: m[0] });
      else {
        const op = OPS.find((o) => s.startsWith(o));
        if (op) m = [op], out.push({ type: 'op', value: op });
        else m = [s[0]], out.push({ type: 'punc', value: s[0] });
      }
      s = s.slice(m[0].length);
    }
    return out;
  }

  // ------------------------------------------------------------ Wächter

  const NO_FLOW = new Set('if else for while do switch case break continue try catch finally throw yield typeof instanceof delete in of void'.split(' '));
  const OK_OPS = new Set(['=', '=>']);
  const BUILTINS = new Set('Map Set Array Object String Number Boolean Infinity NaN undefined null true false this arguments'.split(' '));
  const no = (reason) => ({ ok: false, reason });

  // Steht der Cursor in einem offenen JSDoc-Block (/** … ohne */)?
  const inJsDoc = (code) => code.lastIndexOf('/**') > code.lastIndexOf('*/');
  const JSDOC_OK = /^\s*\*\s*(@(param|returns?)\s*\{[^}]*\}\s*([\p{L}_$][\p{L}\p{N}_$]*)?)?\s*$|^\s*\*\/\s*$/u;

  // Index der passenden ) zu tk[i] = '(' (oder tk.length, wenn sie fehlt)
  function closing(tk, i) {
    let depth = 0;
    for (let j = i; j < tk.length; j++) {
      if (tk[j].value === '(') depth++;
      else if (tk[j].value === ')' && --depth === 0) return j;
    }
    return tk.length;
  }
  const is = (x, v) => !!x && x.value === v;
  const end = (x) => !x || x.value === ';' || x.value === ',';

  // Was rechts von = stehen darf: Literal, leeres []/{}, new Builtin(), Funktions- oder Pfeil-Kopf
  function rhsOk(tk, j) {
    const a = tk[j], b = tk[j + 1], c = tk[j + 2], d = tk[j + 3];
    if (!a) return true;
    if (a.type === 'num' || a.type === 'str' || (a.type === 'tpl' && !a.value.includes('${')) ||
      ['true', 'false', 'null', 'undefined', 'Infinity', 'NaN'].includes(a.value)) return end(b);
    if ((is(a, '[') && is(b, ']')) || (is(a, '{') && is(b, '}'))) return end(c);
    if (is(a, '{')) return !b;
    if (is(a, 'new') && b && BUILTINS.has(b.value) && is(c, '(')) return !d || (is(d, ')') && end(tk[j + 4]));
    if (is(a, 'function') || is(a, 'async')) return true;
    if (is(a, '(')) return is(tk[closing(tk, j) + 1], '=>');
    return a.type === 'id' && is(b, '=>');
  }

  // Positivliste: Syntax und Gerüste ja, Logik nein. Das angefangene Wort wird mitgeprüft
  // (sonst schmuggelt „seen.se|“ + „t(num, i)“ einen Methodenaufruf durch).
  function guardGhost(text, code, partial) {
    const t = String(text || '').replace(/\n+$/, '');
    code = String(code || '');
    partial = String(partial || '');
    if (!t.trim()) return no('leer');
    if (t.includes('\n')) return no('mehrzeilig');
    if (t.length > CONST.GHOST_MAX_CHARS) return no('zu lang');
    if (/^\s*\*/.test(t) && inJsDoc(code)) return JSDOC_OK.test(t) ? { ok: true } : no('Kommentar');
    const head = partial && code.endsWith(partial) ? code.slice(0, code.length - partial.length) : code;
    if (partial && /\.\s*$/.test(head) && !/\bthis\.\s*$/.test(head)) return no('Member-Zugriff');
    const tk = tokenize(partial + t), known = new Set(tokenize(head).filter((x) => x.type === 'id').map((x) => x.value));
    const params = [];
    for (let i = 0; i < tk.length; i++) {
      const x = tk[i], prev = tk[i - 1], next = tk[i + 1];
      if (x.type === 'comment') { if (!/^\/\*\*$/.test(x.value)) return no('Kommentar'); continue; }
      if (x.type === 'kw' && NO_FLOW.has(x.value)) return no('Kontrollfluss: ' + x.value);
      if (x.type === 'op' && x.value === '...') return no('Spread');
      if (x.type === 'op' && !OK_OPS.has(x.value)) return no('Operator: ' + x.value);
      if (x.type === 'tpl' && x.value.includes('${')) return no('Template mit Ausdruck');
      if (is(x, '.') && !is(prev, 'this')) return no('Member-Zugriff');
      if (is(x, '[') && !is(prev, '=')) return no('Index-/Array-Ausdruck');
      if (is(x, '=') && !rhsOk(tk, i + 1)) return no('Zuweisung mit Logik');
      if (is(x, '=>') && next && !is(next, '{')) return no('Pfeilfunktion mit Ausdruck');
      if (is(x, 'return') && next && !(is(next, ';') || is(next, '}') || is(next, 'function') || is(next, 'async') ||
        (is(next, '(') && is(tk[closing(tk, i + 1) + 1], '=>')) || (next.type === 'id' && is(tk[i + 2], '=>')))) return no('return mit Ausdruck');
      if (is(x, '(')) {
        const j = closing(tk, i), after = tk[j + 1];
        const decl = is(prev, 'function') || (prev && prev.type === 'id' && is(tk[i - 2], 'function')) ||
          is(after, '=>') || (prev && prev.type === 'id' && i === 1 && (is(after, '{') || j === tk.length));
        const ctor = prev && BUILTINS.has(prev.value) && is(tk[i - 2], 'new');
        if (!decl && !ctor) return no('Aufruf');
        if (decl) params.push([i, j]);
      }
      if (x.type === 'id' && !known.has(x.value) && !BUILTINS.has(x.value) &&
        !params.some(([a, b]) => i > a && i < b) && !is(prev, '.') &&
        !(i === 0 && partial.length >= 2 && x.value.startsWith(partial))) {
        // Parameter einer Pfeilfunktion ohne Klammern: x => {
        if (!(is(next, '=>'))) return no('neuer Name: ' + x.value);
      }
    }
    return { ok: true };
  }

  const CODE_CALL = /[\p{L}\p{N}_$]\(/u;
  function guardProse(text) {
    const t = String(text || '');
    if (!t.trim()) return no('leer');
    if (/`/.test(t)) return no('Code-Markierung');
    if (/=>/.test(t)) return no('Pfeilfunktion');
    if (/;\s*$/m.test(t)) return no('Semikolon');
    if (/\b(const|let|var)\s+[\p{L}_$]/u.test(t)) return no('Deklaration');
    // O(n)-Schreibweise und Plural-Klammern wie Element(e) sind Prosa
    if (CODE_CALL.test(t.replace(/\bO\([^)]*\)/g, '').replace(/\p{L}\((e|n|en|s|es|er|r)\)/gu, ''))) return no('Funktionsaufruf');
    return { ok: true };
  }

  function guardPseudo(text) {
    const t = String(text || '');
    if (!t.trim()) return no('leer');
    if (/`/.test(t)) return no('Code-Markierung');
    if (/=>/.test(t)) return no('Pfeilfunktion');
    if (/[{}]\s*$/m.test(t)) return no('Block-Klammer');
    if (/;/.test(t)) return no('Semikolon');
    if (/\+\+|--/.test(t)) return no('++/--');
    if (/\b(const|let|var)\s/.test(t)) return no('Deklaration');
    if (/\.[\p{L}_$][\p{L}\p{N}_$]*\(/u.test(t)) return no('Methodenaufruf');
    return { ok: true };
  }

  // ------------------------------------------------------------ Kleinkram

  const wordCount = (text) => String(text || '').split(/\s+/).filter(Boolean).length;
  const readMs = (text) => (wordCount(text) * 1000) / CONST.WORDS_PER_SEC;

  function codeHash(code) {
    const s = String(code || '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  // ------------------------------------------------------------ Hinweis-Leiter
  // Stufen öffnen nur durch einen eigenen Versuch (oder den Notausgang), nie durch Zeit.

  const FB_ESCAPE = 'Ohne eigenen Versuch – kommt in die Wiedervorlage.';
  const FB_FAST = 'Zu schnell gelesen? Erst probieren, dann die nächste Stufe.';

  const ladderInit = () => ({
    level: 0, sinceHint: 0, lastHash: null, lastPlan: null, assisted: false, escapes: 0, accepted: false,
    shownAt: null, shownText: '', history: [],
  });
  const planOk = (text) => wordCount(text) >= CONST.PLAN_MIN_WORDS;

  // Ein Lauf zählt nur mit geändertem Code. Ein Plan-Satz zählt nur für Stufe 1 – ab dann braucht
  // jede Stufe einen Lauf mit geändertem Code (Spec).
  function ladderAttempt(s, a) {
    if (a.src === 'plan' && s.level > 0) return { state: s, counted: false };
    const key = a.src === 'plan' ? 'lastPlan' : 'lastHash';
    if (s[key] === a.hash) return { state: s, counted: false };
    return { state: Object.assign({}, s, { [key]: a.hash, sinceHint: s.sinceHint + 1 }), counted: true };
  }

  const ladderCanOpen = (s) => s.sinceHint >= 1;

  function ladderOpen(s, o) {
    if (!o.escape && !ladderCanOpen(s)) return { error: 'locked' };
    const level = Math.min(s.level + 1, 4);
    const fast = s.shownAt != null && o.now - s.shownAt < readMs(s.shownText);
    const state = Object.assign({}, s, {
      level, sinceHint: 0, assisted: s.assisted || !!o.escape || level === 4, escapes: s.escapes + (o.escape ? 1 : 0),
    });
    return { state, level, fast, feedback: o.escape ? FB_ESCAPE : fast ? FB_FAST : null };
  }

  const ladderShown = (s, h) => Object.assign({}, s, {
    shownAt: h.now, shownText: h.text, history: s.history.concat([{ level: h.level, text: h.text }]),
  });
  const ladderAccepted = (s) => Object.assign({}, s, { accepted: true });

  // Ergebnis einer Hinweis-Anfrage auf den inzwischen gespeicherten Zustand legen: Versuche und
  // Accepted, die während der Anfrage kamen, bleiben erhalten.
  function ladderApply(fresh, before, after) {
    return Object.assign({}, fresh, {
      level: after.level, assisted: fresh.assisted || after.assisted, escapes: fresh.escapes + (after.escapes - before.escapes),
      sinceHint: after.sinceHint + Math.max(0, fresh.sinceHint - before.sinceHint),
      shownAt: after.shownAt, shownText: after.shownText, history: after.history, last: after.last,
    });
  }

  // ------------------------------------------------------------ Prompts
  // Deutsch, kurz, je Stufe festgelegt. Die Stufen folgen der Hinweis-Leiter der Spec.

  const msgs = (system, user) => [{ role: 'system', content: system }, { role: 'user', content: user }];
  const cut = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + ' …' : String(s || ''));
  const CURSOR = '⟨CURSOR⟩';

  function ghostMessages(o) {
    const before = String(o.before || '').slice(-CONST.GHOST_BEFORE_CHARS);
    const after = String(o.after || '').slice(0, CONST.GHOST_AFTER_CHARS);
    return msgs(
      'Du vervollständigst JavaScript an der Stelle ' + CURSOR + '. Gib NUR den einzufügenden Text zurück, ohne Erklärung, ' +
      'ohne Codezaun, höchstens eine Zeile. Erlaubt ist nur Syntax und Boilerplate: Klammern schließen, Signaturen, ' +
      'Parameterlisten, Deklarationen bereits vorhandener Namen, leere Initialisierungen wie {} oder [] oder new Map(), JSDoc-Tags. ' +
      'Verboten: Bedingungen, Schleifen, Rechenlogik, Methodenaufrufe, neue Variablennamen, Kommentare mit Erklärungen. ' +
      'Wenn nichts davon passt, gib einen leeren Text zurück. Der Nutzer lernt und soll die Logik selbst schreiben.',
      before + CURSOR + after);
  }

  const LEVELS = {
    1: ['Leitfrage', 'Stelle GENAU EINE sokratische Frage, die den Nutzer auf den nächsten Engpass in seinem vorhandenen Code lenkt. ' +
      'Verrate weder Lösung noch Konzeptnamen. Antworte als JSON: {"text": "<Frage>"}'],
    2: ['Konzept', 'Benenne das Muster oder Konzept, das hier weiterhilft (z. B. Häufigkeitszählung, zwei Zeiger, Closure), ' +
      'und begründe in höchstens drei Sätzen, warum es zu dieser Aufgabe passt. Keine Schritte, keine Methodennamen. ' +
      'Antworte als JSON: {"text": "<Konzept und Begründung>"}'],
    3: ['Pseudocode', 'Schreibe deutschen Pseudocode für den Lösungsweg, eine Zeile pro Schritt, jede Zeile mit kurzer Erklärung ' +
      'nach einem Gedankenstrich. Keine JavaScript-Syntax: keine Semikolons, keine geschweiften Klammern, keine Methodenaufrufe ' +
      'mit Punkt, kein const/let/var, kein => und kein ++. Antworte als JSON: {"text": "<Pseudocode>"}'],
    4: ['Nächste Zeile', 'Der Nutzer beschreibt, was seine nächste Codezeile tun soll. Bewerte zuerst diese Absicht ' +
      '(stimmt / teilweise / nein) mit einer kurzen Begründung, dann gib GENAU die eine nächste JavaScript-Zeile, die zu seinem ' +
      'Code passt – nicht die ganze Lösung. Antworte als JSON: {"verdict": "stimmt|teilweise|nein", "feedback": "<Begründung>", "line": "<eine Zeile>"}'],
  };

  function hintMessages(o) {
    const [name, task] = LEVELS[o.level];
    const system = 'Du bist ein Programmier-Tutor für jemanden, der LeetCode-Aufgaben in JavaScript übt. ' +
      'Ziel ist, dass er lernt, nicht dass die Aufgabe schnell gelöst ist. ' +
      (o.level < 4 ? 'Gib niemals Code, auch keine einzelnen Ausdrücke oder Methodennamen. ' : '') +
      `Stufe ${o.level} von 4 (${name}): ${task} Antworte auf Deutsch, nur mit dem JSON.` +
      (o.strict ? ' Die letzte Antwort enthielt Code oder JavaScript-Syntax und wurde verworfen. Formuliere rein in Worten.' : '');
    const hist = (o.history || []).map((h) => `Stufe ${h.level}: ${h.text}`).join('\n');
    const user = `Aufgabe:\n${cut(o.desc, CONST.DESC_MAX_CHARS)}\n\nSein aktueller Code:\n${o.code || ''}\n\n` +
      `Letztes Testergebnis: ${o.lastRun || 'noch keins'}\n\n` +
      (hist ? `Bisherige Hinweise:\n${hist}\n\n` : '') +
      (o.level === 4 ? `Seine Absicht für die nächste Zeile: ${o.intent || ''}` : 'Gib den Hinweis dieser Stufe.');
    return msgs(system, user);
  }

  function selfExplMessages(o) {
    return msgs(
      'Jemand hat eine LeetCode-Aufgabe in JavaScript gelöst und erklärt in einem Satz, warum seine Lösung korrekt ist ' +
      'und welche Laufzeit sie hat. Prüfe die Erklärung kurz und ehrlich, korrigiere Fehler (besonders bei der Laufzeit). ' +
      'Höchstens drei Sätze, Deutsch. Antworte als JSON: {"verdict": "stimmt|teilweise|nein", "feedback": "<Rückmeldung>"}',
      `Aufgabe:\n${cut(o.desc, CONST.DESC_MAX_CHARS)}\n\nSeine Lösung:\n${o.code || ''}\n\nSeine Erklärung: ${o.explanation || ''}`);
  }

  const REVIEW = {
    alt: 'Zeig eine andere, deutlich verschiedene Lösung und erkläre den Unterschied in Laufzeit und Idee.',
    complexity: 'Erkläre Zeit- und Speicherkomplexität seiner Lösung Schritt für Schritt.',
    idiom: 'Was an seiner Lösung ist unidiomatisch oder umständlich? Zeig die idiomatischere Form.',
  };
  function reviewMessages(o) {
    return msgs(
      'Du bist ein Code-Reviewer für jemanden, der LeetCode übt. Die Aufgabe ist bereits gelöst und akzeptiert; jetzt darfst du frei ' +
      'Code zeigen und erklären. Deutsch, knapp, Markdown mit ```js-Codeblöcken.',
      `Aufgabe:\n${cut(o.desc, CONST.DESC_MAX_CHARS)}\n\nSeine Lösung:\n${o.code || ''}\n\n` +
      (o.kind === 'ask' ? `Seine Frage: ${o.question || ''}` : REVIEW[o.kind]));
  }

  // ------------------------------------------------------------ Parser

  function firstJson(raw) {
    const s = String(raw || ''), a = s.indexOf('{');
    if (a < 0) return null;
    // vom ersten { bis zur passenden } (Strings beachten)
    let depth = 0, inStr = false, esc = false;
    for (let i = a; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(a, i + 1)); } catch (e) { return null; } }
    }
    return null;
  }
  const str = (v) => typeof v === 'string' && v.trim() ? v.trim() : null;
  const VERDICTS = new Set(['stimmt', 'teilweise', 'nein']);

  function parseHint(raw, level) {
    const j = firstJson(raw);
    if (!j) return { ok: false };
    if (level < 4) return str(j.text) ? { ok: true, text: str(j.text) } : { ok: false };
    if (!VERDICTS.has(j.verdict) || !str(j.feedback) || !str(j.line)) return { ok: false };
    // genau eine Zeile, sonst wäre es die Lösung; die Rückmeldung ohne Codeblock
    if (/\n/.test(str(j.line)) || str(j.line).length > 160 || /```/.test(j.feedback)) return { ok: false };
    return { ok: true, verdict: j.verdict, feedback: str(j.feedback), line: str(j.line) };
  }

  function parseSelfExpl(raw) {
    const j = firstJson(raw);
    return j && VERDICTS.has(j.verdict) && str(j.feedback) ? { ok: true, verdict: j.verdict, feedback: str(j.feedback) } : { ok: false };
  }

  function parseGhost(raw, after) {
    let s = String(raw || '').replace(/^\s*```[\w-]*\n?/, '').replace(/\n?```\s*$/, '');
    s = s.replace(/^\n+|\n+$/g, '').replace(CURSOR, '');
    if (after != null && s.trim() && String(after).trimStart().startsWith(s.trim())) return '';
    return s;
  }

  const api = {
    CONST, tokenize, guardGhost, guardProse, guardPseudo, wordCount, readMs, codeHash,
    FB_ESCAPE, FB_FAST, ladderInit, planOk, ladderAttempt, ladderCanOpen, ladderOpen, ladderShown, ladderAccepted, ladderApply,
    ghostMessages, hintMessages, selfExplMessages, reviewMessages, parseGhost, parseHint, parseSelfExpl,
  };
  if (typeof window !== 'undefined') window.LCDBG_COACH_CORE = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})();
