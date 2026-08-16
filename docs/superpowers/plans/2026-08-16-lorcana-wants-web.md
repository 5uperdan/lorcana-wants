# Lorcana Wants Web Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web page that turns a Lorcana set, a rarity quantity map, and an optional collection export into a Cardmarket-ready wants list — built test-first, with every module including the DOM wiring under test.

**Architecture:** Plain ES modules with dependencies injected rather than reached for. `lorcast.js` takes a `fetch`; `app.js` takes a `document` and a `fetch`; `main.js` is a three-line bootstrap that supplies the real ones. `sets`, `rarities`, `collection`, `wants` and `render` are pure functions. Nothing imports a global it could not be handed instead, which is what makes the whole thing testable.

**Tech Stack:** Vanilla JavaScript (ES modules), HTML, CSS. Vitest + jsdom + @testing-library/dom for tests, GitHub Actions for CI. Test tooling is a development dependency only — the deployed site is the source files, served as-is.

**Spec:** `docs/superpowers/specs/2026-08-16-lorcana-wants-web-design.md`

## Global Constraints

- **The deployed site has no build step.** GitHub Pages serves `index.html`, `styles.css` and `js/` verbatim. No bundler, no transpiler, no framework, and no generated artefact is ever committed or deployed. `node_modules/` is development-only and gitignored.
- **Test tooling is a devDependency and nothing else.** Vitest, jsdom and @testing-library/dom never appear in anything the browser loads.
- **Test-first, always.** Every task writes the failing test, runs it to watch it fail for the right reason, then implements. A step that writes implementation before its test is a defect in the work, not a shortcut.
- **Three test layers.** Vitest for units and DOM behaviour, Playwright for a real browser smoke suite with the network stubbed, and one Playwright contract suite that does hit Lorcast — run on a schedule, never on a pull request.
- **Only the contract suite may touch the network.** Everywhere else `lorcast.js` takes a `fetchImpl` and tests pass a stub, or Playwright intercepts the request at the network layer.
- **Pure modules never touch the DOM.** `sets`, `rarities`, `collection`, `wants`, `render` run under Vitest's default `node` environment. Only `dom.js` and `app.js` opt into jsdom, via a `@vitest-environment jsdom` docblock.
- **Data source is Lorcast:** `https://api.lorcast.com/v0/sets` and `https://api.lorcast.com/v0/sets/{code}/cards`. Set names and rarities always come from the API — never hardcode a set list or a rarity list, because the site must not need redeploying when a new set releases.
- **Default quantities:** common 1, uncommon 2, rare 3, super_rare 4, legendary 4, every other rarity 0. Rarity keys are lowercased for lookup (`"Super_rare"` → `"super_rare"`); display uses the API's casing with underscores replaced by spaces.
- **Output line format:** `<quantity> <name>` when there is no version, `<quantity> <name> - <version>` otherwise. Plain hyphen with a space either side. No expansion qualifier. Names verbatim, including accents.
- **Sorting** is by collector number with the numeric part compared numerically, so `4a` sorts before `40`.
- **`index.html` lives at the repository root**, because GitHub Pages serves the root of `main`.

---

### Task 1: Tooling, CI, and the Lorcast client

**Files:**
- Create: `package.json`, `vitest.config.js`, `.github/workflows/ci.yml`
- Modify: `.gitignore`
- Create: `js/lorcast.js`
- Test: `tests/lorcast.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `API_BASE: string`, `LorcastError extends Error`, `fetchSets(fetchImpl?) -> Promise<Array<{code, name, releasedAt}>>`, `fetchSetCards(code, fetchImpl?) -> Promise<Array<{collectorNumber, name, version, rarity}>>`.

- [ ] **Step 1: Create the tooling**

`package.json`:

```json
{
  "name": "lorcana-wants",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.1",
    "@vitest/coverage-v8": "^4.1.10",
    "jsdom": "^30.0.1",
    "vitest": "^4.1.10"
  }
}
```

There are no runtime `dependencies`, and there must never be. Anything the browser loads is a file in this repository.

`vitest.config.js`:

```javascript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure modules run in Node. DOM tests opt in per file with a
    // `@vitest-environment jsdom` docblock, so they pay for jsdom and the
    // other tests don't.
    environment: "node",
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["js/**/*.js"],
      // main.js is the bootstrap that supplies real browser globals. There is
      // nothing in it to test that app.js does not already cover.
      exclude: ["js/main.js"],
      // Lines and statements are held high. Functions and branches sit a
      // little lower because the file-reading callbacks and the copy-button
      // timeout are browser plumbing with nothing worth asserting.
      thresholds: { lines: 90, statements: 90, functions: 85, branches: 85 },
    },
  },
});
```

Replace `.gitignore` entirely — the Python entries no longer apply:

```gitignore
.DS_Store
node_modules/
coverage/
```

`package-lock.json` **is** committed, because CI runs `npm ci`, which requires it.

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run coverage
```

This repository is public, so GitHub-hosted standard runners cost nothing and have no minute allowance to exhaust.

CI runs tests only. It deliberately does not build, bundle, or deploy: Pages publishes the branch directly, so a red build never blocks a deploy and a green one never causes it.

- [ ] **Step 2: Install and confirm the runner works**

```bash
npm install
npx vitest run --passWithNoTests
```

Expected: Vitest starts and reports no test files. If this fails, stop and fix the tooling before writing any test.

- [ ] **Step 3: Write the failing tests**

Create `tests/lorcast.test.js`:

```javascript
import { expect, test } from "vitest";

import { API_BASE, LorcastError, fetchSetCards, fetchSets } from "../js/lorcast.js";

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok, status, json: async () => payload };
    },
  };
}

test("fetchSets requests the sets endpoint", async () => {
  const { fetchImpl, calls } = stubFetch({ results: [] });

  await fetchSets(fetchImpl);

  expect(calls).toEqual([`${API_BASE}/sets`]);
});

test("fetchSets maps sets to code, name and release date", async () => {
  const { fetchImpl } = stubFetch({
    results: [
      { code: "13", name: "Attack of the Vine!", released_at: "2026-07-17" },
      { code: "P1", name: "Promo Set 1", released_at: "2023-08-18" },
    ],
  });

  expect(await fetchSets(fetchImpl)).toEqual([
    { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
    { code: "P1", name: "Promo Set 1", releasedAt: "2023-08-18" },
  ]);
});

test("fetchSetCards requests the cards endpoint for the set", async () => {
  const { fetchImpl, calls } = stubFetch([]);

  await fetchSetCards("13", fetchImpl);

  expect(calls).toEqual([`${API_BASE}/sets/13/cards`]);
});

test("fetchSetCards maps cards to the fields the tool needs", async () => {
  const { fetchImpl } = stubFetch([
    { collector_number: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
    { collector_number: "102", name: "Piercing Attack", rarity: "Common" },
  ]);

  expect(await fetchSetCards("13", fetchImpl)).toEqual([
    { collectorNumber: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
    { collectorNumber: "102", name: "Piercing Attack", version: "", rarity: "Common" },
  ]);
});

test("a missing version becomes an empty string, never undefined", async () => {
  const { fetchImpl } = stubFetch([
    { collector_number: "1", name: "Circle of Life", rarity: "Rare" },
  ]);

  const [card] = await fetchSetCards("13", fetchImpl);

  expect(card.version).toBe("");
});

test("a non-ok response raises LorcastError naming the status", async () => {
  const { fetchImpl } = stubFetch(null, { ok: false, status: 503 });

  await expect(fetchSets(fetchImpl)).rejects.toThrow(/503/);
  await expect(fetchSets(fetchImpl)).rejects.toBeInstanceOf(LorcastError);
});

test("a network failure is wrapped in LorcastError rather than leaking a TypeError", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };

  await expect(fetchSets(fetchImpl)).rejects.toBeInstanceOf(LorcastError);
});

test("the wrapped network failure keeps the original error as its cause", async () => {
  const original = new TypeError("Failed to fetch");
  const fetchImpl = async () => {
    throw original;
  };

  await expect(fetchSets(fetchImpl)).rejects.toMatchObject({ cause: original });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/lorcast.test.js`
