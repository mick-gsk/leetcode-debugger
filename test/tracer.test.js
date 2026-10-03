// Kern-Tests: node test/tracer.test.js (aus leetcode-debugger/)
const assert = require('assert');
const T = require('../tracer.js');

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const COMPOSE = `/**
 * @param {Function[]} functions
 * @return {Function}
 */
var compose = function(functions) {
    return function(x) {
        return functions.reduceRight((acc, fn) => fn(acc), x);
    }
};
`;
const DESC = `Example 1:
Input: functions = [x => x + 1, x => x * x, x => 2 * x], x = 4
Output: 65
Explanation:
Evaluating from right to left ...
Example 2:
Input: functions = [x => 10 * x, x => 10 * x, x => 10 * x], x = 1
Output: 1000
Example 3:
Input: functions = [], x = 42
Output: 42
Explanation:
The composition of zero functions is the identity function
Constraints:`;

t('Beispiele werden aus dem Aufgabentext gelesen', () => {
  const ex = T.parseExamples(DESC);
  assert.strictEqual(ex.length, 3);
  assert.deepStrictEqual(ex[0].vars, [{ name: 'functions', value: '[x => x + 1, x => x * x, x => 2 * x]' }, { name: 'x', value: '4' }]);
  assert.strictEqual(ex[1].output, '1000');
});

t('Beispiele auch ohne Zeilenumbrüche (GraphQL-HTML als Text)', () => {
  const ex = T.parseExamples('Example 1:Input: nums = [2,7,11,15], target = 9Output: [0,1]Explanation: weil…Example 2:Input: nums = [3,2,4], target = 6Output: [1,2]Constraints:');
  assert.strictEqual(ex.length, 2);
  assert.deepStrictEqual(ex[1].vars.map((v) => v.name), ['nums', 'target']);
  assert.strictEqual(ex[1].output, '[1,2]');
});

t('Testaufruf für Funktion, die eine Funktion zurückgibt', async () => {
  for (const ex of T.parseExamples(DESC)) {
    const h = T.guessHarness(COMPOSE, ex);
    assert.match(h, /compose\(functions\)\(x\);/);
    const r = await T.run(COMPOSE, h);
    assert.strictEqual(r.error, null);
    assert.strictEqual(T.compare(r.result, ex.output), true, `Beispiel ${ex.n}`);
  }
});

t('Schritte: Aufruf, Rückgabe, Variablen, Closure', async () => {
  const ex = T.parseExamples(DESC)[0];
  const r = await T.run(COMPOSE, T.guessHarness(COMPOSE, ex));
  const cb = r.steps.filter((s) => s.kind === 'call' && s.fn === 'reduceRight-Callback');
  assert.strictEqual(cb.length, 3);
  assert.deepStrictEqual(cb.map((s) => s.vars.find((v) => v.name === 'acc').text), ['4', '8', '64']);
  assert.strictEqual(cb[0].vars.find((v) => v.name === 'fn').text, 'x => 2 * x');
  assert.ok(cb[0].vars.find((v) => v.name === 'x').outer, 'x aus der äußeren Funktion ist Closure');
  const rets = r.steps.filter((s) => s.kind === 'return' && s.fn === 'reduceRight-Callback').map((s) => s.value);
  assert.deepStrictEqual(rets, ['8', '64', '65']);
  assert.strictEqual(r.steps[r.steps.length - 1].kind, 'done');
  assert.ok(r.steps.every((s) => s.line >= 1));
  // Zeilennummern = Originalzeilen
  assert.ok(cb.every((s) => s.line === 7));
});

t('Instrumentierter Code behält Zeilenzahl', () => {
  const src = COMPOSE + 'compose([])(1)\n';
  assert.strictEqual(T.instrument(src).code.split('\n').length, src.split('\n').length);
});

