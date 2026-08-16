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
