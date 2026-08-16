# Lorcana Wants List Generator Implementation Plan

> **Superseded** by the web tool design. Kept for its Cardmarket API research, which still holds.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A non-interactive Python CLI that downloads Lorcana card data once and writes a Cardmarket paste-ready wants-list file for every set that doesn't already have one.

**Architecture:** Five small modules with one responsibility each. `lorcana` is the only code that touches the network; `config` reads the TOML quantity files; `sets`, `selection` and `render` are pure functions over plain dicts and dataclasses; `cli` wires them together and does the file I/O. No interactive input anywhere, so every module is testable.

**Tech Stack:** Python 3.11+, standard library only at runtime (`urllib.request`, `json`, `csv`, `argparse`, `dataclasses`, `pathlib`). `pytest` for tests.

**Spec:** `docs/superpowers/specs/2026-08-16-lorcana-wants-list-design.md`

## Global Constraints

- **Python 3.11+**, standard library only at runtime. No third-party runtime dependencies. `pytest` is the only dev dependency.
- **Package lives at the repository root** as `cardmarket_wants/`, not under `src/`, so `python -m cardmarket_wants` works from a clean checkout with no install step.
- **Tests never touch the network.** `urlopen` is monkeypatched wherever fetching is exercised.
- **Output line format:** `<quantity> <name>` for titleless cards, `<quantity> <name> - <title>` otherwise. Separator default is `" - "` — a plain hyphen with a space either side. No expansion qualifier is ever emitted.
- **Quantities live in TOML config files.** `default.toml` is what runs unless `--config` names another. `template.toml` lists every rarity at `0` as a starting point to copy. Both are committed.
- **`0` means excluded**, and a rarity absent from the file is excluded too, so an unrecognised rarity is never an error.
- **`default.toml` quantities:** `common=1, uncommon=2, rare=3, super_rare=4, legendary=4`; `epic`, `enchanted`, `iconic`, `special`, `unreleased`, `challenge24`, `top1` all `0`.
- **Set codes are lowercased** for filenames and all comparisons, because the API uses `atv` in card records but `AtV` in its endpoint paths.
- **Names are emitted verbatim as UTF-8.** No transliteration, no accent folding. All file reads and writes pass `encoding="utf-8"`.
- Card data source: `https://api-lorcana.com/cards`, cached at `.cache/lorcana-cards.json`.

---

### Task 1: Card data fetching with an on-disk cache

**Files:**
- Create: `cardmarket_wants/__init__.py`
- Create: `cardmarket_wants/lorcana.py`
- Create: `conftest.py` (empty, at repository root — makes pytest put the root on `sys.path`)
- Create: `pyproject.toml`
- Test: `tests/test_lorcana.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `CARDS_URL: str`, `DEFAULT_CACHE: Path`, `FetchError(RuntimeError)`, and `fetch_cards(cache_path: Path = DEFAULT_CACHE, refresh: bool = False) -> list[dict]`.

- [ ] **Step 1: Create the empty scaffolding files**

`cardmarket_wants/__init__.py` — empty file.

`conftest.py` at the repository root — empty file. Its only job is to make pytest treat the repository root as the rootdir and insert it into `sys.path`, so `import cardmarket_wants` works without an install.

`pyproject.toml`:

```toml
[project]
name = "cardmarket-wants"
version = "0.1.0"
description = "Generate Cardmarket wants-list files for Disney Lorcana sets"
requires-python = ">=3.11"
dependencies = []

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_lorcana.py`:

```python
import json
import urllib.error

import pytest

from cardmarket_wants import lorcana

SAMPLE = [{"variants": [{"set": "atv", "id": 1, "rarity": "common"}]}]


class _FakeResponse:
    def __init__(self, payload: str):
        self._payload = payload

    def read(self):
        return self._payload.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


def _patch_urlopen(monkeypatch, result):
    calls = []

    def fake_urlopen(url, timeout=None):
        calls.append(url)
        if isinstance(result, Exception):
            raise result
        return _FakeResponse(result)

    monkeypatch.setattr(lorcana.urllib.request, "urlopen", fake_urlopen)
    return calls


def test_downloads_and_writes_cache(monkeypatch, tmp_path):
    calls = _patch_urlopen(monkeypatch, json.dumps(SAMPLE))
    cache = tmp_path / "nested" / "cards.json"

    assert lorcana.fetch_cards(cache) == SAMPLE
    assert calls == [lorcana.CARDS_URL]
    assert json.loads(cache.read_text(encoding="utf-8")) == SAMPLE


def test_uses_cache_without_hitting_the_network(monkeypatch, tmp_path):
    calls = _patch_urlopen(monkeypatch, json.dumps(SAMPLE))
    cache = tmp_path / "cards.json"
    cache.write_text(json.dumps(SAMPLE), encoding="utf-8")

    assert lorcana.fetch_cards(cache) == SAMPLE
    assert calls == []


def test_refresh_bypasses_the_cache(monkeypatch, tmp_path):
    fresh = [{"variants": [{"set": "wun", "id": 2, "rarity": "rare"}]}]
    calls = _patch_urlopen(monkeypatch, json.dumps(fresh))
    cache = tmp_path / "cards.json"
    cache.write_text(json.dumps(SAMPLE), encoding="utf-8")

    assert lorcana.fetch_cards(cache, refresh=True) == fresh
    assert calls == [lorcana.CARDS_URL]
    assert json.loads(cache.read_text(encoding="utf-8")) == fresh


def test_falls_back_to_cache_when_the_network_fails(monkeypatch, tmp_path, capsys):
    _patch_urlopen(monkeypatch, urllib.error.URLError("no route to host"))
    cache = tmp_path / "cards.json"
    cache.write_text(json.dumps(SAMPLE), encoding="utf-8")

    assert lorcana.fetch_cards(cache, refresh=True) == SAMPLE
    assert "using cached data" in capsys.readouterr().out


def test_raises_when_the_network_fails_with_no_cache(monkeypatch, tmp_path):
    _patch_urlopen(monkeypatch, urllib.error.URLError("no route to host"))

    with pytest.raises(lorcana.FetchError, match="no cache"):
        lorcana.fetch_cards(tmp_path / "missing.json")
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/test_lorcana.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardmarket_wants.lorcana'`

