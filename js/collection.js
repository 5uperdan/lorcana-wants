/** Reading a collection export into owned-copy counts. */

const REQUIRED_COLUMNS = ["Set Number", "Card Number", "Variant", "Count"];

/**
 * Minimal RFC 4180 parse. Card names contain commas and are therefore quoted,
 * so splitting on commas would corrupt every row containing one.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      endField();
    } else if (char === "\n") {
      endRow();
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** "005" is Lorcast's set "5". Non-numeric codes such as "P1" pass through. */
export function normaliseSetNumber(value) {
  const trimmed = String(value ?? "").trim();
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
}

/**
 * Parse a Dreamborn CSV export. Only the four columns this tool needs are
 * read; Name and Rarity are ignored because the API is authoritative for
 * those, which means a stale export still works.
 */
export function parseDreambornCsv(text) {
  const table = parseCsv(text ?? "");
  if (table.length === 0) throw new Error("That file is empty.");

  const header = table[0].map((column) => column.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `That CSV is missing the ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}. ` +
        `Expected columns: ${REQUIRED_COLUMNS.join(", ")}.`,
    );
  }

  const at = Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)]));
  const rows = [];
  const unparsed = [];

  for (const record of table.slice(1)) {
    const count = Number(record[at.Count]);
    const collectorNumber = String(record[at["Card Number"]] ?? "").trim();
    if (!Number.isInteger(count) || count <= 0 || collectorNumber === "") {
      unparsed.push(record);
      continue;
    }
    rows.push({
      setCode: normaliseSetNumber(record[at["Set Number"]]),
      collectorNumber,
      variant: String(record[at.Variant] ?? "")
        .trim()
        .toLowerCase(),
      count,
    });
  }

  return { rows, unparsed };
}

/** Owned copies for one set, keyed by collector number. */
export function ownedForSet(rows, setCode) {
  const owned = new Map();
  for (const row of rows) {
    if (row.setCode !== String(setCode)) continue;
    const entry = owned.get(row.collectorNumber) ?? { normal: 0, foil: 0 };
    if (row.variant === "foil") entry.foil += row.count;
    else entry.normal += row.count;
    owned.set(row.collectorNumber, entry);
  }
  return owned;
}

/** Seam for other collection exports. Only Dreamborn is implemented. */
export const PARSERS = { dreamborn: parseDreambornCsv };
