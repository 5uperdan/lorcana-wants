import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const SETS = {
  results: [
    { code: "12", name: "Wilds Unknown", released_at: "2026-05-08" },
    { code: "13", name: "Attack of the Vine!", released_at: "2026-07-17" },
    // Deliberately dated after set 13, mirroring live data: Lorcast lists
    // format and promo sets released alongside or after the main set. Ordering
    // by date alone would select this one and show an empty wants list.
    { code: "Coconut", name: "Format Coconut", released_at: "2026-07-28" },
  ],
};

const CARDS_COCONUT = [{ collector_number: "1", name: "A Promo Card", rarity: "Promo" }];

const CARDS_13 = [
  { collector_number: "1", name: "Woody", version: "Helping a Friend", rarity: "Rare" },
  { collector_number: "2", name: "Piercing Attack", rarity: "Common" },
  { collector_number: "3", name: "Elsa", version: "Spirit of Winter", rarity: "Enchanted" },
];

const CARDS_12 = [{ collector_number: "1", name: "Someone Else", rarity: "Common" }];

const COLLECTION = fileURLToPath(new URL("./fixtures/collection.csv", import.meta.url));

/** Intercept at the network layer, so the page still uses its real fetch. */
async function stubLorcast(page) {
  await page.route("**/v0/sets/13/cards", (route) => route.fulfill({ json: CARDS_13 }));
  await page.route("**/v0/sets/12/cards", (route) => route.fulfill({ json: CARDS_12 }));
  await page.route("**/v0/sets/Coconut/cards", (route) => route.fulfill({ json: CARDS_COCONUT }));
  await page.route("**/v0/sets", (route) => route.fulfill({ json: SETS }));
}

/** Console and page errors, collected per test. */
const errorsByPage = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  errorsByPage.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await stubLorcast(page);
});

test("the page boots and produces a wants list", async ({ page }) => {
  await page.goto("/");

  // If the module graph fails to load, this is what catches it.
  await expect(page.locator("#output")).toHaveValue(
    "3 Woody - Helping a Friend\n1 Piercing Attack",
  );
  await expect(page.locator("#summary")).toHaveText("2 cards, 4 copies.");
});

test("no console errors while doing the normal thing", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  expect(errorsByPage.get(page)).toEqual([]);
});

test("the newest numbered set is selected, not a later promo set", async ({ page }) => {
  // Format Coconut is dated after Attack of the Vine!, so a date-only sort
  // would land the visitor on a set whose only rarity is Promo — an empty
  // list with no explanation.
  await page.goto("/");

  await expect(page.locator("#sets label").first()).toContainText("Attack of the Vine! (2026)");
  await expect(page.locator("#sets input").first()).toBeChecked();
  await expect(page.locator("#output")).not.toHaveValue("");
});

test("promo sets are still reachable, listed after the numbered ones", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#sets label").last()).toContainText("Format Coconut (2026)");
});

test("changing a rarity updates the list", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  await page.locator("#rarities input").last().fill("1");

  // toHaveValue, not toContainText: a textarea's text lives in its value, and
  // toContainText reads textContent, which is empty for every textarea.
  await expect(page.locator("#output")).toHaveValue(/1 Elsa - Spirit of Winter/);
});

test("choosing another set loads its cards", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  await page.locator("#sets input").nth(1).check();

  await expect(page.locator("#output")).toHaveValue("1 Someone Else");
});

test("uploading a collection subtracts what you own", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  await page.locator("#collection").setInputFiles(COLLECTION);

  await expect(page.locator("#collection-status")).toContainText("3 collection rows");
  await expect(page.locator("#output")).toHaveValue("1 Woody - Helping a Friend");
});

test("unticking foils stops foils counting toward the target", async ({ page }) => {
  await page.goto("/");
  await page.locator("#collection").setInputFiles(COLLECTION);
  await expect(page.locator("#output")).toHaveValue("1 Woody - Helping a Friend");

  await page.locator("#count-foils").uncheck();

  await expect(page.locator("#output")).toHaveValue("2 Woody - Helping a Friend");
});

test("the reprint explainer is reachable by keyboard, not only by hover", async ({ page }) => {
  await page.goto("/");

  await page.locator(".info").focus();

  await expect(page.locator(".info .tip")).toBeVisible();
});

test("copying puts the list on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.locator("#output")).not.toHaveValue("");

  await page.locator("#copy").click();

  await expect(page.locator("#copy")).toHaveText("Copied");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe("3 Woody - Helping a Friend\n1 Piercing Attack");
});

test("an unreachable API is reported rather than leaving a blank page", async ({ page }) => {
  await page.route("**/v0/sets", (route) => route.abort());
  await page.goto("/");

  await expect(page.locator("#sets-status")).toHaveClass(/error/);
  await expect(page.locator("#sets-status")).toContainText(/could not reach/i);
});
