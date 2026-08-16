import { expect, test } from "vitest";

import { DEFAULT_QUANTITY, raritiesInSet, rarityKey, rarityLabel } from "../js/rarities.js";

test("rarity keys are lowercased", () => {
  expect(rarityKey("Super_rare")).toBe("super_rare");
  expect(rarityKey("Common")).toBe("common");
});

test("rarity labels replace underscores with spaces", () => {
  expect(rarityLabel("Super_rare")).toBe("Super rare");
  expect(rarityLabel("Common")).toBe("Common");
});

test("every rarity starts at zero, so nothing is wanted by accident", () => {
  expect(DEFAULT_QUANTITY).toBe(0);
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
