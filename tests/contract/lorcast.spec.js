import { expect, test } from "@playwright/test";

/**
 * These really call Lorcast. Everything else stubs it, which means the whole
 * suite would stay green if Lorcast renamed a field and the site broke. This
 * is the only thing that would notice, so it runs on a schedule rather than
 * on a pull request — a third party's bad morning must not fail somebody's PR.
 */

const API = "https://api.lorcast.com/v0";

test("the sets endpoint still returns code, name and released_at", async ({ request }) => {
  const response = await request.get(`${API}/sets`);
  expect(response.ok()).toBe(true);

  const { results } = await response.json();
  expect(results.length).toBeGreaterThan(0);
  expect(results[0]).toMatchObject({
    code: expect.any(String),
    name: expect.any(String),
    released_at: expect.any(String),
  });
});

test("the cards endpoint still returns collector_number, name and rarity", async ({ request }) => {
  const response = await request.get(`${API}/sets/13/cards`);
  expect(response.ok()).toBe(true);

  const cards = await response.json();
  expect(cards.length).toBeGreaterThan(0);
  expect(cards[0]).toMatchObject({
    collector_number: expect.any(String),
    name: expect.any(String),
    rarity: expect.any(String),
  });
});

test("Attack of the Vine! still has the rarity split the tool was built against", async ({
  request,
}) => {
  const cards = await (await request.get(`${API}/sets/13/cards`)).json();

  const counts = {};
  for (const card of cards) counts[card.rarity] = (counts[card.rarity] ?? 0) + 1;

  expect(counts).toMatchObject({
    Common: 72,
    Uncommon: 54,
    Rare: 51,
    Super_rare: 18,
    Legendary: 12,
  });
});

test("Lorcast still serves CORS headers the browser will accept", async ({ request }) => {
  const response = await request.get(`${API}/sets`, {
    headers: { Origin: "https://5uperdan.github.io" },
  });

  expect(response.headers()["access-control-allow-origin"]).toBe("*");
});
