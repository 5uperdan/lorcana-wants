/**
 * The application. Every dependency on the outside world — the document, the
 * network, the clipboard — arrives as an argument, so the whole flow can be
 * driven in a test.
 */

import { combineRows, ownedForSet, parseDreambornCsv } from "./collection.js";
import { fetchCardIndex, loadDreambornCollection } from "./dreamborn.js";
import {
  readQuantities,
  readSplitSize,
  renderRarityInputs,
  renderSetChoices,
  renderSources,
  setStatus,
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
  const state = { setCode: null, cards: [], sources: [] };
  // Taken from the markup so the wording lives in one place.
  const emptyCollectionMessage = doc.getElementById("collection-status").textContent.trim();

  let nextSourceId = 1;
  let cardIndex = null;

  /** Fetched at most once, and only when a collection actually needs it. */
  function getCardIndex() {
    cardIndex ??= fetchCardIndex(fetchImpl);
    return cardIndex;
  }

  async function copyToClipboard(text, button) {
    await clipboard.writeText(text);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy to clipboard";
    }, COPIED_MESSAGE_MS);
  }

  /**
   * Say what the combined collections mean for the set on screen.
   *
   * A source can parse perfectly and still match nothing — promo cards are
   * numbered like "2/P2" and belong to no numbered set — so a bare "loaded"
   * would let a mismatched file look like a working one.
   */
  function reportCollection() {
    if (state.sources.length === 0) {
      setStatus(doc, "collection-status", emptyCollectionMessage);
      return;
    }

    const rows = combineRows(state.sources);
    const numbers = new Set(state.cards.map((card) => card.collectorNumber));
    const forSet = rows.filter((row) => row.setCode === state.setCode);
    const unmatched = forSet.filter((row) => !numbers.has(row.collectorNumber)).length;
    const unreadable = state.sources.reduce((total, source) => total + source.unreadable, 0);

    const parts = [
      `${state.sources.length} ${state.sources.length === 1 ? "collection" : "collections"} combined`,
      `${rows.length} cards`,
      `${forSet.length - unmatched} match this set`,
    ];
    if (unmatched > 0) parts.push(`${unmatched} did not match a card in this set`);
    if (unreadable > 0) parts.push(`${unreadable} could not be read`);

    setStatus(doc, "collection-status", `${parts.join(", ")}.`);
  }

  function recalculate() {
    const owned = ownedForSet(combineRows(state.sources), state.setCode);

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

  function addSource(source) {
    state.sources.push({ id: `source-${nextSourceId}`, unreadable: 0, ...source });
    nextSourceId += 1;
    renderSources(doc, state.sources, removeSource);
    recalculate();
  }

  function removeSource(id) {
    state.sources = state.sources.filter((source) => source.id !== id);
    renderSources(doc, state.sources, removeSource);
    recalculate();
  }

  /** Add a CSV export. Returns false if it could not be read. */
  function addCollectionText(text, name = "Uploaded file") {
    let parsed;
    try {
      parsed = parseDreambornCsv(text);
    } catch (error) {
      // Leave the sources already added alone: one bad file must not discard
      // collections that are working.
      setStatus(doc, "collection-status", error.message, true);
      return false;
    }
    addSource({ kind: "file", name, rows: parsed.rows, unreadable: parsed.unparsed.length });
    return true;
  }

  /** Add a public Dreamborn collection by link. */
  async function addCollectionLink(input) {
    const button = doc.getElementById("add-link");
    button.disabled = true;
    try {
      const collection = await loadDreambornCollection(input, fetchImpl, getCardIndex);
      // Adding the same collection twice would double every count and quietly
      // shrink the wants list, which looks like working software.
      if (state.sources.some((source) => source.sourceKey === collection.id)) {
        setStatus(doc, "collection-status", `"${collection.name}" is already added.`, true);
        return false;
      }
      addSource({
        sourceKey: collection.id,
        kind: "link",
        name: collection.name,
        rows: collection.rows,
        unreadable: collection.unresolved,
      });
      doc.getElementById("collection-url").value = "";
      return true;
    } catch (error) {
      setStatus(doc, "collection-status", error.message, true);
      return false;
    } finally {
      button.disabled = false;
    }
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => addCollectionText(String(reader.result), file.name);
    reader.onerror = () =>
      setStatus(doc, "collection-status", `${file.name} could not be read.`, true);
    reader.readAsText(file);
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

  async function start() {
    for (const id of ["count-normals", "count-foils"]) {
      doc.getElementById(id).addEventListener("change", recalculate);
    }
    for (const radio of doc.querySelectorAll('input[name="split"]')) {
      radio.addEventListener("change", recalculate);
    }
    doc.getElementById("collection").addEventListener("change", (event) => {
      for (const file of event.target.files) readFile(file);
      // Clear it so picking the same file again still fires a change event.
      event.target.value = "";
    });
    doc.getElementById("add-link").addEventListener("click", () => {
      addCollectionLink(doc.getElementById("collection-url").value);
    });
    doc.getElementById("collection-url").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addCollectionLink(event.target.value);
      }
    });

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

  return { start, recalculate, addCollectionText, addCollectionLink, removeSource, state };
}
