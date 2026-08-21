"""Diff two zone-promotion reports: per-zone deltas, aggregate lines, and the options diff.

    python eval/rhvac/compare-zone-runs.py A/report.json B/report.json --out-dir compare-out

This is a report, not a gate: it always exits 0. With --out-dir it writes compare.md and
side-by-side A/B panels for zones whose accepted count, area, or boundary geometry changed.
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))  # render-zone-promotion.py imports overlay
_spec = importlib.util.spec_from_file_location(
    "render_zone_promotion", Path(__file__).with_name("render-zone-promotion.py"))
rzp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rzp)

MATERIAL = 0.05


def load(path):
    report_path = Path(path).resolve()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    zones = {zone["Zone"]: zone for zone in report.get("Zones", [])}
    return report_path, report, zones


def sqft(value):
    return f"{value:+.1f}" if round(value, 1) else "0"


def count(value):
    return f"{value:+d}" if value else "0"


def moved(before, after):
    """Relative move past MATERIAL, with any 0 -> nonzero step counting as material."""
    if before == after:
        return False
    if not before:
        return True
    return abs(after - before) / abs(before) > MATERIAL


def accepted_boundaries(root, zone):
    return rzp.overlay.load_disposition_tsv(root / zone["Tsv"])[1] if zone else {}


def zone_row(key, left, right):
    def delta(name):
        return (right.get(name, 0) or 0) - (left.get(name, 0) or 0)

    rejections = {}
    for name in set(rzp.field(left, "Rejections") or {}) | set(rzp.field(right, "Rejections") or {}):
        change = ((rzp.field(right, "Rejections") or {}).get(name, 0)
                  - (rzp.field(left, "Rejections") or {}).get(name, 0))
        if change:
            rejections[name] = change
    left_verdict = rzp.triage_of(left)[0] if left else "-"
    right_verdict = rzp.triage_of(right)[0] if right else "-"
    triage = "" if left_verdict == right_verdict else f"{left_verdict} -> {right_verdict}"
    areas = [delta("AcceptedSqft"), delta("HeldSqft"), delta("ExcludedSqft")]
    counts = [delta("AcceptedRooms"), delta("HeldRooms"), delta("RawRooms")]
    if not any(round(value, 1) for value in areas) and not any(counts) \
            and not rejections and not triage:
        return None
    presence = "" if left and right else ("only B" if right else "only A")
    return [
        key,
        *(sqft(value) for value in areas),
        *(count(value) for value in counts),
        ", ".join(f"{name} {change:+d}" for name, change in sorted(rejections.items())) or "-",
        triage or presence or "-",
    ]


def options_diff(left, right):
    left_options = rzp.field(left, "options") or {}
    right_options = rzp.field(right, "options") or {}
    rows = []
    for key in sorted(set(left_options) | set(right_options)):
        before, after = left_options.get(key), right_options.get(key)
        if before != after:
            rows.append((key, before, after))
    return rows


def table(header, rows):
    widths = [max(len(str(row[index])) for row in [header, *rows])
              for index in range(len(header))]
    lines = ["| " + " | ".join(str(cell).ljust(widths[index])
                               for index, cell in enumerate(header)) + " |",
             "| " + " | ".join("-" * widths[index] for index in range(len(header))) + " |"]
    for row in rows:
        lines.append("| " + " | ".join(str(cell).ljust(widths[index])
                                       for index, cell in enumerate(row)) + " |")
    return lines


def ab_panel(root, zone, label):
    if zone is None:
        panel = Image.new("RGB", (900, 700), "white")
        ImageDraw.Draw(panel).text((300, 330), f"{label}: zone absent",
                                   fill=(150, 150, 150), font=rzp.font(24))
        return panel
    panel = rzp.render_zone(root, zone, None)
    draw = ImageDraw.Draw(panel)
    draw.text((820, 676), label, fill=(120, 120, 120), font=rzp.font(18))
    return panel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report_a")
    parser.add_argument("report_b")
    parser.add_argument("--out-dir")
    args = parser.parse_args()

    path_a, report_a, zones_a = load(args.report_a)
    path_b, report_b, zones_b = load(args.report_b)
    keys = sorted(set(zones_a) | set(zones_b))

    header = ["zone", "acc sf", "held sf", "excl sf", "acc rooms", "held rooms", "raw rooms",
              "rejections", "triage"]
    rows = [row for row in (zone_row(key, zones_a.get(key, {}), zones_b.get(key, {}))
                            for key in keys) if row]

    lines = [f"# zone-run compare", "",
             f"A: {path_a}", f"B: {path_b}", "",
             f"zones: {len(keys)} union   changed: {len(rows)}", ""]
    lines += table(header, rows) if rows else ["_no per-zone deltas_"]
    lines += ["", "## aggregate", ""]
    for label, report in (("A", report_a), ("B", report_b)):
        for line in rzp.header_lines(report):
            lines.append(f"{label}: {line}")
    lines += ["", "## options", "",
              f"A optionsHash: {rzp.field(report_a, 'optionsHash', default='-')}",
              f"B optionsHash: {rzp.field(report_b, 'optionsHash', default='-')}", ""]
    diff = options_diff(report_a, report_b)
    lines += ([f"{key}: {before} -> {after}" for key, before, after in diff]
              if diff else ["_no option differences_"])

    text = "\n".join(lines)
    print(text)

    if not args.out_dir:
        return
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "compare.md").write_text(text + "\n", encoding="utf-8")

    written = 0
    for index, key in enumerate(keys):
        left, right = zones_a.get(key), zones_b.get(key)
        if not (moved((left or {}).get("AcceptedRooms", 0), (right or {}).get("AcceptedRooms", 0))
                or moved((left or {}).get("AcceptedSqft", 0.0),
                         (right or {}).get("AcceptedSqft", 0.0))
                or accepted_boundaries(path_a.parent, left)
                != accepted_boundaries(path_b.parent, right)):
            continue
        panel_a = ab_panel(path_a.parent, left, "A")
        panel_b = ab_panel(path_b.parent, right, "B")
        pair = Image.new("RGB", (panel_a.width + panel_b.width + 8,
                                 max(panel_a.height, panel_b.height)), (200, 200, 200))
        pair.paste(panel_a, (0, 0))
        pair.paste(panel_b, (panel_a.width + 8, 0))
        name = key.replace(" ", "_").replace("#", "_")
        pair.save(out_dir / f"{index + 1:02d}_{name}_ab.png")
        written += 1
    print(f"\n{out_dir}   compare.md + {written} a/b panels")


if __name__ == "__main__":
    main()
