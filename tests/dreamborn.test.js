import { expect, test } from "vitest";

import {
  CARD_INDEX_URL,
  COLLECTION_API,
  DreambornError,
  buildCardIndex,
  collectionToRows,
  fetchCardIndex,
  loadDreambornCollection,
  needsCardIndex,
  parseCollectionId,
} from "../js/dreamborn.js";

const CARD_JSON = [
  { id: "013/aaa", setId: "013", number: "1" },
  { id: "013/bbb", setId: "013", number: "2" },
  { id: "C2/ccc", setId: "001", number: "9/C2" },
];

const INDEX = buildCardIndex(CARD_JSON);

function stubFetch(responses) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      const key = Object.keys(responses).find((suffix) => url.endsWith(suffix));
      if (!key) return { ok: false, status: 404, json: async () => null };
      const payload = responses[key];
      if (payload instanceof Error) throw payload;
      return { ok: true, status: 200, json: async () => payload };
    },
  };
}

// --- parseCollectionId --------------------------------------------------

test("a full collection URL yields its id", () => {
  expect(parseCollectionId("https://dreamborn.ink/collections/HEFnzVzwpuQlvWDzb1KrAO44N2A3")).toBe(
    "HEFnzVzwpuQlvWDzb1KrAO44N2A3",
  );
});

test("a URL with a trailing slash or query still yields the id", () => {
  expect(parseCollectionId("https://dreamborn.ink/collections/abc123def456/?x=1")).toBe(
    "abc123def456",
  );
});

test("a bare id is accepted, since people paste either", () => {
  expect(parseCollectionId("HEFnzVzwpuQlvWDzb1KrAO44N2A3")).toBe("HEFnzVzwpuQlvWDzb1KrAO44N2A3");
});

test("surrounding whitespace is ignored", () => {
  expect(parseCollectionId("  abc123def456  ")).toBe("abc123def456");
});

test("empty input is a clear error rather than a fetch of nothing", () => {
  expect(() => parseCollectionId("   ")).toThrow(/paste a dreamborn collection link/i);
});

test("something that is plainly not a collection link is rejected", () => {
  expect(() => parseCollectionId("https://example.com/hello")).toThrow(/does not look like/i);
});

test("a deck link is rejected rather than fetched as a collection", () => {
  expect(() => parseCollectionId("https://dreamborn.ink/decks/abc123def456")).toThrow(
    /does not look like/i,
  );
});

// --- the card index -----------------------------------------------------

test("the index maps a card id to its set and number", () => {
  expect(INDEX.get("013/aaa")).toEqual({ setCode: "13", number: "1" });
});

test("set ids lose their leading zeros to match Lorcast", () => {
  expect(INDEX.get("C2/ccc").setCode).toBe("1");
});

test("the index is only needed when a key is in the hashed form", () => {
  expect(needsCardIndex({ "005-135": 2 })).toBe(false);
  expect(needsCardIndex({ "005-135": 2, "013/aaa": 1 })).toBe(true);
});

test("fetchCardIndex reads the published card list", async () => {
  const { fetchImpl, calls } = stubFetch({ "cards.json": CARD_JSON });

  const index = await fetchCardIndex(fetchImpl);

  expect(calls).toEqual([CARD_INDEX_URL]);
  expect(index.get("013/bbb")).toEqual({ setCode: "13", number: "2" });
});

// --- collectionToRows ---------------------------------------------------

test("a numbered key is read straight off, without the index", () => {
  const { rows } = collectionToRows({ "005-135": 2 }, new Map());

  expect(rows).toEqual([{ setCode: "5", collectorNumber: "135", variant: "normal", count: 2 }]);
});

test("leading zeros are stripped from the card number", () => {
  const { rows } = collectionToRows({ "005-032": 1 }, new Map());

  expect(rows[0].collectorNumber).toBe("32");
});

test("a lettered card number keeps its letter", () => {
  const { rows } = collectionToRows({ "003-004a": 1 }, new Map());

  expect(rows[0]).toMatchObject({ setCode: "3", collectorNumber: "4a" });
});

test("a foil suffix becomes the foil variant", () => {
  const { rows } = collectionToRows({ "005-032:foil": 3 }, new Map());

  expect(rows[0]).toMatchObject({ variant: "foil", count: 3 });
});

test("a hashed key is resolved through the index", () => {
  const { rows } = collectionToRows({ "013/aaa": 4 }, INDEX);

  expect(rows).toEqual([{ setCode: "13", collectorNumber: "1", variant: "normal", count: 4 }]);
});

test("a hashed foil key is resolved and marked foil", () => {
  const { rows } = collectionToRows({ "013/bbb:foil": 1 }, INDEX);

  expect(rows[0]).toMatchObject({ setCode: "13", collectorNumber: "2", variant: "foil" });
});

test("a hashed key the index does not know is counted, not silently dropped", () => {
  const { rows, unresolved } = collectionToRows({ "013/nope": 1, "013/aaa": 1 }, INDEX);

  expect(rows).toHaveLength(1);
  expect(unresolved).toBe(1);
});

// --- loadDreambornCollection --------------------------------------------

test("loading fetches the collection and returns rows and its name", async () => {
  const { fetchImpl, calls } = stubFetch({
    "/collections/abc123def456": { name: "My Collection", cards: { "005-135": 2 } },
  });

  const result = await loadDreambornCollection("abc123def456", fetchImpl, async () => INDEX);

  expect(calls).toEqual([`${COLLECTION_API}/abc123def456`]);
  expect(result.name).toBe("My Collection");
  expect(result.rows).toHaveLength(1);
});

test("the card index is not fetched when no key needs it", async () => {
  const { fetchImpl } = stubFetch({
    "/collections/abc123def456": { name: "Old sets only", cards: { "005-135": 2 } },
  });
  let indexFetches = 0;

  await loadDreambornCollection("abc123def456", fetchImpl, async () => {
    indexFetches += 1;
    return INDEX;
  });

  // 1.9 MB is not worth downloading for a collection that does not need it.
  expect(indexFetches).toBe(0);
});

test("the card index is fetched once a hashed key appears", async () => {
  const { fetchImpl } = stubFetch({
    "/collections/abc123def456": { name: "Newer sets", cards: { "013/aaa": 1 } },
  });
  let indexFetches = 0;

  const result = await loadDreambornCollection("abc123def456", fetchImpl, async () => {
    indexFetches += 1;
    return INDEX;
  });

  expect(indexFetches).toBe(1);
  expect(result.rows[0].collectorNumber).toBe("1");
});

test("a collection with no cards is an error mentioning it must be public", async () => {
  const { fetchImpl } = stubFetch({ "/collections/abc123def456": { error: "not shared" } });

  await expect(
    loadDreambornCollection("abc123def456", fetchImpl, async () => INDEX),
  ).rejects.toThrow(/public/i);
});

test("a missing collection is a clear error, not a crash", async () => {
  const { fetchImpl } = stubFetch({});

  await expect(
    loadDreambornCollection("abc123def456", fetchImpl, async () => INDEX),
  ).rejects.toBeInstanceOf(DreambornError);
});

test("a network failure is wrapped rather than leaking a TypeError", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };

  await expect(
    loadDreambornCollection("abc123def456", fetchImpl, async () => INDEX),
  ).rejects.toThrow(/could not reach/i);
});
