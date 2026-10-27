"""Offline observed-build journal phases. Never contacts Revit or any URL."""
import argparse
import datetime as dt
import hashlib
import json
import re
import statistics
import time
from pathlib import Path

URL = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://[^\s\"'<>]+")
STAMP = re.compile(r"(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}:\d{2}:\d{2}\.\d+)")
MONTHS = {name: i + 1 for i, name in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}
NUMBER = r"([0-9]+(?:\.[0-9]+)?)"
LIMITS = ["Observed Revit 2025.4.6 journal grammar; other builds unproven.",
          "First observed opening is not a cold-process or immediate-post-file-open claim.",
          "Naive local journal clocks have no UTC offset; no timezone conversion is inferred.",
          "Internal reported durations may overlap or nest: never add them.",
          "ViewOpen, drawing diagnostics and idle are not API, Ready, responsiveness or pixel-completion contracts.",
          "No clean baseline or document/deletion causality follows; CU/CPU and saved-source confounds remain external evidence."]


def clean(text):
    return URL.sub("[remote-url-redacted]", text)[:1600]


def timestamp(text):
    match = STAMP.search(text)
    if not match:
        return None
    day, month, year, clock = match.groups()
    try:
        return dt.datetime.strptime(f"{year}-{MONTHS[month.title()]:02}-{day} {clock}", "%Y-%m-%d %H:%M:%S.%f").isoformat(timespec="milliseconds")
    except (ValueError, KeyError):
        return None


def elapsed(start, end):
    if not start or not end:
        return None
    value = (dt.datetime.fromisoformat(end) - dt.datetime.fromisoformat(start)).total_seconds()
    return round(value, 6) if value >= 0 else None


