/**
 * @vitest-environment jsdom
 */
import { beforeEach, expect, test } from "vitest";

import {
  readQuantities,
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
    "output",
    "summary",
    "copy",
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

test("a number input is rendered per rarity, defaulted from the rarity map", () => {
  renderRarityInputs(document, ["Common", "Super_rare", "Enchanted"], () => {});

  const inputs = [...document.querySelectorAll("#rarities input")];

  expect(inputs.map((node) => node.value)).toEqual(["1", "4", "0"]);
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

test("readQuantities returns lowercased rarity keys", () => {
  renderRarityInputs(document, ["Common", "Super_rare"], () => {});

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

test("showOutput fills the textarea and summarises", () => {
  showOutput(document, "3 Woody - Helping a Friend", { cards: 1, copies: 3 });

  expect(document.getElementById("output").value).toBe("3 Woody - Helping a Friend");
  expect(document.getElementById("summary").textContent).toBe("1 cards, 3 copies.");
});

test("showOutput explains an empty result instead of leaving a blank box", () => {
  showOutput(document, "", { cards: 0, copies: 0 });

  expect(document.getElementById("summary").textContent).toMatch(/nothing to want/i);
});