Expected: FAIL — cannot resolve `../js/lorcast.js`

- [ ] **Step 5: Write the implementation**

Create `js/lorcast.js`:

```javascript
/** Lorcast API client. The only code in the project that touches the network. */

export const API_BASE = "https://api.lorcast.com/v0";

export class LorcastError extends Error {
  constructor(message, options) {
    super(message, options);
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

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/lorcast.test.js`
Expected: PASS, 8 tests

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.js .gitignore .github js/lorcast.js tests/lorcast.test.js
git commit -m "Add test tooling, CI, and the Lorcast API client"
```

---

### Task 2: Set ordering and rarity defaults

**Files:**
- Create: `js/sets.js`, `js/rarities.js`
- Test: `tests/sets.test.js`, `tests/rarities.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: from `sets.js`, `sortSetsNewestFirst(sets) -> Array` and `setLabel(set) -> string`. From `rarities.js`, `DEFAULT_QUANTITIES: object`, `rarityKey(rarity) -> string`, `rarityLabel(rarity) -> string`, `defaultQuantityFor(rarity) -> number`, `raritiesInSet(cards) -> Array<string>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/sets.test.js`:

```javascript
import { expect, test } from "vitest";

import { setLabel, sortSetsNewestFirst } from "../js/sets.js";

const SETS = [
  { code: "1", name: "The First Chapter", releasedAt: "2023-08-18" },
  { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
  { code: "P2", name: "Promo Set 2", releasedAt: "2024-08-09" },
];

test("sets are ordered newest first", () => {
  expect(sortSetsNewestFirst(SETS).map((set) => set.code)).toEqual(["13", "P2", "1"]);
});

test("sorting does not mutate the input", () => {
  const before = SETS.map((set) => set.code);

  sortSetsNewestFirst(SETS);

  expect(SETS.map((set) => set.code)).toEqual(before);
});

test("sets with no release date sort last rather than throwing", () => {
  const withUnknown = [...SETS, { code: "X", name: "Unknown", releasedAt: "" }];

  expect(sortSetsNewestFirst(withUnknown).at(-1).code).toBe("X");
});

test("the label carries the name and the release year", () => {
  expect(setLabel(SETS[1])).toBe("Attack of the Vine! (2026)");
});

test("a set with no release date is labelled by name alone", () => {
  expect(setLabel({ code: "X", name: "Unknown", releasedAt: "" })).toBe("Unknown");
});
```

Create `tests/rarities.test.js`:

```javascript
import { expect, test } from "vitest";

import {
  DEFAULT_QUANTITIES,
  defaultQuantityFor,
  raritiesInSet,
  rarityKey,
  rarityLabel,
} from "../js/rarities.js";

test("rarity keys are lowercased", () => {
  expect(rarityKey("Super_rare")).toBe("super_rare");
  expect(rarityKey("Common")).toBe("common");
});

test("rarity labels replace underscores with spaces", () => {
  expect(rarityLabel("Super_rare")).toBe("Super rare");
  expect(rarityLabel("Common")).toBe("Common");
});

test("the agreed default quantities are used", () => {
  expect(defaultQuantityFor("Common")).toBe(1);
  expect(defaultQuantityFor("Uncommon")).toBe(2);
  expect(defaultQuantityFor("Rare")).toBe(3);
  expect(defaultQuantityFor("Super_rare")).toBe(4);
  expect(defaultQuantityFor("Legendary")).toBe(4);
});

test("secret rarities default to zero", () => {
  expect(defaultQuantityFor("Epic")).toBe(0);
  expect(defaultQuantityFor("Enchanted")).toBe(0);
  expect(defaultQuantityFor("Iconic")).toBe(0);
});

test("a rarity nobody has seen before defaults to zero rather than failing", () => {
  // A new set must never break the page, so unknown rarities are simply off.
  expect(defaultQuantityFor("Mythic_Whatever")).toBe(0);
  expect(defaultQuantityFor(undefined)).toBe(0);
});

test("DEFAULT_QUANTITIES holds exactly the wanted rarities", () => {
  expect(DEFAULT_QUANTITIES).toEqual({
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

  expect(raritiesInSet(cards)).toEqual(["Common", "Rare", "Enchanted"]);
});

test("rarities in an empty set is an empty list", () => {
  expect(raritiesInSet([])).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/sets.test.js tests/rarities.test.js`
Expected: FAIL — cannot resolve `../js/sets.js` and `../js/rarities.js`

- [ ] **Step 3: Write the implementations**

Create `js/sets.js`:

```javascript
/** Ordering and labelling for the set picker. */

/** Newest first. Sets with no release date sort to the end. */
export function sortSetsNewestFirst(sets) {
  return [...sets].sort((a, b) => (b.releasedAt || "").localeCompare(a.releasedAt || ""));
}

/** "Attack of the Vine! (2026)" — the year helps tell promo sets apart. */
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
 * Copies wanted by default. Anything not listed — the secret rarities today,
 * and whatever Ravensburger invents later — is zero, so an unknown rarity
 * appears as a field set to 0 rather than breaking the page.
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

Run: `npx vitest run tests/sets.test.js tests/rarities.test.js`
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
- Produces: `parseCsv(text) -> Array<Array<string>>`, `normaliseSetNumber(value) -> string`, `parseDreambornCsv(text) -> {rows, unparsed}` where each row is `{setCode, collectorNumber, variant, count}`, `ownedForSet(rows, setCode) -> Map<string, {normal, foil}>`, `PARSERS: {dreamborn: parseDreambornCsv}`.

`PARSERS` is the seam for other collection exports later. Nothing else is built for that now.

- [ ] **Step 1: Write the failing tests**

Create `tests/collection.test.js`:

```javascript
import { expect, test } from "vitest";

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
  expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
});

test("parseCsv keeps commas inside quoted fields", () => {
  // Real card names contain commas, which is why this cannot be a split(",").
  const rows = parseCsv('005,1,normal,4,"Malicious, Mean, and Scary",Amber,Rare');

  expect(rows[0][4]).toBe("Malicious, Mean, and Scary");
  expect(rows[0]).toHaveLength(7);
});

test("parseCsv unescapes doubled quotes", () => {
  expect(parseCsv('"He said ""hi""",2')).toEqual([['He said "hi"', "2"]]);
});

test("parseCsv tolerates carriage returns and a trailing newline", () => {
  expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
});