t('Laufzeitfehler mit Zeile und Hinweis', async () => {
  const sol = `var f = function(a) {
  let s = 0;
  for (let i = 0; i <= a.length; i++) {
    s += a[i].v;
  }
  return s;
};`;
  const r = await T.run(sol, 'f([{v:1},{v:2}]);');
  assert.ok(r.error);
  assert.strictEqual(r.error.line, 4);
  assert.match(r.error.message, /undefined/);
  assert.match(T.hint(r.error), /undefined/);
  const last = r.steps[r.steps.length - 1];
  assert.strictEqual(last.kind, 'error');
  assert.strictEqual(last.vars.find((v) => v.name === 'i').text, '2');
});

t('Syntaxfehler mit Zeile', async () => {
  const r = await T.run('var f = function(a) {\n  return a +;\n};', 'f(1);');
  assert.strictEqual(r.error.kind, 'syntax');
  assert.strictEqual(r.error.line, 2);
});

t('Endlosschleife wird abgebrochen (auch mit leerem Block)', async () => {
  for (const body of ['while (true) {}', 'for (;;);', 'let i = 0; while (i < 10) { i + 1; }']) {
    const r = await T.run(`var f = function() { ${body} };`, 'f();', { maxSteps: 20000 });
    assert.strictEqual(r.error && r.error.kind, 'limit', body);
  }
});

t('Unendliche Rekursion wird gemeldet', async () => {
  const r = await T.run('var f = function(n) { return f(n - 1); };', 'f(3);', { maxRecord: 200 });
  assert.ok(r.error);
  assert.ok(/call stack|Schritte/.test(r.error.message));
  assert.ok(r.truncated);
});

t('console.log landet in der Ausgabe und im Verlauf', async () => {
  const r = await T.run('var f = function(a) {\n  console.log("a ist", a, [1, 2]);\n  return a * 2;\n};', 'f(21);');
  assert.deepStrictEqual(r.logs.map((l) => l.text), ['a ist 21 [1, 2]']);
  assert.strictEqual(r.logs[0].line, 2);
  assert.ok(r.steps.some((s) => s.kind === 'log'));
  assert.strictEqual(r.resultText, '42');
});

t('Async: Promise, setTimeout, await', async () => {
  const sol = `/**
 * @param {number} millis
 * @return {Promise}
 */
async function sleep(millis) {
  await new Promise(res => setTimeout(res, millis));
  return millis;
}`;
  const r = await T.run(sol, 'sleep(30);');
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.result, 30);
});

t('Timer-Callbacks laufen zu Ende (debounce)', async () => {
  const sol = `var debounce = function(fn, t) {
  let id;
  return function(...args) {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), t);
  };
};`;
  const r = await T.run(sol, 'const out = [];\nconst d = debounce(x => out.push(x), 20);\nd(1); d(2);\nsetTimeout(() => d(3), 50);\nout;');
  assert.strictEqual(r.error, null);
  assert.deepStrictEqual(r.result, [2, 3]);
});

t('Endlos-Intervall wird nach Zeitlimit beendet', async () => {
  const r = await T.run('var f = function() { setInterval(() => {}, 5); return 1; };', 'f();', { timeout: 150 });
  assert.ok(r.timedOut);
  assert.strictEqual(r.result, 1);
});

t('Array.prototype-Aufgabe', async () => {
  const sol = `/**
 * @return {null|boolean|number|string|Array|Object}
 */
Array.prototype.last = function() {
    return this.length ? this[this.length - 1] : -1;
};`;
  const ex = T.parseExamples('Input: nums = [null, {}, 3]\nOutput: 3\nExplanation: x')[0];
  const h = T.guessHarness(sol, ex);
  assert.match(h, /nums\.last\(\);/);
  const r = await T.run(sol, h);
  assert.strictEqual(T.compare(r.result, ex.output), true);
});

