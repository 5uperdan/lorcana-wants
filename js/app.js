/**
 * The application. Every dependency on the outside world — the document, the
 * network, the clipboard — arrives as an argument, so the whole flow can be
 * driven in a test.
 */

import { ownedForSet, parseDreambornCsv } from "./collection.js";
import {
  readQuantities,
  readSplitSize,
  renderRarityInputs,
  renderSetChoices,
  setStatus,
  showClearCollection,
  showOutput,
} from "./dom.js";
import { fetchSetCards, fetchSets } from "./lorcast.js";
import { raritiesInSet } from "./rarities.js";
import { renderDecklist } from "./render.js";
import { orderSetsForPicker } from "./sets.js";
import { splitWants } from "./split.js";
import { computeWants, summarise } from "./wants.js";

const COPIED_MESSAGE_MS = 1500;

export function createApp({ document: doc, fetchImpl = fetch, clipboard = navigator.clipboard }) {
  const state = { setCode: null, cards: [], collectionRows: null, unreadable: 0 };
  // Taken from the markup so the wording lives in one place.
  const emptyCollectionMessage = doc.getElementById("collection-status").textContent.trim();

  async function copyToClipboard(text, button) {
    await clipboard.writeText(text);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy to clipboard";
    }, COPIED_MESSAGE_MS);
  }

  /**
   * Say what the loaded collection means for the set on screen.
   *
   * A file can parse perfectly and still match nothing — promo cards are
   * numbered like "2/P2" and belong to no numbered set — so "loaded" alone
   * would let a mismatched file look like a working one.
   */
  function reportCollection() {
    if (!state.collectionRows) return;

    const numbers = new Set(state.cards.map((card) => card.collectorNumber));
    const forSet = state.collectionRows.filter((row) => row.setCode === state.setCode);
    const unmatched = forSet.filter((row) => !numbers.has(row.collectorNumber)).length;

    const parts = [
      `Loaded ${state.collectionRows.length} collection rows`,
      `${forSet.length - unmatched} match this set`,
    ];
    if (unmatched > 0) parts.push(`${unmatched} did not match a card in this set`);
    if (state.unreadable > 0) parts.push(`${state.unreadable} could not be read`);

    setStatus(doc, "collection-status", `${parts.join(", ")}.`);
  }

  function recalculate() {
    const owned = state.collectionRows
      ? ownedForSet(state.collectionRows, state.setCode)
      : new Map();

    const wants = computeWants({
      cards: state.cards,
      quantities: readQuantities(doc),
      owned,
      countNormals: doc.getElementById("count-normals").checked,
      countFoils: doc.getElementById("count-foils").checked,
    });

    const parts = splitWants(wants, readSplitSize(doc)).map((part) => ({
      wants: part,
      text: renderDecklist(part),
    }));

    showOutput(doc, parts, summarise(wants), copyToClipboard);
    reportCollection();
  }

  async function selectSet(code) {
    const entered = readQuantities(doc);
    state.setCode = code;
    setStatus(doc, "sets-status", "Loading cards…");
    try {
      state.cards = await fetchSetCards(code, fetchImpl);
    } catch (error) {
      state.cards = [];
      setStatus(doc, "sets-status", error.message, true);
      return;
    }
    setStatus(doc, "sets-status", `${state.cards.length} cards in this set.`);
    // Read before re-rendering: the inputs are about to be replaced, and
    // whatever was typed should survive a change of set.
    renderRarityInputs(doc, raritiesInSet(state.cards), recalculate, entered);
    recalculate();
  }

  /**
   * Split out from the file input so the parse-and-recalculate path is
   * testable without a FileReader. A bad file keeps the previous collection
   * rather than silently discarding work.
   */
  function loadCollectionText(text) {
    try {
      const { rows, unparsed } = parseDreambornCsv(text);
      state.collectionRows = rows;
      state.unreadable = unparsed.length;
    } catch (error) {
      // Keep whatever was loaded before, so a bad file does not silently
      // discard a good one — and leave the remove button as it was.
      setStatus(doc, "collection-status", error.message, true);
      return;
    }
    showClearCollection(doc, true);
    recalculate();
  }

  /**
   * Forget the uploaded collection and go back to wanting the whole set.
   *
   * Clearing the file input matters as much as clearing the rows: a file
   * input fires no change event when the same file is picked again, so
   * leaving the old filename in place would make re-uploading it do nothing.
   */
  function clearCollection() {
    state.collectionRows = null;
    state.unreadable = 0;
    doc.getElementById("collection").value = "";
    setStatus(doc, "collection-status", emptyCollectionMessage);
    showClearCollection(doc, false);
    recalculate();
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => loadCollectionText(String(reader.result));
    reader.onerror = () =>
      setStatus(doc, "collection-status", "That file could not be read.", true);
    reader.readAsText(file);
  }

  async function start() {
    for (const id of ["count-normals", "count-foils"]) {
      doc.getElementById(id).addEventListener("change", recalculate);
    }
    for (const radio of doc.querySelectorAll('input[name="split"]')) {
      radio.addEventListener("change", recalculate);
    }
    doc.getElementById("collection").addEventListener("change", (event) => {
      const [file] = event.target.files;
      if (file) readFile(file);
    });
    doc.getElementById("clear-collection").addEventListener("click", clearCollection);
    let sets;
    try {
      sets = orderSetsForPicker(await fetchSets(fetchImpl));
    } catch (error) {
      setStatus(doc, "sets-status", error.message, true);
      return;
    }
    renderSetChoices(doc, sets, selectSet);
    if (sets.length > 0) await selectSet(sets[0].code);
  }

  return { start, recalculate, loadCollectionText, clearCollection };
}
