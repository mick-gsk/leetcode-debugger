# Lern-Coach im LeetCode-Editor – Design (Teil 1)

Stand 03.10.2026 · Freigegeben im Chat (Design) · Ort: `leetcode-debugger/`, gleicher Rahmen wie der Debugger

## Ziel

Ein Autocompleter direkt im LeetCode-Editor, der **den Lerneffekt maximiert, nicht die Tippgeschwindigkeit**.
Er nimmt Syntax und Boilerplate ab (Arbeitsgedächtnis frei), gibt aber keine Algorithmus-Logik heraus.
Wer feststeckt, bekommt gestufte Hinweise, die erst ein eigener Versuch freischaltet.

**Erfolg heißt** (gemessen in Teil 2 aus den Rohdaten von Teil 1):

- Die Lösungsquote ohne Hilfe bei Wiedervorlage oder bei einer strukturgleichen Aufgabe steigt.
- Höchste genutzte Hinweisstufe und Anteil Notausgang sinken über die Wochen.
- Die Abbruchquote bleibt niedrig (Frust-Wächter).

**Nicht-Ziel:** Copilot-Komfort vor dem Lösen. Das Werkzeug soll sich schlechter anfühlen als Copilot.

## Evidenz → Designentscheidungen

| Befund | Stärke | Folge im Design |
|---|---|---|
| Substitution (Lösung generieren lassen) senkt den Skill-Erwerb, Ergänzung (erklären lassen) nicht: Shen & Tamkin 2026 (50 % gegen 67 %, d=0,74), Bastani PNAS 2025 (Prüfung −17 % bei GPT ohne Guardrails) | einzelne große RCTs | Ghost-Text nur Syntax; Logik nie per Tab |
| Leichter Zugang führt dazu, dass Substitution gewählt wird (Lehmann 2024: Copy/Paste erlaubt → weniger Verständnis) | quasi-experimentell | kein Produktiv-Modus vor „Accepted“; enthüllte Zeilen nicht kopierbar |
| Abtippen von KI-Code (Guided-Write-Over) bringt nur Frust, kein Lernplus; **Lead-and-Reveal** (erst Absicht nennen, dann Zeile sehen) gibt den besten Transfer ohne Mehrlast (Kazemitabaar IUI 2025) | Einzelstudie | L4 = Lead-and-Reveal statt „Abtippen“ |
| Hinweis vor dem ersten Versuch und zu schnelles Durchklicken sagen schlechtere Tests voraus (An LAK 2026, n=999); Feedback zum Hilfeverhalten wirkt (Roll 2011) | korrelativ, repliziert / Einzelstudie | Freischaltung durch Versuch; Rückmeldung bei Notausgang und Schnell-Klicken |
| Hinweise auf Abruf schlagen proaktive Hinweise (Razzaq & Heffernan 2010); Inline-Vorschläge unterbrechen das Denken von Novizen (Prather 2024) | Einzelstudie / qualitativ | Ghost-Text erst nach Tipp-Pause oder Taste; Hinweise nur auf Abruf |
| Generation-Effekt d≈0,4, Selbsterklärung g≈0,55, Retrieval g≈0,5 | robust | API-Namen selbst tippen; Selbsterklärung nach Accepted |
| Zeitsperren laden zum Umgehen oder Abbrechen ein; ein Abbruch ist schlechter als ein verratener Schritt | Designannahme | **keine Zeitsperren**, Freischaltung nur durch Handlung; Notausgang statt harter Sperre |

Quellen: Recherche vom 03.10.2026; Links in `README.md` → „Lern-Coach“.

## Bausteine (Teil 1)

### 1. Syntax-Ghost-Text (LLM, streng bewacht)

- **Auslöser:** 1,5 s Tipp-Pause in einer JS-Datei oder `Alt+Shift+Leertaste`. Nie während des Tippens.
- **Anfrage:** an das Ghost-Modell (Standard `anthropic/claude-haiku-4.5`). Kontext: Code bis zum Cursor plus
  ~20 Zeilen danach. Auftrag: höchstens eine Zeile, nur Syntax/Boilerplate.
