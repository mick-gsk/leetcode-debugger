// Kern-Tests Lern-Coach: node test/coach.test.js (aus leetcode-debugger/)
const assert = require('assert');
const C = require('../coach-core.js');

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// ------------------------------------------------------------ Task 1: Wächter

const ok = (txt, code = 'var compose = function(functions) {\n', p = '') => C.guardGhost(txt, code, p).ok;

t('Ghost: Syntax und Gerüste sind erlaubt', () => {
  assert(ok('});'));
  assert(ok('return function(x) {'));
  assert(ok('constructor(capacity) {', 'class LRUCache {\n  constructor(capacity) {}'));
  assert(ok('= {};', 'const memo'));
  assert(ok('= new Map();', 'const seen'));
  assert(ok('tions) {', 'var compose = function(functions', 'func'));
  assert(ok(' * @param {number} n', '/**\n * @param {number} n'));
  assert(ok('this.cache = new Map();', 'class C { constructor() { this.cache } }'));
});

t('Ghost: Logik, neue Namen und Kommentare werden verworfen – mit Grund', () => {
  const code = 'var x, acc, functions, a, b, count, n;';
  for (const bad of ['if (x > 0) {', 'for (let i = 0; i < n; i++) {', 'return acc + x;', 'count++;', 'a && b',
    'x ? 1 : 2', 'functions.reduceRight((acc, fn) => fn(acc), x)', 'const freq = {};', '// zähle die Häufigkeiten',
    '...args', 'a\nb', 'x'.repeat(81), '`${a}`']) {
    const r = C.guardGhost(bad, code, '');
    assert.strictEqual(r.ok, false, bad);
    assert.ok(r.reason, 'Grund fehlt: ' + bad);
  }
});

t('Prosa: Fragen ja, Code nein', () => {
  assert(C.guardProse('Was muss nach jedem Durchlauf in der Variable stehen?').ok);
  assert(C.guardProse('Häufigkeitszählung: Für jedes Zeichen zählst du, wie oft es vorkommt.').ok);
  assert(!C.guardProse('Nutze `arr.reduce((a, b) => a + b)`').ok);
  assert(!C.guardProse('```js\nconst x = 1\n```').ok);
  assert(!C.guardProse('Ruf einfach magazine.split("") auf.').ok);
});

t('Pseudocode: deutsch ja, JS-Syntax nein', () => {
  assert(C.guardPseudo('für jedes Zeichen c in magazine:\n  zähler[c] um 1 erhöhen').ok);
  assert(!C.guardPseudo('for (const c of magazine) {\n  count[c]++;\n}').ok);
  assert(!C.guardPseudo('zähler = new Map(); zähler.set(c, 1);').ok);
});

t('Lesezeit und Code-Hash', () => {
  assert.strictEqual(C.wordCount('  eins zwei\ndrei  vier '), 4);
  assert.strictEqual(C.readMs('eins zwei drei vier'), 1000);
  assert.strictEqual(C.codeHash('a = 1\n\n  b'), C.codeHash('  a = 1\nb  '));
  assert.notStrictEqual(C.codeHash('a = 1'), C.codeHash('a = 2'));
  assert.match(C.codeHash('x'), /^[0-9a-f]+$/);
});

t('Tokenizer erkennt Strings, Kommentare, Operatoren', () => {
  const k = C.tokenize('const s = "a+b"; // x\nx += 1').map((x) => x.type + ':' + x.value);
  assert.deepStrictEqual(k, ['kw:const', 'id:s', 'op:=', 'str:"a+b"', 'punc:;', 'comment:// x', 'id:x', 'op:+=', 'num:1']);
});

// ------------------------------------------------------------ Task 2: Hinweis-Leiter

const att = (s, hash, src = 'debug') => C.ladderAttempt(s, { src, hash });

t('Leiter: L1 gesperrt ohne Versuch', () => {
  const s = C.ladderInit();
  assert.strictEqual(s.level, 0);
  assert.strictEqual(C.ladderCanOpen(s), false);
  assert.deepStrictEqual(C.ladderOpen(s, { escape: false, now: 0 }), { error: 'locked' });
});

t('Leiter: Debug-Lauf schaltet L1 frei', () => {
  const r = att(C.ladderInit(), 'h1');
  assert.strictEqual(r.counted, true);
  const o = C.ladderOpen(r.state, { escape: false, now: 0 });
  assert.strictEqual(o.level, 1);
  assert.strictEqual(o.feedback, null);
  assert.strictEqual(o.state.level, 1);
  assert.strictEqual(o.state.assisted, false);
});