t('Klassen-Aufgabe im Design-Format', async () => {
  const sol = `class MinStack {
  constructor() { this.s = []; }
  push(x) { this.s.push(x); }
  top() { return this.s[this.s.length - 1]; }
}`;
  const ex = T.parseExamples('Input\n["MinStack","push","push","top"]\n[[],[1],[5],[]]\nOutput\n[null,null,null,5]\nExplanation')[0];
  assert.ok(ex, 'LeetCode-Format „Input⏎…⏎Output⏎…“ ohne Doppelpunkt wird erkannt');
  assert.strictEqual(ex.vars.length, 2, 'zwei Zeilen = zwei Eingaben');
  const r1 = await T.run(sol, T.guessHarness(sol, ex));
  assert.strictEqual(T.compare(r1.result, ex.output), true);
  const ex2 = T.parseExamples('Input: ["MinStack","push","push","top"]\n[[],[1],[5],[]]\nOutput: [null,null,null,5]\nExplanation:')[0];
  const r = await T.run(sol, T.guessHarness(sol, ex2));
  assert.strictEqual(r.error, null);
  assert.strictEqual(T.compare(r.result, ex2.output), true);
  assert.ok(r.steps.some((s) => s.kind === 'call' && s.fn === 'push'));
});

t('Komma am Zeilenende trennt Variablen sauber (join-two-arrays-by-id)', () => {
  const v = T.parseInput(`arr1 = [
  {"id": 1}
],
arr2 = [
  {"id": 3}
]`);
  assert.deepStrictEqual(v.map((x) => x.name), ['arr1', 'arr2']);
  assert.ok(!/,\s*$/.test(v[0].value), 'kein Komma am Ende des Werts');
});

t('Treiber „30 Days“: Ergebnis im LeetCode-Format, Zeiten tolerant', async () => {
  const sol = `var cancellable = function(fn, args, t) {
    const id = setTimeout(() => fn(...args), t);
    return () => clearTimeout(id);
};`;
  const ex = T.parseExamples(`Input: fn = (x) => x * 5, args = [2], t = 20
Output: [{"time": 20, "returned": 10}]
Explanation: 
const cancelTimeMs = 50;
`)[0];
  const h = T.guessHarness(sol, ex, 'timeout-cancellation');
  assert.match(h, /cancelTimeMs = 50/);
  const r = await T.run(sol, h);
  assert.strictEqual(r.error, null);
  assert.strictEqual(T.compare(r.result, ex.output, { timed: T.timed('timeout-cancellation') }), true);
  assert.strictEqual(T.compare([{ time: 60, returned: 10 }], ex.output, { timed: true }), false, 'zu spät bleibt falsch');
  assert.strictEqual(T.compare([{ time: 22, returned: 11 }], ex.output, { timed: true }), false, 'Wert wird exakt geprüft');
});

t('Rest-Parameter und Zuordnung per Namen', async () => {
  const len = 'var argumentsLength = function(...args) { return args.length; };';
  const e1 = T.parseExamples(`Input: args = [{}, null, "3"]
Output: 3`)[0];
  assert.strictEqual((await T.run(len, T.guessHarness(len, e1))).result, 3);
  const tl = 'var f = function(fn, t) { return t; };';
  const e2 = T.parseExamples(`Input: fn = () => 1, inputs = [5], t = 50
Output: 50`)[0];
  assert.match(T.guessHarness(tl, e2), /f\(fn, t\)\(inputs\)/);
});

t('Gefangener Fehler wird mit Zeile erfasst, Auffälligkeiten ohne Ausführen', async () => {
  const sol = [
    'var expect = function(val) {',
    '    return {',
    '        toBe(val) {',
    '            if (toBe(val) === val) return true;',
    '            throw "Not Equal";',
    '        },',
    '        toBe(val) { return true; },',
    '    };',
    '};'].join('\n');
  const ex = T.parseExamples('Input: func = () => expect(5).toBe(5)\nOutput: {"value": true}')[0];
  const r = await T.run(sol, T.guessHarness(sol, ex, 'to-be-or-not-to-be'));
  assert.strictEqual(r.error, null, 'der Prüf-Code fängt den Fehler');
  assert.strictEqual(T.compare(r.result, ex.output), true);
  const bad = sol.replace('toBe(val) { return true; },', '');
  const r2 = await T.run(bad, T.guessHarness(bad, ex, 'to-be-or-not-to-be'));
  assert.strictEqual(r2.thrown.name, 'ReferenceError');
  assert.strictEqual(r2.thrown.line, 4);
  assert.strictEqual(r2.steps[r2.thrown.step].kind, 'error');
  assert.match(T.hint(r2.thrown, bad), /eine Methode deines Objekts \(Zeile 3\)/);
  const kinds = T.lint(sol).map((f) => f.kind);
  assert.deepStrictEqual(kinds, ['dupe', 'shadow', 'throw']);
  assert.match(T.lint(sol)[1].message, /\(Ebenso Zeile 7\.\)/);
  assert.deepStrictEqual(T.lint('class A { get x() { return 1; } set x(v) {} }'), [], 'get/set-Paar ist kein Duplikat');
  assert.deepStrictEqual(T.lint('var f = function(a) { return a.map((x) => x * 2); };'), []);
});

