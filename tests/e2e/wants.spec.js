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

/** 207 commons, matching the size of a real Lorcana set. */
const CARDS_BIG = Array.from({ length: 207 }, (_, index) => ({
  collector_number: String(index + 1),
  name: `Filler Card ${index + 1}`,
  rarity: "Common",
}));

const COLLECTION = fileURLToPath(new URL("./fixtures/collection.csv", import.meta.url));
const SECOND = fileURLToPath(new URL("./fixtures/second.csv", import.meta.url));

const DREAMBORN = { name: "Linked Collection", cards: { "013-001": 1, "013/hash": 1 } };
const CARD_INDEX = [{ id: "013/hash", setId: "013", number: "2" }];

/** Intercept at the network layer, so the page still uses its real fetch. */
async function stubLorcast(page) {
  await page.route("**/v0/sets/13/cards", (route) => route.fulfill({ json: CARDS_13 }));
  await page.route("**/v0/sets/12/cards", (route) => route.fulfill({ json: CARDS_12 }));
  await page.route("**/v0/sets/Coconut/cards", (route) => route.fulfill({ json: CARDS_COCONUT }));
  await page.route("**/v0/sets", (route) => route.fulfill({ json: SETS }));
  await page.route("**/api/collections/**", (route) => route.fulfill({ json: DREAMBORN }));
  await page.route("**/cache/en/cards.json", (route) => route.fulfill({ json: CARD_INDEX }));
}

/** Type quantities the way a visitor would. Everything starts at 0. */
async function wantTheUsual(page) {
  await page.locator('#rarities input[data-rarity="Rare"]').fill("3");
  await page.locator('#rarities input[data-rarity="Common"]').fill("1");
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

  // If the module graph fails to load, the rarity boxes never appear and this
  // is what catches it.
  await wantTheUsual(page);

  await expect(page.locator("#outputs textarea").first()).toHaveValue(
    "3 Woody - Helping a Friend\n1 Piercing Attack",
  );
  await expect(page.locator("#summary")).toHaveText("2 cards, 4 copies.");
});

test("the list starts empty and says so", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#rarities input").first()).toHaveValue("0");
  // No wants means no paste box at all, rather than an empty one to puzzle over.
  await expect(page.locator("#outputs textarea")).toHaveCount(0);
  await expect(page.locator("#summary")).toContainText(/nothing wanted yet/i);
});

test("no console errors while doing the normal thing", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);
  await expect(page.locator("#outputs textarea").first()).not.toHaveValue("");

  expect(errorsByPage.get(page)).toEqual([]);
});

test("the newest numbered set is selected, not a later promo set", async ({ page }) => {
  // Format Coconut is dated after Attack of the Vine!, so a date-only sort
  // would land the visitor on a set whose only rarity is Promo — an empty
  // list with no explanation.
  await page.goto("/");

  await expect(page.locator("#sets label").first()).toContainText("Attack of the Vine! (2026)");
  await expect(page.locator("#sets input").first()).toBeChecked();
  // The promo set has only a Promo rarity, so landing there would show a
  // single box; a numbered set shows the full spread.
  await expect(page.locator("#rarities label")).toHaveCount(3);
});

test("promo sets are still reachable, listed after the numbered ones", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#sets label").last()).toContainText("Format Coconut (2026)");
});

test("changing a rarity updates the list", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);
  await expect(page.locator("#outputs textarea").first()).not.toHaveValue("");

  await page.locator("#rarities input").last().fill("1");

  // toHaveValue, not toContainText: a textarea's text lives in its value, and
  // toContainText reads textContent, which is empty for every textarea.
  await expect(page.locator("#outputs textarea").first()).toHaveValue(/1 Elsa - Spirit of Winter/);
});

test("choosing another set loads its cards, keeping the quantities typed", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);
  await expect(page.locator("#outputs textarea").first()).not.toHaveValue("");

  await page.locator("#sets input").nth(1).check();

  await expect(page.locator("#outputs textarea").first()).toHaveValue("1 Someone Else");
  await expect(page.locator('#rarities input[data-rarity="Common"]')).toHaveValue("1");
});

