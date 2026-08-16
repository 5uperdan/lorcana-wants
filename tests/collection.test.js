import { expect, test } from "vitest";

import {
  PARSERS,
  combineRows,
  normaliseSetNumber,
  ownedForSet,
  parseCsv,
  parseDreambornCsv,
} from "../js/collection.js";

const HEADER = "Set Number,Card Number,Variant,Count,Name,Color,Rarity";

// --- parseCsv -----------------------------------------------------------

test("parseCsv splits plain rows", () => {
  expect(parseCsv("a,b\n1,2")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
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
  expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseCsv ignores blank lines", () => {
  expect(parseCsv("a,b\n\n1,2\n")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
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

  expect(rows).toEqual([{ setCode: "5", collectorNumber: "135", variant: "normal", count: 2 }]);
});

test("column order is read from the header, not assumed", () => {
  const { rows } = parseDreambornCsv("Count,Variant,Card Number,Set Number\n3,foil,7,006");

  expect(rows).toEqual([{ setCode: "6", collectorNumber: "7", variant: "foil", count: 3 }]);
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

// --- combineRows --------------------------------------------------------

test("sources are added together, not replaced", () => {
  const rows = combineRows([
    { rows: [{ setCode: "13", collectorNumber: "1", variant: "normal", count: 1 }] },
    { rows: [{ setCode: "13", collectorNumber: "2", variant: "foil", count: 2 }] },
  ]);

  expect(rows).toHaveLength(2);
});

test("the same card in two sources adds up", () => {
  const rows = combineRows([
    { rows: [{ setCode: "13", collectorNumber: "1", variant: "normal", count: 1 }] },
    { rows: [{ setCode: "13", collectorNumber: "1", variant: "normal", count: 2 }] },
  ]);

  expect(ownedForSet(rows, "13").get("1")).toEqual({ normal: 3, foil: 0 });
});

test("no sources means no rows", () => {
  expect(combineRows([])).toEqual([]);
});
