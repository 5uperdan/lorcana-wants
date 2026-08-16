# Lorcana Wants Web Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static, dependency-free web page that turns a Lorcana set plus a rarity quantity map plus an optional collection export into a Cardmarket-ready wants list.

**Architecture:** Plain ES modules, no framework and no bundler. `lorcast.js` is the only network code and takes an injected `fetch`; `sets`, `rarities`, `collection`, `wants` and `render` are pure functions with no DOM access; `ui.js` and `main.js` do the DOM wiring and stay thin.

**Tech Stack:** Vanilla JavaScript (ES modules), HTML, CSS. `node --test` for tests — stock Node, nothing installed. GitHub Pages for hosting.

**Spec:** `docs/superpowers/specs/2026-08-16-lorcana-wants-web-design.md`

## Global Constraints

- **No build step and no dependencies.** No npm install, no bundler, no framework. `package.json` exists solely to declare `{"type": "module"}` so Node treats `.js` as ES modules.
- **Tests never touch the network.** `lorcast.js` takes a `fetchImpl` parameter defaulting to global `fetch`; tests pass a stub.
- **Pure modules never touch the DOM.** `sets`, `rarities`, `collection`, `wants`, `render` must be importable under `node --test`, which has no `document`.
- **Data source is Lorcast:** `https://api.lorcast.com/v0/sets` and `https://api.lorcast.com/v0/sets/{code}/cards`. Set names and rarities always come from the API — never hardcode a set list or a rarity list, because the site must not need redeploying when a new set releases.
- **Default quantities:** common 1, uncommon 2, rare 3, super_rare 4, legendary 4, every other rarity 0. Rarity keys are lowercased for lookup (`"Super_rare"` → `"super_rare"`); display uses the API's own casing with underscores replaced by spaces.
- **Output line format:** `<quantity> <name>` when there is no version, `<quantity> <name> - <version>` otherwise. Plain hyphen with a space either side. No expansion qualifier. Names verbatim, including accents.
- **Sorting** is by collector number with the numeric part compared numerically, so `4a` sorts before `40`.
- **`index.html` lives at the repository root**, because GitHub Pages serves the root of `main`.

---

### Task 1: Scaffolding and the Lorcast client