test("parseCsv ignores blank lines", () => {
  expect(parseCsv("a,b\n\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
});

// --- normaliseSetNumber -------------------------------------------------

test("leading zeros are stripped to match Lorcast set codes", () => {
  expect(normaliseSetNumber("005")).toBe("5");
  expect(normaliseSetNumber("013")).toBe("13");
});

test("a non-numeric set number is left alone", () => {
  expect(normaliseSetNumber("P1")).toBe("P1");
});

// --- parseDreambornCsv --------------------------------------------------

test("parses the documented columns", () => {
  const { rows } = parseDreambornCsv(
    `${HEADER}\n005,135,normal,2,"Sugar Rush Speedway - Starting Line",Ruby,Rare`,
  );

  expect(rows).toEqual([
    { setCode: "5", collectorNumber: "135", variant: "normal", count: 2 },
  ]);
});

test("column order is read from the header, not assumed", () => {
  const { rows } = parseDreambornCsv("Count,Variant,Card Number,Set Number\n3,foil,7,006");

  expect(rows).toEqual([
    { setCode: "6", collectorNumber: "7", variant: "foil", count: 3 },
  ]);
});

test("lettered collector numbers survive intact", () => {
  const { rows } = parseDreambornCsv(`${HEADER}\n003,4a,normal,1,"Dalmatian Puppy",Amber,Common`);

  expect(rows[0].collectorNumber).toBe("4a");
});

test("a missing required column is an error naming the column", () => {
  expect(() => parseDreambornCsv("Set Number,Card Number,Count\n005,1,2")).toThrow(/Variant/);
});

test("an empty file is an error rather than an empty collection", () => {
  expect(() => parseDreambornCsv("")).toThrow(/empty/i);
});

test("rows with an unusable count are reported as unparsed, not dropped silently", () => {
  const { rows, unparsed } = parseDreambornCsv(
    `${HEADER}\n005,1,normal,two,"Bad Row",Amber,Common\n005,2,normal,1,"Good Row",Amber,Common`,
  );

  expect(rows).toHaveLength(1);
  expect(unparsed).toHaveLength(1);
});

test("variant casing is normalised", () => {
  const { rows } = parseDreambornCsv(`${HEADER}\n005,1,Foil,1,"X",Amber,Common`);

  expect(rows[0].variant).toBe("foil");
});

// --- ownedForSet --------------------------------------------------------

test("owned copies are indexed by collector number for one set", () => {
  const owned = ownedForSet(
    [
      { setCode: "13", collectorNumber: "1", variant: "normal", count: 2 },
      { setCode: "13", collectorNumber: "1", variant: "foil", count: 1 },
      { setCode: "12", collectorNumber: "1", variant: "normal", count: 9 },
    ],
    "13",
  );

  expect(owned.get("1")).toEqual({ normal: 2, foil: 1 });
  expect(owned.size).toBe(1);
});

test("repeated rows for the same card and variant are summed", () => {
  // The real export contains at least one duplicated key.
  const owned = ownedForSet(
    [
      { setCode: "13", collectorNumber: "5", variant: "normal", count: 2 },
      { setCode: "13", collectorNumber: "5", variant: "normal", count: 3 },
    ],
    "13",
  );

  expect(owned.get("5")).toEqual({ normal: 5, foil: 0 });
});

test("a card with no rows is absent rather than zero-filled", () => {
  expect(ownedForSet([], "13").get("1")).toBeUndefined();
});

test("the parser registry exposes the dreamborn parser", () => {
  expect(PARSERS.dreamborn).toBe(parseDreambornCsv);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/collection.test.js`
Expected: FAIL — cannot resolve `../js/collection.js`

- [ ] **Step 3: Write the implementation**

Create `js/collection.js`:

```javascript
/** Reading a collection export into owned-copy counts. */

const REQUIRED_COLUMNS = ["Set Number", "Card Number", "Variant", "Count"];

/**
 * Minimal RFC 4180 parse. Card names contain commas and are therefore quoted,
 * so splitting on commas would corrupt every row containing one.
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

Run: `npx vitest run tests/collection.test.js`
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
- Produces: `compareCollectorNumbers(a, b) -> number`, `computeWants({cards, quantities, owned, countNormals, countFoils}) -> Array<{collectorNumber, name, version, rarity, quantity}>`, `summarise(wants) -> {cards, copies}`.

`owned` is a `Map` from collector number to `{normal, foil}`, empty when no collection is loaded. `quantities` is keyed by lowercased rarity.

- [ ] **Step 1: Write the failing tests**

Create `tests/wants.test.js`:

```javascript
import { expect, test } from "vitest";

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

function puppies(numbers) {
  return numbers.map((collectorNumber) => ({
    collectorNumber,
    name: "Dalmatian Puppy",
    version: "Tail Wagger",
    rarity: "Common",
  }));
}

test("each card gets the quantity configured for its rarity", () => {
  expect(wants().map((want) => [want.name, want.quantity])).toEqual([
    ["Woody", 3],
    ["Celia Mae", 2],
    ["Piercing Attack", 1],
    ["Chernabog", 4],
  ]);
});

test("a rarity absent from the quantities produces no line", () => {
  expect(wants().every((want) => want.name !== "Elsa")).toBe(true);
});

test("a rarity explicitly set to zero produces no line", () => {
  const result = wants({ quantities: { ...QUANTITIES, rare: 0 } });

  expect(result.every((want) => want.name !== "Woody")).toBe(true);
});

test("owned copies are subtracted from the target", () => {
  const owned = new Map([["1", { normal: 1, foil: 0 }]]);

  expect(wants({ owned }).find((want) => want.name === "Woody").quantity).toBe(2);
});

test("a card owned in full produces no line", () => {
  const owned = new Map([["1", { normal: 3, foil: 0 }]]);

  expect(wants({ owned }).every((want) => want.name !== "Woody")).toBe(true);
});

test("owning more than wanted never produces a negative quantity", () => {
  const owned = new Map([["1", { normal: 99, foil: 0 }]]);

  expect(wants({ owned }).every((want) => want.name !== "Woody")).toBe(true);
});

test("foils count toward the target when the foil checkbox is ticked", () => {
  const owned = new Map([["1", { normal: 1, foil: 1 }]]);

  expect(wants({ owned }).find((want) => want.name === "Woody").quantity).toBe(1);
});

test("unticking foils ignores foil copies", () => {
  const owned = new Map([["1", { normal: 1, foil: 1 }]]);

  expect(wants({ owned, countFoils: false }).find((w) => w.name === "Woody").quantity).toBe(2);
});

test("unticking normals ignores normal copies", () => {
  const owned = new Map([["1", { normal: 1, foil: 1 }]]);

  expect(wants({ owned, countNormals: false }).find((w) => w.name === "Woody").quantity).toBe(2);
});

test("unticking both counts nothing as owned", () => {
  const owned = new Map([["1", { normal: 3, foil: 3 }]]);
  const result = wants({ owned, countNormals: false, countFoils: false });

  expect(result.find((want) => want.name === "Woody").quantity).toBe(3);
});

test("cards sharing a name and version merge into one line", () => {
  // Into the Inklands prints five Dalmatian Puppy - Tail Wagger, 4a to 4e.
  // Cardmarket sees one product name, so five separate lines would be wrong.
  const result = computeWants({
    cards: puppies(["4a", "4b", "4c", "4d", "4e"]),
    quantities: { common: 1 },
    owned: new Map(),
    countNormals: true,
    countFoils: true,
  });

  expect(result).toHaveLength(1);
  expect(result[0].quantity).toBe(5);
});

test("merging happens after subtracting what you own", () => {
  const result = computeWants({
    cards: puppies(["4a", "4b", "4c"]),
    quantities: { common: 1 },
    owned: new Map([["4a", { normal: 1, foil: 0 }]]),
    countNormals: true,
    countFoils: true,
  });

  expect(result[0].quantity).toBe(2);
});

test("a merged line is ordered by the lowest collector number in the group", () => {
  const result = computeWants({
    cards: puppies(["4e", "4a"]),
    quantities: { common: 1 },
    owned: new Map(),
    countNormals: true,
    countFoils: true,
  });

  expect(result[0].collectorNumber).toBe("4a");
});

test("cards with the same name but different versions stay separate", () => {
  const result = computeWants({
    cards: [
      { collectorNumber: "1", name: "Elsa", version: "Snow Queen", rarity: "Common" },
      { collectorNumber: "2", name: "Elsa", version: "Spirit of Winter", rarity: "Common" },
    ],
    quantities: { common: 1 },
    owned: new Map(),
    countNormals: true,
    countFoils: true,
  });

  expect(result).toHaveLength(2);
});

test("collector numbers sort numerically, not as text", () => {
  expect(["10", "9", "100"].sort(compareCollectorNumbers)).toEqual(["9", "10", "100"]);
});

test("lettered collector numbers sort beside their number", () => {
  expect(["40", "4a", "4"].sort(compareCollectorNumbers)).toEqual(["4", "4a", "40"]);
});

test("summarise counts distinct lines and total copies", () => {
  expect(summarise(wants())).toEqual({ cards: 4, copies: 10 });
});

test("summarise of an empty list is zeroes", () => {
  expect(summarise([])).toEqual({ cards: 0, copies: 0 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/wants.test.js`
Expected: FAIL — cannot resolve `../js/wants.js`

- [ ] **Step 3: Write the implementation**

Create `js/wants.js`:

```javascript
/** Turning a set plus quantities plus a collection into a wants list. */

import { rarityKey } from "./rarities.js";

const NUMBER_THEN_SUFFIX = /^(\d+)(.*)$/;
// A character that cannot occur in a card name, so "Ariel" + "Spectacular
// Singer" can never collide with a name that happens to end in a space.
const MERGE_SEPARATOR = "\u0000";

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
 * Cards sharing a name and version merge into a single line, because
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

    const key = `${card.name}${MERGE_SEPARATOR}${card.version}`;
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

/** Distinct lines and total copies, for the summary under the output. */
export function summarise(wants) {
  return {
    cards: wants.length,
    copies: wants.reduce((total, want) => total + want.quantity, 0),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/wants.test.js`
Expected: PASS, 18 tests

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
import { expect, test } from "vitest";

import { SEPARATOR, renderDecklist, renderLine } from "../js/render.js";

const WOODY = { collectorNumber: "1", name: "Woody", version: "Helping a Friend", quantity: 3 };
const PIERCING = { collectorNumber: "102", name: "Piercing Attack", version: "", quantity: 1 };

test("a card with a version renders name then version", () => {
  expect(renderLine(WOODY)).toBe("3 Woody - Helping a Friend");
});

test("a card without a version renders the name alone", () => {
  expect(renderLine(PIERCING)).toBe("1 Piercing Attack");
});

test("the separator is a spaced hyphen", () => {
  expect(SEPARATOR).toBe(" - ");
});

test("hyphens inside a name are untouched", () => {
  const tyler = { collectorNumber: "4", name: "Tyler Nguyen-Baker", version: "4*Town Fan", quantity: 1 };

  expect(renderLine(tyler)).toBe("1 Tyler Nguyen-Baker - 4*Town Fan");
});

test("accented names are emitted verbatim", () => {
  const teKa = { collectorNumber: "7", name: "Te Kā", version: "Heartless", quantity: 3 };

  expect(renderLine(teKa)).toBe("3 Te Kā - Heartless");
});

test("a decklist is one line per card, newline separated", () => {
  expect(renderDecklist([WOODY, PIERCING])).toBe("3 Woody - Helping a Friend\n1 Piercing Attack");
});

test("an empty decklist is an empty string", () => {
  expect(renderDecklist([])).toBe("");
});

test("a decklist has no trailing newline, so the textarea has no blank last line", () => {
  expect(renderDecklist([WOODY]).endsWith("\n")).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/render.test.js`
Expected: FAIL — cannot resolve `../js/render.js`

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

Run: `npx vitest run tests/render.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add js/render.js tests/render.test.js
git commit -m "Add Cardmarket paste format rendering"
```

---

### Task 6: The page and its DOM helpers

**Files:**
- Create: `index.html`, `styles.css`, `js/dom.js`
- Test: `tests/dom.test.js`

**Interfaces:**
- Consumes: `rarities.defaultQuantityFor`, `rarities.rarityLabel`, `sets.setLabel`.
- Produces: `renderSetChoices(doc, sets, onChange) -> void`, `renderRarityInputs(doc, rarities, onChange) -> void`, `readQuantities(doc) -> object`, `setStatus(doc, id, message, isError?) -> void`, `showOutput(doc, text, summary) -> void`.

Every function takes the `document` explicitly. Nothing reaches for a global, which is what lets these run under jsdom without setting up ambient state.

- [ ] **Step 1: Write the page**

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
        Build a Cardmarket wants list for a Lorcana set. Upload your collection and it lists only the
        cards you still need.
      </p>

      <section class="panel">
        <h2>How this works</h2>
        <ol>
          <li>Pick a set. Names and rarities are fetched live, so new sets appear here as soon as
            they are published — nothing here needs updating when a set releases.</li>
          <li>Say how many copies of each rarity you want. The defaults build a playset-style
            collection and leave the rare chase cards out.</li>
          <li>Optionally upload your collection export. Cards you already own are subtracted.</li>
          <li>Copy the result into Cardmarket under <strong>Buying → My Wants → your list</strong>,
            paste it into the decklist field, and press Add.</li>
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
          <span class="info" tabindex="0" role="note">
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
          Upload a Dreamborn CSV export. It needs the columns <code>Set Number</code>,
          <code>Card Number</code>, <code>Variant</code> and <code>Count</code>:
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

Create `styles.css`:

```css
:root {
  color-scheme: light dark;
  --ink: #1c1c20;
  --paper: #fbfbfd;
  --line: #d8d8e0;
  --accent: #4a3f8f;
  --muted: #5f5f6d;
  --warn: #b3261e;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ink: #e9e9ee;
    --paper: #17171c;
    --line: #35353f;
    --accent: #a89df0;
    --muted: #a0a0ae;
    --warn: #f2b8b5;
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
.error { color: var(--warn); }

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

.info:hover .tip,
.info:focus .tip,
.info:focus-within .tip { opacity: 1; visibility: visible; }
```

- [ ] **Step 2: Write the failing tests**

Create `tests/dom.test.js`:

```javascript
/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, expect, test } from "vitest";

import {
  readQuantities,
  renderRarityInputs,
  renderSetChoices,
  setStatus,
  showOutput,
} from "../js/dom.js";

const INDEX_HTML = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

const SETS = [
  { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
  { code: "12", name: "Wilds Unknown", releasedAt: "2026-05-08" },
];

beforeEach(() => {
  document.body.innerHTML = INDEX_HTML;
});

test("the markup contains every element the code looks up", () => {
  // Guards against renaming an id in the HTML without updating the code.
  for (const id of [
    "sets",
    "sets-status",
    "rarities",
    "collection",
    "collection-status",
    "count-normals",
    "count-foils",
    "output",
    "summary",
    "copy",
  ]) {
    expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
  }
});

test("the page loads its script as a module from the expected path", () => {
  const script = document.querySelector('script[type="module"]');

  expect(script.getAttribute("src")).toBe("js/main.js");
});

test("a radio is rendered per set, labelled with name and year", () => {
  renderSetChoices(document, SETS, () => {});

  const labels = [...document.querySelectorAll("#sets label")].map((node) => node.textContent.trim());

  expect(labels).toEqual(["Attack of the Vine! (2026)", "Wilds Unknown (2026)"]);
});

test("the first set is selected so the page has something to show immediately", () => {
  renderSetChoices(document, SETS, () => {});

  const [first, second] = document.querySelectorAll("#sets input");

  expect(first.checked).toBe(true);
  expect(second.checked).toBe(false);
});

test("the set radios share a name so only one can be chosen", () => {
  renderSetChoices(document, SETS, () => {});

  const names = new Set([...document.querySelectorAll("#sets input")].map((node) => node.name));

  expect(names).toEqual(new Set(["set"]));
});

test("choosing a set reports its code", () => {
  const chosen = [];
  renderSetChoices(document, SETS, (code) => chosen.push(code));

  document.querySelectorAll("#sets input")[1].click();

  expect(chosen).toEqual(["12"]);
});

test("re-rendering replaces the previous set choices rather than appending", () => {
  renderSetChoices(document, SETS, () => {});
  renderSetChoices(document, SETS, () => {});

  expect(document.querySelectorAll("#sets input")).toHaveLength(2);
});

test("a number input is rendered per rarity, defaulted from the rarity map", () => {
  renderRarityInputs(document, ["Common", "Super_rare", "Enchanted"], () => {});

  const inputs = [...document.querySelectorAll("#rarities input")];

  expect(inputs.map((node) => node.value)).toEqual(["1", "4", "0"]);
});

test("rarity inputs are labelled readably", () => {
  renderRarityInputs(document, ["Super_rare"], () => {});

  expect(document.querySelector("#rarities label span").textContent).toBe("Super rare");
});

test("rarity inputs cannot go negative", () => {
  renderRarityInputs(document, ["Common"], () => {});

  expect(document.querySelector("#rarities input").min).toBe("0");
});

test("editing a rarity notifies the caller", () => {
  let changes = 0;
  renderRarityInputs(document, ["Common"], () => {
    changes += 1;
  });

  const input = document.querySelector("#rarities input");
  input.value = "2";
  input.dispatchEvent(new Event("input"));

  expect(changes).toBe(1);
});

test("readQuantities returns lowercased rarity keys", () => {
  renderRarityInputs(document, ["Common", "Super_rare"], () => {});

  expect(readQuantities(document)).toEqual({ common: 1, super_rare: 4 });
});

test("readQuantities treats a blank or negative entry as zero", () => {
  renderRarityInputs(document, ["Common", "Rare"], () => {});
  const [blank, negative] = document.querySelectorAll("#rarities input");
  blank.value = "";
  negative.value = "-3";

  expect(readQuantities(document)).toEqual({ common: 0, rare: 0 });
});

test("setStatus writes the message", () => {
  setStatus(document, "sets-status", "42 cards in this set.");

  expect(document.getElementById("sets-status").textContent).toBe("42 cards in this set.");
});

test("setStatus marks errors and clears the mark when the next message is fine", () => {
  setStatus(document, "sets-status", "It broke.", true);
  expect(document.getElementById("sets-status").classList.contains("error")).toBe(true);

  setStatus(document, "sets-status", "All good.");
  expect(document.getElementById("sets-status").classList.contains("error")).toBe(false);
});

test("showOutput fills the textarea and summarises", () => {
  showOutput(document, "3 Woody - Helping a Friend", { cards: 1, copies: 3 });

  expect(document.getElementById("output").value).toBe("3 Woody - Helping a Friend");
  expect(document.getElementById("summary").textContent).toBe("1 cards, 3 copies.");
});

test("showOutput explains an empty result instead of leaving a blank box", () => {
  showOutput(document, "", { cards: 0, copies: 0 });

  expect(document.getElementById("summary").textContent).toMatch(/nothing to want/i);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/dom.test.js`
Expected: FAIL — cannot resolve `../js/dom.js`

- [ ] **Step 4: Write the implementation**

Create `js/dom.js`:

```javascript
/**
 * DOM rendering. Every function takes the document explicitly rather than
 * reaching for a global, which is what makes these testable under jsdom.
 */

import { defaultQuantityFor, rarityLabel } from "./rarities.js";
import { setLabel } from "./sets.js";

/** Radio buttons for the sets, with the first one selected. */
export function renderSetChoices(doc, sets, onChange) {
  const container = doc.getElementById("sets");
  container.replaceChildren();

  sets.forEach((set, index) => {
    const label = doc.createElement("label");
    const input = doc.createElement("input");
    input.type = "radio";
    input.name = "set";
    input.value = set.code;
    input.checked = index === 0;
    input.addEventListener("change", () => onChange(set.code));

    label.append(input, doc.createTextNode(setLabel(set)));
    container.append(label);
  });
}

/** A number input per rarity present in the set, defaulted from the rarity map. */
export function renderRarityInputs(doc, raritiesPresent, onChange) {
  const container = doc.getElementById("rarities");
  container.replaceChildren();

  for (const rarity of raritiesPresent) {
    const label = doc.createElement("label");
    const span = doc.createElement("span");
    span.textContent = rarityLabel(rarity);

    const input = doc.createElement("input");
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
export function readQuantities(doc) {
  const quantities = {};
  for (const input of doc.getElementById("rarities").querySelectorAll("input[data-rarity]")) {
    const value = Number(input.value);
    quantities[input.dataset.rarity.toLowerCase()] =
      Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return quantities;
}

export function setStatus(doc, id, message, isError = false) {
  const node = doc.getElementById(id);
  node.textContent = message;
  node.classList.toggle("error", isError);
}

export function showOutput(doc, text, { cards, copies }) {
  doc.getElementById("output").value = text;
  doc.getElementById("summary").textContent = cards
    ? `${cards} cards, ${copies} copies.`
    : "Nothing to want — either every rarity is set to 0, or you already own the lot.";
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/dom.test.js`
Expected: PASS, 17 tests

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css js/dom.js tests/dom.test.js
git commit -m "Add the page and its DOM helpers"
```

---

### Task 7: Wiring it together

**Files:**
- Create: `js/app.js`, `js/main.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `createApp({document, fetchImpl, clipboard}) -> {start, recalculate, loadCollectionText}`.

`main.js` is the bootstrap and holds no logic. Everything the app does is reachable through `createApp` with a stubbed `fetch` and a jsdom `document`, so the whole flow is under test.

- [ ] **Step 1: Write the failing tests**

Create `tests/app.test.js`:

```javascript
/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, expect, test, vi } from "vitest";

import { createApp } from "../js/app.js";

const INDEX_HTML = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

const SETS = {
  results: [
    { code: "12", name: "Wilds Unknown", released_at: "2026-05-08" },
    { code: "13", name: "Attack of the Vine!", released_at: "2026-07-17" },
  ],
};

const CARDS_13 = [
  { collector_number: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
  { collector_number: "2", name: "Piercing Attack", rarity: "Common" },
  { collector_number: "3", name: "Elsa", version: "Spirit of Winter", rarity: "Enchanted" },
];

const CARDS_12 = [{ collector_number: "1", name: "Someone Else", rarity: "Common" }];

const COLLECTION = [
  "Set Number,Card Number,Variant,Count,Name,Color,Rarity",
  '013,1,normal,1,"Woody - Helping a Friend",Amber,Rare',
  '013,1,foil,1,"Woody - Helping a Friend",Amber,Rare',
].join("\n");

function stubFetch(overrides = {}) {
  const responses = { "/sets": SETS, "/sets/13/cards": CARDS_13, "/sets/12/cards": CARDS_12, ...overrides };
  return async (url) => {
    const match = Object.keys(responses).find((suffix) => url.endsWith(suffix));
    if (!match) return { ok: false, status: 404, json: async () => null };
    const payload = responses[match];
    if (payload instanceof Error) throw payload;
    return { ok: true, status: 200, json: async () => payload };
  };
}

function build(overrides = {}) {
  return createApp({ document, fetchImpl: stubFetch(overrides), clipboard: { writeText: vi.fn() } });
}

const output = () => document.getElementById("output").value;
const summary = () => document.getElementById("summary").textContent;
const statusOf = (id) => document.getElementById(id).textContent;

beforeEach(() => {
  document.body.innerHTML = INDEX_HTML;
});

test("starting loads the sets newest first and selects the newest", async () => {
  await build().start();

  const labels = [...document.querySelectorAll("#sets label")].map((n) => n.textContent.trim());

  expect(labels[0]).toBe("Attack of the Vine! (2026)");
  expect(document.querySelector("#sets input").checked).toBe(true);
});

test("starting renders rarity inputs for the selected set only", async () => {
  await build().start();

  const labels = [...document.querySelectorAll("#rarities label span")].map((n) => n.textContent);

  expect(labels).toEqual(["Rare", "Common", "Enchanted"]);
});

test("starting produces a wants list from the defaults", async () => {
  await build().start();

  expect(output()).toBe("3 Woody - Helping a Friend\n1 Piercing Attack");
  expect(summary()).toBe("2 cards, 4 copies.");
});

test("a rarity defaulting to zero is left out of the list", async () => {
  await build().start();

  expect(output()).not.toMatch(/Elsa/);
});

test("raising a rarity from zero adds its cards", async () => {
  await build().start();

  const enchanted = [...document.querySelectorAll("#rarities input")].at(-1);
  enchanted.value = "1";
  enchanted.dispatchEvent(new Event("input"));

  expect(output()).toMatch(/1 Elsa - Spirit of Winter/);
});

test("choosing another set reloads its cards and its rarities", async () => {
  await build().start();

  document.querySelectorAll("#sets input")[1].click();
  await vi.waitFor(() => expect(output()).toBe("1 Someone Else"));

  expect(statusOf("sets-status")).toMatch(/1 cards/);
});

test("loading a collection subtracts owned copies", async () => {
  const app = build();
  await app.start();

  app.loadCollectionText(COLLECTION);

  // Three Woody wanted, one normal and one foil owned, so one left.
  expect(output()).toBe("1 Woody - Helping a Friend\n1 Piercing Attack");
});

test("loading a collection reports how many rows it read", async () => {
  const app = build();
  await app.start();

  app.loadCollectionText(COLLECTION);

  expect(statusOf("collection-status")).toMatch(/2 collection rows/);
});

test("unticking foils stops foil copies counting toward the target", async () => {
  const app = build();
  await app.start();
  app.loadCollectionText(COLLECTION);

  const foils = document.getElementById("count-foils");
  foils.checked = false;
  foils.dispatchEvent(new Event("change"));

  expect(output()).toMatch(/^2 Woody - Helping a Friend/);
});

test("unticking both variants ignores the collection entirely", async () => {
  const app = build();
  await app.start();
  app.loadCollectionText(COLLECTION);

  for (const id of ["count-normals", "count-foils"]) {
    const box = document.getElementById(id);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
  }

  expect(output()).toMatch(/^3 Woody - Helping a Friend/);
});

test("a collection for a different set changes nothing", async () => {
  const app = build();
  await app.start();

  app.loadCollectionText(
    'Set Number,Card Number,Variant,Count\n012,1,normal,4',
  );

  expect(output()).toBe("3 Woody - Helping a Friend\n1 Piercing Attack");
});

test("a malformed collection reports the problem and keeps the previous list", async () => {
  const app = build();
  await app.start();
  app.loadCollectionText(COLLECTION);

  app.loadCollectionText("Nonsense,Header\n1,2");

  expect(statusOf("collection-status")).toMatch(/missing/i);
  expect(document.getElementById("collection-status").classList.contains("error")).toBe(true);
  expect(output()).toBe("1 Woody - Helping a Friend\n1 Piercing Attack");
});

test("unmatched collection rows are reported rather than hidden", async () => {
  const app = build();
  await app.start();

  app.loadCollectionText(`${COLLECTION}\n013,2/P2,normal,bad,"Promo",Amber,Promo`);

  expect(statusOf("collection-status")).toMatch(/1 rows skipped/);
});

test("a failure loading the sets is shown, not swallowed", async () => {
  await build({ "/sets": new TypeError("Failed to fetch") }).start();

  expect(statusOf("sets-status")).toMatch(/could not reach/i);
  expect(document.getElementById("sets-status").classList.contains("error")).toBe(true);
});

test("a failure loading a set's cards is shown", async () => {
  await build({ "/sets/13/cards": new TypeError("Failed to fetch") }).start();

  expect(statusOf("sets-status")).toMatch(/could not reach/i);
});

test("copying writes the output to the clipboard", async () => {
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  const app = createApp({ document, fetchImpl: stubFetch(), clipboard });
  await app.start();

  document.getElementById("copy").click();
  await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledOnce());

  expect(clipboard.writeText).toHaveBeenCalledWith("3 Woody - Helping a Friend\n1 Piercing Attack");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/app.test.js`
Expected: FAIL — cannot resolve `../js/app.js`

- [ ] **Step 3: Write the implementation**

Create `js/app.js`:

```javascript
/**
 * The application. Every dependency on the outside world — the document, the
 * network, the clipboard — arrives as an argument, so the whole flow can be
 * driven in a test.
 */

import { ownedForSet, parseDreambornCsv } from "./collection.js";
import {
  readQuantities,
  renderRarityInputs,
  renderSetChoices,
  setStatus,
  showOutput,
} from "./dom.js";
import { fetchSetCards, fetchSets } from "./lorcast.js";
import { raritiesInSet } from "./rarities.js";
import { renderDecklist } from "./render.js";
import { sortSetsNewestFirst } from "./sets.js";
import { computeWants, summarise } from "./wants.js";

export function createApp({ document: doc, fetchImpl = fetch, clipboard = navigator.clipboard }) {
  const state = { setCode: null, cards: [], collectionRows: null };

  function recalculate() {
    const owned = state.collectionRows
      ? ownedForSet(state.collectionRows, state.setCode)
      : new Map();

    const wants = computeWants({
      cards: state.cards,
      quantities: readQuantities(doc),
      owned,
      countNormals: doc.getElementById("count-normals").checked,
      countFoils: doc.getElementById("count-foils").checked,
    });

    showOutput(doc, renderDecklist(wants), summarise(wants));
  }

  async function selectSet(code) {
    state.setCode = code;
    setStatus(doc, "sets-status", "Loading cards…");
    try {
      state.cards = await fetchSetCards(code, fetchImpl);
    } catch (error) {
      state.cards = [];
      setStatus(doc, "sets-status", error.message, true);
      return;
    }
    setStatus(doc, "sets-status", `${state.cards.length} cards in this set.`);
    renderRarityInputs(doc, raritiesInSet(state.cards), recalculate);
    recalculate();
  }

  /**
   * Split out from the file input so the parse-and-recalculate path is
   * testable without a FileReader. A bad file keeps the previous collection
   * rather than silently discarding work.
   */
  function loadCollectionText(text) {
    try {
      const { rows, unparsed } = parseDreambornCsv(text);
      state.collectionRows = rows;
      const skipped = unparsed.length > 0 ? ` ${unparsed.length} rows skipped.` : "";
      setStatus(doc, "collection-status", `Loaded ${rows.length} collection rows.${skipped}`);
    } catch (error) {
      setStatus(doc, "collection-status", error.message, true);
    }
    recalculate();
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => loadCollectionText(String(reader.result));
    reader.onerror = () =>
      setStatus(doc, "collection-status", "That file could not be read.", true);
    reader.readAsText(file);
  }

  async function start() {
    for (const id of ["count-normals", "count-foils"]) {
      doc.getElementById(id).addEventListener("change", recalculate);
    }
    doc.getElementById("collection").addEventListener("change", (event) => {
      const [file] = event.target.files;
      if (file) readFile(file);
    });
    doc.getElementById("copy").addEventListener("click", async () => {
      const button = doc.getElementById("copy");
      await clipboard.writeText(doc.getElementById("output").value);
      button.textContent = "Copied";
      setTimeout(() => {
        button.textContent = "Copy to clipboard";
      }, 1500);
    });

    let sets;
    try {
      sets = sortSetsNewestFirst(await fetchSets(fetchImpl));
    } catch (error) {
      setStatus(doc, "sets-status", error.message, true);
      return;
    }
    renderSetChoices(doc, sets, selectSet);
    if (sets.length > 0) await selectSet(sets[0].code);
  }

  return { start, recalculate, loadCollectionText };
}
```

Create `js/main.js`:

```javascript
/** Bootstrap: hand the app the real browser. Nothing else belongs here. */

import { createApp } from "./app.js";

createApp({ document, fetchImpl: fetch.bind(window), clipboard: navigator.clipboard }).start();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/app.test.js`
Expected: PASS, 16 tests

- [ ] **Step 5: Run the whole suite with coverage**

Run: `npm run coverage`
Expected: PASS, 98 tests, and every coverage threshold met. If a threshold fails, add the missing test rather than lowering the threshold.

- [ ] **Step 6: Commit**

```bash
git add js/app.js js/main.js tests/app.test.js
git commit -m "Wire the app together with injected dependencies"
```

---

### Task 8: Browser tests with Playwright

**Files:**
- Create: `playwright.config.js`
- Create: `tests/e2e/wants.spec.js`
- Create: `tests/e2e/fixtures/collection.csv`
- Create: `tests/contract/lorcast.spec.js`
- Create: `.github/workflows/contract.yml`
- Modify: `package.json`, `.gitignore`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the deployed page as a user meets it. No module imports.
- Produces: nothing other tasks depend on.

**Why this layer exists.** Vitest and jsdom prove the logic and the wiring, but they load modules through Vite's resolver, not
the browser's. A wrong `src` path, a module the browser refuses, a CSS rule that hides the output, a clipboard call that needs a
permission — all of these pass jsdom and break the real page. Playwright is the only thing here that opens the actual file over
HTTP in a real engine.

The suite stays deliberately small. It checks that the page boots and the main paths work; it does not re-test the logic that
Vitest already covers exhaustively, because a slow suite that duplicates a fast one gets ignored.

- [ ] **Step 1: Add the tooling**

Add to `package.json` — `devDependencies` gains Playwright, `scripts` gains three entries:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "test:e2e": "playwright test --project=smoke",
    "test:e2e:ui": "playwright test --project=smoke --ui",
    "test:contract": "playwright test --project=contract"
  },
  "devDependencies": {
    "@playwright/test": "^1.62.1",
    "@testing-library/dom": "^10.4.1",
    "@vitest/coverage-v8": "^4.1.10",
    "jsdom": "^30.0.1",
    "vitest": "^4.1.10"
  }
}
```

Install it, and the one browser we drive:

```bash
npm install
npx playwright install --with-deps chromium
```

Append to `.gitignore`:

```gitignore
test-results/
playwright-report/
```

`playwright.config.js`:

```javascript
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  // Two suites with different contracts. "smoke" stubs the network and gates
  // every push. "contract" really calls Lorcast and runs on a schedule, so a
  // third party having a bad morning never fails somebody's pull request.
  projects: [
    { name: "smoke", testDir: "./tests/e2e", use: { ...devices["Desktop Chrome"] } },
    { name: "contract", testDir: "./tests/contract", use: { ...devices["Desktop Chrome"] } },
  ],
  use: { baseURL: `http://localhost:${PORT}` },
  reporter: process.env.CI ? "github" : "list",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The same server the README tells a developer to use. Serving the
  // repository as static files is exactly what GitHub Pages does.
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
});
```

Vitest only collects `tests/**/*.test.js` and Playwright only collects `*.spec.js` under its two `testDir`s, so neither runner
ever picks up the other's files.

- [ ] **Step 2: Create the upload fixture**

Create `tests/e2e/fixtures/collection.csv`. Two rows against set 13 card 1, one normal and one foil, so the upload has a visible
effect on the wants list:

```csv
Set Number,Card Number,Variant,Count,Name,Color,Rarity
013,1,normal,1,"Woody - Helping a Friend",Amber,Rare
013,1,foil,1,"Woody - Helping a Friend",Amber,Rare
013,2,normal,1,"Piercing Attack",Amber,Common
```

- [ ] **Step 3: Write the failing smoke tests**

Create `tests/e2e/wants.spec.js`:

```javascript
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const SETS = {
  results: [
    { code: "12", name: "Wilds Unknown", released_at: "2026-05-08" },
    { code: "13", name: "Attack of the Vine!", released_at: "2026-07-17" },
  ],
};

const CARDS_13 = [
  { collector_number: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
  { collector_number: "2", name: "Piercing Attack", rarity: "Common" },
  { collector_number: "3", name: "Elsa", version: "Spirit of Winter", rarity: "Enchanted" },
];

const CARDS_12 = [{ collector_number: "1", name: "Someone Else", rarity: "Common" }];

const COLLECTION = fileURLToPath(new URL("./fixtures/collection.csv", import.meta.url));

/** Intercept at the network layer, so the page still uses its real fetch. */
async function stubLorcast(page) {
  await page.route("**/v0/sets/13/cards", (route) => route.fulfill({ json: CARDS_13 }));
  await page.route("**/v0/sets/12/cards", (route) => route.fulfill({ json: CARDS_12 }));
  await page.route("**/v0/sets", (route) => route.fulfill({ json: SETS }));
}

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.errors = errors;

  await stubLorcast(page);
});

test("the page boots and produces a wants list", async ({ page }) => {
  await page.goto("/");

  // If the module graph fails to load, this is what catches it.
  await expect(page.locator("#output")).toHaveValue(
    "3 Woody - Helping a Friend\n1 Piercing Attack",
  );
  await expect(page.locator("#summary")).toHaveText("2 cards, 4 copies.");
});

test("no console errors while doing the normal thing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  expect(page.errors).toEqual([]);
});

