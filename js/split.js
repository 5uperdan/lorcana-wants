/**
 * Splitting a wants list into parts small enough for one Cardmarket list.
 *
 * A Cardmarket wants list holds a limited number of unique cards, and the
 * Shopping Wizard works over a single list, so a set completion has to be
 * spread across several lists to be shoppable. The limit counts unique cards,
 * not copies: four copies of one card is one entry.
 */

/** Offered part sizes. 0 means no limit. */
export const SPLIT_SIZES = [0, 100, 150];

/**
 * Break `wants` into parts of at most `size` unique cards, preserving order.
 * A size of 0, or a list already within the limit, yields a single part.
 */
export function splitWants(wants, size) {
  if (wants.length === 0) return [];
  if (!size || size <= 0 || wants.length <= size) return [wants];

  const parts = [];
  for (let index = 0; index < wants.length; index += size) {
    parts.push(wants.slice(index, index + size));
  }
  return parts;
}