- **Lokaler Wächter `guardGhost(text, code)`** in `coach-core.js`: ein Tokenizer ohne Abhängigkeiten. Der
  Vorschlag wird verworfen, wenn er eines davon enthält:
  - Kontrollfluss: `if else for while do switch case break continue try catch throw ?`
  - Operatoren außer `=`/`=>`: arithmetisch, Vergleich, logisch, `++ --`, Verbund-Zuweisungen, Spread
  - Member-Zugriff `.name` außer `this.`; API-Namen tippt der Nutzer selbst (Baustein 2)
  - `return` mit Ausdruck
  - einen Bezeichner, der weder im Code vorkommt noch die Fortsetzung des angefangenen Worts ist
  - mehr als eine Zeile oder mehr als 80 Zeichen

  Erlaubt bleiben Klammern schließen, `const`/`let`/`function`/`class`/`constructor`/`new`, Parameterlisten,
  `=>`, Literal-Initialisierungen (`= 0`, `= []`, `= {}`, `= new Map()`), JSDoc und Komma/Semikolon.
- **Anzeige:** `monaco.languages.registerInlineCompletionsProvider`, Tab übernimmt. Fehlt die API in LeetCodes
  Monaco, wird der Ghost-Text als graue `afterContentClassName`-Dekoration gezeichnet (wie die Inline-Werte)
  und Tab per Tasten-Abfang übernommen.
- **Gesperrt nach „Accepted“?** Nein, dann darf er bleiben; die Strenge betrifft den Inhalt, nicht den Zeitpunkt.

### 2. API-Karten (lokal, ohne LLM)

- `coach-api.js`: rund 70 Einträge mit den in *30 Days of JavaScript* und LeetCode-JS typischen Builtins
  (Array, String, Object, Map/Set, Math, JSON, Promise, Timer, Function.prototype, Number). Pro Eintrag:
  - Signatur, Rückgabe
  - verändert das Original? ja/nein
  - eine typische Falle, deutsch (z. B. `sort()` ohne Vergleichsfunktion sortiert als Text)
- **Anzeige** als Monaco-Content-Widget am Cursor, sobald nach `.` mindestens ein Buchstabe steht, der zu einem
  Eintrag passt (höchstens 4 Treffer). Die Karte fügt nichts ein; `Esc` schließt sie. Beim Überfahren eines
  bekannten API-Namens erscheint dieselbe Karte als Hover.
- **LeetCodes eigene Vorschläge** (`quickSuggestions`, `suggestOnTriggerCharacters`) schaltet der Coach aus,
  solange die Aufgabe nicht „Accepted“ ist. Abschaltbar im Fenster am Käfer-Symbol (nicht in der Leiste, damit
  der Zugriff nicht einen Klick entfernt liegt).

### 3. Hinweis-Leiter (LLM, auf Abruf)

Eigenes Overlay-Widget unten rechts im Editor: Knopf **💡 Hinweis** (`Alt+Shift+H`), aufgeklappt das
Hinweis-Panel. Es gibt vier Stufen, jede ein LLM-Aufruf an das Hinweis-Modell (Standard
`anthropic/claude-sonnet-4.6`). Der Kontext jeder Anfrage:

- der Aufgabentext
- der aktuelle Code
- das letzte Testergebnis
- die bisherigen Hinweise zu dieser Aufgabe

| Stufe | Inhalt | Wächter |
|---|---|---|
| L1 Leitfrage | Eine sokratische Frage zum nächsten Engpass im Code | kein Code (`guardProse`) |
| L2 Konzept | Muster/Konzept benennen + warum es hier passt (z. B. „Häufigkeitszählung mit Map“) | kein Code |
| L3 Pseudocode | Deutscher Pseudocode, eine Erklärung pro Zeile (CodeAid-Stil) | keine JS-Syntax (`guardPseudo`) |
| L4 Lead-and-Reveal | Nutzer schreibt, was die nächste Zeile tun soll → Rückmeldung (stimmt / teilweise / nein, warum) → dann die Zeile als Text | Zeile nicht auswählbar, nicht kopierbar |

Verletzt eine Antwort ihren Wächter, wird sie einmal mit verschärftem Auftrag neu angefragt. Scheitert auch
das, zeigt das Panel „Hinweis enthielt Code – verworfen“ und protokolliert das.

**Freischaltung durch eigenen Versuch, nie durch Zeit:**

