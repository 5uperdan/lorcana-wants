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
  const tyler = {
    collectorNumber: "4",
    name: "Tyler Nguyen-Baker",
    version: "4*Town Fan",
    quantity: 1,
  };

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
