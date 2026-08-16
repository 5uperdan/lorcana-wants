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
