/* Läuft in der Hauptwelt ab Seitenbeginn: hört bei LeetCodes eigenen Anfragen mit, wenn eine
 * Einsendung („Submit“) zurückkommt, und merkt sich den Testfall, an dem sie gescheitert ist.
 * Liest nur Antworten, ändert nichts und schickt nichts weiter. Ablage: localStorage der Seite,
 * Schlüssel lcdbg:subs:<aufgabe>, höchstens 3 Fälle, neueste zuerst. */
(() => {
  'use strict';
  if (window.__lcdbgNet) return;
  window.__lcdbgNet = true;

  const MAX = 3;
  const WATCH = /\/submissions\/detail\/[^/]+\/check\/?|\/graphql\/?|\/problems\/[^/]+\/submit\/?/;
  const slugNow = () => (location.pathname.match(/^\/problems\/([^/]+)/) || [])[1] || '';
  const lastCode = {};   // zuletzt eingesendeter Code pro Aufgabe (aus der Submit-Anfrage)

  const signature = (input) => String(input || '').replace(/\s+/g, '');   // Umbrüche im Ergebnisfeld zählen nicht

  function remember(slug, sub) {
    if (!slug || !signature(sub.input)) return;
    const key = 'lcdbg:subs:' + slug;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { list = []; }
    const sig = signature(sub.input);
    list = list.filter((x) => signature(x.input || (x.vars || []).map((v) => v.value).join('\n')) !== sig);
    list.unshift(Object.assign({ id: String(Date.now()), at: Date.now(), code: lastCode[slug] || null }, sub));
    try { localStorage.setItem(key, JSON.stringify(list.slice(0, MAX))); } catch (e) { /* voll: dann eben nicht */ }
    window.dispatchEvent(new CustomEvent('lcdbg-submission', { detail: { slug } }));
  }

  // REST: /submissions/detail/<id>/check/ – fertig, wenn state = SUCCESS
  function fromCheck(j, url) {
    if (!j || j.state !== 'SUCCESS') return;
    const id = String(j.submission_id || (url.match(/detail\/([^/]+)\//) || [])[1] || '');
    if (/^runcode_/.test(id) || j.status_code === 10 || j.status_msg === 'Accepted') return;   // „Run“ bzw. bestanden
    const input = j.last_testcase != null && j.last_testcase !== '' ? j.last_testcase : j.input;
    if (input == null || input === '') return;   // z. B. Kompilierfehler: kein Testfall
    remember(slugNow(), {
      id: id || undefined, status: j.status_msg || null, input: String(input),
      expected: j.expected_output != null ? String(j.expected_output) : null,
      got: j.code_output != null ? String(Array.isArray(j.code_output) ? j.code_output.join('\n') : j.code_output) : null,
      error: j.runtime_error || null,
    });
  }

  // GraphQL: submissionDetails (Ansicht einer früheren Einsendung)
  function fromGraphql(j) {
    const d = j && j.data && j.data.submissionDetails;
    if (!d || d.statusCode === 10 || !d.lastTestcase) return;
    const slug = (d.question && d.question.titleSlug) || slugNow();
    if (d.code && !lastCode[slug]) lastCode[slug] = d.code;
    remember(slug, {
      status: d.statusDisplay || d.status_msg || null, input: String(d.lastTestcase),
      expected: d.expectedOutput != null ? String(d.expectedOutput) : null,
      got: d.codeOutput != null ? String(d.codeOutput) : null, error: d.runtimeError || null,
    });
  }

  function inspect(url, text) {
    if (!text || text.length > 2e6) return;
    try {
      if (/\/check\/?/.test(url)) fromCheck(JSON.parse(text), url);
      else if (/graphql/.test(url) && text.includes('lastTestcase')) fromGraphql(JSON.parse(text));
    } catch (e) { /* keine JSON-Antwort */ }
  }

  function noteSubmit(url, body) {
    const m = url.match(/\/problems\/([^/]+)\/submit\/?/);
    if (!m || typeof body !== 'string') return;
    try { const j = JSON.parse(body); if (j && typeof j.typed_code === 'string') lastCode[m[1]] = j.typed_code; } catch (e) { /* egal */ }
  }

  const urlOf = (input) => (typeof input === 'string' ? input : (input && input.url) || String(input));

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = urlOf(input);
        if (WATCH.test(url)) {
          if (/\/submit\/?/.test(url)) noteSubmit(url, init && init.body);
          p.then((r) => r.clone().text()).then((t) => inspect(url, t)).catch(() => {});
        }
      } catch (e) { /* nie die Seite stören */ }
      return p;
    };
  }

  const X = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (X) {
    const open = X.open, send = X.send;
    X.open = function (method, url) {
      try { this.__lcdbgUrl = String(url); } catch (e) { /* egal */ }
      return open.apply(this, arguments);
    };
    X.send = function (body) {
      const url = this.__lcdbgUrl || '';
      try {
        if (WATCH.test(url)) {
          if (/\/submit\/?/.test(url)) noteSubmit(url, body);
          this.addEventListener('load', () => {
            try {
              const t = this.responseType === '' || this.responseType === 'text' ? this.responseText
                : this.responseType === 'json' ? JSON.stringify(this.response) : null;
              inspect(url, t);
            } catch (e) { /* egal */ }
          });
        }
      } catch (e) { /* egal */ }
      return send.apply(this, arguments);
    };
  }
})();
