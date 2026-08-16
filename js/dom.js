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

/**
 * One row per added collection, each removable on its own.
 *
 * Showing them as a list is the point: sources add together, and a list makes
 * that obvious in a way a single "collection loaded" line never could.
 */
export function renderSources(doc, sources, onRemove) {
  const list = doc.getElementById("sources");
  list.replaceChildren();

  for (const source of sources) {
    const item = doc.createElement("li");
    item.dataset.sourceId = source.id;

    const kind = doc.createElement("span");
    kind.className = "source-kind";
    kind.textContent = source.kind === "link" ? "link" : "file";

    const copies = source.rows.reduce((total, row) => total + row.count, 0);
    const label = doc.createElement("span");
    label.textContent = `${source.name} — ${source.rows.length} cards, ${copies} copies`;

    const remove = doc.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => onRemove(source.id));

    item.append(kind, label, remove);
    list.append(item);
  }
}

export function setStatus(doc, id, message, isError = false) {
  const node = doc.getElementById(id);
  node.textContent = message;
  node.classList.toggle("error", isError);
}

/** The chosen split size in unique cards, 0 meaning no limit. */
export function readSplitSize(doc) {
  const chosen = doc.querySelector('input[name="split"]:checked');
  return chosen ? Number(chosen.value) : 0;
}

/**
 * Render one block per part: a heading, the paste text, and its own copy
 * button. Each part is a separate Cardmarket wants list, so they must be
 * copied separately — one big box would invite pasting the lot into one list.
 */
export function showOutput(doc, parts, { cards, copies }, onCopy) {
  const container = doc.getElementById("outputs");
  container.replaceChildren();

  doc.getElementById("summary").textContent = cards
    ? `${cards} cards, ${copies} copies${parts.length > 1 ? ` across ${parts.length} lists` : ""}.`
    : "Nothing wanted yet — raise a rarity above 0 to build a list.";

  parts.forEach((part, index) => {
    const block = doc.createElement("div");
    block.className = "part";

    if (parts.length > 1) {
      const heading = doc.createElement("p");
      heading.className = "note part-label";
      const partCopies = part.wants.reduce((total, want) => total + want.quantity, 0);
      heading.textContent = `List ${index + 1} of ${parts.length} — ${part.wants.length} cards, ${partCopies} copies`;
      block.append(heading);
    }

    const textarea = doc.createElement("textarea");
    textarea.readOnly = true;
    textarea.rows = parts.length > 1 ? 10 : 16;
    textarea.value = part.text;
    textarea.setAttribute("aria-label", `Wants list ${index + 1}`);

    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = "Copy to clipboard";
    button.addEventListener("click", () => onCopy(part.text, button));

    block.append(textarea, button);
    container.append(block);
  });
}
