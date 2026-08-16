/**
 * Regression guard over a real collection.
 *
 * Every other test uses three-row fixtures written to make one behaviour
 * obvious. This one runs the whole pipeline over an actual 2,888-row
 * collection, captured both ways Dreamborn offers it — the CSV export and the
 * API response — against real Lorcast card lists.
 *
 * It exists to catch the class of bug that small fixtures cannot: quoted names
 * containing commas, lettered collector numbers, promo rows belonging to no
 * numbered set, and cards sharing a name across several collector numbers.
 *
 * Everything here is offline. The fixtures were captured on 2026-08-16 and the
 * figures below were verified against the live APIs on that date.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "vitest";

import { combineRows, ownedForSet, parseDreambornCsv } from "../js/collection.js";
import { buildCardIndex, collectionToRows } from "../js/dreamborn.js";
import { fetchSetCards } from "../js/lorcast.js";
import { renderDecklist } from "../js/render.js";
import { splitWants } from "../js/split.js";
import { computeWants, summarise } from "../js/wants.js";

const fixture = (name) => resolve(process.cwd(), "tests/fixtures", name);
const json = (name) => JSON.parse(readFileSync(fixture(name), "utf8"));

const QUANTITIES = { common: 1, uncommon: 2, rare: 3, super_rare: 4, legendary: 4 };

const CSV_ROWS = parseDreambornCsv(readFileSync(fixture("collection-export.csv"), "utf8"));
const API_ROWS = collectionToRows(
  json("collection-dreamborn.json").cards,
  buildCardIndex(json("dreamborn-card-index.json")),
);

/** Run a set's card list through the real client, so its mapping is exercised. */
async function cardsFor(set) {
  const payload = json(`lorcast-set-${set}.json`);
  return fetchSetCards(set, async () => ({ ok: true, status: 200, json: async () => payload }));
}

// --- the collection itself ----------------------------------------------

test("the CSV export parses completely, with nothing unreadable", () => {
  expect(CSV_ROWS.rows).toHaveLength(2888);
  expect(CSV_ROWS.unparsed).toHaveLength(0);
});

test("the API response resolves completely, including hashed card ids", () => {
  // Sets 10 onwards are keyed by an opaque id, resolvable only via the card list.
  expect(API_ROWS.rows).toHaveLength(2888);
  expect(API_ROWS.unresolved).toBe(0);
});

test("both routes into the collection agree on the number of copies", () => {
  const copies = (rows) => rows.reduce((total, row) => total + row.count, 0);

  expect(copies(CSV_ROWS.rows)).toBe(8198);
  expect(copies(API_ROWS.rows)).toBe(8198);
});

// --- Attack of the Vine! ------------------------------------------------

test("the full set is 207 cards and 453 copies", async () => {
  const cards = await cardsFor("13");

  const wants = computeWants({
    cards,
    quantities: QUANTITIES,
    owned: new Map(),
    countNormals: true,
    countFoils: true,
  });

  expect(summarise(wants)).toEqual({ cards: 207, copies: 453 });
  expect(renderDecklist(wants).split("\n")[0]).toBe("3 Woody - Helping a Friend");
});

test("subtracting the real collection leaves 201 cards and 438 copies", async () => {
  const cards = await cardsFor("13");

  const wants = computeWants({
    cards,
    quantities: QUANTITIES,
    owned: ownedForSet(CSV_ROWS.rows, "13"),
    countNormals: true,
    countFoils: true,
  });

  expect(summarise(wants)).toEqual({ cards: 201, copies: 438 });
});

test("the CSV export and the API give the same wants list", async () => {
  const cards = await cardsFor("13");
  const from = (rows) =>
    renderDecklist(
      computeWants({
        cards,
        quantities: QUANTITIES,
        owned: ownedForSet(rows, "13"),
        countNormals: true,
        countFoils: true,
      }),
    );

  // The strongest assertion here: two independent readings of one collection
  // must produce byte-identical output.
  expect(from(API_ROWS.rows)).toBe(from(CSV_ROWS.rows));
});

test("what is left splits into three Cardmarket lists at 100 unique cards", async () => {
  const cards = await cardsFor("13");
  const wants = computeWants({
    cards,
    quantities: QUANTITIES,
    owned: ownedForSet(CSV_ROWS.rows, "13"),
    countNormals: true,
    countFoils: true,
  });

  expect(splitWants(wants, 100).map((part) => part.length)).toEqual([100, 100, 1]);
});

// --- Into the Inklands, for the repeated-name case ----------------------

test("the five Dalmatian Puppy printings become one line", async () => {
  const cards = await cardsFor("3");

  const wants = computeWants({
    cards,
    quantities: QUANTITIES,
    owned: new Map(),
    countNormals: true,
    countFoils: true,
  });
  const puppies = wants.filter((want) => want.name === "Dalmatian Puppy");

  // 4a to 4e are five distinct cards but one Cardmarket product name.
  expect(puppies).toHaveLength(1);
  expect(puppies[0].quantity).toBe(5);
  expect(summarise(wants)).toEqual({ cards: 204, copies: 448 });
});

test("Into the Inklands needs 58 cards and 142 copies, either way round", async () => {
  const cards = await cardsFor("3");
  const summary = (rows) =>
    summarise(
      computeWants({
        cards,
        quantities: QUANTITIES,
        owned: ownedForSet(rows, "3"),
        countNormals: true,
        countFoils: true,
      }),
    );

  expect(summary(CSV_ROWS.rows)).toEqual({ cards: 58, copies: 142 });
  expect(summary(API_ROWS.rows)).toEqual({ cards: 58, copies: 142 });
});

test("the CSV files four promos under set 3 where the API does not", () => {
  // A real difference between the two exports, harmless because none of them
  // is a card in set 3 — but worth pinning, so a future change to the joining
  // rules has to face it deliberately rather than by accident.
  const fromCsv = ownedForSet(CSV_ROWS.rows, "3");
  const fromApi = ownedForSet(API_ROWS.rows, "3");
  const onlyInCsv = [...fromCsv.keys()].filter((number) => !fromApi.has(number));

  expect(onlyInCsv.sort()).toEqual(["26/P1", "27/P1", "28/P1", "29/P1"]);
});

// --- combining ----------------------------------------------------------

test("adding the same collection twice doubles what is owned", async () => {
  // Not a recommendation — this is why the app refuses a duplicate link.
  const cards = await cardsFor("13");
  const doubled = combineRows([{ rows: CSV_ROWS.rows }, { rows: CSV_ROWS.rows }]);

  const wants = computeWants({
    cards,
    quantities: QUANTITIES,
    owned: ownedForSet(doubled, "13"),
    countNormals: true,
    countFoils: true,
  });

  expect(summarise(wants).copies).toBeLessThan(438);
});