test("the newest set is selected first", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#sets label").first()).toContainText("Attack of the Vine! (2026)");
  await expect(page.locator("#sets input").first()).toBeChecked();
});

test("changing a rarity updates the list", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  await page.locator("#rarities input").last().fill("1");

  await expect(page.locator("#output")).toContainText("1 Elsa - Spirit of Winter");
});

test("choosing another set loads its cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  await page.locator("#sets input").nth(1).check();

  await expect(page.locator("#output")).toHaveValue("1 Someone Else");
});

test("uploading a collection subtracts what you own", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  await page.locator("#collection").setInputFiles(COLLECTION);

  await expect(page.locator("#collection-status")).toContainText("3 collection rows");
  await expect(page.locator("#output")).toHaveValue("1 Woody - Helping a Friend");
});

test("unticking foils stops foils counting toward the target", async ({ page }) => {
  await page.goto("/");
  await page.locator("#collection").setInputFiles(COLLECTION);
  await expect(page.locator("#output")).toHaveValue("1 Woody - Helping a Friend");

  await page.locator("#count-foils").uncheck();

  await expect(page.locator("#output")).toHaveValue("2 Woody - Helping a Friend");
});

test("the reprint explainer is reachable by keyboard, not only by hover", async ({ page }) => {
  await page.goto("/");

  await page.locator(".info").focus();

  await expect(page.locator(".info .tip")).toBeVisible();
});

