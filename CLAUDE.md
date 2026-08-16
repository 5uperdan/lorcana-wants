# Working on Lorcana Wants

Notes for anyone — human or agent — picking this up cold. The design decisions are in
`docs/superpowers/specs/2026-08-16-lorcana-wants-web-design.md`; this file is about *working* on it.

## The two rules that shape everything

1. **The deployed site has no build step.** GitHub Pages serves `index.html`, `styles.css` and
   `js/` exactly as committed. No bundler, no transpiler, no framework, no generated file. If you
   find yourself wanting one, that is a design change to raise, not a detail to slip in.
2. **Dependencies are injected, never reached for.** `lorcast.js` takes a `fetch`; `dom.js` takes a
   `document`; `app.js` takes `document`, `fetch` and `clipboard`; `main.js` is a three-line
   bootstrap that supplies the real ones. This is the only reason the DOM wiring is testable.

Test tooling (Vitest, jsdom, Playwright) is a devDependency and never reaches the browser.

## Running things

```bash
npm install
npx playwright install --with-deps chromium

npm test              # unit + DOM, jsdom, fast
npm run coverage      # the same with thresholds enforced
npm run test:e2e      # real Chromium, network stubbed
npm run test:contract # really calls Lorcast — expect failures to be news about Lorcast

python3 -m http.server 8000   # then http://localhost:8000
```

**A `file://` URL will not work.** ES modules are blocked by CORS there, so `js/main.js` never runs
and you get an unstyled-looking empty shell. This has been mistaken for a CSS bug. Always serve over
http.

**Hard-reload after editing a module.** Browsers cache ES modules aggressively; a stale module shows
up as `does not provide an export named ...` in the console for an export that plainly exists.

## Manual checks worth doing, and the numbers to expect

The suites stub the network, so they cannot catch a change in the real data or a real browser
behaviour. These figures were verified against live APIs on 2026-08-16 and are stable enough to
assert against.

With quantities set to the standard 1 / 2 / 3 / 4 / 4:

| Check | Expected |
|---|---|
| Attack of the Vine! (set 13), no collection | `207 cards, 453 copies`, first line `3 Woody - Helping a Friend` |
| Same, with Epic raised to 1 | copies rise to `471`, card count **stays** 207 — see below |
| Into the Inklands (set 3) | exactly one `5 Dalmatian Puppy - Tail Wagger` line |
| Split at 100 / 150 on set 13 | 3 lists (100/100/7) / 2 lists (150/57) |
| Newest set selected on load | *Attack of the Vine!*, **not** a promo set — see below |

Driving the page from the console is the quickest way to check by hand:

```js
const q = (r, v) => { const i = document.querySelector(`#rarities input[data-rarity="${r}"]`);
                      i.value = String(v); i.dispatchEvent(new Event("input")); };
q("Common",1); q("Uncommon",2); q("Rare",3); q("Super_rare",4); q("Legendary",4);
document.getElementById("summary").textContent;
```

To check the Dreamborn link path end to end you need a **public** collection. This one is the
maintainer's, shared for the purpose, and is the same collection the real-data fixtures came from:

```
https://dreamborn.ink/collections/HEFnzVzwpuQlvWDzb1KrAO44N2A3
```

It should load as `My Collection — 2888 cards, 8198 copies`, and with set 13 selected and the
standard quantities it should leave `201 cards, 438 copies`. A private collection fails in a way
that looks like a bug in the code, so use a known-public one when diagnosing.

## Things that have already bitten someone

- **Epic, Enchanted and Iconic are alternate printings of cards already in the set.** All 18 Epics
  in set 13 share a name and version with a regular printing, so raising Epic adds *copies to an
  existing line*, not new lines. Correct, and surprising. The page says so.
- **Cards can share a name across collector numbers.** Into the Inklands prints five *Dalmatian
  Puppy - Tail Wagger* (`4a`–`4e`). Cardmarket matches on name, so lines are merged by name and
  version, summing quantities — *after* subtracting what is owned.
- **Promo sets are dated after the main set they accompany.** Lorcast lists *Format Coconut* as
  newer than Attack of the Vine!, so a plain date sort selects a set whose only rarity is `Promo`
  and shows an empty list. Numbered sets sort first for exactly this reason.
- **`toContainText` is wrong for a `<textarea>`.** It reads `textContent`, which is always empty
  there. Use `toHaveValue`.
- **Dreamborn keys collections two ways.** Sets 1–9 use the collector number (`005-135`); set 10
  onwards use an opaque id (`013/<hash>`) resolvable only through `cache/en/cards.json` (1.9 MB,
  fetched lazily and only when a hashed key appears).
- **Adding the same collection twice** used to double every count and silently shrink the wants
  list. It is refused now; keep it that way.
- **Function declarations hoist.** A rewrite once left a stale `readFile` after the new one; the old
  declaration won and every upload threw. Every unit test still passed, because they call the
  parsing entry point directly. If the DOM path misbehaves while units are green, look for
  duplicate declarations.

## Test data

Two kinds, deliberately:

- **`tests/e2e/fixtures/`** — three-row synthetic files, each written to make one behaviour obvious.
  Use these when adding a behaviour test; a big file makes a failure hard to read.
- **`tests/fixtures/`** — a real 2,888-card collection, committed with the owner's agreement, driving
  `tests/real-collection.test.js`. Captured 2026-08-16 and entirely offline.

The real-data guard exists because small fixtures cannot catch quoted names containing commas,
lettered collector numbers (`4a`–`4e`), promo rows belonging to no numbered set, or cards sharing a
name across several collector numbers. It pins:

| | |
|---|---|
| `collection-export.csv` | the CSV export route |
| `collection-dreamborn.json` | the API route, trimmed to the `name` and `cards` the code reads |
| `dreamborn-card-index.json` | only the 652 hashed ids this collection references, not the 1.9 MB list |
| `lorcast-set-13.json`, `lorcast-set-3.json` | real card lists, slimmed to the four fields used |

Its strongest assertion is that the **CSV route and the API route produce byte-identical output**.
They are independent readings of one collection, so any divergence is a bug in one of them.

One real difference between the two formats is pinned rather than smoothed over: the CSV files four
promos (`26/P1`–`29/P1`) under set 3, while the API files them under P1. Neither is a set 3 card, so
the output is unaffected — but a future change to the joining rules now has to face it deliberately.

**Refreshing the fixtures** means re-capturing all of them together and re-checking the figures,
since they are cross-asserted. Do not update one in isolation.

## External APIs

| What | Where | Notes |
|---|---|---|
| Sets and cards | `https://api.lorcast.com/v0/sets`, `/sets/{code}/cards` | CORS `*`. Rarity strings are `Super_rare` style |
| Collection | `https://dreamborn.ink/api/collections/{id}` | CORS `*`. Public collections only |
| Card id → number | `https://dreamborn.ink/cache/en/cards.json` | CORS `*`, 1.9 MB, lazy |

`npm run test:contract` is the guard on all of this. A red contract run means the third party
changed, not that this repository broke.