- [ ] **Step 4: Write the implementation**

Create `cardmarket_wants/lorcana.py`:

```python
"""Fetch Lorcana card data from api-lorcana.com, with an on-disk cache."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

CARDS_URL = "https://api-lorcana.com/cards"
DEFAULT_CACHE = Path(".cache/lorcana-cards.json")

_TIMEOUT_SECONDS = 120


class FetchError(RuntimeError):
    """Card data could not be obtained from the network or from a cache."""


def fetch_cards(cache_path: Path = DEFAULT_CACHE, refresh: bool = False) -> list[dict]:
    """Return every Lorcana card, downloading only when there is no usable cache.

    The endpoint takes no parameters and returns roughly 6.4 MB covering every
    set, so one download serves a whole run.
    """
    cache_path = Path(cache_path)
    if not refresh and cache_path.exists():
        return _load(cache_path)

    try:
        with urllib.request.urlopen(CARDS_URL, timeout=_TIMEOUT_SECONDS) as response:
            payload = response.read().decode("utf-8")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        if cache_path.exists():
            print(f"warning: could not reach {CARDS_URL} ({exc}); using cached data")
            return _load(cache_path)
        raise FetchError(
            f"could not fetch {CARDS_URL} ({exc}) and there is no cache at {cache_path}"
        ) from exc

    cards = json.loads(payload)
    _store(cache_path, payload)
    return cards


def _load(cache_path: Path) -> list[dict]:
    return json.loads(cache_path.read_text(encoding="utf-8"))


def _store(cache_path: Path, payload: str) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_name(cache_path.name + ".tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(cache_path)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_lorcana.py -v`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml conftest.py cardmarket_wants/__init__.py cardmarket_wants/lorcana.py tests/test_lorcana.py
git commit -m "Add cached card data fetching from api-lorcana.com"
```

---

### Task 2: Set discovery

**Files:**
- Create: `cardmarket_wants/sets.py`
- Test: `tests/test_sets.py`

**Interfaces:**
- Consumes: nothing (operates on the raw card list produced by `lorcana.fetch_cards`).
- Produces: `SetInfo` dataclass with fields `code: str` and `rarity_counts: dict[str, int]` plus a `card_count` property, and `survey_sets(cards: list[dict]) -> list[SetInfo]` returning one entry per set, sorted by code.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_sets.py`:

```python
from cardmarket_wants.sets import SetInfo, survey_sets

CARDS = [
    {"variants": [{"set": "atv", "id": 1, "rarity": "common"}]},
    {"variants": [{"set": "atv", "id": 2, "rarity": "common"}]},
    {"variants": [{"set": "atv", "id": 3, "rarity": "legendary"}]},
    {"variants": [{"set": "p1", "id": 1, "rarity": "special"}]},
    # One card printed in two sets, which is why sets are counted per variant.
    {"variants": [{"set": "tfc", "id": 9, "rarity": "rare"}, {"set": "atv", "id": 4, "rarity": "rare"}]},
]


def test_finds_every_set_sorted_by_code():
    assert [info.code for info in survey_sets(CARDS)] == ["atv", "p1", "tfc"]


def test_counts_rarities_per_set():
    by_code = {info.code: info for info in survey_sets(CARDS)}

    assert by_code["atv"].rarity_counts == {"common": 2, "legendary": 1, "rare": 1}
    assert by_code["p1"].rarity_counts == {"special": 1}


def test_card_count_totals_the_rarities():
    by_code = {info.code: info for info in survey_sets(CARDS)}

    assert by_code["atv"].card_count == 4
    assert by_code["tfc"].card_count == 1


def test_set_codes_are_lowercased():
    # The API returns "atv" in card records but expects "AtV" in its paths.
    cards = [{"variants": [{"set": "AtV", "id": 1, "rarity": "common"}]}]

    assert survey_sets(cards) == [SetInfo(code="atv", rarity_counts={"common": 1})]


def test_ignores_cards_with_no_variants():
    assert survey_sets([{"variants": []}, {}]) == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_sets.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardmarket_wants.sets'`

- [ ] **Step 3: Write the implementation**

Create `cardmarket_wants/sets.py`:

```python
"""Survey which sets exist in the card data, and what rarities each contains."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SetInfo:
    """One Lorcana set as it appears in the card data."""

    code: str
    rarity_counts: dict[str, int] = field(default_factory=dict)

    @property
    def card_count(self) -> int:
        return sum(self.rarity_counts.values())


def survey_sets(cards: list[dict]) -> list[SetInfo]:
    """Return every set present in `cards`, sorted by code.

    Counting happens per variant rather than per card because a card reprinted
    in a later set carries one variant entry per printing.
    """
    counts: dict[str, Counter] = {}
    for card in cards:
        for variant in card.get("variants") or []:
            code = variant.get("set")
            if not code:
                continue
            rarity = variant.get("rarity")
            if not rarity:
                continue
            counts.setdefault(str(code).lower(), Counter())[rarity] += 1

    return [SetInfo(code=code, rarity_counts=dict(tally)) for code, tally in sorted(counts.items())]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_sets.py -v`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add cardmarket_wants/sets.py tests/test_sets.py
git commit -m "Add set discovery with per-rarity counts"
```

---

### Task 3: Want selection

**Files:**
- Create: `cardmarket_wants/selection.py`
- Test: `tests/test_selection.py`

**Interfaces:**
- Consumes: nothing (operates on the raw card list).
- Produces: `DEFAULT_QUANTITIES: dict[str, int]`, `CardDataError(ValueError)`, frozen dataclass `Want(number: int, name: str, title: str, rarity: str, quantity: int)`, and `select_wants(cards: list[dict], set_code: str, quantities: dict[str, int] | None = None) -> list[Want]` sorted by collector number.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_selection.py`:

```python
import pytest

from cardmarket_wants.selection import (
    DEFAULT_QUANTITIES,
    CardDataError,
    Want,
    select_wants,
)


def card(set_code, number, rarity, name, title=""):
    return {
        "variants": [{"set": set_code, "id": number, "rarity": rarity}],
        "languages": {"en": {"name": name, "title": title}},
    }


CARDS = [
    card("atv", 3, "common", "Isabela Madrigal", "Kind Cultivator"),
    card("atv", 1, "rare", "Woody", "Helping a Friend"),
    card("atv", 2, "uncommon", "Celia Mae", "Friendly Receptionist"),
    card("atv", 4, "super_rare", "Ursula", "Vanessa"),
    card("atv", 5, "legendary", "Chernabog", "Unnatural Force"),
    card("atv", 6, "common", "Piercing Attack"),
    card("atv", 7, "enchanted", "Woody", "Helping a Friend"),
    card("wun", 1, "rare", "Somebody Else", "From Another Set"),
]


def test_applies_the_default_quantity_per_rarity():
    wants = select_wants(CARDS, "atv")

    assert [(w.number, w.quantity) for w in wants] == [
        (1, 3),  # rare
        (2, 2),  # uncommon
        (3, 1),  # common
        (4, 4),  # super_rare
        (5, 4),  # legendary
        (6, 1),  # common
    ]


def test_results_are_sorted_by_collector_number():
    assert [w.number for w in select_wants(CARDS, "atv")] == [1, 2, 3, 4, 5, 6]


def test_excludes_other_sets():
    assert all(w.name != "Somebody Else" for w in select_wants(CARDS, "atv"))


def test_excludes_rarities_outside_the_quantity_map():
    # The enchanted printing of Woody must not appear.
    assert [w.number for w in select_wants(CARDS, "atv")] == [1, 2, 3, 4, 5, 6]


def test_unrecognised_rarities_are_skipped_not_fatal():
    cards = [
        card("p1", 1, "unreleased", "Mystery Card"),
        card("p1", 2, "challenge24", "Another"),
        card("p1", 3, "top1", "Winner"),
        card("p1", 4, "common", "Real Card"),
    ]

    assert [w.name for w in select_wants(cards, "p1")] == ["Real Card"]


def test_a_zero_quantity_excludes_a_rarity():
    # The config files list unwanted rarities explicitly as 0 rather than
    # them, so zero must behave exactly like absent.
    wants = select_wants(CARDS, "atv", {"common": 1, "rare": 0})

    assert [w.name for w in wants] == ["Isabela Madrigal", "Piercing Attack"]


def test_all_zero_quantities_yield_nothing():
    every_rarity_off = dict.fromkeys(DEFAULT_QUANTITIES, 0)

    assert select_wants(CARDS, "atv", every_rarity_off) == []


def test_set_code_matching_is_case_insensitive():
    assert len(select_wants(CARDS, "AtV")) == 6


def test_titleless_cards_keep_an_empty_title():
    piercing = next(w for w in select_wants(CARDS, "atv") if w.number == 6)

    assert piercing == Want(number=6, name="Piercing Attack", title="", rarity="common", quantity=1)


def test_custom_quantities_override_the_default():
    wants = select_wants(CARDS, "atv", {"legendary": 2})

    assert [(w.name, w.quantity) for w in wants] == [("Chernabog", 2)]


def test_unknown_set_returns_nothing():
    assert select_wants(CARDS, "nope") == []


def test_missing_english_name_is_an_error():
    broken = [{"variants": [{"set": "atv", "id": 1, "rarity": "common"}], "languages": {}}]

    with pytest.raises(CardDataError, match="no English name"):
        select_wants(broken, "atv")


def test_missing_collector_number_is_an_error():
    broken = [
        {
            "variants": [{"set": "atv", "rarity": "common"}],
            "languages": {"en": {"name": "Nameless Number", "title": ""}},
        }
    ]

    with pytest.raises(CardDataError, match="no collector number"):
        select_wants(broken, "atv")


def test_default_quantities_match_the_spec():
    assert DEFAULT_QUANTITIES == {
        "common": 1,
        "uncommon": 2,
        "rare": 3,
        "super_rare": 4,
        "legendary": 4,
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_selection.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardmarket_wants.selection'`

- [ ] **Step 3: Write the implementation**

Create `cardmarket_wants/selection.py`:

```python
"""Turn raw card data into the wanted cards for one set."""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_QUANTITIES: dict[str, int] = {
    "common": 1,
    "uncommon": 2,
    "rare": 3,
    "super_rare": 4,
    "legendary": 4,
}


class CardDataError(ValueError):
    """A card record is missing something the generator needs."""


@dataclass(frozen=True)
class Want:
    """One line of a wants list: a card and how many copies are wanted."""

    number: int
    name: str
    title: str
    rarity: str
    quantity: int


def select_wants(
    cards: list[dict],
    set_code: str,
    quantities: dict[str, int] | None = None,
) -> list[Want]:
    """Return the wanted cards from `set_code`, sorted by collector number.

    Rarities set to zero, and rarities absent from `quantities` entirely, are
    both out of scope and skipped silently. That covers the secret rarities
    (epic, enchanted, iconic), the promo-only ones (special, unreleased,
    challenge24, top1), and any rarity Ravensburger invents later — none of
    which should stop a run.
    """
    quantities = DEFAULT_QUANTITIES if quantities is None else quantities
    target = set_code.lower()

    wants: list[Want] = []
    for card in cards:
        for variant in card.get("variants") or []:
            if str(variant.get("set", "")).lower() != target:
                continue

            quantity = quantities.get(variant.get("rarity"), 0)
            if quantity <= 0:
                continue

            english = (card.get("languages") or {}).get("en") or {}
            name = english.get("name")
            if not name:
                raise CardDataError(
                    f"card {variant.get('id')} in set {set_code} has no English name"
                )

            number = variant.get("id")
            if number is None:
                raise CardDataError(f"card {name!r} in set {set_code} has no collector number")

            wants.append(
                Want(
                    number=int(number),
                    name=name,
                    title=english.get("title") or "",
                    rarity=variant["rarity"],
                    quantity=quantity,
                )
            )

    wants.sort(key=lambda want: want.number)
    return wants
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_selection.py -v`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add cardmarket_wants/selection.py tests/test_selection.py
git commit -m "Add want selection with rarity quantity mapping"
```

---

### Task 4: Rendering

**Files:**
- Create: `cardmarket_wants/render.py`
- Test: `tests/test_render.py`

**Interfaces:**
- Consumes: `Want` from `cardmarket_wants.selection`.
- Produces: `DEFAULT_SEPARATOR: str` (`" - "`), `CSV_HEADER: list[str]`, `render_line(want: Want, separator: str = DEFAULT_SEPARATOR) -> str`, `render_decklist(wants: list[Want], separator: str = DEFAULT_SEPARATOR) -> str`, and `csv_rows(wants: list[Want]) -> list[list[str]]` including the header row.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_render.py`:

```python
from cardmarket_wants.render import (
    CSV_HEADER,
    DEFAULT_SEPARATOR,
    csv_rows,
    render_decklist,
    render_line,
)
from cardmarket_wants.selection import Want

WOODY = Want(number=1, name="Woody", title="Helping a Friend", rarity="rare", quantity=3)
PIERCING = Want(number=6, name="Piercing Attack", title="", rarity="common", quantity=1)


def test_renders_name_and_title_separated_by_a_spaced_hyphen():
    assert render_line(WOODY) == "3 Woody - Helping a Friend"


def test_renders_a_titleless_card_as_the_name_alone():
    assert render_line(PIERCING) == "1 Piercing Attack"


def test_default_separator_is_a_spaced_hyphen():
    assert DEFAULT_SEPARATOR == " - "


def test_separator_is_configurable():
    assert render_line(WOODY, separator=" | ") == "3 Woody | Helping a Friend"


def test_hyphens_inside_a_name_are_left_alone():
    tyler = Want(number=4, name="Tyler Nguyen-Baker", title="4*Town Fan", rarity="common", quantity=1)

    assert render_line(tyler) == "1 Tyler Nguyen-Baker - 4*Town Fan"


def test_non_ascii_names_pass_through_unchanged():
    te_ka = Want(number=7, name="Te Kā", title="Heartless", rarity="rare", quantity=3)

    assert render_line(te_ka) == "3 Te Kā - Heartless"


def test_decklist_is_one_line_per_card_with_a_trailing_newline():
    assert render_decklist([WOODY, PIERCING]) == "3 Woody - Helping a Friend\n1 Piercing Attack\n"


def test_empty_decklist_is_an_empty_string():
    assert render_decklist([]) == ""


def test_csv_rows_start_with_the_header():
    rows = csv_rows([WOODY])

    assert rows[0] == CSV_HEADER
    assert CSV_HEADER == ["number", "name", "title", "rarity", "quantity"]


def test_csv_rows_carry_every_field_as_text():
    assert csv_rows([WOODY, PIERCING])[1:] == [
        ["1", "Woody", "Helping a Friend", "rare", "3"],
        ["6", "Piercing Attack", "", "common", "1"],
    ]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_render.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardmarket_wants.render'`

- [ ] **Step 3: Write the implementation**

Create `cardmarket_wants/render.py`:

```python
"""Render wants into Cardmarket's decklist paste format, and into CSV rows."""

from __future__ import annotations

from .selection import Want

DEFAULT_SEPARATOR = " - "
CSV_HEADER = ["number", "name", "title", "rarity", "quantity"]


def render_line(want: Want, separator: str = DEFAULT_SEPARATOR) -> str:
    """Render one line of Cardmarket's wants-list paste format.

    Cardmarket parses `<amount> <card name>`, where a card's name includes its
    version subtitle. Cards without a subtitle are just the name.
    """
    name = f"{want.name}{separator}{want.title}" if want.title else want.name
    return f"{want.quantity} {name}"


def render_decklist(wants: list[Want], separator: str = DEFAULT_SEPARATOR) -> str:
    """Render a full paste-ready decklist, one card per line."""
    return "".join(f"{render_line(want, separator)}\n" for want in wants)


def csv_rows(wants: list[Want]) -> list[list[str]]:
    """Render the audit CSV, header row first."""
    return [CSV_HEADER] + [
        [str(want.number), want.name, want.title, want.rarity, str(want.quantity)]
        for want in wants
    ]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_render.py -v`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add cardmarket_wants/render.py tests/test_render.py
git commit -m "Add decklist and CSV rendering"
```

---

### Task 5: Configuration file

**Files:**
- Create: `default.toml`
- Create: `template.toml`
- Create: `cardmarket_wants/config.py`
- Test: `tests/test_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_CONFIG: Path` (`Path("default.toml")`), `ConfigError(ValueError)`, and `load_quantities(path: Path) -> dict[str, int]`, which raises `ConfigError` when the file is missing, malformed, or contains a bad value. Callers decide what a missing default file means.

- [ ] **Step 1: Write the two config files**

Create `default.toml` at the repository root. This is what runs when no `--config` is given. Every rarity that exists in the card
data is listed, including the unwanted ones at `0`, so changing what you collect is editing a number rather than remembering a
rarity name.

```toml
# How many copies of each rarity to want, per set.
#
# This file is the default. To collect something different, copy template.toml
# to a file of your own and run with --config yours.toml. Leave this one alone
# so there is always a known-good starting point.
#
# 0 means "don't want any" — the rarity is listed rather than omitted so the
# full set of rarities is visible and switching one on is a one-character edit.
#
# Rarities not listed here are also treated as 0, so a rarity that Ravensburger
# adds later will be ignored rather than break a run.

[quantities]
# Main set rarities.
common = 1
uncommon = 2
rare = 3
super_rare = 4
legendary = 4

# Secret rarities — the chase cards, pulled far less often.
epic = 0
enchanted = 0
iconic = 0

# Promo, collection and event-only rarities.
special = 0
unreleased = 0
challenge24 = 0
top1 = 0
```

Create `template.toml` — every rarity at zero, so a new configuration is built by switching on only what is wanted. Copy it,
don't edit it.

```toml
# A starting point for your own wants configuration. Everything is 0, so a
# copy of this file generates nothing until you raise the rarities you want.
#
#   cp template.toml mine.toml
#   # edit mine.toml
#   python -m cardmarket_wants --config mine.toml
#
# 0 means "don't want any". Rarities not listed here are treated as 0 too.