test("copying puts the list on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  await page.locator("#copy").click();

  await expect(page.locator("#copy")).toHaveText("Copied");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe("3 Woody - Helping a Friend\n1 Piercing Attack");
});

test("an unreachable API is reported rather than leaving a blank page", async ({ page }) => {
  await page.route("**/v0/sets", (route) => route.abort());
  await page.goto("/");

  await expect(page.locator("#sets-status")).toHaveClass(/error/);
  await expect(page.locator("#sets-status")).toContainText(/could not reach/i);
});
```

- [ ] **Step 4: Run them and watch them fail for the right reason**

Run: `npm run test:e2e`

If Tasks 1–7 are complete these may pass immediately. That is fine — this layer guards against regressions rather than driving
new code. What matters is that each test fails for the right reason when you break the thing it covers. Prove it for the first
one: temporarily change the `src` in `index.html` to `js/nope.js`, run again, watch "the page boots" fail, then put it back.

- [ ] **Step 5: Write the live contract test**

Create `tests/contract/lorcast.spec.js`:

```javascript
import { expect, test } from "@playwright/test";

/**
 * These really call Lorcast. Everything else stubs it, which means the whole
 * suite would stay green if Lorcast renamed a field and the site broke. This
 * is the only thing that would notice, so it runs on a schedule rather than
 * on a pull request — a third party's bad morning must not fail somebody's PR.
 */

