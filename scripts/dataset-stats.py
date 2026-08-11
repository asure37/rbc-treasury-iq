#!/usr/bin/env python3
"""Measure the dataset. Every number the handbook quotes about coverage comes from here.

    python3 scripts/dataset-stats.py

Run it after any change to data/banks/*.json and update HANDBOOK.md §1 if the
numbers move. The project's governing rule is that no figure is asserted without
a way to reproduce it -- that applies to the documentation's own numbers too.
"""

import json
import glob
import re
import collections
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A note whose text admits the figure was computed rather than read off a page.
# This free-text regex is the ONLY signal distinguishing derived from quoted --
# see HANDBOOK.md §12, "Derived figures".
DERIVED_RE = re.compile(r"computed|derived|calculated|divided by", re.I)

# Families that are inherently a ratio of two inputs. Some issuers publish these
# directly and some do not, so a value here is *potentially* derived -- the count
# is the upper bound on what a structured derivations table would need to cover.
RATIO_FAMILIES = {
    "loansToAssetsPct",
    "loanToDepositRatio",
    "wholesaleFundingPct",
    "efficiencyRatio",
    "irrbbNiiSensitivityPct",
    "irrbbEveSensitivityPct",
}

# Quarter markers as they appear in the six issuers' filenames, most specific first:
#   .../2026q2_report.pdf      .../q2-2026-supp.pdf      .../q225_supp.pdf
QUARTER_PATTERNS = [
    (re.compile(r"(20\d\d)[_\-/]?q([1-4])", re.I), "yq"),
    (re.compile(r"q([1-4])[_\-]?(20\d\d)", re.I), "qy"),
    (re.compile(r"q([1-4])[_\-]?(\d\d)(?!\d)", re.I), "qy2"),
]


def quarter_of_url(url):
    """(year, quarter) the document's filename advertises, or None if it carries no marker."""
    for pattern, kind in QUARTER_PATTERNS:
        m = pattern.search(url)
        if not m:
            continue
        a, b = m.groups()
        if kind == "yq":
            return int(a), int(b)
        year = int(b)
        return (year + 2000 if year < 100 else year), int(a)
    return None


def main():
    bank_files = sorted(glob.glob(os.path.join(ROOT, "data", "banks", "*.json")))
    if not bank_files:
        sys.exit("No bank files found -- run this from the repo root.")

    meta = json.load(open(os.path.join(ROOT, "data", "metrics-meta.json")))
    metric_keys = [m["key"] for m in (meta["metrics"] if isinstance(meta, dict) else meta)]

    cells = filled = refs = with_page = with_anchor = with_search = notes = 0
    derived = 0
    cross_quarter = no_marker = 0
    derived_families = collections.Counter()
    ratio_family_values = collections.Counter()
    populated_keys = set()
    docs = set()
    undated_docs = set()
    quarters_per_bank = []

    for path in bank_files:
        bank = json.load(open(path))
        quarters_per_bank.append(len(bank["quarters"]))
        for q in bank["quarters"]:
            period_q, period_y = int(q["period"][1]), int(q["period"].split()[1])

            for key in metric_keys:
                cells += 1
                if q["metrics"].get(key) is not None:
                    filled += 1

            for key, value in q["metrics"].items():
                if value is None:
                    continue
                populated_keys.add(key)
                if key in RATIO_FAMILIES:
                    ratio_family_values[key] += 1

            for key, note in (q.get("notes") or {}).items():
                notes += 1
                if q["metrics"].get(key) is not None and DERIVED_RE.search(note):
                    derived += 1
                    derived_families[key] += 1

            for key, ref in (q.get("sourceRefs") or {}).items():
                refs += 1
                if ref.get("page"):
                    with_page += 1
                if ref.get("anchorText"):
                    with_anchor += 1
                if ref.get("searchText"):
                    with_search += 1
                url = ref.get("url") or q["reportUrl"]
                docs.add(url)
                found = quarter_of_url(url)
                if found is None:
                    no_marker += 1
                    undated_docs.add(url)
                elif found != (period_y, period_q):
                    cross_quarter += 1

    hosts = collections.Counter(u.split("/")[2] for u in docs)

    print(f"Banks                    {len(bank_files)}")
    print(f"Quarters per bank        {set(quarters_per_bank)}")
    print(f"Metrics defined          {len(metric_keys)}")
    print(f"Populated values         {filled} of {cells} ({round(100 * filled / cells)}%)")
    print(f"Source references        {refs}")
    print(f"  with a page number     {with_page}")
    print(f"  with a search value    {with_search}")
    print(f"  with a label anchor    {with_anchor}")
    print(f"Per-metric notes         {notes}")
    print(f"Distinct cited docs      {len(docs)}")
    print(f"  all on issuer domains  {sorted(hosts)}")
    unregistered = sorted(populated_keys - set(metric_keys))
    if unregistered:
        print(f"Populated but absent from metrics-meta.json:")
        for key in unregistered:
            print(f"    {key}")
    print()

    ratio_total = sum(ratio_family_values.values())
    print(f"Notes admitting a computed figure   {derived} across {len(derived_families)} families")
    for key, n in derived_families.most_common():
        print(f"    {key:<34}{n:>5} of {ratio_family_values.get(key, n)} populated")
    print(f"Values in ratio families overall    {ratio_total}")
    print(f"  -> {ratio_total - derived} carry no note either way (see HANDBOOK.md §12)")
    print()
    print(f"Refs citing a doc labelled for another quarter   {cross_quarter}")
    print(f"Refs pointing at an undated document            {no_marker}"
          f"  ({len(undated_docs)} distinct annual reports)")


if __name__ == "__main__":
    main()
