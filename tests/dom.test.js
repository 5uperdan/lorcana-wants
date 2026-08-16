/**
 * @vitest-environment jsdom
 */
import { beforeEach, expect, test } from "vitest";

import {
  readQuantities,
  readSplitSize,
  renderRarityInputs,
  renderSetChoices,
  setStatus,
  showOutput,
} from "../js/dom.js";
import { INDEX_HTML } from "./helpers/page.js";

const SETS = [
  { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
  { code: "12", name: "Wilds Unknown", releasedAt: "2026-05-08" },
];

beforeEach(() => {
  document.body.innerHTML = INDEX_HTML;
});

test("the markup contains every element the code looks up", () => {
  // Guards against renaming an id in the HTML without updating the code.
  for (const id of [
    "sets",
    "sets-status",
    "rarities",
    "collection",
    "collection-status",
    "count-normals",
    "count-foils",
    "outputs",
    "summary",
  ]) {
    expect(document.getElementById(id), `missing #${id}`).not.toBeNull();
  }
});

test("the page loads its script as a module from the expected path", () => {
  const script = document.querySelector('script[type="module"]');

  expect(script.getAttribute("src")).toBe("js/main.js");
});

test("a radio is rendered per set, labelled with name and year", () => {
  renderSetChoices(document, SETS, () => {});

  const labels = [...document.querySelectorAll("#sets label")].map((node) =>
    node.textContent.trim(),
  );

  expect(labels).toEqual(["Attack of the Vine! (2026)", "Wilds Unknown (2026)"]);
});

test("the first set is selected so the page has something to show immediately", () => {
  renderSetChoices(document, SETS, () => {});

  const [first, second] = document.querySelectorAll("#sets input");

  expect(first.checked).toBe(true);
  expect(second.checked).toBe(false);
});

test("the set radios share a name so only one can be chosen", () => {
  renderSetChoices(document, SETS, () => {});

  const names = new Set([...document.querySelectorAll("#sets input")].map((node) => node.name));

  expect(names).toEqual(new Set(["set"]));
});

test("choosing a set reports its code", () => {
  const chosen = [];
  renderSetChoices(document, SETS, (code) => chosen.push(code));

  document.querySelectorAll("#sets input")[1].click();

  expect(chosen).toEqual(["12"]);
});

test("re-rendering replaces the previous set choices rather than appending", () => {
  renderSetChoices(document, SETS, () => {});
  renderSetChoices(document, SETS, () => {});

  expect(document.querySelectorAll("#sets input")).toHaveLength(2);
});

test("a number input is rendered per rarity, every one starting at zero", () => {
  renderRarityInputs(document, ["Common", "Super_rare", "Enchanted"], () => {});

  const inputs = [...document.querySelectorAll("#rarities input")];

  expect(inputs.map((node) => node.value)).toEqual(["0", "0", "0"]);
});

test("previously entered quantities survive a re-render", () => {
  // Changing set re-renders these inputs; whatever was typed must not be lost.
  renderRarityInputs(document, ["Common", "Rare"], () => {}, { common: 2, rare: 3 });

  const inputs = [...document.querySelectorAll("#rarities input")];

  expect(inputs.map((node) => node.value)).toEqual(["2", "3"]);
});

test("a rarity the previous set did not have falls back to zero", () => {
  renderRarityInputs(document, ["Common", "Iconic"], () => {}, { common: 2 });

  const inputs = [...document.querySelectorAll("#rarities input")];

  expect(inputs.map((node) => node.value)).toEqual(["2", "0"]);
});

test("rarity inputs are labelled readably", () => {
  renderRarityInputs(document, ["Super_rare"], () => {});

  expect(document.querySelector("#rarities label span").textContent).toBe("Super rare");
});

test("rarity inputs cannot go negative", () => {
  renderRarityInputs(document, ["Common"], () => {});

  expect(document.querySelector("#rarities input").min).toBe("0");
});

test("editing a rarity notifies the caller", () => {
  let changes = 0;
  renderRarityInputs(document, ["Common"], () => {
    changes += 1;
  });

  const input = document.querySelector("#rarities input");
  input.value = "2";
  input.dispatchEvent(new Event("input"));

  expect(changes).toBe(1);
});

test("readQuantities returns lowercased rarity keys and the entered values", () => {
  renderRarityInputs(document, ["Common", "Super_rare"], () => {});
  const [common, superRare] = document.querySelectorAll("#rarities input");
  common.value = "1";
  superRare.value = "4";

  expect(readQuantities(document)).toEqual({ common: 1, super_rare: 4 });
});

test("readQuantities treats a blank or negative entry as zero", () => {
  renderRarityInputs(document, ["Common", "Rare"], () => {});
  const [blank, negative] = document.querySelectorAll("#rarities input");
  blank.value = "";
  negative.value = "-3";

  expect(readQuantities(document)).toEqual({ common: 0, rare: 0 });
});

test("setStatus writes the message", () => {
  setStatus(document, "sets-status", "42 cards in this set.");

  expect(document.getElementById("sets-status").textContent).toBe("42 cards in this set.");
});

test("setStatus marks errors and clears the mark when the next message is fine", () => {
  setStatus(document, "sets-status", "It broke.", true);
  expect(document.getElementById("sets-status").classList.contains("error")).toBe(true);

  setStatus(document, "sets-status", "All good.");
  expect(document.getElementById("sets-status").classList.contains("error")).toBe(false);
});

const part = (text, wants) => ({ text, wants });
const someWants = (count) => Array.from({ length: count }, () => ({ quantity: 2 }));

test("showOutput fills a textarea and summarises", () => {
  showOutput(document, [part("3 Woody - Helping a Friend", someWants(1))], { cards: 1, copies: 3 }, () => {});

  expect(document.querySelector("#outputs textarea").value).toBe("3 Woody - Helping a Friend");
  expect(document.getElementById("summary").textContent).toBe("1 cards, 3 copies.");
});

test("showOutput explains an empty result instead of leaving a blank box", () => {
  showOutput(document, [], { cards: 0, copies: 0 }, () => {});

  expect(document.getElementById("summary").textContent).toMatch(/nothing wanted yet/i);
  expect(document.querySelectorAll("#outputs textarea")).toHaveLength(0);
});

test("a single part gets no list heading, because there is nothing to tell apart", () => {
  showOutput(document, [part("a", someWants(1))], { cards: 1, copies: 2 }, () => {});

  expect(document.querySelector(".part-label")).toBeNull();
});

test("several parts each get their own textarea, heading and copy button", () => {
  showOutput(
    document,
    [part("a", someWants(100)), part("b", someWants(7))],
    { cards: 107, copies: 214 },
    () => {},
  );

  expect(document.querySelectorAll("#outputs textarea")).toHaveLength(2);
  expect(document.querySelectorAll("#outputs button")).toHaveLength(2);
  const labels = [...document.querySelectorAll(".part-label")].map((n) => n.textContent);
  expect(labels[0]).toBe("List 1 of 2 — 100 cards, 200 copies");
  expect(labels[1]).toBe("List 2 of 2 — 7 cards, 14 copies");
});

test("the summary says how many lists the wants are spread across", () => {
  showOutput(document, [part("a", someWants(2)), part("b", someWants(1))], { cards: 3, copies: 6 }, () => {});

  expect(document.getElementById("summary").textContent).toBe("3 cards, 6 copies across 2 lists.");
});

test("each copy button copies its own part, not the whole list", () => {
  const copied = [];
  showOutput(
    document,
    [part("first list", someWants(1)), part("second list", someWants(1))],
    { cards: 2, copies: 4 },
    (text) => copied.push(text),
  );

  document.querySelectorAll("#outputs button")[1].click();

  expect(copied).toEqual(["second list"]);
});

test("re-rendering replaces the previous parts rather than appending", () => {
  showOutput(document, [part("a", someWants(1)), part("b", someWants(1))], { cards: 2, copies: 4 }, () => {});
  showOutput(document, [part("a", someWants(1))], { cards: 1, copies: 2 }, () => {});

  expect(document.querySelectorAll("#outputs textarea")).toHaveLength(1);
});

test("the split size defaults to no limit", () => {
  expect(readSplitSize(document)).toBe(0);
});

test("readSplitSize reports the chosen limit", () => {
  document.querySelector('input[name="split"][value="150"]').checked = true;

  expect(readSplitSize(document)).toBe(150);
});
