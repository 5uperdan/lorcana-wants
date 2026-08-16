# Lorcana Wants — Web Tool Design

**Date:** 2026-08-16
**Status:** Approved for implementation
**Supersedes:** `2026-08-16-lorcana-wants-list-design.md` (Python CLI). That design is kept for its Cardmarket API research, which still holds.

## Goal

A static web page where anyone can pick a Lorcana set, say how many copies of each rarity they want, optionally upload their
collection, and get a Cardmarket-ready wants list containing only the cards they still need.

Hosted on GitHub Pages from [github.com/5uperdan/lorcana-wants](https://github.com/5uperdan/lorcana-wants). No backend, no build
step, no server-side state.

## Why this replaces the CLI

The CLI produced files for one person on one machine. The point of the pivot is other people: a page anyone can open, upload a
collection to, and get a list from — without installing Python or cloning anything.

## Data source: Lorcast

`https://api.lorcast.com/v0`, which serves `Access-Control-Allow-Origin: *`, so the browser can call it directly.

| Endpoint | Returns | Size |
|---|---|---|
| `GET /v0/sets` | 22 sets with `code`, `name`, `released_at` | ~3 KB |
| `GET /v0/sets/{code}/cards` | Every card in a set: `collector_number`, `name`, `version`, `rarity` | ~300 KB |

This replaces `api-lorcana.com`, which the CLI design used. Lorcast wins on three counts that matter here: it has real set
names (api-lorcana exposes only codes like `atv`), it serves one set at a time rather than a 6.4 MB download of everything, and
its `collector_number` values match the collection export format exactly.

Set names and rarities both come from the API, so a new set appears in the tool the day Lorcast lists it, with no code change.
That is a requirement, not a convenience: nobody should have to redeploy the site for Set 14.

Verified against live data on 2026-08-16: set 13, *Attack of the Vine!*, returns 245 cards — Common 72, Uncommon 54, Rare 51,
Super_rare 18, Legendary 12, Epic 18, Enchanted 18, Iconic 2.

## The page

A single column, in the order you use it:

1. **How this works** — a short explanation, always visible, not hidden behind a toggle.
2. **Pick a set** — radio buttons, newest first, showing name and release year.
3. **How many of each?** — a number input per rarity present in the chosen set. Defaults: Common 1, Uncommon 2, Rare 3,
   Super Rare 4, Legendary 4, everything else 0.
4. **Your collection (optional)** — a file input, with the expected format documented inline, and two checkboxes:
   *Count my normal copies* and *Count my foil copies*, both ticked.
5. **Your wants list** — a read-only textarea with the generated lines, a copy button, and a count of cards and copies.

Everything recalculates on change. There is no generate button.

### Sets are a radio, not checkboxes

One set at a time. Cardmarket's paste import matches on card name, and names repeat across sets — *I'm Stuck!* appears in both
Rise of the Floodborn and Fabled. A combined multi-set list would produce lines Cardmarket cannot resolve to the printing you
meant, and the qualifier that would fix it needs Cardmarket's own expansion abbreviations, which we cannot read (their site is
behind a bot check).

One set per list is also how Cardmarket wants lists are normally organised, so this matches the workflow rather than fighting
it. The radio group carries a hover explainer saying exactly this, so the constraint doesn't read as an oversight.

## Collection upload

Optional. Without it, the tool outputs the full target quantities — the set-completion list. With it, it subtracts what you own.

### Format

The Dreamborn CSV export:

```csv
Set Number,Card Number,Variant,Count,Name,Color,Rarity
005,135,normal,2,"Sugar Rush Speedway - Starting Line",Ruby,Rare
005,32,foil,1,"Amber Chromicon",Amber,Uncommon
```

Only four columns are used: `Set Number`, `Card Number`, `Variant`, `Count`. `Name` and `Rarity` are ignored — the API is
authoritative for those, and ignoring them means a stale export still works.

Parsing must be a real CSV parse, not a `split(",")`. Card names contain commas (*Malicious, Mean, and Scary*) and are
therefore quoted.

### Joining to the API

`Set Number` with leading zeros stripped matches Lorcast's set `code` (`005` → `5`). `Card Number` matches `collector_number`
verbatim, including lettered variants (`4a` → `4a`).

Measured against a real 2,888-row export: 98–99% of rows join. The misses are promo cards numbered like `2/P2`, which belong to
promo sets rather than the numbered set, and are correctly ignored when a numbered set is selected.

Rows that don't join are counted and reported to the user as a note, not swallowed silently and not treated as an error.

### Foil handling

Two independent checkboxes, both on by default. Owned copies counted toward the target are the sum of the ticked variants. A
card wanted 4× where you own 2 normal and 1 foil needs 1 more with both ticked, or 2 more with foils unticked.

