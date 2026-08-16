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