def parse_journal(path, *, browser_path=None, max_bytes=32*1024*1024, max_lines=500000,
                  max_seconds=10, max_openings=100, max_records=1000):
    path = Path(path)
    result = {"schemaVersion": 1, "status": "completed", "source": {"path": str(path.resolve()), "releaseHeader": None, "buildHeader": None},
              "limits": LIMITS, "diagnostics": [], "openings": []}
    start = time.monotonic()
    digest = hashlib.sha256()
    scanned = 0
    lines = 0
    record_count = 0
    latest = None
    latest_line = None
    current = None
    pending_brackets = []

    def finish(reason, line, truncated=False):
        nonlocal current, pending_brackets
        if current is None:
            return
        current["end"] = {"reason": reason, "line": line}
        records = current["records"]
        opens = [r for r in records if r["kind"] == "view-open"]
        unique = len(opens) == 1 and not truncated and current["browserPath"] is not None and not current.get("associationAmbiguous", False)
        if not unique:
            current["diagnostics"].append("Missing/ambiguous ViewOpen, missing exact browser path, or truncated association window; paired metrics are null.")
        marker = opens[0] if unique else None
        ids = sorted({r["targetViewId"] for r in records if "targetViewId" in r and marker and r["line"] > marker["line"]})
        if len(ids) > 1:
            current["diagnostics"].append("Multiple target IDs in association window; target identity is ambiguous.")
            marker = None
        current["targetViewId"] = ids[0] if marker and len(ids) == 1 else None
        drawing = [r for r in records if r["kind"] == "drawing-total" and marker and r["line"] > marker["line"]]
        if len(drawing) > 1:
            current["diagnostics"].append("Multiple drawing-total records; drawing metric is null.")
        idle = next((r for r in records if r["kind"] == "idle" and marker and r["line"] > marker["line"]), None)
        current["metrics"] = {
            "browserToViewOpenJournalSeconds": elapsed(current["browserTimestampLocal"], marker["timestampLocal"]) if marker else None,
            "createNewCViewReportedSeconds": marker.get("fields", {}).get("TimeSpent_createNewCView") if marker else None,
            "updateAllGRepsReportedSeconds": marker.get("fields", {}).get("TimeSpent_updateAllGReps") if marker else None,
            "drawingReportedSeconds": drawing[0]["reportedSeconds"] if len(drawing) == 1 else None,
            "browserToFirstJournalIdleSeconds": elapsed(current["browserTimestampLocal"], idle["timestampLocal"]) if idle else None,
            "pixelCompletionSeconds": None, "readyCompletionSeconds": None, "durationsAdditive": False}
        if browser_path is None or current["browserPath"] == browser_path:
            result["openings"].append(current)
        current = None
        pending_brackets = []

    def record(kind, n, text, **fields):
        nonlocal record_count
        if record_count >= max_records:
            raise ValueError("record limit reached")
        own = timestamp(text)
        # Only an immediately adjacent timestamp is assigned to an untimestamped ViewOpen.
        assigned = own or (latest if kind == "view-open" and latest_line == n - 1 else None)
        row = {"kind": kind, "line": n, "raw": clean(text.rstrip()), "timestampLocal": assigned,
               "timestampSourceLine": n if own else latest_line if assigned else None,
               "precedingTimestampLocal": latest, "followingTimestampLocal": None, **fields}
        current["records"].append(row)
        record_count += 1
        if not own:
            pending_brackets.append(row)
        return row

    try:
        before = path.stat()
        result["source"].update(sizeBytes=before.st_size, mtimeNs=before.st_mtime_ns)
        with path.open("rb") as stream:
            while True:
                if scanned >= max_bytes or lines >= max_lines or time.monotonic()-start > max_seconds:
                    if scanned < before.st_size:
                        raise ValueError("input byte/line/time budget reached")
                    break
                raw = stream.readline(min(65537, max_bytes-scanned))
                if not raw:
                    break
                scanned += len(raw)
                digest.update(raw)
                lines += 1
                if lines == 1 and raw.startswith((b"\xff\xfe", b"\xfe\xff")):
                    raise ValueError("UTF-16 journal unsupported; supply a separate decoded UTF-8 copy")
                if len(raw) > 65536:
                    raise ValueError("line exceeds 65536-byte limit")
                text = raw.decode("utf-8-sig", errors="replace")
                if lines <= 300:
                    header = re.search(r"^\s*'\s*(Build|Release):\s*([0-9][0-9A-Za-z. _()-]{1,70})\s*$", text, re.I)
                    if header:
                        result["source"][header.group(1).lower()+"Header"] = {"line": lines, "value": header.group(2).strip(), "raw": clean(text.rstrip())}
                if "\ufffd" in text and "invalid UTF-8 replaced" not in result["diagnostics"]:
                    result["diagnostics"].append("invalid UTF-8 replaced")
                stamp = timestamp(text)
                if stamp:
                    for row in pending_brackets:
                        row["followingTimestampLocal"] = stamp
                    pending_brackets = []
                    latest, latest_line = stamp, lines
                elif STAMP.search(text):
                    result["diagnostics"].append(f"Invalid timestamp at line {lines}")
                double = re.match(r'^\s*Jrn\.Browser\s+"LButtonDblClk"', text)
                command = re.match(r'^\s*Jrn\.(?:Command|RibbonEvent|Browser|ViewActivate)\b', text)
                if double or command:
                    finish("next-command-or-transition", lines)
                if double:
                    if len(result["openings"]) >= max_openings:
                        raise ValueError("opening limit reached")
                    current = {"browserLine": lines, "browserRaw": clean(text.rstrip()), "browserPath": None,
                               "browserTimestampLocal": latest if latest_line == lines-1 else None,
                               "browserTimestampSourceLine": latest_line if latest_line == lines-1 else None,
                               "document": None, "activationTitle": None, "records": [], "diagnostics": []}
                    continue
                if current is None:
                    continue
                if current["browserPath"] is None and lines-current["browserLine"] <= 4:
                    match = re.search(r'"(>>[^"\r\n]+>>)"', text)
                    if match:
                        current["browserPath"] = clean(match.group(1))
                if "[Jrn.Activate]" in text:
                    title = re.search(r'ViewTitleExpression:\s*(.*)', text)
                    if title:
                        value = clean(title.group(1).strip())
                        if current["activationTitle"] and value != current["activationTitle"]:
                            finish("view-transition", lines)
                            continue
                        current["activationTitle"] = value
                        expected = current["browserPath"].rstrip("> ").split(">>")[-1] if current["browserPath"] else None
                        if expected and not value.endswith(expected):
                            current["associationAmbiguous"] = True
                            current["diagnostics"].append("Activation title disagrees with exact browser path; paired metrics are null.")
                    match = re.search(r'DocumentExpression:\s*"([^"\r\n]+)"', text)
                    if match:
                        doc = clean(match.group(1))
                        if current["document"] and doc != current["document"]:
                            finish("document-transition", lines)
                            continue
                        current["document"] = doc
                if "[Jrn.ViewOpen]" in text:
                    fields = {k: float(v) for k, v in re.findall(r'Rvt\.Attr\.(TimeSpent_\w+):\s*'+NUMBER, text)}
                    record("view-open", lines, text, fields=fields)
                elif "idle0_doc" in text:
                    record("idle", lines, text)
                elif re.search(r'DBView\w* id=(\d+)', text):
                    record("target-id", lines, text, targetViewId=int(re.search(r'DBView\w* id=(\d+)', text).group(1)))
                elif re.search(r'^\s*\'\s*'+NUMBER+r'.*drawing/ALL_GAPS', text):
                    value = re.search(r'^\s*\'\s*'+NUMBER, text)
                    record("drawing-total", lines, text, reportedSeconds=float(value.group(1)))
                elif any(word in text for word in ("updateGReps ", "generating greps", "BIG_GAP", "Element expansion used", "ElapsedTime_createNWCDrawing")):
                    record("named-phase", lines, text)
                elif any(word in text.lower() for word in ("exception", "could not acquire lock", "drawregion() failed", "silhouette")):
                    record("diagnostic", lines, text)
        finish("end-of-file", lines)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            result["status"] = "partial"
            result["diagnostics"].append("Source changed during read; this is not a frozen-file observation.")
            for opening in result["openings"]:
                opening["targetViewId"] = None
                opening["metrics"] = {key: False if key == "durationsAdditive" else None for key in opening["metrics"]}
    except (OSError, ValueError) as error:
        result["status"] = "partial"
        result["diagnostics"].append(clean(str(error)))
        finish("read-boundary", lines, truncated=True)
    result["source"].update(scannedBytes=scanned, scannedLines=lines, scannedPrefixSha256=digest.hexdigest(),
                            complete=result["status"] == "completed", clock="local text; UTC offset unknown")
    metrics = ("browserToViewOpenJournalSeconds", "createNewCViewReportedSeconds", "drawingReportedSeconds", "browserToFirstJournalIdleSeconds")
    result["summary"] = {key: {"sampleCount": len(values), "medianSeconds": statistics.median(values) if values else None,
                                "samplesSeconds": values} for key in metrics
                         for values in [[o["metrics"][key] for o in result["openings"] if o["metrics"][key] is not None]]}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("journal", type=Path)
    parser.add_argument("output", type=Path, help="Explicit NEW JSON path; parent must exist")
    parser.add_argument("--browser-path", help="Exact >> browser path to select, not a substring")
    parser.add_argument("--max-bytes", type=int, default=32*1024*1024)
    parser.add_argument("--max-lines", type=int, default=500000)
    parser.add_argument("--max-seconds", type=float, default=10)
    parser.add_argument("--max-output-bytes", type=int, default=2*1024*1024)
    args = parser.parse_args()
    if URL.search(str(args.journal)):
        parser.error("Supply an explicit local journal filepath, not a URL")
    if not (1 <= args.max_bytes <= 128*1024*1024 and 1 <= args.max_lines <= 2000000 and
            0 < args.max_seconds <= 60 and 16384 <= args.max_output_bytes <= 10*1024*1024):
        parser.error("Bounds: 1..128 MiB input, 1..2M lines, >0..60s, 16 KiB..10 MiB output")
    if args.output.exists() or args.journal.resolve() == args.output.resolve():
        parser.error("Output must be a new path distinct from the journal")
    result = parse_journal(args.journal, browser_path=args.browser_path, max_bytes=args.max_bytes,
                           max_lines=args.max_lines, max_seconds=args.max_seconds)
    data = json.dumps(result, indent=2, ensure_ascii=True).encode("utf-8")
    if len(data) > args.max_output_bytes:
        result = {"status": "output-budget-exceeded", "source": result["source"], "openings": [],
                  "diagnostics": ["Output omitted; select one exact browser path or reduce the input window."], "limits": LIMITS}
        data = json.dumps(result, indent=2).encode("utf-8")
    try:
        with args.output.open("xb") as stream:
            stream.write(data)
    except OSError as error:
        parser.error(clean(str(error)))
    print(json.dumps({"status": result["status"], "output": str(args.output), "openingCount": len(result["openings"])}))
    return 0 if result["status"] == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