test("uploading a collection subtracts what you own", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);
  await expect(page.locator("#outputs textarea").first()).not.toHaveValue("");

  await page.locator("#collection").setInputFiles(COLLECTION);

  await expect(page.locator("#collection-status")).toContainText("1 collection combined");
  await expect(page.locator("#outputs textarea").first()).toHaveValue("1 Woody - Helping a Friend");
});

test("unticking foils stops foils counting toward the target", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);
  await page.locator("#collection").setInputFiles(COLLECTION);
  await expect(page.locator("#outputs textarea").first()).toHaveValue("1 Woody - Helping a Friend");

  await page.locator("#count-foils").uncheck();

  await expect(page.locator("#outputs textarea").first()).toHaveValue("2 Woody - Helping a Friend");
});

test("removing a source restores the full wants list", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);
  await expect(page.locator("#sources li")).toHaveCount(0);

  await page.locator("#collection").setInputFiles(COLLECTION);
  await expect(page.locator("#outputs textarea").first()).toHaveValue(
    "1 Woody - Helping a Friend",
  );
  await expect(page.locator("#sources li")).toHaveCount(1);

  await page.locator("#sources button").click();

  await expect(page.locator("#outputs textarea").first()).toHaveValue(
    "3 Woody - Helping a Friend\n1 Piercing Attack",
  );
  await expect(page.locator("#sources li")).toHaveCount(0);
});

test("the same file can be uploaded again after removing it", async ({ page }) => {
  // The browser fires no change event when the same file is chosen twice, so
  // the input has to be cleared after every pick.
  await page.goto("/");
  await wantTheUsual(page);

  await page.locator("#collection").setInputFiles(COLLECTION);
  await page.locator("#sources button").click();
  await page.locator("#collection").setInputFiles(COLLECTION);

  await expect(page.locator("#sources li")).toHaveCount(1);
  await expect(page.locator("#outputs textarea").first()).toHaveValue(
    "1 Woody - Helping a Friend",
  );
});

test("several files picked at once are all added together", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);

  await page.locator("#collection").setInputFiles([COLLECTION, SECOND]);

  await expect(page.locator("#sources li")).toHaveCount(2);
  await expect(page.locator("#collection-status")).toContainText("2 collections combined");
});

test("a Dreamborn link is added as a source and counts toward the total", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);

  await page.locator("#collection-url").fill("https://dreamborn.ink/collections/abc123def456");
  await page.locator("#add-link").click();

  await expect(page.locator("#sources li")).toContainText("Linked Collection");
  await expect(page.locator(".source-kind")).toHaveText("link");
  // The link owns Woody once and Piercing Attack once, via a hashed id.
  await expect(page.locator("#outputs textarea").first()).toHaveValue(
    "2 Woody - Helping a Friend",
  );
});

test("a link and a file combine into one collection", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);

  await page.locator("#collection-url").fill("https://dreamborn.ink/collections/abc123def456");
  await page.locator("#add-link").click();
  await expect(page.locator("#sources li")).toHaveCount(1);
  await page.locator("#collection").setInputFiles(COLLECTION);

  await expect(page.locator("#sources li")).toHaveCount(2);
  await expect(page.locator("#collection-status")).toContainText("2 collections combined");
  // Woody: 3 wanted, 1 from the link plus 1 normal and 1 foil from the file.
  await expect(page.locator("#outputs textarea")).toHaveCount(0);
});

test("pressing Enter in the link box adds it, without a page reload", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);

  await page.locator("#collection-url").fill("abc123def456");
  await page.locator("#collection-url").press("Enter");

  await expect(page.locator("#sources li")).toHaveCount(1);
});

test("the same collection link cannot be added twice", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);

  await page.locator("#collection-url").fill("abc123def456");
  await page.locator("#add-link").click();
  await expect(page.locator("#sources li")).toHaveCount(1);

  await page.locator("#collection-url").fill("https://dreamborn.ink/collections/abc123def456");
  await page.locator("#add-link").click();

  await expect(page.locator("#sources li")).toHaveCount(1);
  await expect(page.locator("#collection-status")).toContainText(/already added/i);
});

test("a link that is not a collection is refused with an explanation", async ({ page }) => {
  await page.goto("/");
  await wantTheUsual(page);

  await page.locator("#collection-url").fill("https://example.com/nope");
  await page.locator("#add-link").click();

  await expect(page.locator("#collection-status")).toHaveClass(/error/);
  await expect(page.locator("#sources li")).toHaveCount(0);
});