t('Uncaught-Fehler erscheint nur einmal im Verlauf', async () => {
  const r = await T.run('function f(a) {\n  return a.b.c;\n}', 'f({});');
  assert.strictEqual(r.error.line, 2);
  assert.strictEqual(r.steps.filter((s) => s.kind === 'error').length, 1);
});

t('ListNode-Aufgabe: Eingabe wird umgewandelt, Ausgabe verglichen', async () => {
  const sol = `/**
 * Definition for singly-linked list.
 * function ListNode(val, next) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.next = (next===undefined ? null : next)
 * }
 */
/**
 * @param {ListNode} head
 * @return {ListNode}
 */
var reverseList = function(head) {
    let prev = null;
    while (head) {
        const next = head.next;
        head.next = prev;
        prev = head;
        head = next;
    }
    return prev;
};`;
  const ex = T.parseExamples('Input: head = [1,2,3,4,5]\nOutput: [5,4,3,2,1]\nExample 2:')[0];
  const h = T.guessHarness(sol, ex);
  assert.match(h, /toList\(\[1,2,3,4,5\]\)/);
  const r = await T.run(sol, h);
  assert.strictEqual(r.error, null);
  assert.strictEqual(r.resultText, 'ListNode[5 → 4 → 3 → 2 → 1]');
  assert.strictEqual(T.compare(r.result, ex.output), true);
});

t('Falsches Ergebnis wird erkannt', async () => {
  const bad = COMPOSE.replace('reduceRight', 'reduce');
  const ex = T.parseExamples(DESC)[0];
  const r = await T.run(bad, T.guessHarness(bad, ex));
  assert.strictEqual(r.resultText, '50');
  assert.strictEqual(T.compare(r.result, ex.output), false);
});

t('Werte-Anzeige', () => {
  assert.strictEqual(T.fmt(new Map([[1, 'a']])), 'Map(1) {1 => "a"}');
  assert.strictEqual(T.fmt(new Set([1, 2])), 'Set(2) {1, 2}');
  assert.strictEqual(T.fmt({ a: [1, { b: 2 }], 'x-y': null }), '{a: [1, {b: 2}], "x-y": null}');
  const o = { a: 1 }; o.self = o;
  assert.strictEqual(T.fmt(o), '{a: 1, self: [zirkulär]}');
  assert.strictEqual(T.fmt(-0), '-0');
  assert.strictEqual(T.fmt(Math.max), 'ƒ max() [eingebaut]');
});

t('Kontrollstrukturen ohne Klammern, switch, Label, Destructuring, Klassen bleiben gültig', async () => {
  const sol = `function f(arr) {
  let n = 0;
  outer: for (const [i, v] of arr.entries()) {
    if (v < 0) continue; else if (v > 100) break outer;
    for (let j = 0; j < 2; j++) if (j) n += v; else n += 0;
    switch (v % 3) { case 0: { n += 1; break; } case 1: n += 2; break; default: let z = 3; n += z; }
  }
  do n++; while (n < 0)
  const { a = 1, ...rest } = { b: 2 };
  class P { #x = 1; static s = 2; get x() { return this.#x; } m = () => this.x; }
  return [n, a, rest, new P().m()];
}`;
  const r = await T.run(sol, 'f([1, -2, 3, 200, 4]);');
  assert.strictEqual(r.error, null, r.error && r.error.message);
  assert.deepStrictEqual(r.result, [8, 1, { b: 2 }, 1]);
});

