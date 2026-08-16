/** Ordering and labelling for the set picker. */

/** Newest first. Sets with no release date sort to the end. */
export function sortSetsNewestFirst(sets) {
  return [...sets].sort((a, b) => (b.releasedAt || "").localeCompare(a.releasedAt || ""));
}

/** "Attack of the Vine! (2026)" — the year helps tell promo sets apart. */
export function setLabel(set) {
  const year = (set.releasedAt || "").slice(0, 4);
  return year ? `${set.name} (${year})` : set.name;
}