test("the reprint explainer opens on keyboard focus, not only on hover", async ({ page }) => {
  await page.goto("/");

  await page.locator(".info").focus();

  await expect(page.locator(".info .tip")).toBeVisible();
});

test("the reprint explainer opens on tap, for devices with no hover", async ({ page }) => {
  // It is a button rather than a span with tabindex precisely so that tapping
  // it focuses it on a touch device.
  await page.goto("/");

  await page.locator(".info").click();

  await expect(page.locator(".info .tip")).toBeVisible();
});

test("copying puts the list on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await wantTheUsual(page);
  await expect(page.locator("#outputs textarea").first()).not.toHaveValue("");

  await page.locator("#outputs button").first().click();

  await expect(page.locator("#outputs button").first()).toHaveText("Copied");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe("3 Woody - Helping a Friend\n1 Piercing Attack");
});

test("the layout holds together on a phone-sized screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await wantTheUsual(page);

  // Nothing may push the page sideways — horizontal scroll is the classic
  // mobile failure and it is invisible on a desktop viewport.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);

  // The wide CSV example must scroll inside its own box, not stretch the page.
  const preScrolls = await page.evaluate(() => {
    const pre = document.querySelector("pre");
    return pre.scrollWidth > pre.clientWidth;
  });
  expect(preScrolls).toBe(true);

  await expect(page.locator("#outputs textarea").first()).not.toHaveValue("");
});

test("the reprint explainer fits the screen when opened on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await page.locator(".info").click();

  await expect(page.locator(".info .tip")).toBeVisible();
  const fits = await page.evaluate(() => {
    const { left, right } = document.querySelector(".info .tip").getBoundingClientRect();
    return left >= 0 && right <= window.innerWidth;
  });
  expect(fits).toBe(true);
});

test("splitting at 100 breaks a full set into three pasteable lists", async ({ page }) => {
  // A Cardmarket wants list holds a limited number of unique cards, so a whole
  // set has to be spread across several lists.
  await page.route("**/v0/sets/13/cards", (route) => route.fulfill({ json: CARDS_BIG }));
  await page.goto("/");
  await page.locator('#rarities input[data-rarity="Common"]').fill("1");
  await expect(page.locator("#summary")).toHaveText("207 cards, 207 copies.");

  await page.locator('input[name="split"][value="100"]').check();

  await expect(page.locator("#outputs textarea")).toHaveCount(3);
  await expect(page.locator("#summary")).toHaveText("207 cards, 207 copies across 3 lists.");
  await expect(page.locator(".part-label").first()).toHaveText(
    "List 1 of 3 — 100 cards, 100 copies",
  );

  const lines = await page.locator("#outputs textarea").last().inputValue();
  expect(lines.split("\n")).toHaveLength(7);
});

test("splitting at 150 gives two lists, and no limit gives one", async ({ page }) => {
  await page.route("**/v0/sets/13/cards", (route) => route.fulfill({ json: CARDS_BIG }));
  await page.goto("/");
  await page.locator('#rarities input[data-rarity="Common"]').fill("1");

  await page.locator('input[name="split"][value="150"]').check();
  await expect(page.locator("#outputs textarea")).toHaveCount(2);

  await page.locator('input[name="split"][value="0"]').check();
  await expect(page.locator("#outputs textarea")).toHaveCount(1);
});

test("each list has its own copy button, copying only that list", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/v0/sets/13/cards", (route) => route.fulfill({ json: CARDS_BIG }));
  await page.goto("/");
  await page.locator('#rarities input[data-rarity="Common"]').fill("1");
  await page.locator('input[name="split"][value="100"]').check();

  await page.locator("#outputs button").last().click();

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.split("\n")).toHaveLength(7);
  expect(clipboard).toContain("1 Filler Card 207");
});

test("an unreachable API is reported rather than leaving a blank page", async ({ page }) => {
  await page.route("**/v0/sets", (route) => route.abort());
  await page.goto("/");

  await expect(page.locator("#sets-status")).toHaveClass(/error/);
  await expect(page.locator("#sets-status")).toContainText(/could not reach/i);
});