[quantities]
# Main set rarities.
common = 0
uncommon = 0
rare = 0
super_rare = 0
legendary = 0

# Secret rarities — the chase cards, pulled far less often.
epic = 0
enchanted = 0
iconic = 0

# Promo, collection and event-only rarities.
special = 0
unreleased = 0
challenge24 = 0
top1 = 0
```

- [ ] **Step 2: Write the failing tests**

Create `tests/test_config.py`:

```python
import pytest

from cardmarket_wants.config import (
    DEFAULT_CONFIG,
    TEMPLATE_CONFIG,
    ConfigError,
    load_quantities,
)

VALID = """
[quantities]
common = 1
rare = 3
epic = 0
"""


def write(tmp_path, text, name="quantities.toml"):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def test_reads_the_quantities_section(tmp_path):
    assert load_quantities(write(tmp_path, VALID)) == {"common": 1, "rare": 3, "epic": 0}


def test_zero_is_kept_rather_than_dropped(tmp_path):
    # Selection treats 0 as excluded; config's job is to report it faithfully.
    assert load_quantities(write(tmp_path, VALID))["epic"] == 0


def test_rarity_names_are_lowercased(tmp_path):
    config = write(tmp_path, "[quantities]\nSuper_Rare = 4\n")

    assert load_quantities(config) == {"super_rare": 4}


def test_missing_file_is_an_error(tmp_path):
    with pytest.raises(ConfigError, match="no configuration file"):
        load_quantities(tmp_path / "absent.toml")


def test_malformed_toml_is_an_error(tmp_path):
    with pytest.raises(ConfigError, match="not valid TOML"):
        load_quantities(write(tmp_path, "[quantities\ncommon = 1\n"))


def test_missing_quantities_section_is_an_error(tmp_path):
    with pytest.raises(ConfigError, match=r"\[quantities\]"):
        load_quantities(write(tmp_path, "[something_else]\ncommon = 1\n"))


def test_empty_quantities_section_is_an_error(tmp_path):
    with pytest.raises(ConfigError, match=r"\[quantities\]"):
        load_quantities(write(tmp_path, "[quantities]\n"))


def test_a_negative_quantity_is_an_error(tmp_path):
    with pytest.raises(ConfigError, match="zero or a positive whole number"):
        load_quantities(write(tmp_path, "[quantities]\ncommon = -1\n"))


def test_a_non_integer_quantity_is_an_error(tmp_path):
    with pytest.raises(ConfigError, match="zero or a positive whole number"):
        load_quantities(write(tmp_path, '[quantities]\ncommon = "three"\n'))


def test_a_boolean_quantity_is_an_error(tmp_path):
    # TOML booleans are ints in Python; they are not a quantity.
    with pytest.raises(ConfigError, match="zero or a positive whole number"):
        load_quantities(write(tmp_path, "[quantities]\ncommon = true\n"))


def test_the_default_config_matches_the_agreed_quantities():
    quantities = load_quantities(DEFAULT_CONFIG)

    assert quantities["common"] == 1
    assert quantities["uncommon"] == 2
    assert quantities["rare"] == 3
    assert quantities["super_rare"] == 4
    assert quantities["legendary"] == 4
    assert quantities["epic"] == 0
    assert quantities["enchanted"] == 0
    assert quantities["iconic"] == 0


def test_the_template_is_entirely_zero():
    quantities = load_quantities(TEMPLATE_CONFIG)

    assert set(quantities.values()) == {0}


def test_the_template_covers_every_rarity_the_default_does():
    # A copied template must not silently omit a rarity the default knows about.
    assert set(load_quantities(TEMPLATE_CONFIG)) == set(load_quantities(DEFAULT_CONFIG))
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardmarket_wants.config'`

- [ ] **Step 4: Write the implementation**

Create `cardmarket_wants/config.py`:

```python
"""Read the rarity quantity configuration from a TOML file."""

from __future__ import annotations

import tomllib
from pathlib import Path

DEFAULT_CONFIG = Path("default.toml")
TEMPLATE_CONFIG = Path("template.toml")


class ConfigError(ValueError):
    """The configuration file is missing, malformed, or holds a bad value."""


def load_quantities(path: Path) -> dict[str, int]:
    """Return the rarity to quantity map from `path`.

    Zero is preserved rather than dropped: the file lists unwanted rarities
    explicitly so they are visible and easy to switch on. Deciding that zero
    means excluded is selection's job, not this function's.
    """
    path = Path(path)
    try:
        with path.open("rb") as handle:
            document = tomllib.load(handle)
    except FileNotFoundError:
        raise ConfigError(f"no configuration file at {path}") from None
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{path} is not valid TOML: {exc}") from None

    section = document.get("quantities")
    if not isinstance(section, dict) or not section:
        raise ConfigError(f"{path} has no [quantities] section, or it is empty")

    quantities: dict[str, int] = {}
    for rarity, value in section.items():
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ConfigError(
                f"quantity for {rarity!r} in {path} must be zero or a positive "
                f"whole number, got {value!r}"
            )
        quantities[rarity.lower()] = value
    return quantities
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_config.py -v`
Expected: PASS, 13 tests

- [ ] **Step 6: Commit**

```bash
git add default.toml template.toml cardmarket_wants/config.py tests/test_config.py
git commit -m "Add rarity quantity configuration files"
```

---

### Task 6: CLI

**Files:**
- Create: `cardmarket_wants/cli.py`
- Create: `cardmarket_wants/__main__.py`
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: `lorcana.fetch_cards`, `lorcana.DEFAULT_CACHE`, `lorcana.FetchError`, `config.DEFAULT_CONFIG`, `config.ConfigError`, `config.load_quantities`, `sets.survey_sets`, `sets.SetInfo`, `selection.select_wants`, `selection.DEFAULT_QUANTITIES`, `selection.CardDataError`, `render.render_decklist`, `render.render_line`, `render.csv_rows`, `render.DEFAULT_SEPARATOR`.
- Produces: `resolve_quantities(config_path: Path, explicit: bool) -> dict[str, int]`, `txt_path(out_dir: Path, code: str) -> Path`, `csv_path(out_dir: Path, code: str) -> Path`, and `main(argv: list[str] | None = None) -> int`.

