"""Build an immutable, blind all-level takeoff review bundle from frozen TSVs + INKP rasters."""

import argparse
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

import overlay


REPO = Path(__file__).resolve().parents[2]
PANEL_SIZE = (1200, 900)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_name(value):
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "review"


def parse_variant(value):
    label, separator, directory = value.partition("=")
    if not separator or not label.strip() or not directory.strip():
        raise argparse.ArgumentTypeError("variant must be NAME=TSV_DIRECTORY")
    path = Path(directory).resolve()
    if not path.is_dir():
        raise argparse.ArgumentTypeError(f"variant directory does not exist: {path}")
    return label.strip(), path


def parse_audit(value):
    label, separator, directory = value.partition("=")
    if not separator or not label.strip() or not directory.strip():
        raise argparse.ArgumentTypeError("audit must be NAME=AUDIT_DIRECTORY")
    path = Path(directory).resolve()
    if not path.is_dir():
        raise argparse.ArgumentTypeError(f"audit directory does not exist: {path}")
    return label.strip(), path


def parse_provenance(value):
    label, separator, filename = value.partition("=")
    if not separator or not label.strip() or not filename.strip():
        raise argparse.ArgumentTypeError("provenance must be NAME=MANIFEST_FILE")
    path = Path(filename).resolve()
    if not path.is_file():
        raise argparse.ArgumentTypeError(f"provenance manifest does not exist: {path}")
    return label.strip(), path


def takeoff_files(directory):
    files = {path.stem.removeprefix("rooms_"): path
             for path in sorted(directory.glob("rooms_*.tsv"))}
    if not files:
        raise ValueError(f"no rooms_*.tsv files in {directory}")
    return files


def level_name(tsv_path):
    with open(tsv_path, encoding="utf-8") as stream:
        for line in stream:
            if line.startswith("META\tlevel\t"):
                return line.rstrip("\r\n").split("\t", 2)[2]
    raise ValueError(f"{tsv_path}: no META level line")


