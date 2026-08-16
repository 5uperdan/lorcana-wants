/** Ordering and labelling for the set picker. */

/** A numbered set — "13" — as opposed to a promo or collection like "P2". */
function isNumbered(set) {
  return /^\d+$/.test(String(set.code ?? ""));
}

/**
 * Numbered sets first, then promos and collections, each group newest first.
 *
 * Ordering purely by date is wrong here: Lorcast releases promo and format
 * sets alongside or after the main set they accompany, so "Format Coconut"
 * outranks Attack of the Vine! and a first-time visitor lands on a set whose
 * only rarity is Promo — an empty wants list and no clue why.
 *
 * Sets with no release date sort to the end of their group.
 */
export function orderSetsForPicker(sets) {
  const byDateDescending = (a, b) => (b.releasedAt || "").localeCompare(a.releasedAt || "");
  return [
    ...sets.filter(isNumbered).sort(byDateDescending),
    ...sets.filter((set) => !isNumbered(set)).sort(byDateDescending),
  ];
}

/** "Attack of the Vine! (2026)" — the year helps tell promo sets apart. */
export function setLabel(set) {
  const year = (set.releasedAt || "").slice(0, 4);
  return year ? `${set.name} (${year})` : set.name;
}
