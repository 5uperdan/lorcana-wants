# Lorcana Wants

Build a [Cardmarket](https://www.cardmarket.com) wants list for a Disney Lorcana set, minus the cards you already own.

**→ [Use it here](https://5uperdan.github.io/lorcana-wants/)**

## What it does

Pick a set, say how many copies of each rarity you want, and get a list you can paste straight into Cardmarket under
**Buying → My Wants → your list**. Upload a collection export and it subtracts what you already have, so the list is only what
you still need.

Every rarity starts at 0, so nothing is requested until you ask for it. A common set completion is 1 common, 2 uncommon, 3 rare
and 4 of each super rare and legendary. Quantities you type carry over when you switch sets.

Card data comes from [Lorcast](https://lorcast.com), fetched live in your browser. New sets appear on their own — the site never
needs updating for a release.

Your collection file is read in the browser and never uploaded anywhere.

## Your collections

Add as many as you like — **everything you add is combined into one collection**. That is the point:
if your collection is split across several Dreamborn collections, or some are public and some are
not, you can mix links and files freely and still get one correct wants list.

**Dreamborn link.** Paste a public collection URL (or just its id) and the browser fetches it from
Dreamborn directly. Nothing is sent to this site.

**CSV export.** Use a file for any collection you keep private. Several can be picked at once. Four
columns are used — `Set Number`, `Card Number`, `Variant`, `Count` — and the rest are ignored:

```csv
Set Number,Card Number,Variant,Count,Name,Color,Rarity
005,135,normal,2,"Sugar Rush Speedway - Starting Line",Ruby,Rare
005,32,foil,1,"Amber Chromicon",Amber,Uncommon
```

Each source is listed with its own **Remove** button. The status line reports how many collections
are combined, how many cards they hold, how many match the set you picked, and how many did not.
Some not matching is normal: promo cards use numbers like `2/P2` and belong to no numbered set.

The same collection cannot be added twice — double counting would shrink the wants list while
looking like it worked.

### How the link works

Dreamborn keys a collection two ways. Sets 1–9 use the collector number directly (`005-135`), but
from set 10 the key is an opaque id (`013/<hash>`) that only their published card list can resolve.
That list is 1.9 MB, so it is fetched lazily — a collection covering only older sets never downloads
it. Both endpoints are CORS-open, so no proxy or key is needed.

## Special rarities

Epic, Enchanted and Iconic cards are alternate printings of cards already in the set — every one of Attack of the Vine!'s 18
Epics shares its name and version with a regular printing. Since Cardmarket matches on name, asking for them adds copies to an
existing line rather than adding a new one, and the paste format has no way to say which printing you want. They default to 0
for that reason; pick those out by hand.

## Splitting into several lists

A Cardmarket wants list holds a limited number of unique cards, and the Shopping Wizard works over one list at a time — so a
whole set has to be spread across several lists to be shoppable. Pick **100** or **150** cards per list and the output comes out
as separate blocks, each with its own copy button, ready to paste into a list of its own.

The limit counts unique cards, not copies: four copies of one card is one entry. A 207-card set splits into three lists at 100,
or two at 150.

## Why one set at a time

Cardmarket matches wants by card name, and the same name can appear in more than one set — *I'm Stuck!* is in both Rise of the
Floodborn and Fabled. Generating one set per list means a reprint is never confused with the printing you meant.

## Development

The deployed site has no build step: GitHub Pages serves the source files as they are. The tooling below is for tests only and
never reaches the browser.

```bash
npm install
npx playwright install --with-deps chromium

npm test                      # unit and DOM tests
npm run test:watch            # watch mode
npm run coverage              # with coverage thresholds
npm run test:e2e              # browser smoke tests
npm run test:e2e:ui           # the same, in Playwright's UI mode
npm run test:contract         # really calls Lorcast

python3 -m http.server 8000   # serve locally at http://localhost:8000
```

A `file://` URL will not work — ES modules need http.

### How it is put together

Dependencies are injected rather than reached for, which is what makes a frontend testable: `lorcast.js` takes a `fetch`,
`app.js` takes a `document`, a `fetch` and a `clipboard`, and `main.js` is a three-line bootstrap that supplies the real ones.
`sets`, `rarities`, `collection`, `wants` and `render` are pure functions and run without a DOM at all.

Working on this? **[CLAUDE.md](CLAUDE.md)** has the manual checks worth doing, the real-data figures
to expect, and the mistakes that have already caught people out.

### Three layers of test

| Layer | Runner | Covers | Runs |
|---|---|---|---|
| Unit and DOM | Vitest + jsdom | Every module, including the wiring. Mounts the real `index.html`, so renaming an element id fails the suite rather than the page. | Every push and PR |
| Browser smoke | Playwright, network stubbed | That the real page boots over HTTP and its main paths work — module loading, file upload, clipboard, keyboard access. | Every push and PR |
| Real data | Vitest, offline | A real 2,888-card collection through the whole pipeline, both by CSV export and by API, asserting the two agree. | Every push and PR |
| Contract | Playwright, live | That Lorcast still returns the fields the tool reads. Nothing else would notice a rename, because everything else stubs it. | Weekly, and on demand |

The contract suite is kept off pull requests on purpose: it can fail for reasons that have nothing to do with the change being
reviewed.

## Not supported

- Combining several sets into one list
- Foil-specific wants — Cardmarket's paste format has no foil, language or condition column, so foils only affect what counts as
  owned, never the output
- Writing to Cardmarket directly. Their API supports wants lists, but access is
  [restricted to professional sellers](https://apiv2.cardmarket.com/ws/documentation/API:Auth_Overview).