**Files:**
- Create: `package.json`
- Create: `js/lorcast.js`
- Test: `tests/lorcast.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `API_BASE: string`, `LorcastError extends Error`, `fetchSets(fetchImpl?) -> Promise<Array<{code, name, releasedAt}>>`, `fetchSetCards(code, fetchImpl?) -> Promise<Array<{collectorNumber, name, version, rarity}>>`.

- [ ] **Step 1: Create the manifest**

`package.json`:

```json
{
  "name": "lorcana-wants",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

There are no `dependencies` and no `devDependencies`, and there must never be. `npm test` works on stock Node without an install.

- [ ] **Step 2: Write the failing tests**

Create `tests/lorcast.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import { API_BASE, LorcastError, fetchSetCards, fetchSets } from "../js/lorcast.js";

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok, status, json: async () => payload };
  };
  return { fetchImpl, calls };
}

test("fetchSets requests the sets endpoint", async () => {
  const { fetchImpl, calls } = stubFetch({ results: [] });

  await fetchSets(fetchImpl);

  assert.deepEqual(calls, [`${API_BASE}/sets`]);
});

test("fetchSets maps sets to code, name and release date", async () => {
  const { fetchImpl } = stubFetch({
    results: [
      { code: "13", name: "Attack of the Vine!", released_at: "2026-07-17" },
      { code: "P1", name: "Promo Set 1", released_at: "2023-08-18" },
    ],
  });

  assert.deepEqual(await fetchSets(fetchImpl), [
    { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
    { code: "P1", name: "Promo Set 1", releasedAt: "2023-08-18" },
  ]);
});

test("fetchSetCards requests the cards endpoint for the set", async () => {
  const { fetchImpl, calls } = stubFetch([]);

  await fetchSetCards("13", fetchImpl);

  assert.deepEqual(calls, [`${API_BASE}/sets/13/cards`]);
});

test("fetchSetCards maps cards to the fields the tool needs", async () => {
  const { fetchImpl } = stubFetch([
    { collector_number: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
    { collector_number: "102", name: "Piercing Attack", rarity: "Common" },
  ]);

  assert.deepEqual(await fetchSetCards("13", fetchImpl), [
    { collectorNumber: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
    { collectorNumber: "102", name: "Piercing Attack", version: "", rarity: "Common" },
  ]);
});

test("a missing version becomes an empty string, never undefined", async () => {
  const { fetchImpl } = stubFetch([{ collector_number: "1", name: "Circle of Life", rarity: "Rare" }]);
  const [card] = await fetchSetCards("13", fetchImpl);

  assert.equal(card.version, "");
});

test("a non-ok response raises LorcastError naming the status", async () => {
  const { fetchImpl } = stubFetch(null, { ok: false, status: 503 });

  await assert.rejects(() => fetchSets(fetchImpl), (error) => {
    assert.ok(error instanceof LorcastError);
    assert.match(error.message, /503/);
    return true;
  });
});

test("a network failure is wrapped in LorcastError", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };

  await assert.rejects(() => fetchSets(fetchImpl), LorcastError);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/lorcast.test.js`
Expected: FAIL — cannot find module `../js/lorcast.js`

- [ ] **Step 4: Write the implementation**

Create `js/lorcast.js`:

```javascript
/** Lorcast API client. The only code in the project that touches the network. */

export const API_BASE = "https://api.lorcast.com/v0";

export class LorcastError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "LorcastError";
  }
}

async function getJson(path, fetchImpl) {
  const url = `${API_BASE}${path}`;
  let response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new LorcastError(`Could not reach ${url}. Check your connection.`, { cause });
  }
  if (!response.ok) {
    throw new LorcastError(`${url} returned ${response.status}.`);
  }
  return response.json();
}

/** Every set Lorcast knows about, in the order it returns them. */
export async function fetchSets(fetchImpl = fetch) {
  const payload = await getJson("/sets", fetchImpl);
  return (payload.results ?? []).map((set) => ({
    code: set.code,
    name: set.name,
    releasedAt: set.released_at ?? "",
  }));
}

/** Every card in one set, reduced to the fields this tool uses. */
export async function fetchSetCards(code, fetchImpl = fetch) {
  const payload = await getJson(`/sets/${code}/cards`, fetchImpl);
  return (payload ?? []).map((card) => ({
    collectorNumber: card.collector_number,
    name: card.name,
    version: card.version ?? "",
    rarity: card.rarity,
  }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/lorcast.test.js`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add package.json js/lorcast.js tests/lorcast.test.js
git commit -m "Add Lorcast API client"
```

---

### Task 2: Set ordering and rarity defaults

**Files:**
- Create: `js/sets.js`
- Create: `js/rarities.js`
- Test: `tests/sets.test.js`
- Test: `tests/rarities.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: from `sets.js`, `sortSetsNewestFirst(sets) -> Array` and `setLabel(set) -> string`. From `rarities.js`, `DEFAULT_QUANTITIES: object`, `rarityKey(rarity) -> string`, `rarityLabel(rarity) -> string`, `defaultQuantityFor(rarity) -> number`, and `raritiesInSet(cards) -> Array<string>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/sets.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import { setLabel, sortSetsNewestFirst } from "../js/sets.js";

const SETS = [
  { code: "1", name: "The First Chapter", releasedAt: "2023-08-18" },
  { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
  { code: "P2", name: "Promo Set 2", releasedAt: "2024-08-09" },
];

test("sets are ordered newest first", () => {
  assert.deepEqual(
    sortSetsNewestFirst(SETS).map((set) => set.code),
    ["13", "P2", "1"],
  );
});

test("sorting does not mutate the input", () => {
  const original = SETS.map((set) => set.code);

  sortSetsNewestFirst(SETS);

  assert.deepEqual(SETS.map((set) => set.code), original);
});

test("sets with no release date sort last rather than throwing", () => {
  const withUnknown = [...SETS, { code: "X", name: "Unknown", releasedAt: "" }];

  assert.equal(sortSetsNewestFirst(withUnknown).at(-1).code, "X");
});

test("the label carries the name and the release year", () => {
  assert.equal(setLabel(SETS[1]), "Attack of the Vine! (2026)");
});

test("a set with no release date is labelled by name alone", () => {
  assert.equal(setLabel({ code: "X", name: "Unknown", releasedAt: "" }), "Unknown");
});
```

Create `tests/rarities.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_QUANTITIES,
  defaultQuantityFor,
  rarityKey,
  rarityLabel,
  raritiesInSet,
} from "../js/rarities.js";

test("rarity keys are lowercased", () => {
  assert.equal(rarityKey("Super_rare"), "super_rare");
  assert.equal(rarityKey("Common"), "common");
});

test("rarity labels are readable", () => {
  assert.equal(rarityLabel("Super_rare"), "Super rare");
  assert.equal(rarityLabel("Common"), "Common");
});

test("the agreed default quantities are used", () => {
  assert.equal(defaultQuantityFor("Common"), 1);
  assert.equal(defaultQuantityFor("Uncommon"), 2);
  assert.equal(defaultQuantityFor("Rare"), 3);
  assert.equal(defaultQuantityFor("Super_rare"), 4);
  assert.equal(defaultQuantityFor("Legendary"), 4);
});

test("secret rarities default to zero", () => {
  assert.equal(defaultQuantityFor("Epic"), 0);
  assert.equal(defaultQuantityFor("Enchanted"), 0);
  assert.equal(defaultQuantityFor("Iconic"), 0);
});

test("a rarity nobody has seen before defaults to zero rather than failing", () => {
  // A new set must never break the page, so unknown rarities are simply off.
  assert.equal(defaultQuantityFor("Mythic_Whatever"), 0);
});

test("DEFAULT_QUANTITIES holds exactly the wanted rarities", () => {
  assert.deepEqual(DEFAULT_QUANTITIES, {
    common: 1,
    uncommon: 2,
    rare: 3,
    super_rare: 4,
    legendary: 4,
  });
});

test("rarities in a set are listed once each, in first-seen order", () => {
  const cards = [
    { rarity: "Common" },
    { rarity: "Rare" },
    { rarity: "Common" },
    { rarity: "Enchanted" },
  ];

  assert.deepEqual(raritiesInSet(cards), ["Common", "Rare", "Enchanted"]);
});

test("rarities in an empty set is an empty list", () => {
  assert.deepEqual(raritiesInSet([]), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/sets.test.js tests/rarities.test.js`
Expected: FAIL — cannot find modules `../js/sets.js` and `../js/rarities.js`

- [ ] **Step 3: Write the implementations**

Create `js/sets.js`:

```javascript
/** Ordering and labelling for the set picker. */

/** Newest first. Sets with no release date sort to the end. */
export function sortSetsNewestFirst(sets) {
  return [...sets].sort((a, b) => (b.releasedAt || "").localeCompare(a.releasedAt || ""));
}

/** "Attack of the Vine! (2026)" — the year helps distinguish promo sets. */
export function setLabel(set) {
  const year = (set.releasedAt || "").slice(0, 4);
  return year ? `${set.name} (${year})` : set.name;
}
```

Create `js/rarities.js`:

```javascript
/** Rarity naming and the default quantity for each. */

export const DEFAULT_QUANTITIES = {
  common: 1,
  uncommon: 2,
  rare: 3,
  super_rare: 4,
  legendary: 4,
};

/** Lookup key. Lorcast returns "Super_rare"; we key on "super_rare". */
export function rarityKey(rarity) {
  return String(rarity ?? "").toLowerCase();
}

/** Display form: "Super_rare" reads as "Super rare". */
export function rarityLabel(rarity) {
  return String(rarity ?? "").replaceAll("_", " ");
}

/**
 * Copies wanted by default. Anything not listed — secret rarities today, and
 * whatever Ravensburger invents later — is zero, so an unknown rarity shows up
 * as a field set to 0 rather than breaking the page.
 */
export function defaultQuantityFor(rarity) {
  return DEFAULT_QUANTITIES[rarityKey(rarity)] ?? 0;
}

/** Rarities actually present in a set, once each, in the order they appear. */
export function raritiesInSet(cards) {
  const seen = [];
  for (const card of cards) {
    if (card.rarity && !seen.includes(card.rarity)) seen.push(card.rarity);
  }
  return seen;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/sets.test.js tests/rarities.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: Commit**

```bash
git add js/sets.js js/rarities.js tests/sets.test.js tests/rarities.test.js
git commit -m "Add set ordering and rarity defaults"
```

---

### Task 3: Collection CSV parsing

**Files:**
- Create: `js/collection.js`
- Test: `tests/collection.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCsv(text) -> Array<Array<string>>`, `normaliseSetNumber(value) -> string`, `parseDreambornCsv(text) -> {rows, unparsed}` where each row is `{setCode, collectorNumber, variant, count}`, `ownedForSet(rows, setCode) -> Map<string, {normal, foil}>`, and `PARSERS: {dreamborn: parseDreambornCsv}`.

The `PARSERS` registry is the seam for other collection exports later. Nothing else is built for that now.

- [ ] **Step 1: Write the failing tests**

Create `tests/collection.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import {
  PARSERS,
  normaliseSetNumber,
  ownedForSet,
  parseCsv,
  parseDreambornCsv,
} from "../js/collection.js";

const HEADER = "Set Number,Card Number,Variant,Count,Name,Color,Rarity";

// --- parseCsv -----------------------------------------------------------

test("parseCsv splits plain rows", () => {
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("parseCsv keeps commas inside quoted fields", () => {
  // Real card names contain commas, which is why this cannot be split(",").
  const rows = parseCsv('005,1,normal,4,"Malicious, Mean, and Scary",Amber,Rare');

  assert.equal(rows[0][4], "Malicious, Mean, and Scary");
  assert.equal(rows[0].length, 7);
});

test("parseCsv unescapes doubled quotes", () => {
  assert.deepEqual(parseCsv('"He said ""hi""",2'), [['He said "hi"', "2"]]);
});

test("parseCsv tolerates carriage returns and a trailing newline", () => {
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
});

test("parseCsv ignores blank lines", () => {
  assert.deepEqual(parseCsv("a,b\n\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

// --- normaliseSetNumber -------------------------------------------------

test("leading zeros are stripped to match Lorcast set codes", () => {
  assert.equal(normaliseSetNumber("005"), "5");
  assert.equal(normaliseSetNumber("013"), "13");
});

test("a non-numeric set number is left alone", () => {
  assert.equal(normaliseSetNumber("P1"), "P1");
});

// --- parseDreambornCsv --------------------------------------------------

test("parses the documented columns", () => {
  const { rows } = parseDreambornCsv(
    `${HEADER}\n005,135,normal,2,"Sugar Rush Speedway - Starting Line",Ruby,Rare`,
  );

  assert.deepEqual(rows, [
    { setCode: "5", collectorNumber: "135", variant: "normal", count: 2 },
  ]);
});

test("column order is taken from the header, not assumed", () => {
  const { rows } = parseDreambornCsv("Count,Variant,Card Number,Set Number\n3,foil,7,006");

  assert.deepEqual(rows, [
    { setCode: "6", collectorNumber: "7", variant: "foil", count: 3 },
  ]);
});

test("lettered collector numbers survive intact", () => {
  const { rows } = parseDreambornCsv(`${HEADER}\n003,4a,normal,1,"Dalmatian Puppy",Amber,Common`);

  assert.equal(rows[0].collectorNumber, "4a");
});

test("a missing required column is an error naming the column", () => {
  assert.throws(
    () => parseDreambornCsv("Set Number,Card Number,Count\n005,1,2"),
    /Variant/,
  );
});

test("an empty file is an error rather than an empty collection", () => {
  assert.throws(() => parseDreambornCsv(""), /empty/i);
});

test("rows with an unusable count are reported as unparsed, not dropped silently", () => {
  const { rows, unparsed } = parseDreambornCsv(
    `${HEADER}\n005,1,normal,two,"Bad Row",Amber,Common\n005,2,normal,1,"Good Row",Amber,Common`,
  );

  assert.equal(rows.length, 1);
  assert.equal(unparsed.length, 1);
});

test("variant casing is normalised", () => {
  const { rows } = parseDreambornCsv(`${HEADER}\n005,1,Foil,1,"X",Amber,Common`);

  assert.equal(rows[0].variant, "foil");
});

// --- ownedForSet --------------------------------------------------------

test("owned copies are indexed by collector number for one set", () => {
  const rows = [
    { setCode: "13", collectorNumber: "1", variant: "normal", count: 2 },
    { setCode: "13", collectorNumber: "1", variant: "foil", count: 1 },
    { setCode: "12", collectorNumber: "1", variant: "normal", count: 9 },
  ];

  const owned = ownedForSet(rows, "13");

  assert.deepEqual(owned.get("1"), { normal: 2, foil: 1 });
  assert.equal(owned.size, 1);
});

test("repeated rows for the same card and variant are summed", () => {
  // The real export contains at least one duplicated key.
  const rows = [
    { setCode: "13", collectorNumber: "5", variant: "normal", count: 2 },
    { setCode: "13", collectorNumber: "5", variant: "normal", count: 3 },
  ];

  assert.deepEqual(ownedForSet(rows, "13").get("5"), { normal: 5, foil: 0 });
});

test("a card with no rows is absent rather than zero-filled", () => {
  assert.equal(ownedForSet([], "13").get("1"), undefined);
});

test("the parser registry exposes the dreamborn parser", () => {
  assert.equal(PARSERS.dreamborn, parseDreambornCsv);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/collection.test.js`
Expected: FAIL — cannot find module `../js/collection.js`

- [ ] **Step 3: Write the implementation**

Create `js/collection.js`:

```javascript
/** Reading a collection export into owned-copy counts. */

const REQUIRED_COLUMNS = ["Set Number", "Card Number", "Variant", "Count"];

/**
 * Minimal RFC 4180 parse. Card names contain commas and are quoted, so
 * splitting on commas would corrupt every row containing one.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** "005" is Lorcast's set "5". Non-numeric codes such as "P1" pass through. */
export function normaliseSetNumber(value) {
  const trimmed = String(value ?? "").trim();
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
}

/**
 * Parse a Dreamborn CSV export. Only the four columns this tool needs are
 * read; Name and Rarity are ignored because the API is authoritative for
 * those, which means a stale export still works.
 */
export function parseDreambornCsv(text) {
  const table = parseCsv(text ?? "");
  if (table.length === 0) throw new Error("That file is empty.");

  const header = table[0].map((column) => column.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `That CSV is missing the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. ` +
        `Expected columns: ${REQUIRED_COLUMNS.join(", ")}.`,
    );
  }

  const at = Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)]));
  const rows = [];
  const unparsed = [];

  for (const record of table.slice(1)) {
    const count = Number(record[at.Count]);
    const collectorNumber = String(record[at["Card Number"]] ?? "").trim();
    if (!Number.isInteger(count) || count <= 0 || collectorNumber === "") {
      unparsed.push(record);
      continue;
    }
    rows.push({
      setCode: normaliseSetNumber(record[at["Set Number"]]),
      collectorNumber,
      variant: String(record[at.Variant] ?? "").trim().toLowerCase(),
      count,
    });
  }

  return { rows, unparsed };
}

/** Owned copies for one set, keyed by collector number. */
export function ownedForSet(rows, setCode) {
  const owned = new Map();
  for (const row of rows) {
    if (row.setCode !== String(setCode)) continue;
    const entry = owned.get(row.collectorNumber) ?? { normal: 0, foil: 0 };
    if (row.variant === "foil") entry.foil += row.count;
    else entry.normal += row.count;
    owned.set(row.collectorNumber, entry);
  }
  return owned;
}

/** Seam for other collection exports. Only Dreamborn is implemented. */
export const PARSERS = { dreamborn: parseDreambornCsv };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/collection.test.js`
Expected: PASS, 18 tests

- [ ] **Step 5: Commit**

```bash
git add js/collection.js tests/collection.test.js
git commit -m "Add Dreamborn collection CSV parsing"
```

---

### Task 4: Computing wants

**Files:**
- Create: `js/wants.js`
- Test: `tests/wants.test.js`

**Interfaces:**
- Consumes: `rarities.rarityKey`.
- Produces: `compareCollectorNumbers(a, b) -> number`, `computeWants({cards, quantities, owned, countNormals, countFoils}) -> Array<{collectorNumber, name, version, rarity, quantity}>`, and `summarise(wants) -> {cards, copies}`.

`owned` is a `Map` from collector number to `{normal, foil}`, or an empty `Map` when no collection is loaded. `quantities` is keyed by lowercased rarity.

- [ ] **Step 1: Write the failing tests**

Create `tests/wants.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import { compareCollectorNumbers, computeWants, summarise } from "../js/wants.js";

const CARDS = [
  { collectorNumber: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
  { collectorNumber: "2", name: "Celia Mae", version: "Friendly Receptionist", rarity: "Uncommon" },
  { collectorNumber: "3", name: "Piercing Attack", version: "", rarity: "Common" },
  { collectorNumber: "4", name: "Chernabog", version: "Unnatural Force", rarity: "Legendary" },
  { collectorNumber: "5", name: "Elsa", version: "Spirit of Winter", rarity: "Enchanted" },
];

const QUANTITIES = { common: 1, uncommon: 2, rare: 3, legendary: 4 };

function wants(overrides = {}) {
  return computeWants({
    cards: CARDS,
    quantities: QUANTITIES,
    owned: new Map(),
    countNormals: true,
    countFoils: true,
    ...overrides,
  });
}

test("each card gets the quantity configured for its rarity", () => {
  assert.deepEqual(
    wants().map((want) => [want.name, want.quantity]),
    [["Woody", 3], ["Celia Mae", 2], ["Piercing Attack", 1], ["Chernabog", 4]],
  );
});

test("a rarity set to zero produces no line", () => {
  assert.ok(wants().every((want) => want.name !== "Elsa"));
});

test("a rarity absent from the quantities produces no line", () => {
  const result = computeWants({
    cards: CARDS,
    quantities: { common: 1 },
    owned: new Map(),
    countNormals: true,
    countFoils: true,
  });

  assert.deepEqual(result.map((want) => want.name), ["Piercing Attack"]);
});

test("owned copies are subtracted from the target", () => {
  const owned = new Map([["1", { normal: 1, foil: 0 }]]);

  assert.equal(wants({ owned }).find((want) => want.name === "Woody").quantity, 2);
});

test("a card owned in full produces no line", () => {
  const owned = new Map([["1", { normal: 3, foil: 0 }]]);

  assert.ok(wants({ owned }).every((want) => want.name !== "Woody"));
});

test("owning more than wanted never produces a negative quantity", () => {
  const owned = new Map([["1", { normal: 99, foil: 0 }]]);

  assert.ok(wants({ owned }).every((want) => want.name !== "Woody"));
});

test("foils count toward the target when the foil checkbox is ticked", () => {
  const owned = new Map([["1", { normal: 1, foil: 1 }]]);

  assert.equal(wants({ owned }).find((want) => want.name === "Woody").quantity, 1);
});

test("unticking foils ignores foil copies", () => {
  const owned = new Map([["1", { normal: 1, foil: 1 }]]);

  assert.equal(
    wants({ owned, countFoils: false }).find((want) => want.name === "Woody").quantity,
    2,
  );
});

test("unticking normals ignores normal copies", () => {
  const owned = new Map([["1", { normal: 1, foil: 1 }]]);

  assert.equal(
    wants({ owned, countNormals: false }).find((want) => want.name === "Woody").quantity,
    2,
  );
});

test("unticking both counts nothing as owned", () => {
  const owned = new Map([["1", { normal: 3, foil: 3 }]]);

  assert.equal(
    wants({ owned, countNormals: false, countFoils: false }).find((w) => w.name === "Woody").quantity,
    3,
  );
});

test("cards sharing a name and version are merged into one line", () => {
  // Into the Inklands prints five Dalmatian Puppy - Tail Wagger, 4a to 4e.
  // Cardmarket sees one product name, so five separate lines would be wrong.
  const puppies = ["4a", "4b", "4c", "4d", "4e"].map((collectorNumber) => ({
    collectorNumber,
    name: "Dalmatian Puppy",
    version: "Tail Wagger",
    rarity: "Common",
  }));

  const result = computeWants({
    cards: puppies,
    quantities: { common: 1 },
    owned: new Map(),
    countNormals: true,
    countFoils: true,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].quantity, 5);
});

test("merging happens after subtracting what you own", () => {
  const puppies = ["4a", "4b", "4c"].map((collectorNumber) => ({
    collectorNumber,
    name: "Dalmatian Puppy",
    version: "Tail Wagger",
    rarity: "Common",
  }));

  const result = computeWants({
    cards: puppies,
    quantities: { common: 1 },
    owned: new Map([["4a", { normal: 1, foil: 0 }]]),
    countNormals: true,
    countFoils: true,
  });

  assert.equal(result[0].quantity, 2);
});

test("cards with the same name but different versions stay separate", () => {
  const cards = [
    { collectorNumber: "1", name: "Elsa", version: "Snow Queen", rarity: "Common" },
    { collectorNumber: "2", name: "Elsa", version: "Spirit of Winter", rarity: "Common" },
  ];

  const result = computeWants({
    cards,
    quantities: { common: 1 },
    owned: new Map(),
    countNormals: true,
    countFoils: true,
  });

  assert.equal(result.length, 2);
});

test("collector numbers sort numerically, not as text", () => {
  assert.deepEqual(["10", "9", "100"].sort(compareCollectorNumbers), ["9", "10", "100"]);
});

test("lettered collector numbers sort beside their number", () => {
  assert.deepEqual(["40", "4a", "4"].sort(compareCollectorNumbers), ["4", "4a", "40"]);
});

test("summarise counts distinct lines and total copies", () => {
  assert.deepEqual(summarise(wants()), { cards: 4, copies: 10 });
});

test("summarise of an empty list is zeroes", () => {
  assert.deepEqual(summarise([]), { cards: 0, copies: 0 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/wants.test.js`
Expected: FAIL — cannot find module `../js/wants.js`

- [ ] **Step 3: Write the implementation**

Create `js/wants.js`:

```javascript
/** Turning a set plus quantities plus a collection into a wants list. */

import { rarityKey } from "./rarities.js";

const NUMBER_THEN_SUFFIX = /^(\d+)(.*)$/;

/** "4" < "4a" < "40": compare the numeric part numerically, then the suffix. */
export function compareCollectorNumbers(a, b) {
  const left = NUMBER_THEN_SUFFIX.exec(String(a));
  const right = NUMBER_THEN_SUFFIX.exec(String(b));
  if (!left || !right) return String(a).localeCompare(String(b));
  const difference = Number(left[1]) - Number(right[1]);
  return difference !== 0 ? difference : left[2].localeCompare(right[2]);
}

/**
 * How many copies of each card are still needed.
 *
 * Cards sharing a name and version are merged into a single line, because
 * Cardmarket matches on product name: Into the Inklands prints five
 * "Dalmatian Puppy - Tail Wagger" and five identical lines would be nonsense.
 * Merging happens after subtracting owned copies, so owning 4a reduces the
 * merged total rather than removing a whole line.
 */
export function computeWants({ cards, quantities, owned, countNormals, countFoils }) {
  const merged = new Map();

  for (const card of cards) {
    const target = quantities[rarityKey(card.rarity)] ?? 0;
    if (target <= 0) continue;

    const held = owned.get(card.collectorNumber) ?? { normal: 0, foil: 0 };
    const counted = (countNormals ? held.normal : 0) + (countFoils ? held.foil : 0);
    const needed = Math.max(0, target - counted);
    if (needed === 0) continue;

    const key = `${card.name}\u0000${card.version}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += needed;
      if (compareCollectorNumbers(card.collectorNumber, existing.collectorNumber) < 0) {
        existing.collectorNumber = card.collectorNumber;
      }
    } else {
      merged.set(key, {
        collectorNumber: card.collectorNumber,
        name: card.name,
        version: card.version,
        rarity: card.rarity,
        quantity: needed,
      });
    }
  }

  return [...merged.values()].sort((a, b) =>
    compareCollectorNumbers(a.collectorNumber, b.collectorNumber),
  );
}

/** Distinct lines and total copies, for the summary line under the output. */
export function summarise(wants) {
  return {
    cards: wants.length,
    copies: wants.reduce((total, want) => total + want.quantity, 0),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wants.test.js`
Expected: PASS, 17 tests

- [ ] **Step 5: Commit**

```bash
git add js/wants.js tests/wants.test.js
git commit -m "Add wants computation with collection diffing"
```

---

### Task 5: Rendering the paste format

**Files:**
- Create: `js/render.js`
- Test: `tests/render.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `SEPARATOR: string`, `renderLine(want) -> string`, `renderDecklist(wants) -> string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/render.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

import { SEPARATOR, renderDecklist, renderLine } from "../js/render.js";

const WOODY = { collectorNumber: "1", name: "Woody", version: "Helping a Friend", quantity: 3 };
const PIERCING = { collectorNumber: "102", name: "Piercing Attack", version: "", quantity: 1 };

test("a card with a version renders name then version", () => {
  assert.equal(renderLine(WOODY), "3 Woody - Helping a Friend");
});

test("a card without a version renders the name alone", () => {
  assert.equal(renderLine(PIERCING), "1 Piercing Attack");
});

test("the separator is a spaced hyphen", () => {
  assert.equal(SEPARATOR, " - ");
});

test("hyphens inside a name are untouched", () => {
  const tyler = { collectorNumber: "4", name: "Tyler Nguyen-Baker", version: "4*Town Fan", quantity: 1 };

  assert.equal(renderLine(tyler), "1 Tyler Nguyen-Baker - 4*Town Fan");
});

test("accented names are emitted verbatim", () => {
  const teKa = { collectorNumber: "7", name: "Te Kā", version: "Heartless", quantity: 3 };

  assert.equal(renderLine(teKa), "3 Te Kā - Heartless");
});

test("a decklist is one line per card, newline separated", () => {
  assert.equal(renderDecklist([WOODY, PIERCING]), "3 Woody - Helping a Friend\n1 Piercing Attack");
});

test("an empty decklist is an empty string", () => {
  assert.equal(renderDecklist([]), "");
});

test("a decklist has no trailing newline, so the textarea has no blank last line", () => {
  assert.ok(!renderDecklist([WOODY]).endsWith("\n"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/render.test.js`
Expected: FAIL — cannot find module `../js/render.js`

- [ ] **Step 3: Write the implementation**

Create `js/render.js`:

```javascript
/** Rendering wants into Cardmarket's decklist paste format. */

export const SEPARATOR = " - ";

/**
 * One line of Cardmarket's paste format. A card's name there includes its
 * version subtitle; cards without one are just the name.
 */
export function renderLine(want) {
  const name = want.version ? `${want.name}${SEPARATOR}${want.version}` : want.name;
  return `${want.quantity} ${name}`;
}

export function renderDecklist(wants) {
  return wants.map(renderLine).join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/render.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Run the whole suite**

Run: `node --test tests/`
Expected: PASS, 63 tests

- [ ] **Step 6: Commit**

```bash
git add js/render.js tests/render.test.js
git commit -m "Add Cardmarket paste format rendering"
```

---

### Task 6: The page

**Files:**
- Create: `index.html`
- Create: `styles.css`
- Create: `js/ui.js`
- Create: `js/main.js`

**Interfaces:**
- Consumes: everything above.
- Produces: the page. No exports other modules depend on.

This task has no unit tests: it is DOM wiring over logic already covered, and testing it would need a DOM implementation, which means a dependency. It is verified by hand in Step 5 against the real collection export.

- [ ] **Step 1: Write the page structure**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lorcana Wants</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>Lorcana Wants</h1>
      <p class="lede">
        Build a Cardmarket wants list for a Lorcana set. Upload your collection and it will list only
        the cards you still need.
      </p>

      <section class="panel">
        <h2>How this works</h2>
        <ol>
          <li>Pick a set. Card names and rarities are fetched live, so new sets appear here as soon
            as they are published — nothing here needs updating when a set releases.</li>
          <li>Say how many copies of each rarity you want. The defaults build a playset-style
            collection and leave the rare chase cards out.</li>
          <li>Optionally upload your collection export. Cards you already own are subtracted.</li>
          <li>Copy the result into Cardmarket under
            <strong>Buying → My Wants → your list</strong>, paste it into the decklist field, and
            press Add.</li>
        </ol>
        <p class="note">
          Nothing is uploaded anywhere. Your collection file is read in your browser and never
          leaves your machine.
        </p>
      </section>

      <section class="panel">
        <h2>1. Pick a set</h2>
        <p id="sets-status" class="note">Loading sets…</p>
        <div id="sets" class="sets" role="radiogroup" aria-label="Set"></div>
        <p class="note">
          One set at a time
          <span class="info" tabindex="0" role="note"
            aria-label="Cardmarket matches wants by card name, and the same name can appear in more than one set. Generating one set at a time guarantees a reprint is never confused with the printing you meant.">
            i
            <span class="tip">
              Cardmarket matches wants by card name, and the same name can appear in more than one
              set — <em>I'm Stuck!</em> is in both Rise of the Floodborn and Fabled. Generating one
              set at a time guarantees a reprint is never confused with the printing you meant.
            </span>
          </span>
        </p>
      </section>

      <section class="panel">
        <h2>2. How many of each?</h2>
        <div id="rarities" class="rarities"></div>
        <p class="note">Set a rarity to 0 to leave it out.</p>
      </section>

      <section class="panel">
        <h2>3. Your collection <span class="optional">(optional)</span></h2>
        <p>
          Upload a Dreamborn CSV export. It needs the columns
          <code>Set Number</code>, <code>Card Number</code>, <code>Variant</code> and
          <code>Count</code>:
        </p>
        <pre><code>Set Number,Card Number,Variant,Count,Name,Color,Rarity
005,135,normal,2,"Sugar Rush Speedway - Starting Line",Ruby,Rare
005,32,foil,1,"Amber Chromicon",Amber,Uncommon</code></pre>
        <input type="file" id="collection" accept=".csv,text/csv" />
        <div class="variants">
          <label><input type="checkbox" id="count-normals" checked /> Count my normal copies</label>
          <label><input type="checkbox" id="count-foils" checked /> Count my foil copies</label>
        </div>
        <p id="collection-status" class="note">No collection loaded — the list below is the full set.</p>
      </section>

      <section class="panel">
        <h2>4. Your wants list</h2>
        <p id="summary" class="note"></p>
        <textarea id="output" readonly rows="16" aria-label="Wants list"></textarea>
        <button id="copy" type="button">Copy to clipboard</button>
      </section>
    </main>
    <script type="module" src="js/main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the styles**

Create `styles.css`:

```css
:root {
  color-scheme: light dark;
  --ink: #1c1c20;
  --paper: #fbfbfd;
  --line: #d8d8e0;
  --accent: #4a3f8f;
  --muted: #5f5f6d;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e9e9ee;
    --paper: #17171c;
    --line: #35353f;
    --accent: #a89df0;
    --muted: #a0a0ae;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 2rem 1rem 4rem;
  background: var(--paper);
  color: var(--ink);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
}

main { max-width: 46rem; margin: 0 auto; }
h1 { margin: 0 0 0.25rem; font-size: 1.9rem; }
h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
.lede { margin: 0 0 2rem; color: var(--muted); }

.panel {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1.25rem;
  margin-bottom: 1.25rem;
}

.note { color: var(--muted); font-size: 0.9rem; }
.optional { color: var(--muted); font-weight: normal; }

.sets { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.35rem; }
.sets label { display: flex; gap: 0.5rem; align-items: center; padding: 0.3rem; border-radius: 6px; }
.sets label:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }

.rarities { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: 0.6rem; }
.rarities label { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
.rarities input { width: 4.5rem; padding: 0.3rem; }

.variants { display: flex; flex-wrap: wrap; gap: 1.25rem; margin: 0.75rem 0; }

pre {
  overflow-x: auto;
  background: color-mix(in srgb, var(--ink) 6%, transparent);
  padding: 0.75rem;
  border-radius: 6px;
  font-size: 0.82rem;
}

textarea {
  width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  padding: 0.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink);
}

button {
  margin-top: 0.75rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: var(--accent);
  color: var(--paper);
  font: inherit;
  cursor: pointer;
}

.info {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 50%;
  background: var(--accent);
  color: var(--paper);
  font-size: 0.75rem;
  font-style: italic;
  cursor: help;
}

.info .tip {
  position: absolute;
  bottom: 150%;
  left: 50%;
  transform: translateX(-50%);
  width: min(24rem, 80vw);
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  font-style: normal;
  font-size: 0.85rem;
  text-align: left;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms ease;
  z-index: 2;
}

.info:hover .tip, .info:focus .tip { opacity: 1; visibility: visible; }

.error { color: #b3261e; }
@media (prefers-color-scheme: dark) { .error { color: #f2b8b5; } }
```

- [ ] **Step 3: Write the DOM wiring**

Create `js/ui.js`:

```javascript
/** DOM rendering helpers. Everything here reads or writes the document. */

import { defaultQuantityFor, rarityLabel } from "./rarities.js";
import { setLabel } from "./sets.js";

export const el = (id) => document.getElementById(id);

/** Radio buttons for the sets, newest first, with the first one selected. */
export function renderSetChoices(sets, onChange) {
  const container = el("sets");
  container.replaceChildren();

  sets.forEach((set, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "set";
    input.value = set.code;
    input.checked = index === 0;
    input.addEventListener("change", () => onChange(set.code));

    label.append(input, document.createTextNode(setLabel(set)));
    container.append(label);
  });
}

/** A number input per rarity present in the set, defaulted from the rarity map. */
export function renderRarityInputs(raritiesPresent, onChange) {
  const container = el("rarities");
  container.replaceChildren();

  for (const rarity of raritiesPresent) {
    const label = document.createElement("label");
    const span = document.createElement("span");
    span.textContent = rarityLabel(rarity);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.value = String(defaultQuantityFor(rarity));
    input.dataset.rarity = rarity;
    input.addEventListener("input", onChange);

    label.append(span, input);
    container.append(label);
  }
}

/** The rarity inputs as a quantity map keyed the way computeWants expects. */
export function readQuantities() {
  const quantities = {};
  for (const input of el("rarities").querySelectorAll("input[data-rarity]")) {
    const value = Number(input.value);
    quantities[input.dataset.rarity.toLowerCase()] = Number.isFinite(value) && value > 0 ? value : 0;
  }
  return quantities;
}

export function setStatus(id, message, isError = false) {
  const node = el(id);
  node.textContent = message;
  node.classList.toggle("error", isError);
}

export function showOutput(text, { cards, copies }) {
  el("output").value = text;
  el("summary").textContent = cards
    ? `${cards} cards, ${copies} copies.`
    : "Nothing to want — either every rarity is set to 0, or you already own the lot.";
}
```

Create `js/main.js`:

```javascript
/** Bootstrap and the recalculation loop. */

import { ownedForSet, parseDreambornCsv } from "./collection.js";
import { fetchSetCards, fetchSets } from "./lorcast.js";
import { renderDecklist } from "./render.js";
import { raritiesInSet } from "./rarities.js";
import { sortSetsNewestFirst } from "./sets.js";
import {
  el,
  readQuantities,
  renderRarityInputs,
  renderSetChoices,
  setStatus,
  showOutput,
} from "./ui.js";
import { computeWants, summarise } from "./wants.js";

const state = { setCode: null, cards: [], collectionRows: null };

function recalculate() {
  if (state.cards.length === 0) return;

  const owned = state.collectionRows
    ? ownedForSet(state.collectionRows, state.setCode)
    : new Map();

  const wants = computeWants({
    cards: state.cards,
    quantities: readQuantities(),
    owned,
    countNormals: el("count-normals").checked,
    countFoils: el("count-foils").checked,
  });

  showOutput(renderDecklist(wants), summarise(wants));
}

async function selectSet(code) {
  state.setCode = code;
  setStatus("sets-status", "Loading cards…");
  try {
    state.cards = await fetchSetCards(code);
  } catch (error) {
    setStatus("sets-status", error.message, true);
    return;
  }
  setStatus("sets-status", `${state.cards.length} cards in this set.`);
  renderRarityInputs(raritiesInSet(state.cards), recalculate);
  recalculate();
}

function loadCollection(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const { rows, unparsed } = parseDreambornCsv(String(reader.result));
      state.collectionRows = rows;
      const skipped = unparsed.length ? ` ${unparsed.length} rows skipped.` : "";
      setStatus("collection-status", `Loaded ${rows.length} collection rows.${skipped}`);
    } catch (error) {
      // Keep any previously loaded collection rather than silently dropping it.
      setStatus("collection-status", error.message, true);
    }
    recalculate();
  };
  reader.onerror = () => setStatus("collection-status", "That file could not be read.", true);
  reader.readAsText(file);
}

async function start() {
  el("count-normals").addEventListener("change", recalculate);
  el("count-foils").addEventListener("change", recalculate);
  el("collection").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) loadCollection(file);
  });
  el("copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(el("output").value);
    el("copy").textContent = "Copied";
    setTimeout(() => (el("copy").textContent = "Copy to clipboard"), 1500);
  });

  let sets;
  try {
    sets = sortSetsNewestFirst(await fetchSets());
  } catch (error) {
    setStatus("sets-status", error.message, true);
    return;
  }
  renderSetChoices(sets, selectSet);
  await selectSet(sets[0].code);
}

start();
```

- [ ] **Step 4: Serve the page locally**

Run: `python3 -m http.server 8000`

Then open `http://localhost:8000`. A file:// URL will not work — ES modules require http.

- [ ] **Step 5: Verify by hand**

Check each of these in the browser:

1. The set list loads and *Attack of the Vine! (2026)* is first.
2. Selecting it shows rarity inputs for Common, Uncommon, Rare, Super rare, Legendary, Epic, Enchanted, Iconic — with 1, 2, 3, 4, 4, 0, 0, 0.
3. The output reads `207 cards, 453 copies` and begins `3 Woody - Helping a Friend`.
4. Setting Epic to 1 raises the count to 225 cards, 471 copies.
5. Upload the collection export. The count drops and the status line reports the rows loaded.
6. Unticking *Count my foil copies* raises the count, because foils no longer count toward targets.
7. Unticking both variant checkboxes returns the count to the full 207 / 453.
8. Selecting *Into the Inklands* produces exactly one `Dalmatian Puppy - Tail Wagger` line, quantity 5.
9. The `i` beside "One set at a time" shows the reprint explanation on hover and on keyboard focus.
10. Copy to clipboard works and the button confirms.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css js/ui.js js/main.js
git commit -m "Add the wants list page"
```

---

### Task 7: Publish and document

**Files:**
- Create: `README.md`
- Modify: `.gitignore`
- Modify: both superseded design documents under `docs/superpowers/` — see Step 1. Neither is deleted.

- [ ] **Step 1: Mark the superseded documents**

Add this line directly under the title of both `docs/superpowers/specs/2026-08-16-lorcana-wants-list-design.md` and
`docs/superpowers/plans/2026-08-16-lorcana-wants-list.md`:

```markdown
> **Superseded** by the web tool design. Kept for its Cardmarket API research, which still holds.
```

They stay in the repository. The Cardmarket API findings in the spec — that wants-list endpoints exist but are restricted to
professional sellers, and that the Shopping Wizard has no endpoint — cost real effort to establish and will be wanted again.

- [ ] **Step 2: Replace the .gitignore**

The Python entries no longer apply:

```gitignore
.DS_Store
node_modules/
```

- [ ] **Step 3: Write the README**

Create `README.md`:

````markdown
# Lorcana Wants

Build a [Cardmarket](https://www.cardmarket.com) wants list for a Disney Lorcana set, minus the cards you already own.

**→ [Use it here](https://5uperdan.github.io/lorcana-wants/)**

## What it does

Pick a set, say how many copies of each rarity you want, and get a list you can paste straight into Cardmarket under
**Buying → My Wants → your list**. Upload a collection export and it subtracts what you already have, so the list is only what
you still need.

Card data comes from [Lorcast](https://lorcast.com), fetched live in your browser. New sets appear on their own — the site never
needs updating for a release.

Your collection file is read in the browser and never uploaded anywhere.

## Collection format

A Dreamborn CSV export. Four columns are used — `Set Number`, `Card Number`, `Variant`, `Count` — and the rest are ignored:

```csv
Set Number,Card Number,Variant,Count,Name,Color,Rarity
005,135,normal,2,"Sugar Rush Speedway - Starting Line",Ruby,Rare
005,32,foil,1,"Amber Chromicon",Amber,Uncommon
```

Rows that don't match a card in the selected set are reported and skipped. That is normal: promo cards use numbers like `2/P2`
and don't belong to a numbered set.

## Why one set at a time

Cardmarket matches wants by card name, and the same name can appear in more than one set — *I'm Stuck!* is in both Rise of the
Floodborn and Fabled. Generating one set per list means a reprint is never confused with the printing you meant.

## Development

No build step and no dependencies.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
node --test tests/            # run the tests
```

`js/lorcast.js` is the only module that touches the network, and it takes an injected `fetch` so tests never do. `sets`,
`rarities`, `collection`, `wants` and `render` are pure functions with no DOM access, which is what keeps them testable without
a toolchain. `ui.js` and `main.js` hold the DOM wiring.

## Not supported

- Combining several sets into one list
- Foil-specific wants — Cardmarket's paste format has no foil, language or condition column, so foils only affect what counts as
  owned, never the output
- Writing to Cardmarket directly. Their API supports wants lists, but access is
  [restricted to professional sellers](https://apiv2.cardmarket.com/ws/documentation/API:Auth_Overview).
````

- [ ] **Step 4: Commit and push**

```bash
git add README.md .gitignore docs/
git commit -m "Add README and mark the CLI design superseded"
git push
```

- [ ] **Step 5: Enable GitHub Pages**

```bash
gh api -X POST repos/5uperdan/lorcana-wants/pages -f "source[branch]=main" -f "source[path]=/" 2>&1 | tail -3
```

If it reports the site already exists, that is fine. Confirm the URL:

```bash
gh api repos/5uperdan/lorcana-wants/pages --jq .html_url
```

- [ ] **Step 6: Verify the deployed site**

Wait for the first build, then open `https://5uperdan.github.io/lorcana-wants/` and repeat checks 1, 3 and 8 from Task 6 Step 5
against the live page. A path that works locally but not on Pages means a case-sensitivity or relative-path mistake, so this
check is not redundant.
