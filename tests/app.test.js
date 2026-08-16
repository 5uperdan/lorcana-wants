/**
 * @vitest-environment jsdom
 */
import { beforeEach, expect, test, vi } from "vitest";

import { createApp } from "../js/app.js";
import { INDEX_HTML } from "./helpers/page.js";

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
  const responses = {
    "/sets": SETS,
    "/sets/13/cards": CARDS_13,
    "/sets/12/cards": CARDS_12,
    ...overrides,
  };
  return async (url) => {
    const match = Object.keys(responses)
      .sort((a, b) => b.length - a.length)
      .find((suffix) => url.endsWith(suffix));
    if (!match) return { ok: false, status: 404, json: async () => null };
    const payload = responses[match];
    if (payload instanceof Error) throw payload;
    return { ok: true, status: 200, json: async () => payload };
  };
}

function build(overrides = {}) {
  return createApp({
    document,
    fetchImpl: stubFetch(overrides),
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
}

/** Type a quantity into a rarity box, the way a visitor would. */
function setRarity(rarity, value) {
  const input = document.querySelector(`#rarities input[data-rarity="${rarity}"]`);
  input.value = String(value);
  input.dispatchEvent(new Event("input"));
}

/** The quantities most tests need: everything starts at 0 now. */
function wantTheUsual() {
  setRarity("Rare", 3);
  setRarity("Common", 1);
}

const output = () => document.querySelector("#outputs textarea")?.value ?? "";
const outputs = () => [...document.querySelectorAll("#outputs textarea")].map((n) => n.value);
const chooseSplit = (value) => {
  const radio = document.querySelector(`input[name="split"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event("change"));
};
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

test("nothing is wanted until a rarity is raised", async () => {
  await build().start();

  expect(output()).toBe("");
  expect(summary()).toMatch(/nothing wanted yet/i);
});

test("raising rarities builds the list", async () => {
  await build().start();

  wantTheUsual();

  expect(output()).toBe("3 Woody - Helping a Friend\n1 Piercing Attack");
  expect(summary()).toBe("2 cards, 4 copies.");
});

test("a rarity left at zero is absent from the list", async () => {
  await build().start();
  wantTheUsual();

  expect(output()).not.toMatch(/Elsa/);
});

test("raising a secret rarity adds its cards too", async () => {
  await build().start();

  setRarity("Enchanted", 1);

  expect(output()).toMatch(/1 Elsa - Spirit of Winter/);
});

test("choosing another set reloads its cards and its rarities", async () => {
  await build().start();
  wantTheUsual();

  document.querySelectorAll("#sets input")[1].click();
  await vi.waitFor(() => expect(statusOf("sets-status")).toMatch(/1 cards/));

  expect(output()).toBe("1 Someone Else");
});

test("quantities typed for one set carry over to the next", async () => {
  // Everything starts at zero, so resetting the form on every set change
  // would mean retyping the same numbers to compare two sets.
  await build().start();
  wantTheUsual();

  document.querySelectorAll("#sets input")[1].click();
  await vi.waitFor(() => expect(statusOf("sets-status")).toMatch(/1 cards/));

  expect(document.querySelector('#rarities input[data-rarity="Common"]').value).toBe("1");
});

test("loading a collection subtracts owned copies", async () => {
  const app = build();
  await app.start();

  wantTheUsual();
  app.loadCollectionText(COLLECTION);

  // Three Woody wanted, one normal and one foil owned, so one left.
  expect(output()).toBe("1 Woody - Helping a Friend\n1 Piercing Attack");
});

test("loading a collection reports how many rows it read and how many match", async () => {
  const app = build();
  await app.start();

  app.loadCollectionText(COLLECTION);

  expect(statusOf("collection-status")).toMatch(/2 collection rows/);
  expect(statusOf("collection-status")).toMatch(/2 match this set/);
});

test("rows that match no card in the set are reported rather than hidden", async () => {
  const app = build();
  await app.start();

  app.loadCollectionText(`${COLLECTION}\n013,2/P2,normal,1,"A Promo",Amber,Promo`);

  expect(statusOf("collection-status")).toMatch(/1 did not match a card in this set/);
});

test("rows that could not be read at all are reported separately", async () => {
  const app = build();
  await app.start();

  app.loadCollectionText(`${COLLECTION}\n013,2,normal,lots,"Bad Count",Amber,Common`);

  expect(statusOf("collection-status")).toMatch(/1 could not be read/);
});

test("the match count follows the selected set", async () => {
  const app = build();
  await app.start();
  wantTheUsual();
  app.loadCollectionText(COLLECTION);

  document.querySelectorAll("#sets input")[1].click();
  await vi.waitFor(() => expect(statusOf("sets-status")).toMatch(/1 cards/));

  expect(statusOf("collection-status")).toMatch(/0 match this set/);
});

test("unticking foils stops foil copies counting toward the target", async () => {
  const app = build();
  await app.start();
  wantTheUsual();
  app.loadCollectionText(COLLECTION);

  const foils = document.getElementById("count-foils");
  foils.checked = false;
  foils.dispatchEvent(new Event("change"));

  expect(output()).toMatch(/^2 Woody - Helping a Friend/);
});

test("unticking both variants ignores the collection entirely", async () => {
  const app = build();
  await app.start();
  wantTheUsual();
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
  wantTheUsual();

  app.loadCollectionText("Set Number,Card Number,Variant,Count\n012,1,normal,4");

  expect(output()).toBe("3 Woody - Helping a Friend\n1 Piercing Attack");
});

test("a malformed collection reports the problem and keeps the previous list", async () => {
  const app = build();
  await app.start();
  wantTheUsual();
  app.loadCollectionText(COLLECTION);

  app.loadCollectionText("Nonsense,Header\n1,2");

  expect(statusOf("collection-status")).toMatch(/missing/i);
  expect(document.getElementById("collection-status").classList.contains("error")).toBe(true);
  expect(output()).toBe("1 Woody - Helping a Friend\n1 Piercing Attack");
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

test("choosing a split limit breaks the list into separate lists", async () => {
  // Three commons wanted, split at two unique cards per list.
  const app = createApp({
    document,
    fetchImpl: stubFetch({
      "/sets/13/cards": [
        { collector_number: "1", name: "One", rarity: "Common" },
        { collector_number: "2", name: "Two", rarity: "Common" },
        { collector_number: "3", name: "Three", rarity: "Common" },
      ],
    }),
    clipboard: { writeText: vi.fn() },
  });
  await app.start();
  setRarity("Common", 1);

  // Retune one radio to a small limit so the fixture can demonstrate a split
  // without needing a hundred cards.
  const radio = document.querySelector('input[name="split"][value="100"]');
  radio.value = "2";
  radio.checked = true;
  radio.dispatchEvent(new Event("change"));

  expect(outputs()).toEqual(["1 One\n1 Two", "1 Three"]);
  expect(summary()).toBe("3 cards, 3 copies across 2 lists.");
});

test("switching back to no limit rejoins the list", async () => {
  await build().start();
  wantTheUsual();
  chooseSplit("100");

  chooseSplit("0");

  expect(outputs()).toHaveLength(1);
  expect(summary()).toBe("2 cards, 4 copies.");
});

test("a list within the limit is not split", async () => {
  await build().start();
  wantTheUsual();

  chooseSplit("150");

  expect(outputs()).toHaveLength(1);
});

test("copying writes the output to the clipboard", async () => {
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  const app = createApp({ document, fetchImpl: stubFetch(), clipboard });
  await app.start();
  wantTheUsual();

  document.querySelector("#outputs button").click();
  await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledOnce());

  expect(clipboard.writeText).toHaveBeenCalledWith("3 Woody - Helping a Friend\n1 Piercing Attack");
});