t('Leiter: gleicher Code zählt nicht', () => {
  let s = C.ladderOpen(att(C.ladderInit(), 'h1').state, { escape: false, now: 0 }).state;
  const same = att(s, 'h1');
  assert.strictEqual(same.counted, false);
  assert.deepStrictEqual(C.ladderOpen(same.state, { escape: false, now: 0 }), { error: 'locked' });
  const changed = att(same.state, 'h2');
  assert.strictEqual(changed.counted, true);
  assert.strictEqual(C.ladderOpen(changed.state, { escape: false, now: 0 }).level, 2);
});

t('Leiter: Plan-Satz zählt', () => {
  assert.strictEqual(C.planOk('erst zählen dann vergleichen bitte'), false);
  assert.strictEqual(C.planOk('erst beide Strings zählen, dann vergleichen'), true);
  const r = att(C.ladderInit(), 'plan:abc', 'plan');
  assert.strictEqual(r.counted, true);
  assert.strictEqual(C.ladderOpen(r.state, { escape: false, now: 0 }).level, 1);
});

t('Leiter: Notausgang öffnet sofort', () => {
  const o = C.ladderOpen(C.ladderInit(), { escape: true, now: 0 });
  assert.strictEqual(o.level, 1);
  assert.strictEqual(o.feedback, C.FB_ESCAPE);
  assert.strictEqual(o.state.assisted, true);
  assert.strictEqual(o.state.escapes, 1);
});

t('Leiter: L4 macht assistiert und bleibt bei 4', () => {
  let s = C.ladderInit();
  for (let i = 1; i <= 4; i++) {
    s = att(s, 'h' + i).state;
    const o = C.ladderOpen(s, { escape: false, now: 0 });
    assert.strictEqual(o.level, i);
    s = o.state;
  }
  assert.strictEqual(s.assisted, true);
  s = att(s, 'h5').state;
  const o = C.ladderOpen(s, { escape: false, now: 0 });
  assert.strictEqual(o.level, 4);
  assert.strictEqual(o.state.level, 4);
});

t('Leiter: Schnell-Klick', () => {
  const words = Array(40).fill('wort').join(' ');
  let s = C.ladderOpen(att(C.ladderInit(), 'h1').state, { escape: false, now: 0 }).state;
  s = C.ladderShown(s, { level: 1, text: words, now: 0 });
  assert.deepStrictEqual(s.history, [{ level: 1, text: words }]);
  s = att(s, 'h2').state;
  const fast = C.ladderOpen(s, { escape: false, now: 5000 });
  assert.strictEqual(fast.fast, true);
  assert.strictEqual(fast.feedback, C.FB_FAST);
  const slow = C.ladderOpen(s, { escape: false, now: 11000 });
  assert.strictEqual(slow.fast, false);
  assert.strictEqual(slow.feedback, null);
  // Notausgang und zu schnell: Notausgang-Text, fast bleibt fürs Log
  const both = C.ladderOpen(C.ladderShown(s, { level: 1, text: words, now: 0 }), { escape: true, now: 1000 });
  assert.strictEqual(both.feedback, C.FB_ESCAPE);
  assert.strictEqual(both.fast, true);
});

t('Leiter: Accepted', () => {
  assert.strictEqual(C.ladderAccepted(C.ladderInit()).accepted, true);
});

// ------------------------------------------------------------ Task 3: Prompts und Parser

const sys = (m) => m.find((x) => x.role === 'system').content;
const usr = (m) => m.find((x) => x.role === 'user').content;

