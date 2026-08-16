/**
 * DOM rendering. Every function takes the document explicitly rather than
 * reaching for a global, which is what makes these testable under jsdom.
 */

import { DEFAULT_QUANTITY, rarityLabel } from "./rarities.js";
import { setLabel } from "./sets.js";

/** Radio buttons for the sets, with the first one selected. */
export function renderSetChoices(doc, sets, onChange) {
  const container = doc.getElementById("sets");
  container.replaceChildren();

  sets.forEach((set, index) => {
    const label = doc.createElement("label");
    const input = doc.createElement("input");
    input.type = "radio";
    input.name = "set";
    input.value = set.code;
    input.checked = index === 0;
    input.addEventListener("change", () => onChange(set.code));

    label.append(input, doc.createTextNode(setLabel(set)));
    container.append(label);
  });
}

/**
 * A number input per rarity present in the set, every one starting at zero.
 *
 * `previous` carries the quantities already on screen, so switching sets keeps
 * what you typed. Without it, every set change would silently reset the form
 * to zero and the tool would be tiresome to use.
 */
export function renderRarityInputs(doc, raritiesPresent, onChange, previous = {}) {
  const container = doc.getElementById("rarities");
  container.replaceChildren();

  for (const rarity of raritiesPresent) {
    const label = doc.createElement("label");
    const span = doc.createElement("span");
    span.textContent = rarityLabel(rarity);

    const input = doc.createElement("input");
    input.type = "number";
    input.min = "0";
    input.value = String(previous[rarity.toLowerCase()] ?? DEFAULT_QUANTITY);
    input.dataset.rarity = rarity;
    input.addEventListener("input", onChange);

    label.append(span, input);
    container.append(label);
  }
}

/** The rarity inputs as a quantity map keyed the way computeWants expects. */
export function readQuantities(doc) {
  const quantities = {};
  for (const input of doc.getElementById("rarities").querySelectorAll("input[data-rarity]")) {
    const value = Number(input.value);
    quantities[input.dataset.rarity.toLowerCase()] =
      Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return quantities;
}

export function setStatus(doc, id, message, isError = false) {
  const node = doc.getElementById(id);
  node.textContent = message;
  node.classList.toggle("error", isError);
}

export function showOutput(doc, text, { cards, copies }) {
  doc.getElementById("output").value = text;
  doc.getElementById("summary").textContent = cards
    ? `${cards} cards, ${copies} copies.`
    : "Nothing wanted yet — raise a rarity above 0 to build a list.";
}