- **L1** öffnet, sobald es mindestens einen Versuch gibt. Ein Versuch ist ein Lauf mit eigenem Code (🐞-Prüfung,
  LeetCode „Run“ oder „Submit“) oder ein Satz im Feld **„Mein Plan: …“** mit mindestens 6 Wörtern.
- **L2–L4** öffnen jeweils nach einem weiteren Versuch **mit geändertem Code** (Hash ungleich dem des letzten
  Versuchs) seit dem vorigen Hinweis.
- Ab L4 kann L4 wiederholt werden, jede Wiederholung zeigt die jeweils nächste Zeile.
- **Notausgang „Ich komme nicht weiter“:** öffnet die nächste Stufe sofort. Er wird protokolliert und markiert
  die Aufgabe als „assistiert“, genau wie das Erreichen von L4.

**Rückmeldung zum Hilfeverhalten** (eine Zeile im Panel, nicht blockierend):

- beim Notausgang: „Ohne eigenen Versuch – kommt in die Wiedervorlage.“
- wenn die nächste Stufe angefordert wird, bevor die Lesezeit (Wörter ÷ 4 pro Sekunde) um ist:
  „Zu schnell gelesen? Erst probieren, dann die nächste Stufe.“

### 4. Nach „Accepted“: Selbsterklärung, dann Review-Modus

- `net.js` meldet zusätzlich bestandene Einsendungen (`lcdbg-accepted`).
- Das Panel fragt **einen Satz**: Warum ist die Lösung korrekt, welche Laufzeit hat sie? Das LLM gibt eine
  Rückmeldung, kurz und mit Korrektur, wenn nötig. Überspringen ist möglich und wird protokolliert.
- Danach öffnet der **Review-Modus**: Knöpfe „Andere Lösung“, „Komplexität“, „Was ist unidiomatisch?“ und ein
  freies Fragefeld. Hier gibt es keine Einschränkungen; LeetCodes eigene Vorschläge sind wieder an.

### 5. Rohdaten-Log

Jedes Ereignis geht als Zeile in `chrome.storage.local` (`coachLog`, höchstens 5.000 Zeilen, älteste fallen raus):

```
{ t, slug, ev: 'open' | 'attempt' | 'hint' | 'escape' | 'guardReject' | 'fastClick' | 'accepted' | 'selfExpl' | 'review' | 'ghostShown' | 'ghostAccepted',
  level?, src?: 'debug'|'run'|'submit'|'plan', codeHash?, ms? }
```

Das Käfer-Fenster zeigt die Anzahl und hat **„Log exportieren (JSON)“**. Teil 2 wertet das aus.

## Architektur

**Neue Dateien (Debugger-Code, F5 reicht):**

| Datei | Welt | Aufgabe |
|---|---|---|
| `coach-core.js` | Hauptwelt + Node | Reine Logik ohne DOM: Wächter, Freischalt-Zustandsautomat, Prompt-Bau, Antwort-Parser, Lesezeit, Code-Hash. Exportiert für Tests (`module.exports`) |
| `coach-api.js` | Hauptwelt + Node | Daten der API-Karten + `lookup(prefix)` |
| `coach.js` | Hauptwelt | Monaco-Anbindung (Inline-Provider, Karten-Widget, Hover, Optionen), Hinweis-Widget (Shadow DOM, Stil wie `ui.js`), Brücke zu `content.js`, Versuchserkennung |

**Geänderter Debugger-Code:**

- `host.js` sendet nach jeder 🐞-Prüfung `lcdbg-run` (Code-Hash und Ergebnis) und reicht den Aufgabentext auf
  Nachfrage an den Coach.
- `net.js` meldet „Run“ (`runcode_…`) und „Accepted“ als Ereignisse.
- `update.json`: `main` bekommt `coach-core.js`, `coach-api.js` und `coach.js`.

**Geänderter Rahmen (einmal „Aktualisieren“ in `chrome://extensions`):**

- `manifest.json`: Host-Berechtigung `https://openrouter.ai/*`, Version 3.0.0.
- `update.json` `shell: 3`, `background.js` `SHELL = 3`.
- `content.js` reicht `{lcdbgCoach:'req', op:'llm'|'log'|'cfg'}` aus der Hauptwelt an den Hintergrund weiter und
  schickt die Antwort zurück.
