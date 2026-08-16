/** Rendering wants into Cardmarket's decklist paste format. */

export const SEPARATOR = " - ";

/**
 * One line of Cardmarket's paste format. A card's name there includes its
 * version subtitle; cards without one are just the name.
 */
export function renderLine(want) {
  const name = want.version ? `${want.name}${SEPARATOR}${want.version}` : want.name;
  return `${want.quantity} ${name}`;
}

export function renderDecklist(wants) {
  return wants.map(renderLine).join("\n");
}
