# Cardmarket Wants List Generator — Design

**Date:** 2026-08-16
**Status:** Approved for implementation
**Scope:** Phase 1 (wants-list file generation). Phase 2 (pricing) is documented here as research, not as a commitment.

## Goal

Generate a Cardmarket wants list for the Disney Lorcana set *Attack of the Vine!* (Set 13) containing:

| Rarity | Cards in set | Copies each | Total copies |
|---|---:|---:|---:|
| Common | 72 | 1 | 72 |
| Uncommon | 54 | 2 | 108 |
| Rare | 51 | 3 | 153 |
| Super Rare | 18 | 4 | 72 |
| Legendary | 12 | 4 | 48 |
| **Total** | **207** | | **453** |

Epic (18), Enchanted (18) and Iconic (2) — the set's secret rarities — are out of scope.

The tool is set-agnostic and non-interactive: one run generates a file for every Lorcana set that doesn't already have one.
Attack of the Vine! is the immediate need and the worked example throughout this document.

## Key decision: file output, not the Cardmarket API

The Cardmarket REST API supports wants lists fully (`POST /ws/v2.0/wantslist`, `PUT /ws/v2.0/wantslist/:id` with `addItem`), but
[their auth documentation](https://apiv2.cardmarket.com/ws/documentation/API:Auth_Overview) states: *"API applications and access
are restricted to professional sellers and subject to a manual approval process at this moment."* A standard buyer account cannot
register an app.

Cardmarket's website has a decklist paste-import for wants lists, and Lorcana is supported
([help article](https://help.cardmarket.com/en/how-to-add-a-lorcana-decklist-to-wants)). Phase 1 therefore produces a paste-ready
file. The user pastes it into **Buying → My Wants → [list] → paste field → Add**.

## Data source

`GET https://api-lorcana.com/cards` returns all 2,477 cards (~6.4 MB) with no query parameters; filtering happens client-side.

Its [OpenAPI spec](https://api-lorcana.com/openapi.json) also offers `GET /set/{set}`, which returns just one set. We use
`/cards` anyway, for two reasons: the tool needs to know which sets exist in order to generate all of them, and deriving that
from the card data itself is more robust than parsing the set list out of the prose parameter description in the OpenAPI
document. One cached 6.4 MB download covers every set in a single run, and every subsequent run is offline.

Fields used, per card:

- `variants[]` — entries matching the selected set code give `id` (the collector number, 1–207 for Attack of the Vine!) and
  `rarity`, one of `common`, `uncommon`, `rare`, `super_rare`, `legendary`, `epic`, `enchanted`, `iconic`, `special`
- `languages.en.name` — the character name, e.g. `Woody`
- `languages.en.title` — the version subtitle, e.g. `Helping a Friend`; empty string for actions/items/songs

Verified against live data on 2026-08-16: 207 matching cards, 453 copies, rarity counts exactly as tabulated above.

The response is cached to disk so repeated runs and tests don't re-download 6.4 MB.

## Set discovery and idempotent generation

The tool is non-interactive. One download of the card data, then for every set found in it: if an output file already exists,
skip; otherwise generate. Re-running is therefore cheap and safe, and a new Lorcana set is picked up simply by running it again.

- **Existence check.** `out/<set>-wants.txt` is the marker. Its presence means that set is done.
- **Sets with nothing to generate are skipped, not written.** Promo and collection sets (`p1`–`p4`, `c1`, `c2`, `d23`,
  `worlds`, `pd1`) carry only rarities outside the quantity map, so they yield zero lines. Writing empty files for them would
  mark them permanently done and hide a future data fix, so they are reported as skipped each run instead.
- **Set codes come from the card data** and are used lowercase in filenames (`atv`, `rotf`). Matching against existing files is
  case-insensitive, since the API is inconsistent with itself: card records carry `atv` while its `/set/{set}` endpoint expects
  `AtV`.
- `--force` regenerates everything, ignoring existing files. Needed when the quantity map or the line format changes. It costs
  nothing beyond CPU, since the card data is cached.
- `out/` stays gitignored. The generated files are build output, not source, and a fresh clone rebuilds all of them
  deterministically from one download. The "already generated" check is therefore local state, which is the intent — it tracks
  what *this* machine has produced.

Against live data on 2026-08-16 this produces **14 files** covering 2,671 cards and 5,827 copies, and skips 9 promo sets.

## Rarity handling

Only rarities present in the quantity map produce lines. Everything else is silently out of scope. That covers the secret
rarities (`epic`, `enchanted`, `iconic`) and also the odd ones that exist in real data — `special`, `unreleased`, `challenge24`,
`top1`. An unrecognised rarity is not an error: the data set is a moving target and a new rarity appearing must not stop the
other sets from generating.

## Output format

One card per line, sorted by collector number:

```
<quantity> <name>[ - <title>]
```

```
3 Woody - Helping a Friend
1 Tyler Nguyen-Baker - 4*Town Fan
2 Celia Mae - Friendly Receptionist
1 Piercing Attack
```

Format rules, confirmed against a known-good Cardmarket paste and the help article:

- Separator between name and title is `" - "` — a plain hyphen with spaces, not an en dash.
- Cards with no title emit the name alone. 46 of the 207 are titleless.
- Quantity is a bare integer. Cardmarket also accepts `4x`; we use the bare form.
- No expansion qualifier. Cardmarket supports an optional `(CODE)` suffix, but it is not needed and the tool does not emit one.

Two properties of Attack of the Vine! make the format safe there: no card name contains `" - "`, so the separator is
unambiguous, and no name contains a non-ASCII character. Neither is guaranteed for other sets — Lorcana names elsewhere carry
accents and macrons. Names are emitted verbatim as UTF-8 with no transliteration, since Cardmarket's own product names carry
those characters; if a set ever does contain a name with `" - "` inside it, the smoke test below is what catches it.

**The paste format has no language or condition column.** Columns are Amount / Card Name / Version / Expansion only. The
English-or-French preference cannot be expressed in the import; it is set afterwards in the UI, or via `idLanguage` (EN=1, FR=2,
multiple values allowed per item) if API access is ever obtained.

## Architecture

```
cardmarket_wants/
├── __main__.py     # python -m cardmarket_wants
├── lorcana.py      # fetch /cards with on-disk cache — the only network I/O
├── sets.py         # survey card data → set codes with per-rarity counts
├── selection.py    # set filter + rarity→quantity map → list[Want]
├── render.py       # Want → decklist line
└── cli.py          # argparse, which-sets-are-missing logic, orchestration, file writing
```

`Want` is a small record: collector number, name, title, rarity, quantity.

Runtime dependencies: none. Python 3.11+ standard library only (`urllib.request` for the fetch, `csv`, `argparse`,
`dataclasses`), so the tool runs from a clean checkout with no install step: `python -m cardmarket_wants`. The package sits at
the repository root rather than under `src/` precisely to keep that true — a `src/` layout needs an install or a `PYTHONPATH`
to import. `pytest` is the only development dependency.

The boundaries: `sets`, `selection` and `render` are pure functions over plain data and carry the logic worth testing. `lorcana`
is isolated so that everything else is testable without a network. With no prompt anywhere, `cli` is fully testable too — its
only real logic is deciding which sets are missing, which is a pure comparison of discovered codes against directory contents.

### Outputs

- `out/<set>-wants.txt` — the paste-ready file, e.g. `out/atv-wants.txt` with its 207 lines
- `out/<set>-wants.csv` — collector number, name, title, rarity, quantity — audit trail, and the input for Phase 2 pricing
- stdout — one line per set (generated with counts, skipped as existing, or skipped as having nothing to generate), then totals

### CLI flags

| Flag | Default | Purpose |
|---|---|---|
| `--quantities` | `common=1,uncommon=2,rare=3,super_rare=4,legendary=4` | Rarity→quantity map |
| `--separator` | `" - "` | Name/title separator |
| `--out-dir` | `out/` | Output directory |
| `--force` | off | Regenerate sets that already have files |
| `--refresh` | off | Bypass the card-data cache and re-download |

There is deliberately no `--set`, no `--sample` and no `--chunk`. Regenerating one set means deleting its file and re-running.
A sample file would be indistinguishable from a real one and would mark the set done while holding five lines, so the smoke
test below reads from stdout instead.

## Verification

Before pasting a full file, paste the first five lines. The tool prints those for each set it generates, so no separate sample
file is needed. Cardmarket reports results in three categories — added, not added (no match), and already present — so an
unmatched line is visible immediately and the format can be corrected before the bulk paste.

### Tests

pytest, no network. A trimmed JSON fixture (a handful of cards spanning every rarity, one titleless, one from a different set)
drives:

- `sets`: sets discovered from card data, per-rarity counts correct
- `selection`: correct set filtering, correct quantity per rarity, excluded and unrecognised rarities absent rather than fatal,
  sorted by collector number
- `render`: titled and titleless lines, custom separator, non-ASCII name passed through unchanged
- `cli`: a set with an existing file is skipped, a set without one is generated, `--force` overrides both, a set with no
  qualifying rarities writes no file at all
- a count assertion against the real Attack of the Vine! totals (207 lines / 453 copies) as a regression guard

## Error handling

- Network failure or non-200 from api-lorcana.com: fall back to the cache if one exists and say so; fail with a clear message
  if not.
- Unexpected payload shape (missing `languages.en`, missing `variants`): report the offending card and abort rather than emit a
  silently wrong list — a wrong wants list costs money.
- Unrecognised rarity: not an error. See Rarity handling above.
- A set that yields zero lines: no file, a skip line on stdout, and the run continues.
- Failure generating one set does not abort the others; the set is reported as failed and the exit code is non-zero.

## Phase 2 — pricing research (not built)

Findings from the API documentation, recorded so the next phase does not repeat the research:

**The Shopping Wizard is not exposed by the API.** The 2.0 resource list covers Account Management, Marketplace Information,
Order Management, Shopping Cart Manipulation, Stock Management, Wants List Management and Services. There is no wizard endpoint.
It is a website feature, reachable from a wants list, documented at
[Shopping Using Your Wants List](https://help.cardmarket.com/en/shopping-features-from-wants).

**The API endpoints that would price a wants list are gated.**

- `GET /ws/v2.0/articles/:idProduct` returns live offers with filters for `idLanguage`, `minCondition`, `sellerCountry`,
  `userType`, `minUserScore`, `minAvailable`. Paginated at 100 per request, hard-capped at 1,000 offers per product. Requires
  professional-seller API access, and Cardmarket explicitly forbids Dedicated Apps from repeatedly polling public marketplace
  resources.
- The price-guide file endpoint is both deprecated and restricted to Widget/3rd-party apps and powerseller Dedicated apps.
- `GET /ws/v2.0/expansions/:idExpansion/singles` would map the whole set to Cardmarket product IDs in one call — the natural
  bridge between this tool's CSV and any pricing work.

**The practical route is the website's own XHR endpoints**, observed from the browser while using the wants-list UI. The
wants-list page already exposes "Sellers With the Most Cards", which is the shipping-minimisation feature.

**The optimisation problem.** Minimising total cost is not minimising per-card price: it is minimising
`Σ(card prices) + Σ(shipping per seller)`, a set-cover problem. At 453 copies, consolidating into fewer sellers dominates
small per-card savings. Accepting both English and French widens the offer pool per card, which materially helps — more sellers
can cover more of the list, which means fewer parcels.

**Open question for Phase 2:** shipping destination. UK versus EU changes which sellers ship at all, and whether customs and VAT
land on top of the quoted totals.

## Out of scope

- Writing to Cardmarket directly (blocked by the professional-seller restriction)
- Bypassing Cloudflare bot verification
- Foil, condition and signed/altered preferences — not expressible in the paste format
- Secret rarities: Epic, Enchanted, Iconic
