/**
 * Reading a public Dreamborn collection straight from its link.
 *
 * Dreamborn keys a collection two ways. Older sets use the collector number
 * directly ("005-135"), but from set 10 the key is an opaque id
 * ("013/<hash>"), which only their published card list can resolve. That list
 * is 1.9 MB, so it is fetched lazily — a collection covering only older sets
 * never needs it.
 */

export const COLLECTION_API = "https://dreamborn.ink/api/collections";
export const CARD_INDEX_URL = "https://dreamborn.ink/cache/en/cards.json";

const ID_PATTERN = /^[A-Za-z0-9_-]{6,}$/;
const COLLECTION_LINK = /(?:^|\/)collections\/([A-Za-z0-9_-]+)/;
const LEADING_ZEROS = /^0+(?=\d)/;

export class DreambornError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "DreambornError";
  }
}

/** Accept a full collection link or the bare id, since people paste either. */
export function parseCollectionId(input) {
  const trimmed = String(input ?? "").trim();
  if (trimmed === "") throw new DreambornError("Paste a Dreamborn collection link.");

  const linked = COLLECTION_LINK.exec(trimmed);
  if (linked) return linked[1];

  // A bare id has no slashes; anything else is a link to something that is not
  // a collection, and fetching it would fail in a confusing way.
  if (!trimmed.includes("/") && ID_PATTERN.test(trimmed)) return trimmed;

  throw new DreambornError(
    `That does not look like a Dreamborn collection link: ${trimmed}`,
  );
}

function stripSetZeros(setId) {
  return String(setId ?? "").replace(LEADING_ZEROS, "");
}

/** Map every published card id to the set and number the wants list uses. */
export function buildCardIndex(cards) {
  const index = new Map();
  for (const card of cards ?? []) {
    index.set(card.id, { setCode: stripSetZeros(card.setId), number: String(card.number) });
  }
  return index;
}

/** Only hashed keys need the card list, and it is large. */
export function needsCardIndex(cards) {
  return Object.keys(cards ?? {}).some((key) => key.includes("/"));
}

async function getJson(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new DreambornError(`Could not reach ${url}. Check your connection.`, { cause });
  }
  if (!response.ok) {
    throw new DreambornError(
      `Dreamborn returned ${response.status} for that collection. Check the link, and that the collection is public.`,
    );
  }
  return response.json();
}

export async function fetchCardIndex(fetchImpl = fetch) {
  return buildCardIndex(await getJson(CARD_INDEX_URL, fetchImpl));
}

/** Turn Dreamborn's `{key: count}` into the rows the wants list consumes. */
export function collectionToRows(cards, index) {
  const rows = [];
  let unresolved = 0;

  for (const [key, count] of Object.entries(cards ?? {})) {
    const [base, suffix] = key.split(":");
    const variant = suffix === "foil" ? "foil" : "normal";

    let setCode;
    let collectorNumber;

    if (base.includes("/")) {
      const found = index.get(base);
      if (!found) {
        unresolved += 1;
        continue;
      }
      ({ setCode, number: collectorNumber } = found);
    } else {
      const divider = base.indexOf("-");
      setCode = stripSetZeros(base.slice(0, divider));
      collectorNumber = base.slice(divider + 1).replace(LEADING_ZEROS, "");
    }

    rows.push({ setCode, collectorNumber, variant, count });
  }

  return { rows, unresolved };
}

/**
 * Fetch a public collection and return it as wants-list rows.
 *
 * `getCardIndex` is injected so the caller can cache it across collections —
 * and so tests can prove it is not fetched when nothing needs it.
 */
export async function loadDreambornCollection(input, fetchImpl = fetch, getCardIndex) {
  const id = parseCollectionId(input);
  const payload = await getJson(`${COLLECTION_API}/${id}`, fetchImpl);

  if (!payload || typeof payload.cards !== "object" || payload.cards === null) {
    throw new DreambornError(
      "That collection has no cards in it. Check the link, and that the collection is public.",
    );
  }

  const index = needsCardIndex(payload.cards) ? await getCardIndex() : new Map();
  const { rows, unresolved } = collectionToRows(payload.cards, index);

  return { id, name: payload.name || "Dreamborn collection", rows, unresolved };
}
