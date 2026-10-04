// Ende-zu-Ende-Test: lädt die Extension in Chromium und spielt sie gegen eine nachgebaute
// LeetCode-Seite durch (Monaco-Attrappe, gleiche DOM-Merkmale wie das Original).
// Aufruf aus leetcode-debugger/:  NODE_PATH=$(npm root -g) node test/e2e.js [screenshot.png]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');

const EXT = path.resolve(__dirname, '..');
const SHOT = process.argv[2];

const SOLUTION = `/**
 * @param {Function[]} functions
 * @return {Function}
 */
var compose = function(functions) {

    return function(x) {
        return functions.reduceRight((acc, fn) => fn(acc), x);
    }
};

/**
 * const fn = compose([x => x + 1, x => 2 * x])
 * fn(4) // 9
 */`;

const COMPOSE_DESC = `
    <p>Given an array of functions [f1, f2, f3, ..., fn], return a new function fn that is the function composition of the array of functions.</p>
    <p><strong>Example 1:</strong></p>
    <pre><strong>Input:</strong> functions = [x =&gt; x + 1, x =&gt; x * x, x =&gt; 2 * x], x = 4
<strong>Output:</strong> 65
<strong>Explanation:</strong>
Evaluating from right to left ...</pre>
    <p><strong>Example 2:</strong></p>
    <pre><strong>Input:</strong> functions = [x =&gt; 10 * x, x =&gt; 10 * x, x =&gt; 10 * x], x = 1
<strong>Output:</strong> 1000</pre>
    <p><strong>Example 3:</strong></p>
    <pre><strong>Input:</strong> functions = [], x = 42
<strong>Output:</strong> 42
<strong>Explanation:</strong>
The composition of zero functions is the identity function</pre>
    <p><strong>Constraints:</strong></p>`;

// Ransom Note mit dem Fehler aus dem echten Versuch (Variablen hier mit Umlaut): alle drei
// Beispiele stimmen zufällig, die Einsendung scheitert an "aab" / "baa".
const RANSOM = `/**
 * @param {string} ransomNote
 * @param {string} magazine
 * @return {boolean}
 */
var canConstruct = function (ransomNote, magazine) {
    const zähler1 = {}
    const zähler2 = {}

    for (let char of ransomNote) {
        zähler1[char] = (zähler1[char] || 0) + 1
    }
    for (let char of magazine) {
        zähler2[char] = (zähler2[char] || 0) + 1
    }

    const charEnthalten = Object.entries(ransomNote).every(([schlüssel, wert]) => magazine[schlüssel] === wert)

    return charEnthalten
};`;
// To Be Or Not To Be wie im echten Versuch: toBe doppelt, ruft sich als freien Namen auf, throw "…".
// LeetCodes Prüf-Code fängt den Fehler – ohne Hilfe sieht man nur ein falsches Ergebnis.
const TOBE = `/**
 * @param {string} val
 * @return {Object}
 */
var expect = function(val) {
    return {
        toBe(val) {
            if(toBe(val) === val){
                return true
            } else {
                throw "Not Equal"
            }
        },
        toBe(val) {
            if(toBe(val) !== val){
                return true
            } else {
                throw "Equal"
            }
        }
    }
};`;
const TOBE_DESC = `
    <p>Write a function expect that helps developers test their code.</p>
    <p><strong>Example 1:</strong></p>
    <pre><strong>Input:</strong> func = () =&gt; expect(5).toBe(5)
<strong>Output:</strong> {"value": true}
<strong>Explanation:</strong> 5 === 5 so this expression returns true.</pre>
    <p><strong>Example 2:</strong></p>
    <pre><strong>Input:</strong> func = () =&gt; expect(5).notToBe(null)
<strong>Output:</strong> {"value": true}
<strong>Explanation:</strong> 5 !== null so this expression returns true.</pre>
    <p><strong>Constraints:</strong></p>`;
const RANSOM_DESC = `
    <p>Given two strings ransomNote and magazine, return true if ransomNote can be constructed by using the letters from magazine and false otherwise.</p>
    <p><strong>Example 1:</strong></p>
    <pre><strong>Input:</strong> ransomNote = "a", magazine = "b"
<strong>Output:</strong> false</pre>
    <p><strong>Example 2:</strong></p>
    <pre><strong>Input:</strong> ransomNote = "aa", magazine = "ab"
<strong>Output:</strong> false</pre>
    <p><strong>Example 3:</strong></p>
    <pre><strong>Input:</strong> ransomNote = "aa", magazine = "aab"
<strong>Output:</strong> true</pre>
    <p><strong>Constraints:</strong></p>`;
const CHECK = {
  status_code: 11, lang: 'javascript', run_success: true, code_output: 'false', std_output: '', last_testcase: '"aab"\n"baa"',
  expected_output: 'true', total_correct: 39, total_testcases: 130, submission_id: '987654321', input_formatted: '"aab", "baa"',
  input: '"aab"\n"baa"', status_msg: 'Wrong Answer', state: 'SUCCESS',
};