t('Prompt L1: kein Code, JSON-Format, Kontext drin', () => {
  const desc = 'Given an array of functions ' + 'x'.repeat(5000);
  const m = C.hintMessages({ level: 1, desc, code: 'var compose = 1;', lastRun: '1 von 3 Beispielen stimmen.', history: [] });
  assert.strictEqual(m.length, 2);
  assert.match(sys(m), /Gib niemals Code/);
  assert.match(sys(m), /\{"text":/);
  assert.match(usr(m), /Given an array of functions/);
  assert.ok(!usr(m).includes('x'.repeat(4001)), 'Aufgabentext gekürzt');
  assert.match(usr(m), /var compose = 1;/);
  assert.match(usr(m), /1 von 3 Beispielen stimmen/);
});

t('Prompt L4: Absicht drin, strict verschärft', () => {
  const m = C.hintMessages({ level: 4, desc: 'd', code: 'c', lastRun: null, history: [{ level: 3, text: 'pseudo' }], intent: 'von rechts nach links anwenden' });
  assert.match(usr(m), /von rechts nach links anwenden/);
  assert.match(usr(m), /pseudo/);
  assert.match(sys(m), /"verdict"/);
  assert.doesNotMatch(sys(m), /Die letzte Antwort enthielt Code/);
  const s = C.hintMessages({ level: 2, desc: 'd', code: 'c', lastRun: null, history: [], strict: true });
  assert.match(sys(s), /Die letzte Antwort enthielt Code/);
});

t('Prompt Ghost: Cursor-Marke einmal, Kontext gekürzt', () => {
  const m = C.ghostMessages({ before: 'a'.repeat(3000) + 'BEFORE_END', after: 'AFTER' });
  const u = usr(m);
  assert.strictEqual(u.split('⟨CURSOR⟩').length, 2);
  assert.ok(u.includes('BEFORE_END⟨CURSOR⟩AFTER'));
  assert.ok(!u.includes('a'.repeat(1991)), 'before auf 2000 Zeichen gekürzt');
});

t('Prompts Selbsterklärung und Review', () => {
  const se = C.selfExplMessages({ desc: 'd', code: 'c', explanation: 'weil O(n)' });
  assert.match(usr(se), /weil O\(n\)/);
  assert.match(sys(se), /"verdict"/);
  for (const kind of ['alt', 'complexity', 'idiom']) assert.ok(usr(C.reviewMessages({ kind, desc: 'd', code: 'c' })).length > 10);
  assert.match(usr(C.reviewMessages({ kind: 'ask', desc: 'd', code: 'c', question: 'Warum Map?' })), /Warum Map\?/);
});

t('Parser: Hinweise', () => {
  assert.deepStrictEqual(C.parseHint('Hier: {"text":"Was zählt?"} danke', 1), { ok: true, text: 'Was zählt?' });
  assert.strictEqual(C.parseHint('kein json', 2).ok, false);
  assert.strictEqual(C.parseHint('', 1).ok, false);
  assert.strictEqual(C.parseHint('{"text":""}', 1).ok, false);
  assert.strictEqual(C.parseHint('{"verdict":"vielleicht","feedback":"x","line":"y"}', 4).ok, false);
  assert.deepStrictEqual(C.parseHint('```json\n{"verdict":"teilweise","feedback":"fast","line":"return x;"}\n```', 4),
    { ok: true, verdict: 'teilweise', feedback: 'fast', line: 'return x;' });
});

t('Parser: Ghost und Selbsterklärung', () => {
  assert.strictEqual(C.parseGhost('```js\n});\n```'), '});');
  assert.strictEqual(C.parseGhost('\n});\n'), '});');
  assert.strictEqual(C.parseGhost('', ''), '');
  assert.strictEqual(C.parseGhost('}', '}'), '');   // nur Wiederholung dessen, was schon dasteht
  assert.deepStrictEqual(C.parseSelfExpl('{"verdict":"stimmt","feedback":"genau"}'), { ok: true, verdict: 'stimmt', feedback: 'genau' });
  assert.strictEqual(C.parseSelfExpl('{"verdict":"x"}').ok, false);
});

// ------------------------------------------------------------ Task 4: API-Karten

t('API-Karten: reduce und sort', () => {
  const A = require('../coach-api.js');
  const names = A.lookup('red').map((e) => e.name);
  assert.deepStrictEqual(names.slice(0, 2), ['reduce', 'reduceRight']);
  const reduce = A.byName('reduce')[0];
  assert.strictEqual(reduce.sig, 'reduce(callback(acc, x, i, arr), init)');
  assert.strictEqual(reduce.mutates, false);
  assert.match(reduce.pitfall, /Startwert/);
  const sort = A.byName('sort')[0];
  assert.match(sort.pitfall, /als Text/);
  assert.strictEqual(sort.mutates, true);
});

t('API-Karten: Umfang und Pflichtfelder', () => {
  const A = require('../coach-api.js');
  assert.ok(A.API.length >= 70, 'nur ' + A.API.length);
  for (const e of A.API) for (const k of ['name', 'owner', 'sig', 'returns', 'pitfall']) assert.ok(String(e[k] || '').trim(), e.name + '.' + k);
  assert.strictEqual(A.lookup('', 4).length, 0);
  assert.strictEqual(A.lookup('zzz').length, 0);
  assert.ok(A.lookup('s', 4).length <= 4);
  assert.strictEqual(A.lookup('SORT')[0].name, 'sort');   // exakter Treffer zuerst, Groß/klein egal
});

// ------------------------------------------------------------ Abschluss-Review: Lücken im Wächter und in der Leiter

t('Review C1: angefangenes Wort umgeht den Wächter nicht', () => {
  const code = (head) => 'var twoSum = function(nums, target) {\n  const seen = new Map();\n  let left, right, need;\n  ' + head;
  const cases = [['seen.se', 't(num, i)'], ['seen.ha', 's(need)'], ['nums.le', 'ngth'], ['re', 'turn [seen, need]'],
    ['whi', 'le (left) {'], ['swi', 'tch (num) {'], ['el', 'se {'], ['br', 'eak;']];
  for (const [head, txt] of cases) {
    const partial = head.split('.').pop();
    const r = C.guardGhost(txt, code(head), partial);
    assert.strictEqual(r.ok, false, head + '|' + txt);
  }
  // legitime Fortsetzung eines neuen Namens bleibt erlaubt
  assert.ok(C.guardGhost('nt = 0;', 'let cou', 'cou').ok);
});

t('Review I1: Anweisungen aus bekannten Namen sind Logik', () => {
  const code = 'var f = function(nums, target) { const seen = new Map(); let left, right, need, i, num;';
  for (const bad of ['seen[num] = i', '[nums[left], nums[right]] = [nums[right], nums[left]]', 'need = nums[i]', 'left = right',
    'f(nums, need)', 'return (need), () => 0', '(acc, x) => acc + x', 'const n = target;'])
    assert.strictEqual(C.guardGhost(bad, code, '').ok, false, bad);
  for (const good of ['(acc, x) => {', 'left = 0;', 'need = [];', 'return function(x) {', 'return (x) => {'])
    assert.ok(C.guardGhost(good, code, '').ok, good);
});

t('Review M10: JSDoc nur Tags mit Typ und Name', () => {
  const doc = '/**\n';
  assert.ok(C.guardGhost(' * @param {number[]} nums', doc, '').ok);
  assert.ok(C.guardGhost(' * @return {number}', doc, '').ok);
  assert.ok(C.guardGhost(' */', doc, '').ok);
  assert.strictEqual(C.guardGhost(' * @return {number} zähle erst, dann vergleiche', doc, '').ok, false);
  assert.strictEqual(C.guardGhost(' * benutze eine Map für die Häufigkeiten', doc, '').ok, false);
});

t('Review I2: Plan-Satz zählt nur für Stufe 1', () => {
  let s = C.ladderOpen(C.ladderAttempt(C.ladderInit(), { src: 'plan', hash: 'plan:a' }).state, { escape: false, now: 0 }).state;
  const r = C.ladderAttempt(s, { src: 'plan', hash: 'plan:b' });
  assert.strictEqual(r.counted, false);
  assert.strictEqual(C.ladderCanOpen(r.state), false);
  assert.strictEqual(C.ladderAttempt(s, { src: 'debug', hash: 'h1' }).counted, true);
});

t('Review I6: L4-Zeile ist genau eine Zeile, Rückmeldung ohne Codeblock', () => {
  const j = (o) => JSON.stringify(Object.assign({ verdict: 'stimmt', feedback: 'Genau.', line: 'return x;' }, o));
  assert.ok(C.parseHint(j({}), 4).ok);
  assert.strictEqual(C.parseHint(j({ line: 'const a = 1;\nreturn a;' }), 4).ok, false);
  assert.strictEqual(C.parseHint(j({ line: 'x'.repeat(161) }), 4).ok, false);
  assert.strictEqual(C.parseHint(j({ feedback: 'So:\n```js\nreturn 1;\n```' }), 4).ok, false);
});

t('Review M1: Komplexität und Plural-Klammern sind Prosa', () => {
  assert.ok(C.guardProse('Häufigkeitszählung bringt dich von O(n²) auf O(n).').ok);
  assert.ok(C.guardProse('Merke dir die Element(e), die du schon gesehen hast.').ok);
  assert.strictEqual(C.guardProse('Ruf einfach magazine.split("") auf.').ok, false);
});

t('Review M3: Versuche während einer Anfrage gehen nicht verloren', () => {
  const before = C.ladderAttempt(C.ladderInit(), { src: 'debug', hash: 'h1' }).state;
  const opened = C.ladderOpen(before, { escape: false, now: 0 }).state;
  const after = C.ladderShown(opened, { level: 1, text: 'Frage?', now: 1 });
  // während der Anfrage: neuer Lauf mit h2 und Accepted
  const fresh = C.ladderAccepted(C.ladderAttempt(before, { src: 'debug', hash: 'h2' }).state);
  const m = C.ladderApply(fresh, before, after);
  assert.strictEqual(m.level, 1);
  assert.strictEqual(m.lastHash, 'h2');
  assert.strictEqual(m.sinceHint, 1);
  assert.strictEqual(m.accepted, true);
  assert.deepStrictEqual(m.history, [{ level: 1, text: 'Frage?' }]);
});

(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n     ', e.message); }
  }
  console.log(`\n${tests.length - fail}/${tests.length} bestanden`);
  process.exit(fail ? 1 : 0);
})();