**Design note:** there is deliberately no pre-classification of sets into "will generate" and "won't". Whether a set produces
anything is already answered by `select_wants` returning an empty list; deciding it a second time from `rarity_counts` and the
quantity map would be the same rule written twice, free to drift apart. `main` walks the sets once and decides as it goes.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_cli.py`:

```python
import json

import pytest

from cardmarket_wants import cli
from cardmarket_wants.selection import DEFAULT_QUANTITIES

QUANTITIES = {"common": 1, "rare": 3, "special": 0}

CONFIG = """
[quantities]
common = 1
rare = 3
special = 0
"""


def card(set_code, number, rarity, name, title=""):
    return {
        "variants": [{"set": set_code, "id": number, "rarity": rarity}],
        "languages": {"en": {"name": name, "title": title}},
    }


CARDS = [
    card("atv", 1, "rare", "Woody", "Helping a Friend"),
    card("atv", 2, "common", "Piercing Attack"),
    card("wun", 1, "common", "Other Set Card"),
    card("p1", 1, "special", "Promo Card"),
]


@pytest.fixture
def cached(tmp_path):
    """A populated cache, so main() never reaches the network."""
    cache = tmp_path / "cards.json"
    cache.write_text(json.dumps(CARDS), encoding="utf-8")
    return cache


@pytest.fixture
def config(tmp_path):
    path = tmp_path / "default.toml"
    path.write_text(CONFIG, encoding="utf-8")
    return path


def run(cached, config, out_dir, *extra):
    return cli.main(
        ["--cache", str(cached), "--config", str(config), "--out-dir", str(out_dir), *extra]
    )


# --- resolve_quantities -------------------------------------------------


def test_resolve_quantities_reads_the_config_file(config):
    assert cli.resolve_quantities(config, explicit=True) == QUANTITIES


def test_resolve_quantities_falls_back_when_the_default_file_is_absent(tmp_path, capsys):
    quantities = cli.resolve_quantities(tmp_path / "default.toml", explicit=False)

    assert quantities == DEFAULT_QUANTITIES
    assert "built-in defaults" in capsys.readouterr().out


def test_resolve_quantities_raises_when_an_explicit_file_is_absent(tmp_path):
    with pytest.raises(cli.ConfigError, match="no configuration file"):
        cli.resolve_quantities(tmp_path / "typo.toml", explicit=True)


# --- main ---------------------------------------------------------------


def test_main_writes_a_file_per_qualifying_set(cached, config, tmp_path):
    out = tmp_path / "out"

    assert run(cached, config, out) == 0
    assert cli.txt_path(out, "atv").read_text(encoding="utf-8") == (
        "3 Woody - Helping a Friend\n1 Piercing Attack\n"
    )
    assert cli.txt_path(out, "wun").exists()


def test_main_writes_the_audit_csv(cached, config, tmp_path):
    out = tmp_path / "out"
    run(cached, config, out)

    lines = cli.csv_path(out, "atv").read_text(encoding="utf-8").splitlines()

    assert lines[0] == "number,name,title,rarity,quantity"
    assert lines[1] == "1,Woody,Helping a Friend,rare,3"


def test_main_writes_nothing_for_a_set_whose_rarities_are_all_zero(cached, config, tmp_path):
    out = tmp_path / "out"
    run(cached, config, out)

    assert not cli.txt_path(out, "p1").exists()
    assert not cli.csv_path(out, "p1").exists()


def test_main_leaves_an_existing_file_untouched(cached, config, tmp_path, capsys):
    out = tmp_path / "out"
    out.mkdir()
    cli.txt_path(out, "atv").write_text("hand written\n", encoding="utf-8")

    assert run(cached, config, out) == 0
    assert cli.txt_path(out, "atv").read_text(encoding="utf-8") == "hand written\n"
    assert "already generated" in capsys.readouterr().out


