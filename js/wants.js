/** Turning a set plus quantities plus a collection into a wants list. */

import { rarityKey } from "./rarities.js";

const NUMBER_THEN_SUFFIX = /^(\d+)(.*)$/;
// A character that cannot occur in a card name, so "Ariel" + "Spectacular
// Singer" can never collide with a name that happens to end in a space.
const MERGE_SEPARATOR = "\u0000";

/** "4" < "4a" < "40": compare the numeric part numerically, then the suffix. */
export function compareCollectorNumbers(a, b) {
  const left = NUMBER_THEN_SUFFIX.exec(String(a));
  const right = NUMBER_THEN_SUFFIX.exec(String(b));
  if (!left || !right) return String(a).localeCompare(String(b));
  const difference = Number(left[1]) - Number(right[1]);
  return difference !== 0 ? difference : left[2].localeCompare(right[2]);
}

/**
 * How many copies of each card are still needed.
 *
 * Cards sharing a name and version merge into a single line, because
 * Cardmarket matches on product name: Into the Inklands prints five
 * "Dalmatian Puppy - Tail Wagger" and five identical lines would be nonsense.
 * Merging happens after subtracting owned copies, so owning 4a reduces the
 * merged total rather than removing a whole line.
 */
export function computeWants({ cards, quantities, owned, countNormals, countFoils }) {
  const merged = new Map();

  for (const card of cards) {
    const target = quantities[rarityKey(card.rarity)] ?? 0;
    if (target <= 0) continue;

    const held = owned.get(card.collectorNumber) ?? { normal: 0, foil: 0 };
    const counted = (countNormals ? held.normal : 0) + (countFoils ? held.foil : 0);
    const needed = Math.max(0, target - counted);
    if (needed === 0) continue;

    const key = `${card.name}${MERGE_SEPARATOR}${card.version}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += needed;
      if (compareCollectorNumbers(card.collectorNumber, existing.collectorNumber) < 0) {
        existing.collectorNumber = card.collectorNumber;
      }
    } else {
      merged.set(key, {
        collectorNumber: card.collectorNumber,
        name: card.name,
        version: card.version,
        rarity: card.rarity,
        quantity: needed,
      });
    }
  }

  return [...merged.values()].sort((a, b) =>
    compareCollectorNumbers(a.collectorNumber, b.collectorNumber),
  );
}

/** Distinct lines and total copies, for the summary under the output. */
export function summarise(wants) {
  return {
    cards: wants.length,
    copies: wants.reduce((total, want) => total + want.quantity, 0),
  };
}