Foil-ness is not expressible in Cardmarket's paste format, so this only ever affects *counting*, never the output lines.

## Computing the list

For each card in the set:

```
target  = quantity configured for that card's rarity
owned   = (countNormals ? normalCopies : 0) + (countFoils ? foilCopies : 0)
needed  = max(0, target - owned)
```

Cards with `needed == 0` produce no line.

### Aggregating repeated names

Some cards share a name and version across several collector numbers — Into the Inklands has five *Dalmatian Puppy - Tail
Wagger*, numbered `4a` through `4e`. Cardmarket sees one product name, so five separate `1 Dalmatian Puppy - Tail Wagger` lines
would be nonsense.

Lines are therefore aggregated by `name` + `version`, summing quantities: wanting one of each of the five prints emits
`5 Dalmatian Puppy - Tail Wagger`. Ordering uses the lowest collector number in the group.

This is a real bug in the superseded CLI design, which would have emitted the duplicate lines.

## Output format

Unchanged from the CLI design, since Cardmarket is unchanged:

```
3 Woody - Helping a Friend
1 Piercing Attack
5 Dalmatian Puppy - Tail Wagger
```

`<quantity> <name>` for cards with no version, `<quantity> <name> - <version>` otherwise. Plain hyphen, spaces either side. No
expansion qualifier. Names are emitted verbatim, including accents.

Sorted by collector number, treating the numeric part numerically so `4a` precedes `40`.

## Architecture

```
index.html          # structure and copy
styles.css
js/
├── lorcast.js      # the two API calls — the only network code
├── sets.js         # ordering and labelling the set list
├── rarities.js     # rarity keys, default quantities, rarities present in a set
├── collection.js   # CSV parsing and the owned-copies index
├── wants.js        # target − owned → wants, and name aggregation
├── render.js       # wants → paste text
├── dom.js          # DOM rendering, taking the document as an argument
├── app.js          # createApp({document, fetchImpl, clipboard})
└── main.js         # bootstrap: hand createApp the real browser
tests/              # Vitest; DOM tests opt into jsdom per file
```

No framework and no bundler. The page is small and cannot rot from a toolchain upgrade.

### Dependency injection, and why

Nothing reaches for a global it could be handed instead. `lorcast.js` takes a `fetch`; `dom.js` takes a `document`; `app.js`
takes all three of `document`, `fetch` and `clipboard`. `main.js` is a three-line bootstrap supplying the real ones.

That single rule is what makes the DOM wiring testable, which matters because the wiring is where frontends actually break.
`createApp` can be driven end to end under jsdom against the real `index.html` loaded from disk, with a stubbed network — so
selecting a set, editing a rarity, uploading a collection, toggling foils and copying to the clipboard are all under test, not
just the pure functions beneath them.

### Testing

Vitest, with jsdom for the two DOM modules. Pure modules run in Vitest's `node` environment; `dom.js` and `app.js` opt in with
a `@vitest-environment jsdom` docblock, so only the tests that need a DOM pay for one.

Test-first throughout: the failing test is written and watched to fail before the implementation exists.

Two deliberate choices about scope:

- **The DOM tests load the real `index.html` from disk** rather than a fixture, and assert that every element id the code looks
  up exists. Renaming an id in the markup without updating the code fails the suite instead of the deployed page.
- **There is no browser-driving test.** Vitest and jsdom cannot prove a real browser boots the page — a module resolution error
  or a wrong script path would still pass. The id-and-script-path assertions cover the common cases; the rest is a short manual
  checklist against the deployed site, which the plan spells out.

Test tooling is a development dependency and nothing more. Vitest, jsdom and @testing-library/dom never appear in anything the
browser loads, so testing rigour costs the deployed page nothing.

### CI

GitHub Actions runs the suite with coverage on every push to `main` and every pull request. The repository is public, so
standard runners are free and have no minute allowance to exhaust.

CI runs tests only. It does not build, bundle or deploy: Pages publishes the branch directly, so a red run never blocks a
deploy and a green one never causes one. That keeps the deployment story honest — what is in the repository is what is served.

## Error handling

- Lorcast unreachable or non-200: an inline message naming what failed, with the page still usable once it recovers. No silent
  empty state.
- A malformed or non-CSV upload: reject with what was expected, keeping any previously loaded collection.
- Rows that don't join: reported as a count with examples, since a genuinely mismatched file should be visible.
- A set with no cards for the configured quantities: an empty output with an explanation, not a blank box.

## Out of scope

- Multi-set lists in one output
- Foil-specific wants lists
- Writing to Cardmarket directly — still gated behind professional-seller API access
- Pricing. See the superseded spec for the research. Worth noting that Lorcast returns `prices` per card (`usd`, `usd_foil`),
  which is a lead for later, though Cardmarket trades in EUR.
