/* LeetCode-Debugger – Kern.
 * Instrumentiert JavaScript (Acorn), führt es aus und zeichnet jeden Schritt mit
 * Variablenwerten auf. Läuft in der Sandbox-Seite der Extension und in Node (Tests).
 * Jede Einfügung steht zwischen den Markern, damit Funktionstexte wieder auf den
 * Originalcode zurückgeführt werden können. Einfügungen enthalten keine Zeilenumbrüche,
 * deshalb bleiben die Zeilennummern identisch mit dem Original. */
(function (root) {
  'use strict';
  const acorn = root.acorn || (typeof require === 'function' ? require('./vendor/acorn.js') : null);

  const OPEN = '/*‹*/', CLOSE = '/*›*/';
  const MARK_RE = /\/\*‹\*\/[\s\S]*?\/\*›\*\//g;
  const GET = '__v=>eval(__v)';

  // ---------------------------------------------------------------- Instrumentierung

  function patternNames(p, out) {
    if (!p) return out;
    switch (p.type) {
      case 'Identifier': out.push(p.name); break;
      case 'ObjectPattern': for (const pr of p.properties) patternNames(pr.type === 'Property' ? pr.value : pr, out); break;
      case 'ArrayPattern': for (const el of p.elements) patternNames(el, out); break;
      case 'RestElement': patternNames(p.argument, out); break;
      case 'AssignmentPattern': patternNames(p.left, out); break;
    }
    return out;
  }

  // var-Deklarationen eines Funktionskörpers (ohne verschachtelte Funktionen)
  function collectVars(node, out) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { for (const n of node) collectVars(n, out); return out; }
    if (typeof node.type !== 'string' || /Function/.test(node.type)) return out;
    if (node.type === 'VariableDeclaration' && node.kind === 'var')
      for (const d of node.declarations) for (const n of patternNames(d.id, [])) out.push({ name: n, pos: node.start });
    for (const k in node) if (k !== 'loc' && node[k] && typeof node[k] === 'object') collectVars(node[k], out);
    return out;
  }

  // let/const/class/function direkt in einer Anweisungsliste
  function collectLexical(list) {
    const out = [];
    for (const s of list) {
      if (s.type === 'VariableDeclaration' && s.kind !== 'var')
        for (const d of s.declarations) for (const n of patternNames(d.id, [])) out.push({ name: n, pos: s.start });
      else if (s.type === 'ClassDeclaration' && s.id) out.push({ name: s.id.name, pos: s.start });
      else if (s.type === 'FunctionDeclaration' && s.id) out.push({ name: s.id.name, pos: -1 });
    }
    return out;
  }

  function instrument(src, opts) {
    opts = opts || {};
    const harnessStart = opts.harnessStart == null ? Infinity : opts.harnessStart;
    const ast = acorn.parse(src, {
      ecmaVersion: 'latest', sourceType: 'script', locations: true, preserveParens: true,
      allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true,
    });
    const ins = [], sites = [], scopes = [], fnStack = [];
    let seq = 0;
    const add = (pos, text, kind, depth) => ins.push({ pos, text: OPEN + text + CLOSE, kind, depth, seq: seq++ });
    const site = (o) => (sites.push(o), sites.length - 1);

    function visible(pos) {
      const seen = new Set(), out = [];
      let outer = false;
      for (let i = scopes.length - 1; i >= 0; i--) {
        const sc = scopes[i];
        for (const n of sc.names) {
          if (seen.has(n.name) || n.pos >= pos) continue;
          seen.add(n.name);
          out.push({ name: n.name, outer, top: !!sc.top });
        }
        if (sc.fn) outer = true;
      }
      return out;
    }

    function fnName(node, parent) {
      if (node.id) return node.id.name;
      if (!parent) return '(anonym)';
      switch (parent.type) {
        case 'VariableDeclarator': return parent.id.type === 'Identifier' ? parent.id.name : '(anonym)';
        case 'AssignmentExpression': return src.slice(parent.left.start, parent.left.end);
        case 'Property': case 'MethodDefinition': case 'PropertyDefinition': {
          const k = parent.key;
          return k.type === 'Identifier' ? k.name : k.type === 'PrivateIdentifier' ? '#' + k.name : src.slice(k.start, k.end);
        }
        case 'CallExpression': case 'NewExpression': {
          if (parent.callee === node) return '(anonym)';
          const c = parent.callee;
          const n = c.type === 'MemberExpression' && !c.computed ? c.property.name : c.type === 'Identifier' ? c.name : null;
          return n ? n + '-Callback' : 'Callback';
        }
        case 'ReturnStatement':
          return fnStack.length ? 'Rückgabe von ' + fnStack[fnStack.length - 1] : '(anonym)';
      }
      return '(anonym)';
    }

    function stmtList(list, depth, isProgram) {
      list.forEach((s, i) => {
        const skip = s.type === 'FunctionDeclaration' || s.type === 'EmptyStatement' ||
          (s.type === 'ExpressionStatement' && s.directive);
        if (!skip) {
          const id = site({ kind: 'line', line: s.loc.start.line, names: visible(s.start) });
          add(s.start, `__s(${id},${GET});`, 'open', depth);
        }
        // letzte Anweisung des Testaufrufs liefert das Ergebnis
        if (isProgram && i === list.length - 1 && s.start >= harnessStart) {
          let e = null;
          if (s.type === 'ExpressionStatement') e = s.expression;
          else if (s.type === 'VariableDeclaration' && s.declarations.length === 1) e = s.declarations[0].init;
          if (e) {
            add(e.start, '__done(', 'open', depth + 0.5);
            add(e.end, ')', 'close', depth + 0.5);
          }
        }
        walk(s, null, depth + 1);
      });
    }

    function ctrlBody(body, depth) {
      if (body.type === 'BlockStatement') return walk(body, null, depth);
      add(body.start, '{', 'open', depth);
      stmtList([body], depth + 1);
      add(body.end, '}', 'close', depth);
    }

    function loopBody(body, depth) {
      if (body.type === 'BlockStatement') {
        add(body.start + 1, '__t();', 'open', depth);   // Endlosschleifen-Schutz auch bei leerem Block
        return walk(body, null, depth + 1);
      }
      add(body.start, '{__t();', 'open', depth);
      stmtList([body], depth + 1);
      add(body.end, '}', 'close', depth);
    }

    function func(node, parent, depth) {
      let name = fnName(node, parent);
      if (name === '(anonym)' && node.type === 'ArrowFunctionExpression' && node.end - node.start <= 30)
        name = src.slice(node.start, node.end).replace(/\s+/g, ' ');
      const params = node.params.flatMap((p) => patternNames(p, []));
      const names = params.map((n) => ({ name: n, pos: -1 }));
      const block = node.body.type === 'BlockStatement';
      if (block) names.push(...collectVars(node.body.body, []), ...collectLexical(node.body.body));
      scopes.push({ names, fn: true });
      fnStack.push(name);
      for (const p of node.params) walk(p, node, depth + 1);
      const start = block ? node.body.start + 1 : node.body.start;
      const fid = site({ kind: 'call', name, line: node.loc.start.line, params, names: visible(start) });
      if (block && !node.body.body.length) {
        add(start, `__e(${fid},${GET});try{}finally{__x(${fid})}`, 'open', depth);
      } else if (block) {
        add(start, `__e(${fid},${GET});try{`, 'open', depth);
        stmtList(node.body.body, depth + 1);
        add(node.body.end - 1, `}catch(__err){throw __k(__err)}finally{__x(${fid})}`, 'close', depth);
      } else {
        const rid = site({ kind: 'return', line: node.body.loc.start.line, names: visible(start) });
        add(start, `{__e(${fid},${GET});try{return __r(${rid},${GET},`, 'open', depth);
        walk(node.body, node, depth + 1);
        add(node.body.end, `)}catch(__err){throw __k(__err)}finally{__x(${fid})}}`, 'close', depth);
      }
      fnStack.pop();
      scopes.pop();
    }

    function walk(node, parent, depth) {
      if (!node || typeof node.type !== 'string') return;
      switch (node.type) {
        case 'Program':
          scopes.push({ names: collectVars(node.body, []).concat(collectLexical(node.body)), fn: true, top: true });
          stmtList(node.body, depth, true);
          scopes.pop();
          return;
        case 'BlockStatement':
          scopes.push({ names: collectLexical(node.body), fn: false });
          stmtList(node.body, depth);
          scopes.pop();
          return;
        case 'SwitchStatement':
          walk(node.discriminant, node, depth + 1);
          scopes.push({ names: collectLexical([].concat(...node.cases.map((c) => c.consequent))), fn: false });
          for (const c of node.cases) { if (c.test) walk(c.test, c, depth + 1); stmtList(c.consequent, depth + 1); }
          scopes.pop();
          return;
        case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
          func(node, parent, depth);
          return;
        case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': {
          const decl = node.type === 'ForStatement' ? node.init : node.left;
          const names = decl && decl.type === 'VariableDeclaration' && decl.kind !== 'var'
            ? decl.declarations.flatMap((d) => patternNames(d.id, [])).map((n) => ({ name: n, pos: -1 })) : [];
          scopes.push({ names, fn: false });
          for (const k of ['init', 'test', 'update', 'left', 'right']) if (node[k]) walk(node[k], node, depth + 1);
          loopBody(node.body, depth + 1);
          scopes.pop();
          return;
        }
        case 'WhileStatement': case 'DoWhileStatement':
          walk(node.test, node, depth + 1);
          loopBody(node.body, depth + 1);
          return;
        case 'IfStatement':
          walk(node.test, node, depth + 1);
          ctrlBody(node.consequent, depth + 1);
          if (node.alternate) ctrlBody(node.alternate, depth + 1);
          return;
        case 'CatchClause':
          scopes.push({ names: patternNames(node.param, []).map((n) => ({ name: n, pos: -1 })), fn: false });
          walk(node.body, node, depth + 1);
          scopes.pop();
          return;
        case 'ReturnStatement':
          if (node.argument) {
            const id = site({ kind: 'return', line: node.loc.start.line, names: visible(node.start) });
            add(node.argument.start, `__r(${id},${GET},`, 'open', depth);
            add(node.argument.end, ')', 'close', depth);
            walk(node.argument, node, depth + 1);
          }
          return;
      }
      for (const k in node) {
        if (k === 'type' || k === 'loc' || k === 'start' || k === 'end') continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, node, depth + 1); }
        else if (v && typeof v.type === 'string') walk(v, node, depth + 1);
      }
    }

    walk(ast, null, 0);

    // gleiche Position: schließende vor öffnenden; öffnende außen→innen, schließende innen→außen
    ins.sort((a, b) => a.pos - b.pos ||
      (a.kind !== b.kind ? (a.kind === 'close' ? -1 : 1)
        : a.kind === 'open' ? a.depth - b.depth || a.seq - b.seq : b.depth - a.depth || b.seq - a.seq));
    let code = '', last = 0;
    for (const i of ins) { code += src.slice(last, i.pos) + i.text; last = i.pos; }
    code += src.slice(last);
    return { code, sites };
  }

  // ---------------------------------------------------------------- Werte anzeigen

  function fnText(f) {
    let s;
    try { s = Function.prototype.toString.call(f); } catch (e) { return 'ƒ'; }
    if (/\{\s*\[native code\]\s*\}\s*$/.test(s)) return 'ƒ ' + (f.name || '') + '() [eingebaut]';
    // Pfeilfunktionen enden im instrumentierten Text vor dem schließenden Marker
    s = s.replace(MARK_RE, '').replace(/\/\*‹\*\/[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
    return s.length > 70 ? s.slice(0, 67) + '…' : s;
  }

  // in Objekten/Arrays nur die Signatur: {toBe: ƒ toBe(val)} statt des halben Quelltexts
  function fnSig(f) {
    const s = fnText(f);
    if (s.charAt(0) === 'ƒ') return s;
    const m = s.match(/^(?:async\s+)?(?:function\s*\*?\s*)?([\w$]*)\s*\(([^)]*)\)/) || s.match(/^(?:async\s+)?()([\w$]+)\s*=>/);
    return m ? `ƒ ${m[1] || f.name || ''}(${m[2].replace(/\s+/g, ' ').trim()})` : 'ƒ ' + (f.name || '');
  }

  const isListNode = (v) => v && typeof v === 'object' && 'val' in v && 'next' in v && !('left' in v);
  const isTreeNode = (v) => v && typeof v === 'object' && 'val' in v && 'left' in v && 'right' in v;

  function listToArray(v) {
    const out = [], seen = new Set();
    while (v && !seen.has(v) && out.length < 1000) { seen.add(v); out.push(v.val); v = v.next; }
    return { arr: out, cyclic: !!v && seen.has(v) };
  }

  function treeToArray(root) {
    const out = [], q = [root];
    while (q.length && out.length < 1000) {
      const n = q.shift();
      if (n) { out.push(n.val); q.push(n.left, n.right); } else out.push(null);
    }
    while (out.length && out[out.length - 1] === null) out.pop();
    return out;
  }

  const keyText = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

  function fmt(v, depth, seen) {
    depth = depth || 0;
    seen = seen || new Set();
    const t = typeof v;
    if (v === null) return 'null';
    if (t === 'undefined') return 'undefined';
    if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (t === 'bigint') return v + 'n';
    if (t === 'string') return JSON.stringify(v);
    if (t === 'boolean') return String(v);
    if (t === 'symbol') return v.toString();
    if (t === 'function') return depth ? fnSig(v) : fnText(v);
    if (seen.has(v)) return '[zirkulär]';
    if (depth > 3) return Array.isArray(v) ? '[…]' : '{…}';
    seen.add(v);
    try {
      if (Array.isArray(v) || ArrayBuffer.isView(v)) {
        const n = v.length, items = [];
        for (let i = 0; i < Math.min(n, 50); i++) items.push(i in v ? fmt(v[i], depth + 1, seen) : '<leer>');
        if (n > 50) items.push(`… +${n - 50}`);
        return (Array.isArray(v) ? '' : v.constructor.name) + '[' + items.join(', ') + ']';
      }
      if (v instanceof Map) {
        const items = [];
        for (const [k, x] of v) { if (items.length >= 30) { items.push('…'); break; } items.push(fmt(k, depth + 1, seen) + ' => ' + fmt(x, depth + 1, seen)); }
        return `Map(${v.size}) {${items.join(', ')}}`;
      }
      if (v instanceof Set) {
        const items = [];
        for (const x of v) { if (items.length >= 30) { items.push('…'); break; } items.push(fmt(x, depth + 1, seen)); }
        return `Set(${v.size}) {${items.join(', ')}}`;
      }
      if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : `Date(${v.toISOString()})`;
      if (v instanceof RegExp) return String(v);
      if (v instanceof Error) return `${v.name}: ${v.message}`;
      if (typeof v.then === 'function') return 'Promise {…}';
      if (isListNode(v)) {
        const { arr, cyclic } = listToArray(v);
        return 'ListNode[' + arr.slice(0, 30).map((x) => fmt(x, depth + 1, seen)).join(' → ') +
          (arr.length > 30 ? ' → …' : '') + (cyclic ? ' → ↺ Zyklus' : '') + ']';
      }
      if (isTreeNode(v)) return 'TreeNode' + JSON.stringify(treeToArray(v).slice(0, 63));
      const proto = Object.getPrototypeOf(v);
      const cname = proto && proto !== Object.prototype && proto.constructor && proto.constructor.name;
      const keys = Object.keys(v), items = [];
      for (const k of keys.slice(0, 30)) {
        let x;
        try { x = fmt(v[k], depth + 1, seen); } catch (e) { x = '<Fehler>'; }
        items.push(keyText(k) + ': ' + x);
      }
      if (keys.length > 30) items.push(`… +${keys.length - 30}`);
      return (cname ? cname + ' ' : '') + '{' + items.join(', ') + '}';
    } finally {
      seen.delete(v);
    }
  }

  // ---------------------------------------------------------------- Ausführen

  class StepLimit extends Error {}

  const HELPERS = {
    ListNode: 'function ListNode(val,next){this.val=(val===undefined?0:val);this.next=(next===undefined?null:next)}',
    TreeNode: 'function TreeNode(val,left,right){this.val=(val===undefined?0:val);this.left=(left===undefined?null:left);this.right=(right===undefined?null:right)}',
    toList: 'function toList(a){let h=null;for(let i=a.length-1;i>=0;i--)h=new ListNode(a[i],h);return h}',
    toTree: 'function toTree(a){if(!a||!a.length||a[0]===null)return null;const r=new TreeNode(a[0]),q=[r];let i=1;while(q.length&&i<a.length){const n=q.shift();if(i<a.length&&a[i]!==null){n.left=new TreeNode(a[i]);q.push(n.left)}i++;if(i<a.length&&a[i]!==null){n.right=new TreeNode(a[i]);q.push(n.right)}i++}return r}',
  };

  function helperSource(src) {
    src = stripComments(src);
    let out = '';
    for (const name of Object.keys(HELPERS)) {
      const declared = new RegExp('(function|class)\\s+' + name + '\\b|(var|let|const)\\s+' + name + '\\b').test(src);
      if (!declared) out += '\n' + HELPERS[name];
    }
    return out;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function run(solution, harness, o) {
    o = Object.assign({ maxSteps: 200000, maxRecord: 5000, timeout: 4000 }, o);
    const sep = solution.endsWith('\n') ? '' : '\n';
    const src = solution + sep + (harness || '');
    const harnessStart = solution.length + sep.length;
    const firstHarnessLine = src.slice(0, harnessStart).split('\n').length;
    const res = {
      src, firstHarnessLine, steps: [], logs: [], hits: {}, hasResult: false, result: undefined,
      resultText: null, error: null, truncated: false, totalSteps: 0, timedOut: false,
    };

    let inst;
    try { inst = instrument(src, { harnessStart }); } catch (e) {
      res.error = {
        kind: 'syntax', name: 'SyntaxError', message: String(e.message).replace(/\s*\(\d+:\d+\)$/, ''),
        line: e.loc ? e.loc.line : null,
      };
      return res;
    }
    const sites = inst.sites;
    res.stmtLines = Array.from(new Set(sites.filter((x) => x.kind === 'line').map((x) => x.line)));
    const stack = [];
    const started = Date.now();
    let frameSeq = 0, lastLine = null, aborted = null;

    const snap = (names, get) => {
      const vars = [];
      for (const n of names) {
        let v;
        try { v = get(n.name); } catch (e) { continue; }
        if (n.top && typeof v === 'function') continue;
        vars.push({ name: n.name, text: fmt(v), outer: n.outer });
      }
      return vars;
    };

    const tick = () => {
      if (aborted) throw aborted;
      res.totalSteps++;
      if (res.totalSteps > o.maxSteps) throw (aborted = new StepLimit(`Mehr als ${o.maxSteps} Schritte – vermutlich eine Endlosschleife oder Rekursion ohne Ende.`));
      if ((res.totalSteps & 1023) === 0 && Date.now() - started > o.timeout)
        throw (aborted = new StepLimit(`Zeitlimit von ${o.timeout / 1000} s überschritten.`));
    };

    const frameInfo = () => {
      const top = stack[stack.length - 1];
      return { depth: stack.length, fn: top ? top.name : null, frame: top ? top.frame : 0, stack: stack.map((f) => f.name) };
    };

    const record = (kind, st, get, extra) => {
      if (res.steps.length >= o.maxRecord) { res.truncated = true; return; }
      res.steps.push(Object.assign({ kind, line: st.line, vars: snap(st.names, get) }, frameInfo(), extra));
    };

    const event = (kind, extra, live) => {
      if (res.steps.length >= o.maxRecord) { res.truncated = true; return; }
      const prev = res.steps[res.steps.length - 1];
      const base = live || !prev ? frameInfo() : { depth: prev.depth, fn: prev.fn, frame: prev.frame, stack: prev.stack };
      res.steps.push(Object.assign({ kind, line: lastLine, vars: prev ? prev.vars : [] }, base, extra));
    };

    const toErr = (e) => {
      if (e instanceof StepLimit) return { kind: 'limit', name: 'Abbruch', message: e.message, line: lastLine };
      const name = e && typeof e === 'object' ? e.name || 'Error' : `throw ${typeof e}`;
      const message = e && e.message !== undefined ? String(e.message) : String(e);
      let line = lastLine;
      const m = e && typeof e.stack === 'string' && e.stack.match(/<anonymous>:(\d+):(\d+)/);
      if (m && +m[1] >= 1 && +m[1] <= src.split('\n').length) line = +m[1];
      return { kind: 'runtime', name, message, line };
    };

    const fail = (e) => { if (!res.error) { res.error = toErr(e); errObj = e; } };
    // Erster Fehler, der eine Funktion deines Codes verlässt – auch wenn der Testaufruf ihn fängt
    // (LeetCodes Prüf-Code macht daraus sonst still {"error": …}). Ein Schritt, an der Stelle des Wurfs.
    let thrownObj, errObj, hasThrown = false;
    const caught = (e) => {
      if (e instanceof StepLimit || (hasThrown && e === thrownObj)) return e;
      if (!hasThrown) {
        hasThrown = true; thrownObj = e;
        res.thrown = Object.assign(toErr(e), { step: res.steps.length });
        event('error', { error: res.thrown, line: res.thrown.line, thrown: true }, true);
      }
      return e;
    };

    const hooks = {
      __s(id, get) {
        tick();
        const st = sites[id];
        lastLine = st.line;
        res.hits[st.line] = (res.hits[st.line] || 0) + 1;
        record('line', st, get);
      },
      __t: tick,
      __e(id, get) {
        tick();
        const st = sites[id];
        stack.push({ fid: id, name: st.name, frame: ++frameSeq });
        lastLine = st.line;
        record('call', st, get, { name: st.name, params: st.params });
      },
      __x(id) {
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i].fid === id) { stack.length = i; break; }
      },
      __r(id, get, v) {
        if (aborted) throw aborted;
        const st = sites[id];
        lastLine = st.line;
        record('return', st, get, { value: fmt(v) });
        return v;
      },
      __done(v) { res.hasResult = true; res.result = v; return v; },
      __k: caught,
    };

    const fakeConsole = {};
    for (const m of ['log', 'info', 'warn', 'error', 'debug', 'dir', 'table']) {
      fakeConsole[m] = (...a) => {
        const text = a.map((x) => (typeof x === 'string' ? x : fmt(x))).join(' ');
        res.logs.push({ text, level: m, step: res.steps.length, line: lastLine });
        event('log', { text, level: m }, true);
      };
    }

    const timers = new Map();
    const safe = (fn, args) => {
      try {
        const r = fn(...args);
        if (r && typeof r.then === 'function') r.then(null, fail);
      } catch (e) { fail(e); }
    };
    const mySetTimeout = (fn, ms, ...a) => {
      const id = setTimeout(() => { timers.delete(id); if (typeof fn === 'function') safe(fn, a); }, ms);
      timers.set(id, 't');
      return id;
    };
    const mySetInterval = (fn, ms, ...a) => {
      const id = setInterval(() => { if (typeof fn === 'function') safe(fn, a); }, ms);
      timers.set(id, 'i');
      return id;
    };
    const myClear = (id) => { clearTimeout(id); clearInterval(id); timers.delete(id); };

    let fn;
    try {
      fn = (0, eval)('(async function(console,setTimeout,clearTimeout,setInterval,clearInterval,__s,__t,__e,__x,__r,__done,__k){' +
        inst.code + helperSource(src) + '\n})');
    } catch (e) {
      res.error = { kind: 'internal', name: e.name, message: 'Interner Fehler beim Vorbereiten: ' + e.message, line: null };
      return res;
    }

    const remaining = () => Math.max(0, o.timeout - (Date.now() - started));
    const TIMEOUT = {};
    const race = (p) => Promise.race([p, sleep(remaining()).then(() => TIMEOUT)]);

    try {
      const r = await race(fn(fakeConsole, mySetTimeout, myClear, mySetInterval, myClear,
        hooks.__s, hooks.__t, hooks.__e, hooks.__x, hooks.__r, hooks.__done, hooks.__k));
      if (r === TIMEOUT) res.timedOut = true;
      if (!res.timedOut && res.hasResult && res.result && typeof res.result.then === 'function') {
        const v = await race(res.result);
        if (v === TIMEOUT) res.timedOut = true; else res.result = v;
      }
    } catch (e) { fail(e); }

    while (!res.error && !res.timedOut && timers.size) {
      if (remaining() <= 0) { res.timedOut = true; break; }
      await sleep(5);
    }
    for (const id of timers.keys()) myClear(id);
    if (!aborted) aborted = new StepLimit('Lauf beendet.');   // späte Callbacks stoppen

    if (res.error && !(hasThrown && errObj === thrownObj)) event('error', { error: res.error, line: res.error.line });
    else if (res.timedOut) event('timeout', {});
    if (res.hasResult && !res.error) {
      res.resultText = fmt(res.result);
      event('done', { value: res.resultText });
    }
    return res;
  }

  // ---------------------------------------------------------------- Vergleich

  function normalize(v, seen) {
    seen = seen || new Set();
    if (v === undefined) return null;
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[zirkulär]';
    if (isListNode(v)) return listToArray(v).arr;
    if (isTreeNode(v)) return treeToArray(v);
    seen.add(v);
    let out;
    if (Array.isArray(v) || ArrayBuffer.isView(v)) out = Array.from(v, (x) => normalize(x, seen));
    else if (v instanceof Map) out = Array.from(v, ([k, x]) => [normalize(k, seen), normalize(x, seen)]);
    else if (v instanceof Set) out = Array.from(v, (x) => normalize(x, seen));
    else { out = {}; for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = normalize(v[k], seen); }
    seen.delete(v);
    return out;
  }

  function deepEqual(a, b) {
    if (typeof a === 'number' && typeof b === 'number')
      return Object.is(a, b) || a === b || Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }

  function parseValue(text) {
    const t = String(text).trim();
    try { return { ok: true, value: JSON.parse(t) }; } catch (e) { /* weiter */ }
    try { return { ok: true, value: (0, eval)('(' + t + ')') }; } catch (e) { /* weiter */ }
    return { ok: false };
  }

  // true/false, oder null wenn die erwartete Ausgabe nicht lesbar ist
  // o.timed: Zeitangaben (Schlüssel t/time oder eine bloße Zahl) dürfen um TIME_TOL ms abweichen,
  // weil Timer im Browser nie auf die Millisekunde genau feuern und der Debugger mitzählt.
  const TIME_TOL = 25;
  function compare(actual, expectedText, o) {
    if (expectedText == null) return null;
    const p = parseValue(expectedText);
    if (!p.ok) return null;
    const a = normalize(actual), b = normalize(p.value);
    if (!(o && o.timed)) return deepEqual(a, b);
    const near = (x, y) => typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) <= TIME_TOL;
    const eq = (x, y) => {
      if (x && y && typeof x === 'object' && typeof y === 'object' && !Array.isArray(x) && !Array.isArray(y)) {
        const kx = Object.keys(x), ky = Object.keys(y);
        return kx.length === ky.length && ky.every((k) => k in x && ((k === 't' || k === 'time') ? near(x[k], y[k]) : eq(x[k], y[k])));
      }
      if (Array.isArray(x) && Array.isArray(y)) return x.length === y.length && x.every((e, i) => eq(e, y[i]));
      return deepEqual(x, y);
    };
    return near(a, b) || eq(a, b);
  }

  // ---------------------------------------------------------------- Beispiele & Testaufruf

  function parseExamples(text) {
    if (!text) return [];
    const t = String(text).replace(/ /g, ' ');
    // „Input:“ oder „Input“ allein auf einer Zeile (so bei flatten-deeply-nested-array)
    const IN = '(?:Input|输入)(?:\\s*[:：]|[ \\t]*\\n)', OUT = '(?:Output|输出)(?:\\s*[:：]|[ \\t]*\\n)';
    const STOP = 'Explanation\\s*[:：]?|解释|Example\\s*\\d|示例|Constraints\\s*[:：]|提示|Follow[- ]?up|Note\\s*[:：]';
    const re = new RegExp(IN + '\\s*([\\s\\S]*?)\\s*' + OUT + '\\s*([\\s\\S]*?)\\s*(?=' + STOP + '|' + IN + '|$)', 'g');
    const out = [];
    let m;
    while ((m = re.exec(t))) {
      if (!m[1] && !m[2]) { re.lastIndex++; continue; }
      // Erklärung mitnehmen: manche Aufgaben nennen dort Werte, die nicht im Input stehen (cancelTimeMs)
      const rest = t.slice(re.lastIndex);
      const note = /^\s*Explanation/.test(rest) ? rest.slice(0, rest.search(/Example\s*\d|Constraints\s*[:：]|$/)) : '';
      out.push({ n: out.length + 1, input: m[1].trim(), output: m[2].trim(), vars: parseInput(m[1].trim()), note });
    }
    return out;
  }

  function parseInput(raw) {
    const s = String(raw);
    const segs = [];
    let depth = 0, q = null, cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        cur += c;
        if (c === '\\') cur += s[++i] || '';
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      if (depth === 0 && (c === ',' || c === '\n')) { segs.push({ text: cur, sep: c }); cur = ''; continue; }
      cur += c;
    }
    segs.push({ text: cur, sep: '' });
    const vars = [];
    let prevSep = '';
    for (const g of segs) {
      if (!g.text.trim()) continue;   // „arr1 = [...],⏎arr2 = …“: Komma und Zeilenumbruch hintereinander
      const m = g.text.match(/^\s*([A-Za-z_$][\w$]*)\s*=(?![=>])\s*([\s\S]*?)\s*$/);
      const last = vars[vars.length - 1];
      if (m) vars.push({ name: m[1], value: m[2] });
      // „n = 10⏎["call","call"]“: neue Zeile mit fertigem Wert ist eine eigene, namenlose Eingabe
      else if (last && prevSep === '\n' && /^\s*[[{"'\d-]/.test(g.text) && !/(=>|[=+\-*/,(])\s*$/.test(last.value)) vars.push({ name: null, value: g.text.trim() });
      else if (last && last.name) last.value += prevSep + g.text.replace(/\s+$/, '');
      else if (g.text.trim()) vars.push({ name: null, value: g.text.trim() });
      prevSep = g.sep;
    }
    let k = 0;
    for (const v of vars) if (!v.name) v.name = 'eingabe' + ++k;
    return vars;
  }

  function stripComments(code) {
    return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
  }

  function splitParams(p) {
    if (p == null) return [];
    const out = [];
    let depth = 0, cur = '';
    for (const c of p) {
      if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  }

  function findMain(solution) {
    const code = stripComments(solution);
    const pats = [
      [/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\*?\s*[\w$]*\s*\(([^)]*)\)/, 'fn'],
      [/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/, 'fn'],
      [/(?:^|[^.\w$])function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/, 'fn'],
      [/Array\.prototype\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)/, 'proto'],
      [/(?:^|[^.\w$])class\s+([A-Za-z_$][\w$]*)/, 'class'],
    ];
    let best = null;
    for (const [re, kind] of pats) {
      const m = re.exec(code);
      if (m && (!best || m.index < best.index))
        best = { index: m.index, name: m[1], params: splitParams(m[2] !== undefined ? m[2] : m[3]), kind };
    }
    // „var X = function(){}; X.prototype.get = …“ ist eine Klasse im alten Stil
    if (best && best.kind === 'fn' && new RegExp('(?:^|[^.\\w$])' + best.name.replace(/\$/g, '\\$') + '\\.prototype\\.[\\w$]+\\s*=').test(code)) best.kind = 'class';
    return best;
  }

  function jsdocTypes(solution) {
    const types = {};
    const re = /@param\s*\{([^}]*)\}\s*\[?([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(solution))) types[m[2]] = m[1];
    return types;
  }

  const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- Treiber für „30 Days of JavaScript“
  // Diese Aufgaben prüft LeetCode nicht mit „Funktion(Eingabe) = Ausgabe“, sondern mit eigenem
  // Treiber-Code (Aktionslisten, Zeitmessung, Ergebnis-Hüllen wie {"value"}). Der wird hier
  // nachgebaut, damit „erwartet“ und „bekommen“ dasselbe Format haben. v = Variablennamen in
  // Reihenfolge des Inputs, ex = Beispiel (für Werte aus der Erklärung).
  const ms = 'Math.round(performance.now() - t0)';
  const DRIVERS = {
    'create-hello-world-function': (v, f) => [`${f}()(...${v[0]});`],
    'return-length-of-arguments-passed': (v, f) => [`${f}(...${v[0]});`],
    'counter': (v, f) => [`const counter = ${f}(${v[0]});`, `${v[1]}.map(() => counter());`],
    'counter-ii': (v, f) => [`const counter = ${f}(${v[0]});`, `${v[1]}.map((name) => counter[name]());`],
    'to-be-or-not-to-be': (v) => [
      `let out;`, `try { out = { value: ${v[0]}() }; } catch (e) { out = { error: e.message }; }`, `out;`],
    'allow-one-function-call': (v, f) => [
      `let fnCalls = 0;`, `const onceFn = ${f}((...a) => { fnCalls++; return ${v[0]}(...a); });`,
      `const out = [];`, `for (const a of ${v[1]}) { const value = onceFn(...a); if (value !== undefined) out.push({ calls: fnCalls, value }); }`, `out;`],
    'memoize': (v, f) => [
      `const fns = {`, `  sum: (a, b) => a + b,`, `  fib: (n) => (n <= 1 ? 1 : fns.fib(n - 1) + fns.fib(n - 2)),`,
      `  factorial: (n) => (n <= 1 ? 1 : n * fns.factorial(n - 1)),`, `};`,
      `let callCount = 0;`, `const memoized = ${f}((...a) => { callCount++; return fns[${v[0]}](...a); });`,
      `${v[1]}.map((a, i) => (a === 'call' ? memoized(...${v[2]}[i]) : callCount));`],
    'sleep': (v, f) => [`const t0 = performance.now();`, `await ${f}(${v[0]});`, `${ms};`],
    'timeout-cancellation': (v, f, ex) => cancelDriver(v, f, ex),
    'interval-cancellation': (v, f, ex) => cancelDriver(v, f, ex),
    'promise-time-limit': (v, f) => [
      `const t0 = performance.now();`,
      `await ${f}(${v[0]}, ${v[2]})(...${v[1]}).then((resolved) => ({ resolved, time: ${ms} }), (rejected) => ({ rejected, time: ${ms} }));`],
    'cache-with-time-limit': (v, f) => [
      `const obj = new ${f}();`,
      `await Promise.all(${v[0]}.map((a, i) => (i === 0 ? null :`,
      `  new Promise((done) => setTimeout(() => done(obj[a](...${v[1]}[i]) ?? null), ${v[2]}[i])))));`],
    'debounce': (v, f) => [
      `const t0 = performance.now(), out = [];`,
      `const debounced = ${f}((...inputs) => out.push({ t: ${ms}, inputs }), ${v[0]});`,
      `for (const c of ${v[1]}) setTimeout(() => debounced(...c.inputs), c.t);`,
      `await new Promise((done) => setTimeout(done, Math.max(...${v[1]}.map((c) => c.t)) + ${v[0]} + 20));`, `out;`],
    'execute-asynchronous-functions-in-parallel': (v, f) => [
      `const t0 = performance.now();`,
      `await ${f}(${v[0]}).then((resolved) => ({ t: ${ms}, resolved }), (rejected) => ({ t: ${ms}, rejected }));`],
    'event-emitter': (v, f) => [
      `const emitter = new ${f}(), subs = [];`,
      `${v[0]}.map((a, i) => {`, `  const [x, y] = ${v[1]}[i];`, `  if (i === 0) return [];`,
      `  if (a === 'subscribe') { subs.push(emitter.subscribe(x, (0, eval)('(' + y + ')'))); return ['subscribed']; }`,
      `  if (a === 'unsubscribe') { subs[x].unsubscribe(); return ['unsubscribed', x]; }`,
      `  return ['emitted', emitter.emit(x, y)];`, `});`],
    'array-wrapper': (v, f) => [
      `const objs = ${v[0]}.map((a) => new ${f}(a));`,
      `${v[1]} === 'Add' ? objs.reduce((sum, o) => sum + o, 0) : String(objs[0]);`],
    'calculator-with-method-chaining': (v, f) => [
      `let out;`,
      `try {`, `  let calc = new ${f}(${v[1]}[0]);`, `  for (let i = 1; i < ${v[0]}.length; i++) calc = calc[${v[0]}[i]](${v[1]}[i]);`,
      `  out = calc;`, `} catch (e) { out = e.message; }`, `out;`],
  };
  function cancelDriver(v, f, ex) {
    const m = /cancelTimeMs\s*=\s*(\d+)/.exec((ex && ex.note) || '');
    return [
      `const cancelTimeMs = ${m ? m[1] : 50};   // aus der Erklärung der Aufgabe`,
      `const t0 = performance.now(), out = [];`,
      `const cancel = ${f}((...a) => out.push({ time: ${ms}, returned: ${v[0]}(...a) }), ${v[1]}, ${v[2]});`,
      `await new Promise((done) => setTimeout(() => { cancel(); done(); }, cancelTimeMs));`, `out;`];
  }
  // Aufgaben, deren Ergebnis Zeiten enthält: die vergleicht compare mit ±TIME_TOL ms
  const TIMED = ['sleep', 'timeout-cancellation', 'interval-cancellation', 'promise-time-limit', 'debounce', 'execute-asynchronous-functions-in-parallel'];
  const timed = (slug) => TIMED.includes(slug);

  function guessHarness(solution, ex, slug) {
    const main = findMain(solution);
    const types = jsdocTypes(solution);
    const vars = (ex && ex.vars) || [];
    const lines = [];
    lines.push(ex ? `// ${ex.label || 'Beispiel ' + ex.n}` + (ex.output ? ` – erwartet: ${oneLine(ex.output)}` : '') : '// Eigener Testfall');
    const driver = slug && DRIVERS[slug];
    if (driver && main && vars.length) {
      for (const v of vars) lines.push(`const ${v.name} = ${v.value};`);
      lines.push('', '// So prüft LeetCode diese Aufgabe. Letzte Zeile = Ergebnis');
      return lines.concat(driver(vars.map((x) => x.name), main.name, ex)).join('\n');
    }
    const conv = (v) => {
      const t = types[v.name] || '';
      if (/ListNode/.test(t) && /^\s*\[/.test(v.value)) return `toList(${v.value})`;
      if (/TreeNode/.test(t) && /^\s*\[/.test(v.value)) return `toTree(${v.value})`;
      return v.value;
    };
    for (const v of vars) lines.push(`const ${v.name} = ${conv(v)};`);
    const names = vars.map((v) => v.name);
    lines.push('');
    if (!main) {
      lines.push('// Funktion nicht erkannt – ruf sie hier selbst auf.', '// Die letzte Zeile ist das Ergebnis, das verglichen wird.');
      return lines.join('\n');
    }
    if (main.kind === 'class') {
      lines.push(
        '// Klassen-Aufgabe: Aufrufe nach Aufgabentext anpassen.',
        '// Die letzte Zeile ist das Ergebnis, das verglichen wird.',
      );
      if (names.length >= 2) {
        lines.push(
          `const obj = new ${main.name}(...[].concat(${names[1]}[0] ?? []));`,
          `const out = [null];`,
          `for (let i = 1; i < ${names[0]}.length; i++) {`,
          `  const a = ${names[1]}[i];`,
          `  out.push(obj[${names[0]}[i]](...(Array.isArray(a) ? a : [a])) ?? null);`,
          `}`,
          `out;`,
        );
      } else lines.push(`const obj = new ${main.name}();`, 'obj;');
      return lines.join('\n');
    }
    lines.push('// Letzte Zeile = Ergebnis, wird mit "erwartet" verglichen');
    let call;
    if (main.kind === 'proto') call = `${names[0] || '[]'}.${main.name}(${names.slice(1).join(', ')})`;
    else {
      // Parameter, die im Input gleich heißen, per Namen zuordnen (timeLimit(fn, t) bei Input fn, inputs, t)
      const pn = main.params.map((x) => x.replace(/=[\s\S]*$/, '').trim());
      const clean = pn.map((x) => x.replace(/^\.\.\./, ''));
      const byName = clean.length && clean.every((x) => names.includes(x));
      const first = byName ? clean : names.slice(0, pn.length);
      call = `${main.name}(${first.map((n, i) => ((pn[i] || '').startsWith('...') ? '...' + n : n)).join(', ')})`;
      const rest = byName ? names.filter((n) => !clean.includes(n)) : names.slice(pn.length);
      if (rest.length) call += `(${rest.map((n) => (n === 'args' ? '...args' : n)).join(', ')})`;
    }
    lines.push(call + ';');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- Gescheiterte Einsendungen

  // LeetCode zeigt nach „Submit“ den ersten Testfall, der scheitert. Zwei Quellen:
  // die Antwort von /submissions/detail/<id>/check/ (Eingabe = eine Zeile pro Parameter, ohne Namen)
  // oder der sichtbare Text des Ergebnisfelds („ransomNote =“ / „"aab"“ …).
  const STATUS_RE = /^(Wrong Answer|Runtime Error|Time Limit Exceeded|Memory Limit Exceeded|Output Limit Exceeded|解答错误|执行出错|超出时间限制|超出内存限制)$/;
  const SECTION = [
    [/^(Last Executed Input|最后执行的输入)$/, 'input'], [/^(Input|输入)$/, 'input'], [/^(Output|输出)$/, 'output'],
    [/^(Stdout|标准输出)$/, 'stdout'], [/^(Expected|Expected Output|预期结果)$/, 'expected'],
    [/^(Code|代码|Runtime Error Message|Editorial|Solutions?)$/, 'end'],
  ];
  const NOISE_RE = /^(Use Testcase|Diff|View more|Copy|\||JavaScript|TypeScript|\d+\s*\/\s*\d+\s*testcases passed.*)$/i;
  const NAME_RE = /^([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*(.*)$/u;

  function parseResultPanel(text) {
    const lines = String(text || '').replace(/ /g, ' ').split('\n').map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => STATUS_RE.test(l));
    if (at < 0) return null;
    const sec = {};
    let cur = null;
    for (const l of lines.slice(at + 1)) {
      const hit = SECTION.find(([re]) => re.test(l));
      if (hit) {
        if (hit[1] === 'end' && Object.keys(sec).length) break;
        cur = sec[hit[1]] ? null : hit[1];   // nur der erste Block jeder Art
        if (cur) sec[cur] = [];
        continue;
      }
      if (cur && !NOISE_RE.test(l)) sec[cur].push(l);
    }
    const vars = [];
    for (const l of sec.input || []) {
      const m = l.match(NAME_RE);
      if (m && !/^[=>]/.test(m[2])) vars.push({ name: m[1], value: m[2] });
      else if (vars.length) vars[vars.length - 1].value += (vars[vars.length - 1].value ? '\n' : '') + l;
    }
    if (!vars.length) return null;
    const join = (k) => (sec[k] && sec[k].length ? sec[k].join('\n') : null);
    return { status: lines[at], vars: vars.map((v) => ({ name: v.name, value: v.value.trim() })), expected: join('expected'), got: join('output') };
  }

  // Rohdaten (aus Netz oder Ergebnisfeld) → Testfall im Format von parseExamples
  function submissionCase(sub, solution) {
    let vars = sub.vars && sub.vars.length ? sub.vars.map((v) => ({ name: v.name, value: v.value })) : null;
    if (!vars) {
      const lines = String(sub.input || '').split('\n').filter((l) => l.trim() !== '');
      const main = findMain(solution || '');
      let names = main && main.kind !== 'class' ? main.params.map((p) => p.replace(/=[\s\S]*$/, '').trim()) : [];
      if (main && main.kind === 'proto') names = ['arr'].concat(names);
      const ok = names.length === lines.length && names.every((n) => /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(n));
      vars = lines.map((v, i) => ({ name: ok ? names[i] : 'eingabe' + (i + 1), value: v.trim() }));
    }
    return {
      n: null, label: sub.label || 'Einsendung', input: vars.map((v) => `${v.name} = ${v.value}`).join(', '),
      output: sub.expected == null || sub.expected === '' ? null : String(sub.expected), vars,
      leetcode: { status: sub.status || null, got: sub.got == null ? null : String(sub.got), code: sub.code || null },
    };
  }

  // Gleiche Eingabe = gleicher Fall (egal ob aus Netz oder Ergebnisfeld)
  const caseSignature = (sub) => (sub.vars && sub.vars.length ? sub.vars.map((v) => v.value) : String(sub.input || '').split('\n'))
    .map((l) => l.trim()).filter(Boolean).join('\n');

  // ---------------------------------------------------------------- Fehler-Hinweise

  // ---------------------------------------------------------------- Auffälligkeiten (ohne Ausführen)
  // Fehler, die JavaScript still schluckt: Sie werfen keinen Fehler, liefern aber das Falsche.
  // Nur Muster, die praktisch immer ein Versehen sind – sonst wird die Liste Rauschen.
  function lint(code) {
    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
    } catch (e) { return []; }
    const out = [];
    const keyName = (k, computed) => (computed ? null : k.type === 'Identifier' ? k.name : k.type === 'Literal' ? String(k.value) : null);
    const fnTypes = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'];
    const scopes = [];   // Parameter der umschließenden Funktionen: [{ names: Map(name → Zeile) }]

    function dupes(items, what) {
      const seen = new Map();
      for (const it of items) {
        if (!it.name) continue;
        const prev = seen.get(it.name);
        // get + set mit gleichem Namen gehören zusammen
        if (prev && !(prev.kind !== it.kind && /^(get|set)$/.test(prev.kind) && /^(get|set)$/.test(it.kind)))
          out.push({ line: it.line, kind: 'dupe', name: it.name,
            message: `„${it.name}“ steht zweimal im ${what} (Zeile ${prev.line} und ${it.line}). Nur die zweite gilt – die aus Zeile ${prev.line} läuft nie.` });
        else seen.set(it.name, it);
      }
    }

    function walk(n) {
      if (!n || typeof n.type !== 'string') return;
      if (n.type === 'ObjectExpression')
        dupes(n.properties.filter((x) => x.type === 'Property').map((x) => ({ name: keyName(x.key, x.computed), kind: x.kind, line: x.loc.start.line })), 'Objekt');
      if (n.type === 'ClassBody')
        dupes(n.body.filter((x) => x.type === 'MethodDefinition' && !x.static && x.kind !== 'constructor')
          .map((x) => ({ name: keyName(x.key, x.computed), kind: x.kind, line: x.loc.start.line })), 'Klasse');
      if (n.type === 'ThrowStatement' && n.argument && (n.argument.type === 'Literal' || n.argument.type === 'TemplateLiteral')) {
        const t = code.slice(n.argument.start, n.argument.end);
        out.push({ line: n.loc.start.line, kind: 'throw',
          message: `throw ${t} wirft nur einen Wert, kein Error. LeetCode liest e.message und bekommt undefined – schreib throw new Error(${t}).` });
      }
      if (fnTypes.includes(n.type)) {
        const own = new Map();
        for (const prm of n.params) for (const id of paramIds(prm)) {
          own.set(id.name, id.loc.start.line);
          for (let i = scopes.length - 1; i >= 0; i--) {
            if (!scopes[i].has(id.name)) continue;
            out.push({ line: id.loc.start.line, kind: 'shadow', name: id.name,
              message: `Parameter „${id.name}“ verdeckt „${id.name}“ aus Zeile ${scopes[i].get(id.name)} – hier drin kommst du an den äußeren Wert nicht mehr heran. Einen der beiden umbenennen.` });
            break;
          }
        }
        scopes.push(own);
        for (const prm of n.params) walk(prm);
        walk(n.body);
        scopes.pop();
        return;
      }
      for (const k of Object.keys(n)) {
        if (k === 'loc') continue;
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v.type === 'string') walk(v);
      }
    }
    function paramIds(p) {
      if (!p) return [];
      if (p.type === 'Identifier') return [p];
      if (p.type === 'AssignmentPattern') return paramIds(p.left);
      if (p.type === 'RestElement') return paramIds(p.argument);
      return [];   // Destructuring: zu selten verwechselt, um zu warnen
    }
    walk(ast);
    // Gleiches Muster mehrfach (zweimal throw "…", zweimal val verdeckt): einmal melden, Zeilen sammeln
    const RANK = { dupe: 0, shadow: 1, throw: 2 }, merged = [];
    for (const f of out) {
      const same = merged.find((g) => g.kind === f.kind && g.kind !== 'dupe' && (g.name || '') === (f.name || ''));
      if (same) same.also.push(f.line); else merged.push(Object.assign({ also: [] }, f));
    }
    return merged.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.line - b.line).slice(0, 3)
      .map((f) => ({ line: f.line, kind: f.kind, message: f.message + (f.also.length ? ` (Ebenso Zeile ${f.also.join(', ')}.)` : '') }));
  }

  function hint(err, code) {
    if (!err) return '';
    const m = err.message || '';
    let x;
    if (err.kind === 'limit') return 'Geh im Verlauf zurück und schau, ob sich die Schleifenbedingung bzw. der Abbruchfall überhaupt ändert.';
    if (err.kind === 'syntax') return 'Der Code lässt sich nicht lesen. Die Zeilenangabe zeigt, wo der Parser aufgegeben hat – der eigentliche Fehler steht oft eine Zeile davor (fehlende Klammer, Komma, Semikolon).';
    if (/Maximum call stack/.test(m)) return 'Rekursion ohne Ende: Der Abbruchfall wird nie erreicht. Prüf im Verlauf, ob das Argument bei jedem Aufruf kleiner wird.';
    if (code && (x = m.match(/(?:^|\.)([\w$]+) is not a function/)) && !new RegExp('(^|[^\\w$])' + x[1] + '\\s*[(:=]').test(code.replace(/\/\/.*$/gm, '')))
      return `„${x[1]}“ gibt es in deinem Code nirgends – das Objekt hat diese Methode nicht. Tippfehler, oder hast du einer zweiten Methode aus Versehen denselben Namen gegeben?`;
    if ((x = m.match(/(\S+) is not a function/))) return `Du rufst ${x[1]} als Funktion auf, aber es ist keine. Schau in den Variablen nach, welchen Wert es an dieser Stelle hat.`;
    if ((x = m.match(/Cannot read propert(?:y|ies) of (undefined|null)(?: \(reading '([^']*)'\))?/))) {
      // Häufigster Anfängerfall: Funktion ohne return liefert undefined, der Testaufruf greift darauf zu
      if (x[1] === 'undefined' && code && !/\breturn\b|=>/.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
        return `Dein Code enthält kein return – deine Funktion gibt also undefined zurück, und der Testaufruf greift darauf ${x[2] ? '.' + x[2] : 'eine Eigenschaft'} zu. Gib das Objekt zurück: return { ${x[2] || '…'}: … }.`;
      return `Ein Wert ist ${x[1]}, und du greifst trotzdem auf ${x[2] ? '.' + x[2] : 'eine Eigenschaft'} zu. Geh einen Schritt zurück und such die Variable, die ${x[1]} ist.`;
    }
    if ((x = m.match(/Cannot set propert(?:y|ies) of (undefined|null)/))) return `Du schreibst in eine Eigenschaft von ${x[1]}. Das Objekt existiert an dieser Stelle noch nicht.`;
    if (code && (x = m.match(/^([\w$]+) is not defined/))) {
      // Methode im Objekt: „toBe(val) {“ oder „toBe: function“ am Zeilenanfang
      const mm = new RegExp('^[ \\t]*(?:async\\s+)?' + x[1] + '\\s*(?:\\([^)]*\\)\\s*\\{|:\\s*(?:async\\s+)?(?:function|\\())', 'm').exec(code);
      if (mm) {
        const line = code.slice(0, mm.index).split('\n').length;
        return `„${x[1]}“ ist eine Methode deines Objekts (Zeile ${line}), keine Variable – ${x[1]}(…) ohne Objekt davor findet sie nicht. Zum Vergleichen nimm den Wert direkt, z. B. den Parameter.`;
      }
    }
    if ((x = m.match(/(\S+) is not defined/))) return `${x[1]} gibt es an dieser Stelle nicht: Tippfehler, nicht deklariert, oder in einem anderen Scope deklariert.`;
    if (/Assignment to constant/.test(m)) return 'Eine const-Variable wird neu zugewiesen. Nimm let, wenn sich der Wert ändern soll.';
    if ((x = m.match(/Cannot access '([^']*)' before initialization/))) return `${x[1]} wird benutzt, bevor die let/const-Zeile erreicht ist (Temporal Dead Zone). Deklaration nach oben ziehen.`;
    if (/is not iterable/.test(m)) return 'Du iterierst (for…of, Spread, Destructuring) über etwas, das kein Array/Iterable ist. Prüf den Wert in den Variablen.';
    if (/Invalid array length/.test(m)) return 'Array-Länge ist negativ oder keine ganze Zahl.';
    return '';
  }

  const api = {
    instrument, run, fmt, compare, timed, lint, parseExamples, parseInput, guessHarness, findMain, hint, normalize, deepEqual,
    parseResultPanel, submissionCase, caseSignature,
  };
  root.LCTracer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
