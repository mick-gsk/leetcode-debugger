/* Lern-Coach, API-Karten: Signatur, Rückgabe, ob das Original verändert wird, und die typische Falle
 * der gängigen JavaScript-Builtins. Die Karte erklärt nur; den Namen tippt der Nutzer selbst
 * (Abruf statt Einfügen). Läuft in der Hauptwelt (coach.js) und in Node (test/coach.test.js). */
(() => {
  'use strict';

  // [Besitzer, Name, Signatur, Rückgabe, verändert Original (true/false/null = nicht zutreffend), Falle]
  const ROWS = [
    // Array
    ['Array', 'map', 'map(callback(x, i, arr))', 'neues Array, gleiche Länge', false, 'Ohne return im Callback (geschweifte Klammern!) kommt überall undefined heraus.'],
    ['Array', 'filter', 'filter(callback(x, i, arr))', 'neues Array mit den Elementen, für die der Callback truthy liefert', false, 'Der Callback muss einen Wahrheitswert zurückgeben, nicht das Element.'],
    ['Array', 'reduce', 'reduce(callback(acc, x, i, arr), init)', 'ein einzelner Wert (acc nach dem letzten Element)', false, 'Ohne Startwert ist acc zuerst das erste Element – bei leerem Array gibt es dann einen TypeError.'],
    ['Array', 'reduceRight', 'reduceRight(callback(acc, x, i, arr), init)', 'ein einzelner Wert, von rechts nach links gefaltet', false, 'Wie reduce: ohne Startwert beginnt acc mit dem letzten Element.'],
    ['Array', 'forEach', 'forEach(callback(x, i, arr))', 'undefined', false, 'return im Callback bricht die Schleife nicht ab, und das Ergebnis ist immer undefined.'],
    ['Array', 'some', 'some(callback(x, i, arr))', 'true, sobald ein Element passt', false, 'Bei leerem Array immer false.'],
    ['Array', 'every', 'every(callback(x, i, arr))', 'true, wenn alle Elemente passen', false, 'Bei leerem Array immer true.'],
    ['Array', 'find', 'find(callback(x, i, arr))', 'erstes passendes Element oder undefined', false, 'undefined heißt „nicht gefunden“ – aber auch ein gefundenes undefined sieht so aus.'],
    ['Array', 'findIndex', 'findIndex(callback(x, i, arr))', 'Index des ersten Treffers oder -1', false, '-1 ist truthy: if (arr.findIndex(…)) prüft nicht, ob etwas gefunden wurde.'],
    ['Array', 'findLast', 'findLast(callback(x, i, arr))', 'letztes passendes Element oder undefined', false, 'Gibt es erst ab ES2023 – in sehr alten Umgebungen fehlt es.'],
    ['Array', 'includes', 'includes(wert, ab)', 'true/false', false, 'Vergleicht mit === (außer NaN): Objekte und Arrays werden nur als dieselbe Referenz gefunden.'],
    ['Array', 'indexOf', 'indexOf(wert, ab)', 'erster Index oder -1', false, 'Findet NaN nie; -1 ist truthy.'],
    ['Array', 'lastIndexOf', 'lastIndexOf(wert, ab)', 'letzter Index oder -1', false, 'Sucht rückwärts ab „ab“, nicht vorwärts.'],
    ['Array', 'slice', 'slice(start, ende)', 'neues Teil-Array (ende exklusiv)', false, 'ende ist exklusiv; negative Werte zählen vom Ende.'],
    ['Array', 'splice', 'splice(start, anzahl, ...neu)', 'Array der entfernten Elemente', true, 'Verändert das Original und gibt die ENTFERNTEN Elemente zurück, nicht das neue Array.'],
    ['Array', 'push', 'push(...werte)', 'neue Länge', true, 'Gibt die Länge zurück, nicht das Array – return arr.push(x) liefert eine Zahl.'],
    ['Array', 'pop', 'pop()', 'entferntes letztes Element', true, 'Bei leerem Array undefined, kein Fehler.'],
    ['Array', 'shift', 'shift()', 'entferntes erstes Element', true, 'O(n): alle Elemente rücken nach – in Schleifen als Queue langsam.'],
    ['Array', 'unshift', 'unshift(...werte)', 'neue Länge', true, 'O(n) wie shift; gibt die Länge zurück.'],
    ['Array', 'sort', 'sort(vergleich(a, b))', 'dasselbe, sortierte Array', true, 'Ohne Vergleichsfunktion wird als Text sortiert: [10, 9, 1] → [1, 10, 9]. Für Zahlen: (a, b) => a - b.'],
    ['Array', 'toSorted', 'toSorted(vergleich(a, b))', 'neues sortiertes Array', false, 'Wie sort ohne Vergleichsfunktion als Text sortiert; erst ab ES2023.'],
    ['Array', 'reverse', 'reverse()', 'dasselbe, umgedrehte Array', true, 'Verändert das Original – vorher kopieren, wenn du es noch brauchst.'],
    ['Array', 'join', 'join(trenner)', 'String', false, 'Standard-Trenner ist ein Komma, nicht leer: join() ≠ join("").'],
    ['Array', 'concat', 'concat(...arraysOderWerte)', 'neues Array', false, 'Flacht nur eine Ebene ab.'],
    ['Array', 'flat', 'flat(tiefe)', 'neues, abgeflachtes Array', false, 'Standard-Tiefe ist 1; ganz flach mit flat(Infinity).'],
    ['Array', 'flatMap', 'flatMap(callback(x, i, arr))', 'neues Array, eine Ebene abgeflacht', false, 'Flacht nur genau eine Ebene ab.'],
    ['Array', 'fill', 'fill(wert, start, ende)', 'dasselbe Array', true, 'new Array(n).fill([]) teilt EIN Array auf alle Plätze – für Zeilen Array.from nehmen.'],
    ['Array', 'at', 'at(index)', 'Element oder undefined', false, 'Negative Indizes zählen vom Ende: at(-1) ist das letzte Element.'],
    ['Array', 'keys', 'keys()', 'Iterator über die Indizes', false, 'Liefert einen Iterator, kein Array – für Array-Methoden erst [...arr.keys()].'],
    ['Array', 'entries', 'entries()', 'Iterator über [index, wert]', false, 'Iterator, kein Array.'],
    ['Array', 'from', 'Array.from(iterierbar, map(x, i))', 'neues Array', null, 'Array.from({ length: n }, () => []) erzeugt n verschiedene Arrays.'],
    ['Array', 'isArray', 'Array.isArray(wert)', 'true/false', null, 'typeof [] ist "object" – deshalb Array.isArray.'],
    ['Array', 'of', 'Array.of(...werte)', 'neues Array', null, 'Array(3) erzeugt 3 leere Plätze, Array.of(3) dagegen [3].'],
    // String
    ['String', 'split', 'split(trenner, limit)', 'Array von Strings', false, 'split("") zerlegt in Zeichen, split() ohne Argument gibt [ganzer String].'],
    ['String', 'slice', 'slice(start, ende)', 'Teil-String (ende exklusiv)', false, 'Strings sind unveränderlich – das Ergebnis muss gespeichert werden.'],
    ['String', 'substring', 'substring(start, ende)', 'Teil-String', false, 'Vertauscht start und ende, wenn start > ende; negative Werte werden 0.'],
    ['String', 'charAt', 'charAt(index)', 'Zeichen oder ""', false, 'Außerhalb des Strings "" statt undefined.'],
    ['String', 'charCodeAt', 'charCodeAt(index)', 'Zahl (UTF-16-Code)', false, '"a".charCodeAt(0) ist 97 – für Index im Alphabet: c.charCodeAt(0) - 97.'],
    ['String', 'fromCharCode', 'String.fromCharCode(...codes)', 'String', null, 'Statische Methode: String.fromCharCode, nicht "x".fromCharCode.'],
    ['String', 'startsWith', 'startsWith(suche, ab)', 'true/false', false, 'Groß/klein zählt.'],
    ['String', 'endsWith', 'endsWith(suche, länge)', 'true/false', false, 'Groß/klein zählt.'],
    ['String', 'repeat', 'repeat(anzahl)', 'String', false, 'Negative Anzahl wirft einen RangeError.'],
    ['String', 'padStart', 'padStart(länge, füllung)', 'String', false, 'länge ist die Ziellänge, nicht die Zahl der Füllzeichen.'],
    ['String', 'padEnd', 'padEnd(länge, füllung)', 'String', false, 'länge ist die Ziellänge.'],
    ['String', 'toLowerCase', 'toLowerCase()', 'String', false, 'Verändert den String nicht – Ergebnis zuweisen.'],
    ['String', 'toUpperCase', 'toUpperCase()', 'String', false, 'Verändert den String nicht – Ergebnis zuweisen.'],
    ['String', 'trim', 'trim()', 'String ohne Leerraum an den Rändern', false, 'Entfernt nur Ränder, nicht Leerzeichen in der Mitte.'],
    ['String', 'replace', 'replace(muster, ersatz)', 'neuer String', false, 'Mit einem String als Muster wird nur der ERSTE Treffer ersetzt – replaceAll oder /x/g.'],
    ['String', 'replaceAll', 'replaceAll(muster, ersatz)', 'neuer String', false, 'Mit Regex muss das g-Flag gesetzt sein, sonst TypeError.'],
    ['String', 'localeCompare', 'localeCompare(anderer)', 'negativ, 0 oder positiv', false, 'Zum Sortieren von Strings: arr.sort((a, b) => a.localeCompare(b)).'],
    // Object
    ['Object', 'keys', 'Object.keys(obj)', 'Array der eigenen Schlüssel (Strings)', null, 'Schlüssel sind immer Strings – Zahlen-Schlüssel kommen als "1" zurück.'],
    ['Object', 'values', 'Object.values(obj)', 'Array der Werte', null, 'Nur eigene, aufzählbare Eigenschaften.'],
    ['Object', 'entries', 'Object.entries(obj)', 'Array von [schlüssel, wert]', null, 'Auf einen String angewendet liefert es [index, zeichen] – nicht die Zeichen-Häufigkeit.'],
    ['Object', 'fromEntries', 'Object.fromEntries(paare)', 'neues Objekt', null, 'Gegenstück zu entries; nimmt auch eine Map.'],
    ['Object', 'assign', 'Object.assign(ziel, ...quellen)', 'das Ziel-Objekt', true, 'Verändert das erste Argument; nur flache Kopie.'],
    ['Object', 'freeze', 'Object.freeze(obj)', 'dasselbe Objekt', true, 'Nur flach eingefroren: verschachtelte Objekte bleiben änderbar.'],
    ['Object', 'hasOwn', 'Object.hasOwn(obj, schlüssel)', 'true/false', null, '"k" in obj prüft auch geerbte Eigenschaften, hasOwn nicht.'],
    ['Object', 'hasOwnProperty', 'hasOwnProperty(schlüssel)', 'true/false', false, 'Bei Objekten ohne Prototyp fehlt die Methode – Object.hasOwn ist sicherer.'],
    // Map / Set
    ['Map', 'get', 'get(schlüssel)', 'Wert oder undefined', false, 'Objekte als Schlüssel werden per Referenz verglichen: get([1,2]) findet kein anderes [1,2].'],
    ['Map', 'set', 'set(schlüssel, wert)', 'dieselbe Map (verkettbar)', true, 'map[k] = v setzt eine Objekt-Eigenschaft, keinen Map-Eintrag – immer set/get.'],
    ['Map', 'has', 'has(schlüssel)', 'true/false', false, 'Gespeichertes undefined: has ist true, get liefert trotzdem undefined.'],
    ['Map', 'delete', 'delete(schlüssel)', 'true, wenn es den Schlüssel gab', true, 'Gibt einen Wahrheitswert zurück, nicht die Map.'],
    ['Map', 'size', 'size', 'Anzahl der Einträge', null, 'Eigenschaft ohne Klammern; .length gibt es bei Map/Set nicht.'],
    ['Map', 'clear', 'clear()', 'undefined', true, 'Leert die Map für alle, die sie referenzieren.'],
    ['Set', 'add', 'add(wert)', 'dasselbe Set (verkettbar)', true, 'Arrays/Objekte werden per Referenz unterschieden: zwei [1] sind zwei Einträge.'],
    // Math / Number / JSON
    ['Math', 'max', 'Math.max(...zahlen)', 'größte Zahl', null, 'Mit einem Array braucht es Spread: Math.max(...arr); leer ergibt -Infinity.'],
    ['Math', 'min', 'Math.min(...zahlen)', 'kleinste Zahl', null, 'Leer ergibt Infinity; bei sehr großen Arrays sprengt der Spread den Stack.'],
    ['Math', 'floor', 'Math.floor(x)', 'abgerundete Zahl', null, 'Bei negativen Zahlen Richtung -∞: floor(-1.5) ist -2 – Math.trunc schneidet ab.'],
    ['Math', 'ceil', 'Math.ceil(x)', 'aufgerundete Zahl', null, 'ceil(-1.5) ist -1.'],
    ['Math', 'round', 'Math.round(x)', 'gerundete Zahl', null, '.5 wird Richtung +∞ gerundet: round(-2.5) ist -2.'],
    ['Math', 'abs', 'Math.abs(x)', 'Betrag', null, 'Math.abs("-3") wandelt um und ergibt 3 – Eingabetyp prüfen.'],
    ['Math', 'trunc', 'Math.trunc(x)', 'Zahl ohne Nachkommastellen', null, 'Anders als floor bei negativen Zahlen.'],
    ['Number', 'isInteger', 'Number.isInteger(wert)', 'true/false', null, 'Strings sind nie Integer: isInteger("5") ist false.'],
    ['Number', 'parseInt', 'parseInt(text, basis)', 'Zahl oder NaN', null, 'Immer die Basis angeben; parseInt liest nur bis zum ersten Nicht-Ziffern-Zeichen.'],
    ['JSON', 'stringify', 'JSON.stringify(wert, ersetzer, einrückung)', 'String', null, 'Funktionen und undefined fallen weg; Map/Set werden zu {}. Reihenfolge der Schlüssel zählt.'],
    ['JSON', 'parse', 'JSON.parse(text)', 'Wert', null, 'Wirft bei ungültigem JSON einen SyntaxError.'],
    // Promise / Timer / Function
    ['Promise', 'all', 'Promise.all(promises)', 'Promise auf Array der Ergebnisse (gleiche Reihenfolge)', null, 'Scheitert sofort beim ersten reject; Reihenfolge ist die der Eingabe, nicht die der Fertigstellung.'],
    ['Promise', 'allSettled', 'Promise.allSettled(promises)', 'Promise auf Array von {status, value|reason}', null, 'Scheitert nie – Fehler stehen als status "rejected" im Ergebnis.'],
    ['Promise', 'race', 'Promise.race(promises)', 'Promise des zuerst fertigen', null, 'Auch ein reject gewinnt das Rennen.'],
    ['Promise', 'any', 'Promise.any(promises)', 'Promise des ersten erfolgreichen', null, 'Scheitern alle, gibt es einen AggregateError.'],
    ['Promise', 'resolve', 'Promise.resolve(wert)', 'erfülltes Promise', null, 'Ein übergebenes Promise wird nicht doppelt verpackt.'],
    ['Promise', 'reject', 'Promise.reject(grund)', 'abgelehntes Promise', null, 'Ohne catch gibt es einen „unhandled rejection“-Fehler.'],
    ['Promise', 'then', 'then(onErfüllt, onAbgelehnt)', 'neues Promise', false, 'Ohne return im Callback ist das nächste Glied undefined.'],
    ['Promise', 'catch', 'catch(onAbgelehnt)', 'neues Promise', false, 'Nach catch geht die Kette erfüllt weiter, wenn du nicht erneut wirfst.'],
    ['Promise', 'finally', 'finally(callback())', 'neues Promise mit dem ursprünglichen Ergebnis', false, 'Der Callback bekommt keinen Wert und ändert das Ergebnis nicht.'],
    ['global', 'setTimeout', 'setTimeout(callback, ms, ...args)', 'Timer-ID', null, 'ms ist eine Mindestzeit; der Callback läuft frühestens nach dem aktuellen Code.'],
    ['global', 'clearTimeout', 'clearTimeout(id)', 'undefined', null, 'Braucht die ID von setTimeout – also das Ergebnis speichern.'],
    ['global', 'setInterval', 'setInterval(callback, ms, ...args)', 'Timer-ID', null, 'Läuft ewig, bis clearInterval kommt.'],
    ['global', 'clearInterval', 'clearInterval(id)', 'undefined', null, 'Ohne gespeicherte ID kein Stoppen.'],
    ['Function', 'apply', 'fn.apply(thisWert, argumentArray)', 'Ergebnis von fn', null, 'Argumente als ARRAY – bei call einzeln.'],
    ['Function', 'call', 'fn.call(thisWert, ...argumente)', 'Ergebnis von fn', null, 'Argumente einzeln – bei apply als Array.'],
    ['Function', 'bind', 'fn.bind(thisWert, ...argumente)', 'neue Funktion', null, 'Ruft fn NICHT auf, sondern gibt eine gebundene Funktion zurück.'],
  ];

  const API = ROWS.map(([owner, name, sig, returns, mutates, pitfall]) => ({ owner, name, sig, returns, mutates, pitfall }));

  function lookup(prefix, limit = 4) {
    const p = String(prefix || '').toLowerCase();
    if (!p) return [];
    const seen = new Set();
    return API.filter((e) => e.name.toLowerCase().startsWith(p))
      .sort((a, b) => (b.name.toLowerCase() === p) - (a.name.toLowerCase() === p) || a.name.length - b.name.length || a.name.localeCompare(b.name))
      .filter((e) => { const k = e.owner + '.' + e.name; if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, limit);
  }
  const byName = (name) => API.filter((e) => e.name === name);

  const api = { API, lookup, byName };
  if (typeof window !== 'undefined') window.LCDBG_COACH_API = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})();
