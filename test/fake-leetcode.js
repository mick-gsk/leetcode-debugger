// Gemeinsamer LeetCode-Nachbau für e2e.js und coach-e2e.js: Aufgaben, Beispiellösungen, eine
// Seite mit Monaco-Attrappe (gleiche DOM-Merkmale wie das Original) und eine mit echtem Monaco.
'use strict';

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
    layoutOverlayWidget(w) {
      const n = w.getDomNode(), pos = w.getPosition && w.getPosition();
      n.style.right = '14px'; n.style.pointerEvents = 'auto';
      if (pos && pos.preference === 1) { n.style.top = ''; n.style.bottom = '10px'; } else n.style.top = '0';
    },
    getLayoutInfo: () => ({ width: node.clientWidth, height: node.clientHeight, verticalScrollbarWidth: 14, horizontalScrollbarHeight: 10 }),
    onDidLayoutChange: () => ({ dispose() {} }),
  };
  window.__gutterClick = (line) => mouseCb && mouseCb({ target: { type: 2, position: { lineNumber: line, column: 1 } } });
  window.__hover = null;
  if (!/nomonaco/.test(location.search)) window.monaco = {
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
// Seite mit ECHTEM Monaco (AMD-Loader, ausgeliefert unter /__monaco/vs/ – siehe monacoRoute).
// ?noinline=1 entfernt registerInlineCompletionsProvider, bevor der Editor entsteht (Rückfallpfad).
const makeMonacoPage = (title, desc, code) => `<!doctype html><html class="dark"><head><title>${title} - LeetCode</title>
<link rel="stylesheet" href="/__monaco/vs/editor/editor.main.css"></head>
<body style="background:#1a1a1a;color:#eee;font-family:sans-serif;margin:0">
<div style="display:flex;height:100vh">
  <div data-track-load="description_content" style="width:40%;padding:16px;overflow:auto">${desc}</div>
  <div id="editor" style="flex:1;height:100vh"></div>
</div>
<script>
  window.MonacoEnvironment = { getWorkerUrl: () => 'data:text/javascript,' + encodeURIComponent('self.onmessage = () => {};') };
  // Der Platzhalter-Worker antwortet nie; Monaco bricht seine Anfragen dann mit „Canceled“ ab.
  // Das gibt es auf LeetCode (echte Worker) nicht – hier nicht als Seitenfehler werten.
  window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.message === 'Canceled') e.preventDefault(); });
</script>
<script src="/__monaco/vs/loader.js"></script>
<script>
  require.config({ paths: { vs: '/__monaco/vs' } });
  require(['vs/editor/editor.main'], () => {
    if (/noinline/.test(location.search)) delete monaco.languages.registerInlineCompletionsProvider;
    window.__ed = monaco.editor.create(document.getElementById('editor'), {
      value: ${JSON.stringify(code)}, language: 'javascript', theme: 'vs-dark', automaticLayout: true, fontSize: 14,
    });
  });
</script></body></html>`;

// Liefert die Dateien des global installierten Monaco (Paketname aus MONACO, Standard monaco-editor)
function monacoRoute(fs, path) {
  const root = path.join(require('child_process').execSync('npm root -g').toString().trim(), process.env.MONACO || 'monaco-editor', 'min');
  const types = { '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.json': 'application/json' };
  return [/\/__monaco\//, (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/__monaco\//, ''));
    const f = path.join(root, rel);
    if (!f.startsWith(root) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  }];
}

module.exports = { SOLUTION, COMPOSE_DESC, RANSOM, TOBE, TOBE_DESC, RANSOM_DESC, makePage, makeMonacoPage, monacoRoute };