const API = "https://api.lorcast.com/v0";

test("the sets endpoint still returns code, name and released_at", async ({ request }) => {
  const response = await request.get(`${API}/sets`);
  expect(response.ok()).toBe(true);

  const { results } = await response.json();
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]).toMatchObject({
    code: expect.any(String),
    name: expect.any(String),
    released_at: expect.any(String),
  });
});

test("the cards endpoint still returns collector_number, name and rarity", async ({ request }) => {
  const response = await request.get(`${API}/sets/13/cards`);
  expect(response.ok()).toBe(true);

  const cards = await response.json();
  expect(cards.length).toBeGreaterThan(0);
  expect(cards[0]).toMatchObject({
    collector_number: expect.any(String),
    name: expect.any(String),
    rarity: expect.any(String),
  });
});

test("Attack of the Vine! still has the rarity split the tool was built against", async ({ request }) => {
  const cards = await (await request.get(`${API}/sets/13/cards`)).json();

  const counts = {};
  for (const card of cards) counts[card.rarity] = (counts[card.rarity] ?? 0) + 1;

  expect(counts).toMatchObject({
    Common: 72,
    Uncommon: 54,
    Rare: 51,
    Super_rare: 18,
    Legendary: 12,
  });
});

test("the live site still serves CORS headers the browser will accept", async ({ request }) => {
  const response = await request.get(`${API}/sets`, {
    headers: { Origin: "https://5uperdan.github.io" },
  });

  expect(response.headers()["access-control-allow-origin"]).toBe("*");
});
```

- [ ] **Step 6: Run the contract suite**

Run: `npm run test:contract`
Expected: PASS, 4 tests. A failure here is news about Lorcast, not about this repository.

- [ ] **Step 7: Wire both into CI**

Replace `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run coverage

  browser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

