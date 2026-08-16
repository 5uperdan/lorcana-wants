import { expect, test } from "vitest";

import { orderSetsForPicker, setLabel } from "../js/sets.js";

const SETS = [
  { code: "1", name: "The First Chapter", releasedAt: "2023-08-18" },
  { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
  { code: "P2", name: "Promo Set 2", releasedAt: "2024-08-09" },
];

test("numbered sets are ordered newest first", () => {
  const numbered = orderSetsForPicker(SETS).filter((set) => /^\d+$/.test(set.code));

  expect(numbered.map((set) => set.code)).toEqual(["13", "1"]);
});

test("numbered sets come before promos and collections", () => {
  // Lorcast releases promo and format sets after the main set they accompany,
  // so ordering purely by date puts "Format Coconut" ahead of the newest real
  // set — and a visitor lands on a set with nothing to want.
  expect(orderSetsForPicker(SETS).map((set) => set.code)).toEqual(["13", "1", "P2"]);
});

test("the first set is a numbered one whenever there is any", () => {
  const promoIsNewest = [
    { code: "Coconut", name: "Format Coconut", releasedAt: "2026-07-28" },
    { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
    { code: "PD1", name: "PD1", releasedAt: "2026-07-28" },
  ];

  expect(orderSetsForPicker(promoIsNewest)[0].code).toBe("13");
});

test("promos keep their own newest-first order", () => {
  const promos = [
    { code: "P1", name: "Promo Set 1", releasedAt: "2023-08-18" },
    { code: "P3", name: "Promo Set 3", releasedAt: "2025-08-18" },
    { code: "P2", name: "Promo Set 2", releasedAt: "2024-08-09" },
  ];

  expect(orderSetsForPicker(promos).map((set) => set.code)).toEqual(["P3", "P2", "P1"]);
});

test("ordering does not mutate the input", () => {
  const before = SETS.map((set) => set.code);

  orderSetsForPicker(SETS);

  expect(SETS.map((set) => set.code)).toEqual(before);
});

test("sets with no release date sort last within their group", () => {
  const withUnknown = [...SETS, { code: "X", name: "Unknown", releasedAt: "" }];

  expect(orderSetsForPicker(withUnknown).at(-1).code).toBe("X");
});

test("the label carries the name and the release year", () => {
  expect(setLabel(SETS[1])).toBe("Attack of the Vine! (2026)");
});

test("a set with no release date is labelled by name alone", () => {
  expect(setLabel({ code: "X", name: "Unknown", releasedAt: "" })).toBe("Unknown");
});