const makePage = (title, desc, code) => `<!doctype html><html class="dark"><head><title>${title} - LeetCode</title></head>
<body style="background:#1a1a1a;color:#eee;font-family:sans-serif;margin:0">
<div style="display:flex;height:100vh">
  <div data-track-load="description_content" style="width:45%;padding:16px;overflow:auto">${desc}
  </div>
  <div id="editor" class="monaco-editor" style="flex:1;position:relative;overflow:hidden;background:#262626">
    <div id="lines" style="padding:0 16px 0 0;margin:0;font:13px Menlo, Consolas, monospace;color:#d4d4d4"></div>
    <div class="overlayWidgets" style="position:absolute;inset:0;pointer-events:none"></div>
  </div>
</div>
<script>
  window.__code = ${JSON.stringify(code)};
  window.__decos = [];
  window.__opts = { padding: { top: 0 }, glyphMargin: false };
  window.__zones = [];
  class Range { constructor(a, b, c, d) { this.startLineNumber = a; this.startColumn = b; this.endLineNumber = c; this.endColumn = d; } }
  const node = document.getElementById('editor'), lines = document.getElementById('lines');
  const overlays = node.querySelector('.overlayWidgets');
  // Zeichnet Randspalte, Zeilennummern, Markierungen, Werte und Zonen wie Monaco
  const render = () => {
    const d = window.__decos || [];
    lines.innerHTML = '';
    lines.style.paddingTop = (window.__opts.padding && window.__opts.padding.top || 0) + 'px';
    window.__code.split('\\n').forEach((t, i) => {
      const L = i + 1, mine = d.filter((x) => x.range.startLineNumber === L);
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.line = L;
      row.style.cssText = 'display:flex;height:20px;align-items:center';
      const whole = mine.find((x) => x.options.isWholeLine);
      if (whole) row.classList.add(whole.options.className);
      const glyph = document.createElement('div');
      glyph.style.cssText = 'width:' + (window.__opts.glyphMargin ? 18 : 0) + 'px;height:20px;flex:none';
      for (const x of mine) if (x.options.glyphMarginClassName) glyph.className += ' ' + x.options.glyphMarginClassName;
      const no = document.createElement('div');
      no.textContent = L;
      no.style.cssText = 'width:30px;text-align:right;padding-right:12px;color:#858585;flex:none';
      const code = document.createElement('div');
      code.style.whiteSpace = 'pre';
      code.textContent = t || ' ';
      for (const x of mine) if (x.options.afterContentClassName) { const a = document.createElement('span'); a.className = x.options.afterContentClassName; code.appendChild(a); }
      row.append(glyph, no, code);
      lines.appendChild(row);
      for (const z of window.__zones) if (z.afterLineNumber === L) { z.domNode.style.height = z.heightInPx + 'px'; lines.appendChild(z.domNode); }
    });
  };
  render();
  const model = {
    getLanguageId: () => 'javascript',
    getLineCount: () => window.__code.split('\\n').length,
    getLineMaxColumn: (l) => window.__code.split('\\n')[l - 1].length + 1,
    getValue: () => window.__code,
    getWordAtPosition: (p) => {
      const line = window.__code.split('\\n')[p.lineNumber - 1], re = /[A-Za-z_$][\\w$]*/g;
      let m;
      while ((m = re.exec(line))) if (p.column - 1 >= m.index && p.column - 1 <= m.index + m[0].length)
        return { word: m[0], startColumn: m.index + 1, endColumn: m.index + 1 + m[0].length };
      return null;
    },
  };
  let mouseCb = null, zoneSeq = 0;
  const editor = {
    getModel: () => model, getValue: () => window.__code, getDomNode: () => node,
    deltaDecorations: (old, list) => { window.__decos = list; render(); return list.map((_, i) => 'd' + i); },
    revealLineInCenterIfOutsideViewport: () => {},
    revealLineInCenter: (l) => { window.__revealed = l; },
    setSelection: () => {}, focus: () => {},
    getRawOptions: () => JSON.parse(JSON.stringify(window.__opts)),
    updateOptions: (o) => { Object.assign(window.__opts, o); render(); },
    onMouseDown: (cb) => { mouseCb = cb; return { dispose() {} }; },
    getPosition: () => ({ lineNumber: window.__cursorLine || 1, column: 1 }),
    changeViewZones: (fn) => {
      fn({
        addZone: (z) => { z.id = ++zoneSeq; window.__zones.push(z); return z.id; },
        removeZone: (id) => { window.__zones = window.__zones.filter((z) => z.id !== id); },
      });
      render();
    },
    // Overlay-Widgets wie Monaco: 0 = oben rechts neben der Scrollleiste
    addOverlayWidget(w) { const n = w.getDomNode(); n.style.position = 'absolute'; overlays.appendChild(n); this.layoutOverlayWidget(w); },
    removeOverlayWidget(w) { w.getDomNode().remove(); },
    layoutOverlayWidget(w) { const n = w.getDomNode(); n.style.right = '14px'; n.style.top = '0'; n.style.pointerEvents = 'auto'; },
    getLayoutInfo: () => ({ width: node.clientWidth, height: node.clientHeight, verticalScrollbarWidth: 14, horizontalScrollbarHeight: 10 }),
    onDidLayoutChange: () => ({ dispose() {} }),
  };
  window.__gutterClick = (line) => mouseCb && mouseCb({ target: { type: 2, position: { lineNumber: line, column: 1 } } });
  window.__hover = null;
  // ?cm=1: LeetCodes Fokus-Modus – CodeMirror 6 statt Monaco. Nachgebaut ist nur, was der Debugger
  // von der EditorView braucht (am DOM unter .cm-content → cmView.view, wie bei CodeMirror selbst)
  if (/cm=1/.test(location.search)) {
    node.className = 'cm-editor';
    node.innerHTML = '<div class="cm-scroller" style="position:relative;overflow:auto;height:100%;display:flex">' +
      '<div class="cm-gutters" style="width:40px;flex:none"></div>' +
      '<div class="cm-content" data-language="javascript" contenteditable="true" style="flex:1;font:13px Menlo, Consolas, monospace;color:#d4d4d4"></div></div>';
    const content = node.querySelector('.cm-content'), LH = 20, CW = 8;
    const split = () => window.__code.split('\\n');
    const starts = () => { let o = 0; return split().map((t) => { const s = o; o += t.length + 1; return s; }); };
    const lineOf = (pos) => { const st = starts(); let n = 1; while (n < st.length && st[n] <= pos) n++; return n; };
    const draw = () => { content.innerHTML = split().map((t) => '<div class="cm-line" style="height:' + LH + 'px;white-space:pre">' + (t.replace(/&/g, '&amp;').replace(/</g, '&lt;') || ' ') + '</div>').join(''); };
    draw();
    window.__setCode = (c) => { window.__code = c; draw(); };
    content.cmView = { view: {
      state: { get doc() {
        const L = split(), st = starts();
        return { lines: L.length, toString: () => window.__code, line: (n) => ({ number: n, from: st[n - 1], to: st[n - 1] + L[n - 1].length }) };
      } },
      get documentTop() { return content.getBoundingClientRect().top + parseFloat(getComputedStyle(content).paddingTop); },
      lineBlockAt: (pos) => ({ top: (lineOf(pos) - 1) * LH, height: LH }),
      coordsAtPos: (pos) => { const n = lineOf(pos), r = content.getBoundingClientRect(); return { left: r.left + (pos - starts()[n - 1]) * CW, right: r.left + (pos - starts()[n - 1]) * CW }; },
      domAtPos: (pos) => ({ node: content.children[lineOf(pos) - 1], offset: 0 }),
      dispatch: (tr) => { window.__cmSel = tr.selection; },
      focus() {}, requestMeasure() {},
    } };
  }
  if (!/nomonaco|cm=1/.test(location.search)) window.monaco = {
    Range, editor: { getEditors: () => [editor], getModels: () => [model] },
    languages: { registerHoverProvider: (lang, p) => { if (lang === 'javascript') window.__hover = p; } },
  };
  window.__hoverAt = (line, word) => {
    const col = window.__code.split('\\n')[line - 1].indexOf(word) + 1;
    const h = window.__hover && window.__hover.provideHover(model, { lineNumber: line, column: col });
    return h ? h.contents.map((c) => c.value).join(' ') : null;
  };
  window.__setCode = (c) => { window.__code = c; render(); };
</script></body></html>`;
const PAGE = makePage('Function Composition', COMPOSE_DESC, SOLUTION);