The two jobs run in parallel, and the report artifact means a CI-only failure can be read rather than guessed at.

Create `.github/workflows/contract.yml`:

```yaml
name: Contract

# Lorcast is a third party. Checking it on a schedule tells us when it changes
# without letting it fail anybody's pull request.
on:
  schedule:
    - cron: "0 7 * * 1"
  workflow_dispatch:

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:contract
```

- [ ] **Step 8: Run everything**

```bash
npm run coverage && npm run test:e2e
```

Expected: 98 Vitest tests and 10 Playwright tests, all passing.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json playwright.config.js .gitignore .github tests/e2e tests/contract
git commit -m "Add Playwright smoke tests and a scheduled Lorcast contract check"
```

---

### Task 9: Publish and document

**Files:**
- Create: `README.md`
- Modify: the two superseded documents under `docs/superpowers/`

- [ ] **Step 1: Mark the superseded documents**

Add this line directly under the title of both `docs/superpowers/specs/2026-08-16-lorcana-wants-list-design.md` and
`docs/superpowers/plans/2026-08-16-lorcana-wants-list.md`:

```markdown
> **Superseded** by the web tool design. Kept for its Cardmarket API research, which still holds.
```

They stay in the repository. The Cardmarket findings — that wants-list endpoints exist but are restricted to professional
sellers, and that the Shopping Wizard has no endpoint at all — cost real effort to establish and will be wanted again.

- [ ] **Step 2: Write the README**

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

Rows that don't match a card in the selected set are counted and reported. That is normal: promo cards use numbers like `2/P2`
and don't belong to a numbered set.

## Why one set at a time

Cardmarket matches wants by card name, and the same name can appear in more than one set — *I'm Stuck!* is in both Rise of the
Floodborn and Fabled. Generating one set per list means a reprint is never confused with the printing you meant.

## Development

The deployed site has no build step: GitHub Pages serves the source files as they are. The tooling below is for tests only and
never reaches the browser.

```bash
npm install
npx playwright install --with-deps chromium