t('Leere Funktionskörper', async () => {
  const r = await T.run('function f() {}\nconst g = () => {};', 'f(); [g(), (function () {})()];');
  assert.strictEqual(r.error, null, r.error && r.error.message);
  assert.deepStrictEqual(r.result, [undefined, undefined]);
});

t('let in der Temporal Dead Zone stört die Aufzeichnung nicht', async () => {
  const r = await T.run('function f() {\n  const g = () => y;\n  let y = 5;\n  return g();\n}', 'f();');
  assert.strictEqual(r.result, 5);
});

// Ransom Note mit dem Fehler aus dem echten Versuch: alle drei Beispiele stimmen zufällig,
// die Einsendung scheitert an "aab" / "baa".
const RANSOM = `var canConstruct = function (ransomNote, magazine) {
    const count1 = {}
    const count2 = {}
    for (let char of ransomNote) {
        count1[char] = (count1[char] || 0) + 1
    }
    for (let char of magazine) {
        count2[char] = (count2[char] || 0) + 1
    }
    const charEnthalten = Object.entries(ransomNote).every(([schlüssel, wert]) => magazine[schlüssel] === wert)
    return charEnthalten
};`;

const PANEL = `Wrong Answer
39 / 130 testcases passed
Editorial
Input
Use Testcase
ransomNote =
"aab"
magazine =
"baa"
Output
false
Expected
true
Code
|
JavaScript
var canConstruct = function (ransomNote, magazine) {`;

t('Ergebnisfeld einer gescheiterten Einsendung wird gelesen', () => {
  const p = T.parseResultPanel(PANEL);
  assert.deepStrictEqual(p, {
    status: 'Wrong Answer', vars: [{ name: 'ransomNote', value: '"aab"' }, { name: 'magazine', value: '"baa"' }], expected: 'true', got: 'false',
  });
  assert.strictEqual(T.parseResultPanel('Accepted\nRuntime 0 ms'), null);
  const tle = T.parseResultPanel('Time Limit Exceeded\nLast Executed Input\nUse Testcase\nn =\n45');
  assert.deepStrictEqual(tle.vars, [{ name: 'n', value: '45' }]);
  assert.strictEqual(tle.expected, null);
});

t('Einsendung aus dem Netz: Namen kommen aus der Funktion', async () => {
  const ex = T.submissionCase({ input: '"aab"\n"baa"', expected: 'true', got: 'false', status: 'Wrong Answer' }, RANSOM);
  assert.deepStrictEqual(ex.vars, [{ name: 'ransomNote', value: '"aab"' }, { name: 'magazine', value: '"baa"' }]);
  const h = T.guessHarness(RANSOM, ex);
  assert.match(h, /^\/\/ Einsendung – erwartet: true/);
  assert.match(h, /canConstruct\(ransomNote, magazine\);/);
  const r = await T.run(RANSOM, h);
  assert.strictEqual(T.compare(r.result, ex.output), false, 'der Fehler muss sichtbar werden');
  for (const e of T.parseExamples('Example 1:\nInput: ransomNote = "a", magazine = "b"\nOutput: false\nExample 2:\nInput: ransomNote = "aa", magazine = "aab"\nOutput: true\nConstraints:')) {
    assert.strictEqual(T.compare((await T.run(RANSOM, T.guessHarness(RANSOM, e))).result, e.output), true, 'Beispiele stimmen zufällig');
  }
  // passt die Zeilenzahl nicht zur Funktion, gibt es neutrale Namen statt falscher
  assert.deepStrictEqual(T.submissionCase({ input: '1\n2\n3' }, RANSOM).vars.map((v) => v.name), ['eingabe1', 'eingabe2', 'eingabe3']);
  assert.strictEqual(T.caseSignature({ input: '"aab"\n"baa"\n' }), T.caseSignature(T.parseResultPanel(PANEL)));
});

(async () => {
  let fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n     ', e.message); }
  }
  console.log(`\n${tests.length - fail}/${tests.length} bestanden`);
  process.exit(fail ? 1 : 0);
})();
