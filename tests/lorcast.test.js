import { expect, test } from "vitest";

import { API_BASE, LorcastError, fetchSetCards, fetchSets } from "../js/lorcast.js";

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok, status, json: async () => payload };
    },
  };
}

test("fetchSets requests the sets endpoint", async () => {
  const { fetchImpl, calls } = stubFetch({ results: [] });

  await fetchSets(fetchImpl);

  expect(calls).toEqual([`${API_BASE}/sets`]);
});

test("fetchSets maps sets to code, name and release date", async () => {
  const { fetchImpl } = stubFetch({
    results: [
      { code: "13", name: "Attack of the Vine!", released_at: "2026-07-17" },
      { code: "P1", name: "Promo Set 1", released_at: "2023-08-18" },
    ],
  });

  expect(await fetchSets(fetchImpl)).toEqual([
    { code: "13", name: "Attack of the Vine!", releasedAt: "2026-07-17" },
    { code: "P1", name: "Promo Set 1", releasedAt: "2023-08-18" },
  ]);
});

test("fetchSetCards requests the cards endpoint for the set", async () => {
  const { fetchImpl, calls } = stubFetch([]);

  await fetchSetCards("13", fetchImpl);

  expect(calls).toEqual([`${API_BASE}/sets/13/cards`]);
});

test("fetchSetCards maps cards to the fields the tool needs", async () => {
  const { fetchImpl } = stubFetch([
    { collector_number: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
    { collector_number: "102", name: "Piercing Attack", rarity: "Common" },
  ]);

  expect(await fetchSetCards("13", fetchImpl)).toEqual([
    { collectorNumber: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
    { collectorNumber: "102", name: "Piercing Attack", version: "", rarity: "Common" },
  ]);
});

test("a missing version becomes an empty string, never undefined", async () => {
  const { fetchImpl } = stubFetch([
    { collector_number: "1", name: "Circle of Life", rarity: "Rare" },
  ]);

  const [card] = await fetchSetCards("13", fetchImpl);

  expect(card.version).toBe("");
});

test("a non-ok response raises LorcastError naming the status", async () => {
  const { fetchImpl } = stubFetch(null, { ok: false, status: 503 });

  await expect(fetchSets(fetchImpl)).rejects.toThrow(/503/);
  await expect(fetchSets(fetchImpl)).rejects.toBeInstanceOf(LorcastError);
});

test("a network failure is wrapped in LorcastError rather than leaking a TypeError", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };

  await expect(fetchSets(fetchImpl)).rejects.toBeInstanceOf(LorcastError);
});

test("the wrapped network failure keeps the original error as its cause", async () => {
  const original = new TypeError("Failed to fetch");
  const fetchImpl = async () => {
    throw original;
  };

  await expect(fetchSets(fetchImpl)).rejects.toMatchObject({ cause: original });
});