npm test                      # unit and DOM tests
npm run test:watch            # watch mode
npm run coverage              # with coverage thresholds
npm run test:e2e              # browser smoke tests
npm run test:e2e:ui           # the same, in Playwright's UI mode
npm run test:contract         # really calls Lorcast

python3 -m http.server 8000   # serve locally at http://localhost:8000
```

A `file://` URL will not work — ES modules need http.

### How it is put together

Dependencies are injected rather than reached for, which is what makes a frontend testable: `lorcast.js` takes a `fetch`,
`app.js` takes a `document`, a `fetch` and a `clipboard`, and `main.js` is a three-line bootstrap that supplies the real ones.
`sets`, `rarities`, `collection`, `wants` and `render` are pure functions and run without a DOM at all.

### Three layers of test

| Layer | Runner | Covers | Runs |
|---|---|---|---|
| Unit and DOM | Vitest + jsdom | Every module, including the wiring. Loads the real `index.html`, so renaming an element id fails the suite rather than the page. | Every push and PR |
| Browser smoke | Playwright, network stubbed | That the real page boots over HTTP and its main paths work — module loading, file upload, clipboard, keyboard access. | Every push and PR |
| Contract | Playwright, live | That Lorcast still returns the fields the tool reads. Nothing else would notice a rename, because everything else stubs it. | Weekly, and on demand |

The contract suite is kept off pull requests on purpose: it can fail for reasons that have nothing to do with the change being
reviewed.

## Not supported

- Combining several sets into one list
- Foil-specific wants — Cardmarket's paste format has no foil, language or condition column, so foils only affect what counts as
  owned, never the output
- Writing to Cardmarket directly. Their API supports wants lists, but access is
  [restricted to professional sellers](https://apiv2.cardmarket.com/ws/documentation/API:Auth_Overview).
````

- [ ] **Step 3: Commit and push**

```bash
git add README.md docs/
git commit -m "Add README and mark the CLI design superseded"
git push
```

- [ ] **Step 4: Confirm CI is green**

```bash
gh run list --limit 1
gh run watch
```

A red run here means the suite passes locally but not on a clean checkout — usually a file missing from a commit. Fix before
publishing.

- [ ] **Step 5: Enable GitHub Pages**

```bash
gh api -X POST repos/5uperdan/lorcana-wants/pages -f "source[branch]=main" -f "source[path]=/"
gh api repos/5uperdan/lorcana-wants/pages --jq .html_url
```

If it reports the site already exists, that is fine.

- [ ] **Step 6: Verify the deployed page against real data**

Playwright already proves the page boots and its paths work, but always against stubbed cards on localhost. What is left is what
it deliberately does not cover: the real Pages URL, and real Lorcast numbers. Check these on
`https://5uperdan.github.io/lorcana-wants/` once the first build finishes:

1. The page loads over HTTPS with no console errors, and *Attack of the Vine! (2026)* is selected.
2. The output reads `207 cards, 453 copies` and begins `3 Woody - Helping a Friend`. These are the figures verified against live
   data on 2026-08-16, so this checks the whole chain end to end.
3. Setting Epic to 1 raises the copies to `471` while the card count stays at `207`. Every Epic is an alternate printing
   of a card already in the set, so it merges into an existing line rather than adding one.
4. *Into the Inklands* produces exactly one `Dalmatian Puppy - Tail Wagger` line, quantity 5 — the merge behaviour against real
   data rather than a three-card fixture.
5. Uploading your own collection export lowers the count and reports the rows read, with a plausible number skipped.

If step 2 or 4 disagrees with the numbers above, the cause is either a real regression or Lorcast changing its data. Run
`npm run test:contract` to tell which.