- `background.js`:
  - OpenRouter-Aufruf (`POST /api/v1/chat/completions`) mit dem gespeicherten Schlüssel; der Schlüssel verlässt
    den Hintergrund nie.
  - Grenzen: höchstens 400 Ausgabe-Token pro Aufruf, 20 Aufrufe pro Minute, Tageslimit einstellbar (Standard 300).
  - API-Basis-URL einstellbar wie bei GitHub, damit die Tests gegen einen Nachbau laufen.
  - Log anhängen und exportieren.
- `popup.*`: Feld für den OpenRouter-Schlüssel (speichern/löschen), die beiden Modelle, das Tageslimit, den
  Schalter „LeetCode-Vorschläge vor Accepted“, Log-Anzahl und Export.

**Datenfluss LLM:**

```
coach.js ──postMessage──▶ content.js ──runtime.sendMessage──▶ background.js ──fetch──▶ OpenRouter
```

Die Prompts entstehen in `coach-core.js` und sind damit per F5 aktualisierbar. Der Hintergrund prüft nur Form
und Grenzen.

**Sicherheit:**

- Der Schlüssel liegt nur im Extension-Speicher.
- Ehrliche Grenze: Jedes Skript auf leetcode.com kann über dieselbe `postMessage`-Brücke Aufrufe auslösen
  (Kosten, aber kein Schlüssel-Leck). Die Minuten- und Tageslimits deckeln das.
- An OpenRouter gehen Aufgabentext und eigener Code. Das steht so im README.

**Fehlerfälle:**

- Kein Schlüssel: Der 💡-Knopf zeigt „Schlüssel im Käfer-Fenster eintragen“. Ghost-Text ist aus, API-Karten
  laufen weiter.
- Netz- oder HTTP-Fehler: eine Zeile im Panel; der Versuch zählt nicht als Hinweis.
- Limit erreicht: eine Meldung mit Restzeit.

## Tests

- **`test/coach.test.js` (Node):** jeweils positive und negative Fälle für
  - Wächter: Ghost, Prosa, Pseudocode
  - Freischaltung: Versuch, gleicher Hash, Plan-Satz, Notausgang, L4-Wiederholung
  - Lesezeit/Schnell-Klick, Antwort-Parser, API-Lookup
- **`test/coach-e2e.js` (Chromium mit echtem `monaco-editor` aus npm):** gegen den LeetCode-Nachbau und einen
  OpenRouter-Nachbau (lokaler Server, Basis-URL umgestellt). Geprüft werden:
  - Ghost-Text erscheint nach Pause, Tab übernimmt, verbotener Vorschlag erscheint nicht
  - die Karte bei `.red`
  - L1 gesperrt → 🐞-Prüfung → L1 offen
  - L2 erst nach geändertem Code; Notausgang öffnet sofort und protokolliert
  - L4-Zeile ist nicht auswählbar
  - Accepted → Selbsterklärung → Review
  - kein Schlüssel → Hinweis; Log-Export
- Die bestehenden Tests (`tracer.test.js`, `e2e.js`) bleiben grün.

**Nur live prüfbar:**

- ob LeetCodes Monaco `registerInlineCompletionsProvider` anbietet (Rückfall siehe Baustein 1)
- das Antwortformat für „Run“/„Accepted“ (wie bisher bei „Submit“: nicht dokumentiert)

## Teil 2 (eigene Spec, wenn Daten da sind)

- Wiedervorlage assistierter Aufgaben (2–3 Tage, 1–2 Wochen) plus strukturgleiche Aufgabe
- Verblassen pro Konzept (2 hilfefreie Lösungen → Leiter bis L2)
- Statistik im Käfer-Fenster: Lösungsquote bei Wiedervorlage, höchste Stufe, Notausgang-Anteil, Kalibrierung,
  Abbruchquote

## Annahmen (Schwellen sind gesetzt, nicht belegt)

1,5 s Tipp-Pause · 6 Wörter für den Plan-Satz · 4 Wörter/s Lesezeit · 80 Zeichen Ghost-Text · Tageslimit 300 ·
Modellwahl. Alle Werte stehen als Konstanten oben in `coach-core.js`.