(async () => {
  const ctx = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1400, height: 900 },
  });
  const errors = [];
  const submits = [];
  await ctx.route('https://leetcode.com/**', (route) => {
    const u = route.request().url();
    if (/\/submissions\/detail\/\d+\/check\//.test(u)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(CHECK) });
    if (/\/problems\/[^/]+\/submit\//.test(u)) { submits.push(route.request().postData()); return route.fulfill({ contentType: 'application/json', body: '{"submission_id":987654321}' }); }
    if (/\/problems\/to-be-or-not-to-be\//.test(u)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: makePage('To Be Or Not To Be', TOBE_DESC, TOBE) });
    if (/\/problems\/ransom-note\//.test(u)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: makePage('Ransom Note', RANSOM_DESC, RANSOM) });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
  });
  // Der Hintergrund spielt den Debugger-Code bei jedem Seitenaufruf aus dem Ordner ein
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const EXT_ID = sw.url().split('/')[2];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('page: ' + e.message));
  await page.goto('https://leetcode.com/problems/function-composition/');

  const step = async (name, fn) => {
    try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.message.slice(0, 400)); process.exitCode = 1; }
  };
  const ROOT = "(document.querySelector('.lcdbg-overlay') || document.getElementById('lcdbg-host')).shadowRoot";
  const text = (sel) => page.locator(sel).first().innerText();
  const waitText = (sel, re) => page.waitForFunction(([s, src, root]) => {
    const el = eval(root).querySelector(s);
    return el && new RegExp(src).test(el.innerText);
  }, [sel, re.source, ROOT], { timeout: 6000 });
  const decos = () => page.evaluate(() => window.__decos.map((d) => ({
    line: d.range.startLineNumber, cls: d.options.className, glyph: d.options.glyphMarginClassName, after: d.options.afterContentClassName,
  })));
  const curLine = async () => ((await decos()).find((d) => d.cls) || {}).line;
  const afterText = (line) => page.evaluate((L) => {
    const el = document.querySelector(`.row[data-line="${L}"] .lcdbg-iv`);
    return el ? getComputedStyle(el, '::after').content : null;
  }, line);
  const setCode = (c) => page.evaluate((x) => window.__setCode(x), c);
  const posNow = () => page.evaluate((root) => { const r = eval(root).querySelector('.pos'); return r ? r.textContent : ''; }, ROOT);
  const click = async (sel) => {
    const before = await posNow();
    await page.locator(sel).first().click();
    for (let k = 0; k < 50 && (await posNow()) === before; k++) await page.waitForTimeout(20);
  };
  const nextUntil = async (re) => {
    for (let i = 0; i < 40; i++) {
      if (re.test(await text('.et'))) return;
      await click('[data-kind="next"]');
    }
    throw new Error('nicht erreicht: ' + re);
  };

  await step('Knopf sitzt als Monaco-Widget im Editor (oben rechts)', async () => {
    await page.locator('.lcdbg-overlay .pill').waitFor({ timeout: 5000 });
    assert.strictEqual(await page.locator('#lcdbg-host').count(), 0, 'schwebende Ebene müsste weg sein');
    const pill = await page.locator('.pill').boundingBox(), ed = await page.locator('#editor').boundingBox();
    assert.ok(pill.x > ed.x + ed.width / 2 && pill.y < ed.y + 40, JSON.stringify(pill));
  });

  await step('Start: alle Beispiele geprüft, Leiste verdeckt keinen Code', async () => {
    await page.locator('.pill').click();
    await waitText('.r2', /Alle 3 Beispiele stimmen/);
    const tb = await page.locator('.tb').boundingBox();
    assert.ok(tb.height < 90, 'Leiste kompakt: ' + tb.height);
    const opts = await page.evaluate(() => window.__opts);
    assert.ok(opts.glyphMargin, 'Randspalte für Haltepunkte an');
    const line1 = await page.locator('.row[data-line="1"]').boundingBox();
    assert.ok(line1.y >= tb.y + tb.height, `Zeile 1 (${line1.y}) liegt unter der Leiste (${tb.y + tb.height})`);
    await page.locator('[data-act="menu"]').click();
    const items = (await page.locator('.item').allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
    assert.match(items.join('|'), /✓Beispiel1stimmt\|✓Beispiel2stimmt\|✓Beispiel3stimmt/);
    await page.locator('[data-act="menu"]').click();
    assert.ok(await page.locator('.drop').isHidden(), 'Menü wieder zu');
  });

  await step('Einzelschritt: Pfeil + Werte im Code wie VS Code', async () => {
    await nextUntil(/Als Nächstes: Zeile 8/);
    assert.strictEqual(await curLine(), 8);
    assert.ok((await decos()).some((d) => d.line === 8 && d.glyph === 'lcdbg-arrow'), 'gelber Pfeil in der Randspalte');
    assert.match(await afterText(7) || '', /x = 4/);   // Inline-Wert in einer früheren Zeile der Funktion
    await nextUntil(/reduceRight-Callback wird aufgerufen/);
    assert.match(await afterText(8) || '', /→ acc = 4, fn = x => 2 \* x/);
  });

  await step('Variablen-Bereich klappt nur auf Klick auf', async () => {
    assert.ok(await page.locator('.drop').isHidden());
    await page.locator('[data-act="panel"]').click();
    const rows = await page.locator('table.vars tr').allInnerTexts();
    assert.ok(rows.some((r) => /^acc\s+4/.test(r)), rows.join(' | '));
    assert.ok(rows.some((r) => /Closure/.test(r)), 'Closure-Gruppe');
    await page.locator('[data-act="tab"][data-tab="stack"]').click();
    assert.match(await text('.list'), /➜ reduceRight-Callback[\s\S]*Rückgabe von compose/);
    await page.locator('[data-act="panel"]').click();
    assert.ok(await page.locator('.drop').isHidden());
  });

  await step('Maus über Variable im Editor zeigt ihren Wert', async () => {
    const h = await page.evaluate(() => window.__hoverAt(8, 'acc'));
    assert.match(h || '', /acc[\s\S]*4/);
    assert.strictEqual(await page.evaluate(() => window.__hoverAt(8, 'reduceRight')), null);
  });

  await step('VS-Code-Tasten im Editor: F11, F10, Alt+Shift+←', async () => {
    await page.locator('#editor').click();
    let before = await posNow();
    await page.keyboard.press('F11');
    await page.waitForFunction(([b, root]) => eval(root).querySelector('.pos').textContent !== b, [before, ROOT]);
    before = await posNow();
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    await page.waitForFunction(([b, root]) => eval(root).querySelector('.pos').textContent !== b, [before, ROOT]);
    before = await posNow();
    await page.keyboard.press('F10');
    await page.waitForFunction(([b, root]) => eval(root).querySelector('.pos').textContent !== b, [before, ROOT]);
  });

  await step('Haltepunkt in der Randspalte, Weiter (F5) hält dort', async () => {
    await page.locator('[data-act="check"]').click();
    await waitText('.pos', /^1\//);
    await page.evaluate(() => window.__gutterClick(8));
    await page.waitForTimeout(100);
    assert.ok((await decos()).some((d) => d.line === 8 && d.glyph === 'lcdbg-bp'), 'roter Punkt');
    await click('[data-act="continue"]');
    assert.strictEqual(await curLine(), 8);
    await page.locator('#editor').click();
    await page.keyboard.press('F5');   // weiter zum nächsten Treffer derselben Zeile
    await page.waitForTimeout(150);
    assert.strictEqual(await curLine(), 8);
    await page.evaluate(() => window.__gutterClick(8));   // Haltepunkt wieder weg
    await click('[data-act="continue"]');
    await waitText('.et', /Fertig – Ergebnis: 65/);
  });

  await step('Falscher Code: Neustart zeigt erwartet vs. bekommen', async () => {
    await setCode(SOLUTION.replace('reduceRight', 'reduce'));
    await page.locator('[data-act="check"]').click();
    await waitText('.r2', /Falsches Ergebnis/);
    assert.match(await text('.cmp'), /erwartet\s*65\s*bekommen\s*50/);
    assert.match(await text('.case'), /✗\s*Beispiel 1/);
  });

  await step('Laufzeitfehler: Kasten unter der Zeile wie in VS Code', async () => {
    await setCode(SOLUTION.replace('fn(acc)', 'fn(acc).value.x'));
    await page.locator('[data-act="menu"]').click();
    await page.locator('.item', { hasText: 'Beispiel 1' }).click();
    await waitText('.r2', /TypeError\s*Zeile 8/);
    await page.waitForTimeout(100);
    const zone = await page.evaluate(() => window.__zones.map((z) => [z.afterLineNumber, z.domNode.textContent]));
    assert.strictEqual(zone.length, 1);
    assert.strictEqual(zone[0][0], 8);
    assert.match(zone[0][1], /TypeError/);
    assert.doesNotMatch(zone[0][1], /💡/, 'Tipp nur in der Leiste, nicht doppelt');
    assert.strictEqual((await decos()).find((d) => d.cls).cls, 'lcdbg-line-err');
  });

  await step('Eigener Test mit console.log', async () => {
    await setCode(SOLUTION);
    await page.locator('[data-act="menu"]').click();
    await page.locator('.item', { hasText: 'Eigener Test' }).click();
    const ta = page.locator('#harness');
    await ta.fill('const f = compose([x => x * 3]);\nconsole.log("zwischen", f(2));\nf(5);');
    await ta.press('Control+Enter');
    await waitText('.r2', /15/);
    assert.strictEqual(await page.evaluate(() => window.__zones.length), 0, 'Fehlerkasten weg');
    await page.locator('[data-act="tab"][data-tab="console"]').click();
    assert.match(await text('.list'), /zwischen 6/);
  });

  await step('Tippen im Testaufruf landet nicht im LeetCode-Editor', async () => {
    let leaked = false;
    await page.exposeFunction('__leak', () => { leaked = true; });
    await page.evaluate(() => document.addEventListener('keydown', (e) => { if (e.key === 'q') window.__leak(); }));
    await page.locator('[data-act="tab"][data-tab="harness"]').click();
    await page.locator('#harness').press('q');
    await page.waitForTimeout(50);
    assert.ok(!leaked, 'Tastendruck ist bis zur Seite durchgerutscht');
    await page.locator('#harness').press('Backspace');
  });

  await step('Entwurf bleibt nach Neuladen, Alt+Shift+D startet', async () => {
    await page.waitForTimeout(600);
    await page.reload();
    await page.locator('.pill').waitFor({ timeout: 5000 });
    await page.keyboard.press('Alt+Shift+D');
    await waitText('.r2', /Alle 3 Beispiele stimmen/);
    await page.locator('[data-act="menu"]').click();
    await page.locator('.item', { hasText: 'Eigener Test' }).click();
    await page.locator('[data-act="tab"][data-tab="harness"]').click();
    assert.match(await page.locator('#harness').inputValue(), /console\.log\("zwischen"/);
  });

  await step('Beenden räumt den Editor auf (Abstand, Randspalte, Markierungen)', async () => {
    await page.locator('[data-act="close"]').click();
    await page.waitForTimeout(200);
    assert.strictEqual((await decos()).length, 0);
    const o = await page.evaluate(() => window.__opts);
    assert.strictEqual(o.padding.top, 0);
    assert.strictEqual(o.glyphMargin, false);
    assert.ok(await page.locator('.pill').isVisible());
    assert.strictEqual(await page.evaluate(() => window.__hoverAt(8, 'acc')), null);
  });

  if (SHOT) {
    await page.locator('.pill').click();
    await waitText('.r2', /stimmen/);
    await page.locator('[data-act="menu"]').click();
    await page.locator('.item', { hasText: 'Beispiel 1' }).click();
    await waitText('.r2', /stimmt/);
    await page.evaluate(() => window.__gutterClick(8));
    await nextUntil(/Als Nächstes: Zeile 8/);
    await page.waitForTimeout(200);
    await page.screenshot({ path: SHOT });
    await page.locator('[data-act="panel"]').click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: SHOT.replace(/\.png$/, '-variablen.png') });
    await page.locator('[data-act="panel"]').click();
    console.log('Screenshot:', SHOT);
  }

  await step('Käfer-Symbol: Fenster zeigt Zustand und startet den Debugger', async () => {
    const src = await page.evaluate(() => document.querySelector('iframe[src^="chrome-extension://"]').src);
    const base = src.replace(/engine\.html.*$/, '');
    if (await page.locator('.tb').isVisible()) await page.locator('[data-act="close"]').click();
    const pop = await ctx.newPage();
    await pop.goto(base + 'popup.html#alle');
    await pop.locator('#checks li').first().waitFor({ timeout: 5000 });
    const t = await pop.locator('main').innerText();
    assert.match(t, /Extension läuft in diesem Tab/);
    assert.match(t, /Code-Editor gefunden/);
    assert.match(t, /Leiste sitzt als Widget im Editor/);
    await pop.locator('#start').click();
    await waitText('.r2', /stimmen/);
    await pop.bringToFront();
    await pop.goto(base + 'popup.html');
    await pop.locator('#msg.bad').waitFor({ timeout: 5000 });
    assert.match(await pop.locator('#msg').innerText(), /läuft in diesem Tab nicht[\s\S]*Auf leetcode\.com/);
    await pop.close();
    await page.locator('[data-act="close"]').click();
  });

  await step('Ohne Monaco: Leiste schwebt über der Seite, Knopf unten rechts', async () => {
    await page.goto('https://leetcode.com/problems/function-composition/?nomonaco=1');
    await page.evaluate(() => { document.getElementById('editor').className = ''; });
    await page.locator('#lcdbg-host .pill').waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    const b = await page.locator('.pill').boundingBox();
    assert.ok(b.y + b.height > 900 - 40 && b.x + b.width > 1400 - 40, JSON.stringify(b));
    // ohne Monaco kein Zugriff auf den Code: Feld zum Einfügen erscheint
    await page.locator('.pill').click();
    await waitText('.r2', /Code im Editor wurde nicht gefunden/);
    await page.locator('#manual').fill(SOLUTION);
    await page.locator('[data-act="check"]').click();
    await waitText('.r2', /Alle 3 Beispiele stimmen/);
  });

  await step('Ohne Monaco: Knopf wird wieder eingehängt, wenn die Seite ihn entfernt', async () => {
    await page.evaluate(() => document.getElementById('lcdbg-host').remove());
    await page.waitForTimeout(400);
    assert.ok(await page.locator('.tb').isVisible());
  });

  await step('Fokus-Modus (CodeMirror): Leiste am Editor, Code gelesen, Zeile markiert, Sprung zur Zeile', async () => {
    await page.goto('https://leetcode.com/problems/function-composition/?cm=1');
    await page.locator('#lcdbg-host .pill').waitFor({ timeout: 5000 });
    await page.waitForTimeout(400);
    const ed = await page.locator('#editor').boundingBox(), b = await page.locator('.pill').boundingBox();
    assert.ok(b.y < ed.y + 40 && b.x + b.width > ed.x + ed.width - 60, 'Knopf oben rechts im Editor, nicht unten in der Ecke: ' + JSON.stringify(b));
    await page.locator('.pill').click();
    await waitText('.r2', /Alle 3 Beispiele stimmen/);
    const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.cm-content')).paddingTop));
    assert.ok(pad > 30, 'Platz für die Leiste über dem Code: ' + pad);
    // die ersten Schritte liegen im Testaufruf – weiter, bis eine Zeile im Code dran ist
    for (let k = 0; k < 15 && !(await page.locator('.lcdbg-cm-layer .lcdbg-cm-bar').count()); k++) await click('[data-kind="next"]');
    const hit = await page.evaluate(() => {
      const bar = document.querySelector('.lcdbg-cm-layer .lcdbg-cm-bar'), iv = document.querySelector('.lcdbg-cm-layer .lcdbg-cm-iv.cur');
      if (!bar) return null;
      const y = bar.getBoundingClientRect().top;
      const i = [...document.querySelectorAll('.cm-line')].findIndex((l) => Math.abs(l.getBoundingClientRect().top - y) < 2);
      return { line: i + 1, text: iv ? iv.textContent : '' };
    });
    assert.ok(hit && hit.line > 0, 'Markierung liegt auf einer Codezeile: ' + JSON.stringify(hit));
    await page.evaluate((c) => window.__setCode(c), SOLUTION.replace('fn(acc)', 'fn(acc).value.x'));
    await page.locator('[data-act="check"]').click();
    await page.locator('[data-act="menu"]').click();
    await page.locator('.item', { hasText: 'Beispiel 1' }).click();
    await waitText('.r2', /TypeError\s*Zeile 8/);
    assert.ok(await page.locator('.lcdbg-cm-layer .lcdbg-cm-bar.err').count(), 'Fehlerzeile rot');
    await page.locator('button.ln', { hasText: 'Zeile 8' }).click();
    const sel = await page.evaluate(() => window.__cmSel);
    assert.strictEqual(sel.anchor, SOLUTION.split('\n').slice(0, 7).join('\n').length + 1, 'Auswahl am Anfang von Zeile 8');
    await page.locator('[data-act="close"]').click();
    await page.waitForTimeout(100);
    assert.strictEqual(await page.locator('.lcdbg-cm-layer').count(), 0, 'Markierungen weg');
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).paddingTop), '0px');
  });

  await step('Gefangener Fehler: Zeile, Erklärung und stille Fehler sichtbar (To Be Or Not To Be)', async () => {
    await page.goto('https://leetcode.com/problems/to-be-or-not-to-be/');
    await page.locator('.lcdbg-overlay .pill').waitFor({ timeout: 5000 });
    await page.locator('.pill').click();
    await waitText('.r2', /ReferenceError\s*Zeile 15/);
    const extra = await text('.card');
    assert.match(extra, /toBe is not defined/);
    assert.match(extra, /eine Methode deines Objekts \(Zeile 7\)/);
    assert.match(extra, /Z\. 14\s*„toBe“ steht zweimal im Objekt/);
    assert.match(extra, /verdeckt „val“ aus Zeile 5/);
    assert.match(extra, /throw new Error\("Not Equal"\)/);
    assert.doesNotMatch(extra, /bekommen/, 'kein doppeltes {error: …}');
    if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-fehler.png') });
    // Zeilenknopf springt in den Code, Einklappen lässt nur die Überschrift stehen
    await page.locator('button.ln', { hasText: 'Zeile 15' }).click();
    assert.strictEqual(await page.evaluate(() => window.__revealed), 15);
    await page.locator('[data-act="fold"]').click();
    assert.strictEqual(await page.locator('.card .msg').count(), 0);
    await page.locator('[data-act="fold"]').click();
    assert.strictEqual(await page.locator('.card .msg').count(), 1);
    await page.waitForTimeout(100);
    const zone = await page.evaluate(() => window.__zones.map((z) => [z.afterLineNumber, z.domNode.textContent]));
    assert.deepStrictEqual(zone.map((z) => z[0]), [15], 'Fehlerkasten an der Stelle des Wurfs');
  });

  // ---------------------------------------------------------------- Gescheiterte Einsendung

  await step('Einsendung scheitert: Fall wird mitgehört, Knopf meldet ihn', async () => {
    await page.goto('https://leetcode.com/problems/ransom-note/');
    await page.locator('.lcdbg-overlay .pill').waitFor({ timeout: 5000 });
    await page.evaluate(async (code) => {
      await fetch('/problems/ransom-note/submit/', { method: 'POST', body: JSON.stringify({ lang: 'javascript', question_id: '383', typed_code: code }) });
      const x = new XMLHttpRequest();   // LeetCode fragt das Ergebnis teils per XHR ab
      await new Promise((r) => { x.onload = r; x.open('GET', '/submissions/detail/987654321/check/'); x.send(); });
    }, RANSOM);
    await page.waitForFunction(() => /Fehlschlag debuggen/.test(document.querySelector('.lcdbg-overlay').shadowRoot.querySelector('.pill').textContent), null, { timeout: 4000 });
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('lcdbg:subs:ransom-note')));
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].input, '"aab"\n"baa"');
    assert.strictEqual(stored[0].code, RANSOM, 'eingesendeter Code gemerkt');
  });

  await step('Debuggen springt direkt zum gescheiterten Fall, Beispiele stimmen trotzdem', async () => {
    await page.locator('.pill').click();
    await waitText('.r2', /Falsches Ergebnis/);
    assert.match(await text('.cmp'), /erwartet\s*true\s*bekommen\s*false/);
    assert.match(await text('.case'), /✗\s*Einsendung/);
    await page.locator('[data-act="menu"]').click();
    const items = (await page.locator('.item').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert.deepStrictEqual(items.slice(0, 4).map((t) => t.split(' ').slice(0, 3).join(' ')),
      ['✓ Beispiel 1', '✓ Beispiel 2', '✓ Beispiel 3', '✗ Einsendung falsches']);
    assert.match(await text('.hd.sub'), /Gescheitert bei LeetCode/);
    if (SHOT) await page.screenshot({ path: SHOT.replace(/\.png$/, '-einsendung.png') });
    await page.locator('[data-act="menu"]').click();
    await page.locator('[data-act="panel"]').click();
    await page.locator('[data-act="tab"][data-tab="harness"]').click();
    assert.match(await page.locator('#harness').inputValue(), /\/\/ Einsendung – erwartet: true[\s\S]*const ransomNote = "aab";[\s\S]*canConstruct\(ransomNote, magazine\);/);
    await page.locator('[data-act="panel"]').click();
  });

  await step('Werte im Code auch für Namen mit Umlaut, Callback zeigt den Fehler', async () => {
    await nextUntil(/Als Nächstes: Zeile 13/);
    assert.match(await afterText(11) || '', /zähler1 = \{/);
    await nextUntil(/every-Callback wird aufgerufen/);
    assert.match(await afterText(17) || '', /→ schlüssel = \\?"0\\?", wert = \\?"a\\?"/);
  });

  await step('Fall entfernen, dann aus dem sichtbaren Ergebnisfeld übernehmen', async () => {
    await page.locator('[data-act="menu"]').click();
    await page.locator('[data-act="dropSub"]').click();
    await page.waitForFunction(() => !/Einsendung/.test(document.querySelector('.lcdbg-overlay').shadowRoot.querySelector('.drop').innerText));
    assert.strictEqual((await page.evaluate(() => JSON.parse(localStorage.getItem('lcdbg:subs:ransom-note')))).length, 0);
    await page.locator('[data-act="menu"]').click();
    // So sieht das Feld nach „Submit“ bei LeetCode aus (Text wie im Screenshot)
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'result';
      d.innerHTML = '<div><h3>Wrong Answer</h3><span>39 / 130 testcases passed</span></div><div>Input</div><button>Use Testcase</button>' +
        '<div><div>ransomNote =</div><div>"aab"</div></div><div><div>magazine =</div><div>"baa"</div></div>' +
        '<div>Output</div><div>false</div><div>Expected</div><div>true</div><div>Code</div><div>|</div><div>JavaScript</div>';
      document.querySelector('[data-track-load]').prepend(d);
    });
    await page.locator('[data-act="check"]').click();
    await waitText('.r2', /Falsches Ergebnis/);
    assert.match(await text('.cmp'), /erwartet\s*true\s*bekommen\s*false/);
    await page.locator('[data-act="close"]').click();
  });

  // ---------------------------------------------------------------- Selbst-Update aus GitHub

  // Nachbau der GitHub-API: liefert diesen Ordner, mit erkennbaren Änderungen als „neue Version“
  const gh = { sha: 'a'.repeat(40), shell: 2, auth: [], n304: 0, files: 0 };
  const remote = (f) => {
    let t = fs.readFileSync(path.join(EXT, f), 'utf8');
    if (f === 'manifest.json') t = t.replace(/"version": "[^"]+"/, '"version": "9.0.0"');
    if (f === 'update.json') t = t.replace(/"shell": \d+/, `"shell": ${gh.shell}`);
    if (f === 'ui.js') t = t.split('🐞 Debuggen').join('🐞 Debuggen v9');
    if (f === 'engine.js') t = t.replace('stimmen.`', 'stimmen (GitHub).`');
    return t;
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, accept, x-github-api-version, if-none-match');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    if (req.method === 'OPTIONS') return res.end();
    gh.auth.push(req.headers.authorization || '');
    if (u.pathname === '/repos/me/dbg/commits') {
      const etag = `"e-${gh.sha}"`;
      if (req.headers['if-none-match'] === etag) { gh.n304++; res.statusCode = 304; return res.end(); }
      res.setHeader('ETag', etag);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(!u.searchParams.has('path') ? [{ sha: gh.sha }] : []));
    }
    const m = u.pathname.match(/^\/repos\/me\/dbg\/contents\/(.+)$/);
    if (m && u.searchParams.get('ref') === gh.sha) { gh.files++; return res.end(remote(decodeURIComponent(m[1]))); }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const API = 'http://127.0.0.1:' + server.address().port;
  const popup = async () => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${EXT_ID}/popup.html#alle`);
    await p.locator('#upd:not(:text("…"))').waitFor({ timeout: 5000 });
    return p;
  };

  await step('Ohne „Nutzerskripts zulassen“: Ordner läuft, Fenster sagt „F5 reicht“', async () => {
    await sw.evaluate((api) => chrome.storage.local.set({ cfg: { api, repo: 'me/dbg', token: 'geheim' } }), API);
    const p = await popup();
    assert.match(await p.locator('#upd').innerText(), /Läuft aus dem Ordner[\s\S]*neu laden \(F5\)[\s\S]*Nutzerskripts zulassen/);
    assert.ok(await p.locator('#details').isVisible());
    await p.close();
  });

  await step('Datei im Ordner geändert: F5 auf LeetCode reicht, kein neues Paket', async () => {
    const files = { 'ui.js': ['🐞 Debuggen', '🐞 Debuggen frisch'], 'engine.js': ['stimmen.`', 'stimmen (frisch).`'] };
    const old = {};
    try {
      for (const [f, [a, b]] of Object.entries(files)) {
        old[f] = fs.readFileSync(path.join(EXT, f), 'utf8');
        fs.writeFileSync(path.join(EXT, f), old[f].split(a).join(b));
      }
      await page.goto('https://leetcode.com/problems/function-composition/');
      await page.waitForFunction(() => {
        const o = document.querySelector('.lcdbg-overlay');
        return o && /frisch/.test(o.shadowRoot.querySelector('.pill').textContent);
      }, null, { timeout: 6000 });
      assert.strictEqual(await page.locator('.lcdbg-overlay').count(), 1, 'Debugger läuft genau einmal');
      await page.locator('.pill').click();
      await waitText('.r2', /Alle 3 Beispiele stimmen \(frisch\)/);
      await page.locator('[data-act="close"]').click();
    } finally {
      for (const f of Object.keys(old)) fs.writeFileSync(path.join(EXT, f), old[f]);
    }
    await page.reload();
    await page.locator('.lcdbg-overlay .pill').waitFor({ timeout: 5000 });
    assert.doesNotMatch(await page.locator('.lcdbg-overlay .pill').innerText(), /frisch/);
  });

  await step('Schalter an + „Nach Updates suchen“: neuer Stand kommt aus GitHub', async () => {
    const ext = await ctx.newPage();
    await ext.goto('chrome://extensions/?id=' + EXT_ID);
    await ext.locator('#allow-user-scripts').click();
    await ext.close();
    await page.goto('https://leetcode.com/problems/function-composition/');
    await page.locator('.lcdbg-overlay .pill').waitFor({ timeout: 5000 });
    const p = await popup();
    await p.locator('#check').click();
    await p.waitForFunction(() => /Update auf v9\.0\.0 geladen/.test(document.querySelector('#upd').innerText), null, { timeout: 8000 });
    assert.match(await p.locator('#checks').innerText(), /Debugger 2.5.1 geladen[\s\S]*Seite neu laden, um v9\.0\.0 zu nutzen/);
    if (SHOT) { await p.setViewportSize({ width: 340, height: 420 }); await p.screenshot({ path: SHOT.replace(/\.png$/, '-update.png') }); }
    assert.match(await p.locator('#v').innerText(), /v9\.0\.0/);
    assert.ok(gh.auth.includes('Bearer geheim'), 'Token geht als Authorization mit');
    assert.strictEqual(gh.files, 9, 'update.json, manifest.json und 7 Code-Dateien');
    await p.close();
    // offener LeetCode-Tab bekommt den Hinweis zum Neuladen
    await page.locator('#lcdbg-toast').waitFor({ timeout: 3000 });
    assert.match(await page.locator('#lcdbg-toast .t').innerText(), /9\.0\.0[\s\S]*Neu laden/);
  });

  await step('Nach Neuladen läuft der GitHub-Stand – Seite und Engine, nur einmal', async () => {
    await page.locator('#lcdbg-toast button.go').click();
    await page.waitForFunction(() => {
      const o = document.querySelector('.lcdbg-overlay');
      return o && /v9/.test(o.shadowRoot.querySelector('.pill').textContent);
    }, null, { timeout: 6000 });
    assert.strictEqual(await page.locator('.lcdbg-overlay').count(), 1, 'Debugger läuft genau einmal');
    assert.strictEqual((await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length, 0, 'Paket-Anmeldung ist weg');
    await page.locator('.pill').click();
    await waitText('.r2', /Alle 3 Beispiele stimmen \(GitHub\)/);
    await page.locator('[data-act="close"]').click();
  });

  await step('Nichts Neues: bedingte Anfrage (304), kein erneuter Download', async () => {
    const before = gh.files, n304 = gh.n304;
    const p = await popup();
    await p.locator('#check').click();
    for (let k = 0; k < 100 && gh.n304 === n304; k++) await p.waitForTimeout(50);
    assert.ok(gh.n304 > n304, '304 genutzt');
    // das Update von eben bleibt als Hinweis stehen
    await p.waitForFunction(() => /Update auf v9\.0\.0 geladen[\s\S]*geprüft vor/.test(document.querySelector('#upd').innerText), null, { timeout: 5000 });
    assert.strictEqual(gh.files, before);
    await p.close();
  });

  await step('Neuer Rahmen nötig: alter Stand bleibt aktiv, Fenster sagt es', async () => {
    gh.sha = 'b'.repeat(40);
    gh.shell = 3;
    const p = await popup();
    await p.locator('#check').click();
    await p.locator('#upd.warn').waitFor({ timeout: 5000 });
    assert.match(await p.locator('#upd').innerText(), /braucht einmal ein neues Paket[\s\S]*läuft v9\.0\.0/);
    await p.close();
  });

  await step('Falsches Repo: verständliche Meldung, Ordner läuft weiter', async () => {
    await sw.evaluate(() => chrome.storage.local.get('cfg').then(({ cfg }) => chrome.storage.local.set({ cfg: Object.assign(cfg, { repo: 'me/gibtsnicht' }) })));
    const p = await popup();
    await p.locator('#check').click();
    await p.locator('#upd.bad').waitFor({ timeout: 5000 });
    assert.match(await p.locator('#upd').innerText(), /Nicht gefunden \(404\)[\s\S]*läuft weiter v2\.\d+\.\d+ \(Ordner\)/);
    assert.ok(await p.locator('#settings').evaluate((d) => d.open), 'Einstellungen klappen auf');
    await p.close();
  });

  await step('Ohne Token: öffentliches Repo wird trotzdem abgefragt', async () => {
    await sw.evaluate(() => chrome.storage.local.get('cfg').then(({ cfg }) => chrome.storage.local.set({ cfg: Object.assign(cfg, { token: '', repo: 'me/dbg' }) })));
    const n = gh.auth.length;
    const p = await popup();
    await p.locator('#check').click();
    for (let k = 0; k < 100 && gh.auth.length === n; k++) await p.waitForTimeout(50);
    assert.ok(gh.auth.length > n, 'Anfrage an GitHub');
    assert.strictEqual(gh.auth[gh.auth.length - 1], '', 'ohne Authorization-Header');
    await p.waitForFunction(() => !/Nicht gefunden|Token/.test(document.querySelector('#upd').innerText), null, { timeout: 5000 });
    await p.close();
  });
  server.close();

  if (errors.length) { console.log('Fehler in der Konsole:\n  ' + errors.join('\n  ')); process.exitCode = 1; }
  await ctx.close();
})();