def font(size):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def titled_panel(image, title):
    canvas = Image.new("RGB", (PANEL_SIZE[0], PANEL_SIZE[1] + 44), "white")
    fitted = ImageOps.contain(image, PANEL_SIZE, Image.Resampling.LANCZOS)
    canvas.paste(fitted, ((PANEL_SIZE[0] - fitted.width) // 2,
                          44 + (PANEL_SIZE[1] - fitted.height) // 2))
    ImageDraw.Draw(canvas).text((18, 11), title, fill=(32, 32, 32), font=font(24))
    return canvas


def level_comparison(level, aliases_and_paths):
    panels = []
    for alias, path in aliases_and_paths:
        with Image.open(path) as image:
            panels.append(titled_panel(image.convert("RGB"), alias))
    header = 50
    result = Image.new("RGB", (PANEL_SIZE[0] * len(panels), panels[0].height + header), "white")
    ImageDraw.Draw(result).text((18, 12), level, fill=(20, 20, 20), font=font(26))
    for index, panel in enumerate(panels):
        result.paste(panel, (index * PANEL_SIZE[0], header))
    return result


def contact_sheet(level_paths):
    rows = []
    for path in level_paths:
        with Image.open(path) as image:
            rows.append(image.convert("RGB"))
    width = max(row.width for row in rows)
    result = Image.new("RGB", (width, sum(row.height for row in rows)), "white")
    y = 0
    for row in rows:
        result.paste(row, (0, y))
        y += row.height
    return result


def git_output(*args):
    result = subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def all_hashes(root, excluded=()):
    excluded = set(excluded)
    return {path.relative_to(root).as_posix(): sha256(path)
            for path in sorted(root.rglob("*"))
            if path.is_file() and path.relative_to(root).as_posix() not in excluded}


def seal(root):
    root = Path(root).resolve()
    if not root.is_dir():
        raise SystemExit(f"cannot seal missing directory: {root}")
    path = root / "review-manifest.json"
    if path.exists():
        raise SystemExit(f"root manifest already exists: {path}")
    summary_path = root / "audit" / "summary.json"
    input_path = root / "input-manifest.json"
    if not summary_path.is_file() or not input_path.is_file():
        raise SystemExit("complete review requires audit/summary.json and input-manifest.json")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if summary.get("InputSha256", "").lower() != sha256(input_path).lower():
        raise SystemExit("copied input manifest does not match the audited replay manifest")
    path.write_text(json.dumps({
        "schemaVersion": 1,
        "files": all_hashes(root, {"review-manifest.json"}),
    }, indent=2) + "\n", encoding="utf-8")
    print(path)


def verify(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    root = manifest_path.parent
    failures = []
    for relative, expected in manifest["files"].items():
        path = root / relative
        actual = sha256(path) if path.is_file() else None
        if actual != expected:
            failures.append(f"{relative}: expected {expected}, got {actual or 'missing'}")
    expected_files = set(manifest["files"]) | {manifest_path.name}
    actual_files = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
    for relative in sorted(actual_files - expected_files):
        failures.append(f"{relative}: unexpected file")
    if failures:
        raise SystemExit("bundle verification failed:\n" + "\n".join(failures))
    print(f"verified {len(manifest['files'])} files: {root}")


def validate_provenance(manifest_path, geometry_files):
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    levels = document.get("Levels")
    if not isinstance(levels, list):
        raise SystemExit(f"provenance has no Levels array: {manifest_path}")
    declared = {Path(level["Tsv"]).stem.removeprefix("rooms_"): level["TsvSha256"]
                for level in levels}
    if set(declared) != set(geometry_files):
        raise SystemExit(f"provenance levels do not match geometry: {manifest_path}")
    for slug, path in geometry_files.items():
        if sha256(path).lower() != declared[slug].lower():
            raise SystemExit(f"provenance geometry hash mismatch: {path}")


def validate_ink_manifest(manifest_path, ink_dir, expected_slugs):
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = document.get("inkRasters")
    if not isinstance(entries, list):
        raise SystemExit(f"ink manifest has no inkRasters array: {manifest_path}")
    declared = {Path(entry["path"]).stem.removeprefix("ink_"): entry for entry in entries}
    if set(declared) != set(expected_slugs):
        raise SystemExit("ink manifest levels do not match review geometry")
    for slug, entry in declared.items():
        path = ink_dir / f"ink_{slug}.bin"
        if sha256(path).lower() != entry["sha256"].lower():
            raise SystemExit(f"ink hash mismatch: {path}")


def build(args):
    variants = dict(args.variant)
    if len(variants) != len(args.variant):
        raise SystemExit("variant names must be unique")
    if len(variants) > 26:
        raise SystemExit("at most 26 variants are supported")
    audits = dict(args.audit or [])
    if len(audits) != len(args.audit or []):
        raise SystemExit("audit names must be unique")
    unknown_audits = set(audits) - set(variants)
    if unknown_audits:
        raise SystemExit(f"audits have no matching variant: {sorted(unknown_audits)}")
    provenance = dict(args.provenance or [])
    if len(provenance) != len(args.provenance or []):
        raise SystemExit("provenance names must be unique")
    unknown_provenance = set(provenance) - set(variants)
    if unknown_provenance:
        raise SystemExit(f"provenance has no matching variant: {sorted(unknown_provenance)}")
    if set(provenance) != set(variants):
        raise SystemExit("every variant requires a matching provenance manifest")

    source_files = {label: takeoff_files(directory) for label, directory in variants.items()}
    expected_slugs = set(next(iter(source_files.values())))
    if len(expected_slugs) != args.expected_level_count:
        raise SystemExit(
            f"expected {args.expected_level_count} levels, found {len(expected_slugs)}: "
            f"{sorted(expected_slugs)}")
    for label, files in source_files.items():
        if set(files) != expected_slugs:
            raise SystemExit(f"{label}: level files differ from the other variants")
        validate_provenance(provenance[label], files)

    ink_dir = Path(args.ink_dir).resolve()
    for slug in expected_slugs:
        if not (ink_dir / f"ink_{slug}.bin").is_file():
            raise SystemExit(f"missing ink raster: {ink_dir / f'ink_{slug}.bin'}")
    validate_ink_manifest(Path(args.ink_manifest).resolve(), ink_dir, expected_slugs)

    labels = list(variants)
    random.Random(args.seed).shuffle(labels)
    aliases = {label: chr(ord("A") + index) for index, label in enumerate(labels)}

    if args.out_dir:
        destination = Path(args.out_dir).resolve()
    else:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = REPO / ".artifacts" / "takeoff-runs" / f"review-{stamp}-{safe_name(args.label)}"
    if destination.exists():
        raise SystemExit(f"refusing to overwrite existing bundle: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.parent / f".partial-{destination.name}-{os.getpid()}"
    if staging.exists():
        raise SystemExit(f"staging directory already exists: {staging}")

    try:
        (staging / "inputs" / "ink").mkdir(parents=True)
        (staging / "review" / "levels").mkdir(parents=True)
        (staging / "review" / "variants").mkdir(parents=True)
        (staging / "blind-key.json").write_text(json.dumps({
            "seed": args.seed,
            "aliases": {aliases[label]: label for label in labels},
        }, indent=2) + "\n", encoding="utf-8")
        copied_provenance = {}
        for label, source in provenance.items():
            target = staging / "inputs" / "provenance" / f"{aliases[label]}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied_provenance[label] = target.relative_to(staging).as_posix()

        levels = []
        comparison_paths = []
        for slug in sorted(expected_slugs):
            names = {level_name(files[slug]) for files in source_files.values()}
            if len(names) != 1:
                raise SystemExit(f"{slug}: variants disagree on META level: {sorted(names)}")
            name = names.pop()
            copied_ink = staging / "inputs" / "ink" / f"ink_{slug}.bin"
            shutil.copy2(ink_dir / copied_ink.name, copied_ink)
            blind_paths = []
            variant_entries = []
            for label in labels:
                alias = aliases[label]
                copied_dir = staging / "inputs" / "variants" / alias
                copied_dir.mkdir(parents=True, exist_ok=True)
                copied_tsv = copied_dir / f"rooms_{slug}.tsv"
                shutil.copy2(source_files[label][slug], copied_tsv)

                copied_audit = None
                problem_ids = set()
                problem_segments = []
                problem_points = []
                if label in audits:
                    source_audit = audits[label] / f"audit_{slug}.json"
                    if not source_audit.is_file():
                        raise SystemExit(f"missing audit: {source_audit}")
                    audited_geometry = audits[label] / f"rooms_{slug}.tsv"
                    if not audited_geometry.is_file():
                        raise SystemExit(f"audit has no bound geometry: {audited_geometry}")
                    if sha256(audited_geometry) != sha256(source_files[label][slug]):
                        raise SystemExit(
                            f"stale audit for {label}/{slug}: audited geometry does not match variant")
                    copied_audit = copied_dir / source_audit.name
                    shutil.copy2(source_audit, copied_audit)
                    audit = json.loads(copied_audit.read_text(encoding="utf-8"))
                    detailed_kinds = {
                        "OffFrameEdge", "DiagonalShortcut", "MicroStepRun",
                        "NonRightCorner", "AcuteTip", "Reversal",
                    }
                    problem_ids = {
                        room["RoomId"] for room in audit["Rooms"]
                        if not room["IsStrictlyEditable"]
                        and not any(violation["Kind"] in detailed_kinds
                                    for violation in room["Violations"])
                    }
                    problem_segments = [
                        ((violation["From"]["X"], violation["From"]["Y"]),
                         (violation["To"]["X"], violation["To"]["Y"]))
                        for room in audit["Rooms"] for violation in room["Violations"]
                        if violation["Kind"] in {"OffFrameEdge", "DiagonalShortcut", "MicroStepRun"}
                    ]
                    problem_points = [
                        (violation["At"]["X"], violation["At"]["Y"])
                        for room in audit["Rooms"] for violation in room["Violations"]
                        if violation["Kind"] in {"NonRightCorner", "AcuteTip", "Reversal"}
                    ]

                render_dir = staging / "review" / "variants" / alias
                render_dir.mkdir(parents=True, exist_ok=True)
                blind_path = render_dir / f"blind_{slug}.png"
                disposition_path = render_dir / f"disposition_{slug}.png"
                diagnostic_path = render_dir / f"diagnostic_{slug}.png"
                overlay.render_review(copied_ink, copied_tsv, mode="blind", scale=args.scale).save(blind_path)
                disposition, disposition_accounting = overlay.render_disposition(
                    copied_ink, copied_tsv, scale=args.scale)
                disposition.save(disposition_path)
                overlay.render_review(copied_ink, copied_tsv, mode="diagnostic", scale=args.scale,
                                      problem_ids=problem_ids,
                                      problem_segments=problem_segments,
                                      problem_points=problem_points).save(diagnostic_path)
                blind_paths.append((alias, blind_path))
                variant_entries.append({
                    "alias": alias,
                    "geometry": copied_tsv.relative_to(staging).as_posix(),
                    "blind": blind_path.relative_to(staging).as_posix(),
                    "disposition": disposition_path.relative_to(staging).as_posix(),
                    "dispositionAccounting": disposition_accounting,
                    "diagnostic": diagnostic_path.relative_to(staging).as_posix(),
                    "audit": copied_audit.relative_to(staging).as_posix() if copied_audit else None,
                })

            comparison_path = staging / "review" / "levels" / f"{slug}.png"
            level_comparison(name, blind_paths).save(comparison_path)
            comparison_paths.append(comparison_path)
            levels.append({
                "slug": slug,
                "name": name,
                "ink": copied_ink.relative_to(staging).as_posix(),
                "comparison": comparison_path.relative_to(staging).as_posix(),
                "variants": variant_entries,
            })

        contact_path = staging / "review" / "contact-sheet.png"
        contact_sheet(comparison_paths).save(contact_path)
        manifest = {
            "schemaVersion": 1,
            "createdAtUtc": datetime.now(timezone.utc).isoformat(),
            "label": args.label,
            "blindSeed": args.seed,
            "repository": {
                "head": git_output("rev-parse", "HEAD"),
                "status": git_output("status", "--short"),
            },
            "variants": [{
                "alias": aliases[label],
                "label": label,
                "source": f"inputs/variants/{aliases[label]}",
                "provenance": copied_provenance.get(label),
            } for label in labels],
            "levels": levels,
            "contactSheet": contact_path.relative_to(staging).as_posix(),
            "files": all_hashes(staging),
        }
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        os.replace(staging, destination)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(destination)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", action="append", type=parse_variant,
                        help="repeat NAME=TSV_DIRECTORY (global aliases become A/B/C)")
    parser.add_argument("--audit", action="append", type=parse_audit,
                        help="optional repeat NAME=AUDIT_DIRECTORY; NAME must match a variant")
    parser.add_argument("--provenance", action="append", type=parse_provenance,
                        help="optional repeat NAME=MANIFEST_FILE; copied and hashed into the bundle")
    parser.add_argument("--ink-dir", default=overlay.LIVE,
                        help="directory containing matching ink_<level>.bin rasters")
    parser.add_argument("--ink-manifest",
                        help="manifest whose inkRasters hashes bind the rendered underlay")
    parser.add_argument("--label", default="takeoff-review")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--scale", type=int, choices=range(1, 5), default=2)
    parser.add_argument("--expected-level-count", type=int,
                        help="fail unless every variant contains exactly this many levels")
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--verify", default=None, metavar="MANIFEST")
    parser.add_argument("--seal-root", default=None, metavar="DIRECTORY")
    args = parser.parse_args()
    if args.verify:
        verify(args.verify)
        return
    if args.seal_root:
        seal(args.seal_root)
        return
    if not args.variant:
        parser.error("at least one --variant is required")
    if args.expected_level_count is None:
        parser.error("--expected-level-count is required when building a bundle")
    if not args.ink_dir:
        parser.error("--ink-dir is required when no live takeoff directory exists")
    if not args.ink_manifest:
        parser.error("--ink-manifest is required when building a bundle")
    build(args)


if __name__ == "__main__":
    main()
