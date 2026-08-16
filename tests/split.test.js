import { expect, test } from "vitest";

import { SPLIT_SIZES, splitWants } from "../js/split.js";

const wants = (count) =>
  Array.from({ length: count }, (_, index) => ({
    collectorNumber: String(index + 1),
    name: `Card ${index + 1}`,
    version: "",
    rarity: "Common",
    quantity: 2,
  }));

test("no limit keeps everything in one part", () => {
  expect(splitWants(wants(207), 0)).toHaveLength(1);
});

test("a list shorter than the limit stays in one part", () => {
  expect(splitWants(wants(40), 100)).toHaveLength(1);
});

test("a list exactly the limit stays in one part", () => {
  // 100 unique cards is within the limit, so splitting would be gratuitous.
  expect(splitWants(wants(100), 100)).toHaveLength(1);
});

test("a longer list splits into parts of at most the limit", () => {
  const parts = splitWants(wants(207), 100);

  expect(parts.map((part) => part.length)).toEqual([100, 100, 7]);
});

test("splitting at 150 gives the parts you would expect", () => {
  expect(splitWants(wants(207), 150).map((part) => part.length)).toEqual([150, 57]);
});

test("the limit counts unique cards, not copies", () => {
  // Every card here wants 2 copies; 207 unique cards is what matters.
  const parts = splitWants(wants(207), 100);
  const copies = parts.flat().reduce((total, want) => total + want.quantity, 0);

  expect(copies).toBe(414);
  expect(parts[0]).toHaveLength(100);
});

test("splitting preserves order across the parts", () => {
  const parts = splitWants(wants(5), 2);

  expect(parts.flat().map((want) => want.name)).toEqual([
    "Card 1",
    "Card 2",
    "Card 3",
    "Card 4",
    "Card 5",
  ]);
});

test("an empty list produces no parts at all", () => {
  expect(splitWants([], 100)).toEqual([]);
  expect(splitWants([], 0)).toEqual([]);
});

test("the offered sizes are no limit, 100 and 150", () => {
  expect(SPLIT_SIZES).toEqual([0, 100, 150]);
});