def test_main_force_overwrites_an_existing_file(cached, config, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    cli.txt_path(out, "atv").write_text("hand written\n", encoding="utf-8")

    assert run(cached, config, out, "--force") == 0
    assert "Woody" in cli.txt_path(out, "atv").read_text(encoding="utf-8")


def test_main_previews_the_first_lines_of_each_generated_set(cached, config, tmp_path, capsys):
    run(cached, config, tmp_path / "out")

    assert "3 Woody - Helping a Friend" in capsys.readouterr().out


def test_main_honours_a_custom_separator(cached, config, tmp_path):
    out = tmp_path / "out"
    run(cached, config, out, "--separator", " | ")

    assert "3 Woody | Helping a Friend\n" in cli.txt_path(out, "atv").read_text(encoding="utf-8")


def test_main_respects_edited_quantities(cached, tmp_path):
    # Switching a rarity on in the config must change the output.
    edited = tmp_path / "edited.toml"
    edited.write_text("[quantities]\ncommon = 0\nrare = 1\n", encoding="utf-8")
    out = tmp_path / "out"

    run(cached, edited, out)

    assert cli.txt_path(out, "atv").read_text(encoding="utf-8") == "1 Woody - Helping a Friend\n"


def test_an_all_zero_config_generates_nothing(cached, tmp_path):
    # This is template.toml's behaviour: a fresh copy produces no files.
    empty_config = tmp_path / "template-copy.toml"
    empty_config.write_text("[quantities]\ncommon = 0\nrare = 0\nspecial = 0\n", encoding="utf-8")
    out = tmp_path / "out"

    assert run(cached, empty_config, out) == 0
    assert list(out.iterdir()) == []


def test_main_rejects_a_missing_explicit_config(cached, tmp_path, capsys):
    assert run(cached, tmp_path / "typo.toml", tmp_path / "out") == 2
    assert "no configuration file" in capsys.readouterr().err


def test_main_rejects_a_malformed_config(cached, tmp_path, capsys):
    broken = tmp_path / "broken.toml"
    broken.write_text("[quantities]\ncommon = -1\n", encoding="utf-8")

    assert run(cached, broken, tmp_path / "out") == 2
    assert "zero or a positive whole number" in capsys.readouterr().err


def test_main_reports_unreachable_data_with_no_cache(config, tmp_path, monkeypatch, capsys):
    def fail(*args, **kwargs):
        raise OSError("no route to host")

    monkeypatch.setattr(cli.urllib.request, "urlopen", fail)

    assert run(tmp_path / "missing.json", config, tmp_path / "out") == 1
    assert "error:" in capsys.readouterr().err


def test_main_keeps_going_and_fails_loudly_when_one_set_is_broken(config, tmp_path, capsys):
    cache = tmp_path / "cards.json"
    broken = CARDS + [{"variants": [{"set": "bad", "id": 1, "rarity": "common"}], "languages": {}}]
    cache.write_text(json.dumps(broken), encoding="utf-8")
    out = tmp_path / "out"

    assert run(cache, config, out) == 1
    assert cli.txt_path(out, "atv").exists()  # the healthy set still generated
    assert "FAILED" in capsys.readouterr().err
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_cli.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cardmarket_wants.cli'`

- [ ] **Step 3: Write the implementation**

Create `cardmarket_wants/cli.py`:

```python
"""Command line entry point: generate a wants-list file for every missing set."""

from __future__ import annotations

import argparse
import csv
import sys
import urllib.request  # noqa: F401  (imported so tests can patch the network here)
from pathlib import Path

from .config import DEFAULT_CONFIG, ConfigError, load_quantities
from .lorcana import DEFAULT_CACHE, FetchError, fetch_cards
from .render import DEFAULT_SEPARATOR, csv_rows, render_decklist, render_line
from .selection import DEFAULT_QUANTITIES, CardDataError, select_wants
from .sets import survey_sets

PREVIEW_LINES = 5


def resolve_quantities(config_path: Path, explicit: bool) -> dict[str, int]:
    """Load quantities from `config_path`, tolerating only an absent default.

    A missing file the user named is a typo and must be reported. A missing
    default file just means the tool is being run from outside a checkout, so
    fall back to the built-in map and say so.
    """
    if not explicit and not Path(config_path).exists():
        print(f"note: no {config_path}, using built-in defaults")
        return dict(DEFAULT_QUANTITIES)
    return load_quantities(config_path)


def txt_path(out_dir: Path, code: str) -> Path:
    return Path(out_dir) / f"{code}-wants.txt"


def csv_path(out_dir: Path, code: str) -> Path:
    return Path(out_dir) / f"{code}-wants.csv"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cardmarket-wants",
        description="Generate Cardmarket wants-list files for every Lorcana set missing one.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help=f"rarity quantity configuration (default: {DEFAULT_CONFIG})",
    )
    parser.add_argument("--separator", default=DEFAULT_SEPARATOR, help="name/title separator")
    parser.add_argument("--out-dir", type=Path, default=Path("out"), help="output directory")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE, help="card data cache path")
    parser.add_argument("--force", action="store_true", help="regenerate sets that already exist")
    parser.add_argument("--refresh", action="store_true", help="re-download the card data")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    try:
        quantities = resolve_quantities(
            args.config if args.config is not None else DEFAULT_CONFIG,
            explicit=args.config is not None,
        )
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    try:
        cards = fetch_cards(args.cache, refresh=args.refresh)
    except FetchError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)

    generated = existing = skipped = failures = 0
    total_cards = total_copies = 0

    for info in survey_sets(cards):
        destination = txt_path(args.out_dir, info.code)

        if destination.exists() and not args.force:
            print(f"  {info.code}: already generated, skipping")
            existing += 1
            continue

        try:
            wants = select_wants(cards, info.code, quantities)
        except CardDataError as exc:
            print(f"  {info.code}: FAILED - {exc}", file=sys.stderr)
            failures += 1
            continue

        # An empty result means nothing in this set is wanted. Writing the file
        # anyway would mark the set permanently done and hide a later config
        # change or data fix.
        if not wants:
            print(f"  {info.code}: nothing wanted ({', '.join(sorted(info.rarity_counts))})")
            skipped += 1
            continue

        destination.write_text(render_decklist(wants, args.separator), encoding="utf-8")
        with csv_path(args.out_dir, info.code).open("w", newline="", encoding="utf-8") as handle:
            csv.writer(handle).writerows(csv_rows(wants))

        copies = sum(want.quantity for want in wants)
        generated += 1
        total_cards += len(wants)
        total_copies += copies
        print(f"  {info.code}: {len(wants)} cards, {copies} copies -> {destination}")
        for want in wants[:PREVIEW_LINES]:
            print(f"      {render_line(want, args.separator)}")

    print(
        f"\n{generated} generated, {existing} existing, {skipped} skipped; "
        f"{total_cards} cards, {total_copies} copies"
    )
    return 1 if failures else 0
```

Create `cardmarket_wants/__main__.py`:

```python
"""Allow `python -m cardmarket_wants`."""

from .cli import main

raise SystemExit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_cli.py -v`
Expected: PASS, 16 tests

- [ ] **Step 5: Run the whole suite**

Run: `python -m pytest -v`
Expected: PASS, 63 tests

- [ ] **Step 6: Commit**

```bash
git add cardmarket_wants/cli.py cardmarket_wants/__main__.py tests/test_cli.py
git commit -m "Add CLI that generates a wants list for every missing set"
```

---

### Task 7: Real-data regression guard, README, and a live run

**Files:**
- Create: `tests/test_real_data.py`
- Create: `README.md`

**Interfaces:**
- Consumes: `lorcana.DEFAULT_CACHE`, `selection.select_wants`, `sets.survey_sets`.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the regression guard**

This test asserts against the real Attack of the Vine! numbers verified on 2026-08-16. It reads the on-disk cache rather than the network, and skips when there is no cache, so the suite stays network-free and green on a fresh clone.

Create `tests/test_real_data.py`:

```python
"""Regression guard against the real card data, when a cache is present.

Populate the cache with `python -m cardmarket_wants`. Without it these skip,
which keeps a fresh clone green and keeps the suite off the network.
"""

import json

import pytest

from cardmarket_wants.lorcana import DEFAULT_CACHE
from cardmarket_wants.selection import select_wants
from cardmarket_wants.sets import survey_sets


@pytest.fixture(scope="module")
def cards():
    if not DEFAULT_CACHE.exists():
        pytest.skip(f"no cached card data at {DEFAULT_CACHE}")
    return json.loads(DEFAULT_CACHE.read_text(encoding="utf-8"))


def test_attack_of_the_vine_has_the_expected_rarity_split(cards):
    by_code = {info.code: info for info in survey_sets(cards)}
    counts = by_code["atv"].rarity_counts

    assert counts["common"] == 72
    assert counts["uncommon"] == 54
    assert counts["rare"] == 51
    assert counts["super_rare"] == 18
    assert counts["legendary"] == 12


def test_attack_of_the_vine_yields_207_cards_and_453_copies(cards):
    wants = select_wants(cards, "atv")

    assert len(wants) == 207
    assert sum(want.quantity for want in wants) == 453


def test_attack_of_the_vine_secret_rarities_are_excluded(cards):
    wants = select_wants(cards, "atv")

    assert {want.rarity for want in wants} == {
        "common",
        "uncommon",
        "rare",
        "super_rare",
        "legendary",
    }


def test_no_attack_of_the_vine_name_contains_the_separator(cards):
    # If this ever fails, a rendered line becomes ambiguous to Cardmarket.
    wants = select_wants(cards, "atv")

    assert [w for w in wants if " - " in w.name or " - " in w.title] == []
```

- [ ] **Step 2: Run the guard against real data**

Run: `python -m pytest tests/test_real_data.py -v`
Expected: SKIPPED, 4 tests — there is no cache yet.

- [ ] **Step 3: Do the live run**

Run: `python -m cardmarket_wants`

Expected: a 6.4 MB download, then 14 sets generated and 9 skipped, ending with a summary line reading `14 generated, 0 existing, 9 skipped; 2671 cards, 5827 copies`.

Verify the headline file:

```bash
wc -l out/atv-wants.txt        # expect 207
head -5 out/atv-wants.txt      # expect: 3 Woody - Helping a Friend
awk '{print $1}' out/atv-wants.txt | paste -sd+ - | bc   # expect 453
```

- [ ] **Step 4: Verify idempotency**

Run: `python -m cardmarket_wants`

Expected: `0 generated, 14 existing, 9 skipped; 0 cards, 0 copies`, no download (the cache is used), and no file modified.

- [ ] **Step 5: Run the full suite now that a cache exists**

Run: `python -m pytest -v`
Expected: PASS, 67 tests — the four real-data tests now run instead of skipping.

- [ ] **Step 6: Write the README**

Create `README.md`:

````markdown
# cardmarket-wants

Generates [Cardmarket](https://www.cardmarket.com) wants-list files for Disney Lorcana sets, ready to paste into
**Buying → My Wants → your list → the paste field → Add**.

Card data comes from [api-lorcana.com](https://api-lorcana.com). Nothing here talks to Cardmarket: their API is
[restricted to professional sellers](https://apiv2.cardmarket.com/ws/documentation/API:Auth_Overview), so this tool produces a
file you paste in yourself.

## Usage

```bash
python -m cardmarket_wants
```

No install, no dependencies, Python 3.11+. One run downloads the card data once, then writes a file for every set that doesn't
already have one. Run it again after a new set releases and only that set is generated.

Output lands in `out/`:

- `out/<set>-wants.txt` — paste this into Cardmarket
- `out/<set>-wants.csv` — the same list as data: number, name, title, rarity, quantity

## Quantities

How many copies of each rarity to want is configuration, not code. Two files ship with the repository:

| File | What it is |
|---|---|
| `default.toml` | What runs when you don't pass `--config`. One common, two uncommon, three rare, four super rare and legendary; secret rarities off. |
| `template.toml` | Every rarity at `0`. A starting point to copy when you want something different. |

**Copy, don't edit.** Both files are tracked in git, so editing them in place means your preferences show up as repository
changes and a `git pull` can conflict with them. Make your own instead:

```bash
cp template.toml mine.toml
# edit mine.toml — raise the rarities you want
python -m cardmarket_wants --config mine.toml
```

Either file is a fine starting point: copy `template.toml` to switch on only what you want, or copy `default.toml` to start
from the standard set and adjust.

A config looks like this:

```toml
[quantities]
common = 1
uncommon = 2
rare = 3
super_rare = 4
legendary = 4

epic = 0
enchanted = 0
iconic = 0
```

`0` means excluded, so wanting one of each Epic is changing `epic = 0` to `epic = 1`. A rarity missing from the file is treated
as `0` too, which is why a rarity introduced in a future set can't break a run.

After changing quantities, regenerate over the top of the old files:

```bash
python -m cardmarket_wants --config mine.toml --force
```

## Options

| Flag | Default | Purpose |
|---|---|---|
| `--config` | `default.toml` | Rarity quantity configuration file |
| `--separator` | `" - "` | Separator between a card's name and its version subtitle |
| `--out-dir` | `out` | Where files are written |
| `--cache` | `.cache/lorcana-cards.json` | Card data cache |
| `--force` | off | Regenerate sets that already have files |
| `--refresh` | off | Re-download the card data |

## Before pasting a whole set

Paste the first five lines first — the tool prints them for every set it generates. Cardmarket reports what it added, what it
couldn't match, and what was already present, so a format problem shows up on five lines instead of two hundred.

Note that the paste format carries no language or condition column. Set those in the Cardmarket UI after importing.

## Tests

```bash
python -m pytest
```

Tests never hit the network. The real-data regression guard in `tests/test_real_data.py` reads the cache written by a normal
run, and skips when there isn't one.
````

- [ ] **Step 7: Commit**

```bash
git add README.md tests/test_real_data.py
git commit -m "Add real data regression guard and README"
```

- [ ] **Step 8: Push**

```bash
git push
```
