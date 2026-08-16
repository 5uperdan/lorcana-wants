/** Rarity naming and the default quantity for each. */

/**
 * Every rarity starts at zero, so the list only ever contains what was asked
 * for deliberately. A helpful-looking default would otherwise be pasted into
 * Cardmarket unread, and wanting the wrong cards costs money.
 */
export const DEFAULT_QUANTITY = 0;

/** Lookup key. Lorcast returns "Super_rare"; we key on "super_rare". */
export function rarityKey(rarity) {
  return String(rarity ?? "").toLowerCase();
}

/** Display form: "Super_rare" reads as "Super rare". */
export function rarityLabel(rarity) {
  return String(rarity ?? "").replaceAll("_", " ");
}

/** Rarities actually present in a set, once each, in the order they appear. */
export function raritiesInSet(cards) {
  const seen = [];
  for (const card of cards) {
    if (card.rarity && !seen.includes(card.rarity)) seen.push(card.rarity);
  }
  return seen;
}
