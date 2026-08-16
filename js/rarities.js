/** Rarity naming and the default quantity for each. */

export const DEFAULT_QUANTITIES = {
  common: 1,
  uncommon: 2,
  rare: 3,
  super_rare: 4,
  legendary: 4,
};

/** Lookup key. Lorcast returns "Super_rare"; we key on "super_rare". */
export function rarityKey(rarity) {
  return String(rarity ?? "").toLowerCase();
}

/** Display form: "Super_rare" reads as "Super rare". */
export function rarityLabel(rarity) {
  return String(rarity ?? "").replaceAll("_", " ");
}

/**
 * Copies wanted by default. Anything not listed — the secret rarities today,
 * and whatever Ravensburger invents later — is zero, so an unknown rarity
 * appears as a field set to 0 rather than breaking the page.
 */
export function defaultQuantityFor(rarity) {
  return DEFAULT_QUANTITIES[rarityKey(rarity)] ?? 0;
}

/** Rarities actually present in a set, once each, in the order they appear. */
export function raritiesInSet(cards) {
  const seen = [];
  for (const card of cards) {
    if (card.rarity && !seen.includes(card.rarity)) seen.push(card.rarity);
  }
  return seen;
}
