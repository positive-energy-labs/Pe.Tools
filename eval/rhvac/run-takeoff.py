# Takeoff -> candidate loop driver: runs RoomTakeoff Prepare+Detect per level in a connected
# Revit session (via the pea host's HTTP /call), then copies emitted TSVs to an explicit
# artifact directory. Fixture promotion is a separate reviewed step.
#
#   python eval/rhvac/run-takeoff.py --port 57108 --session <bridge-session-id> --project project-a \
#       --levels "Lower Level" "Main Level" "Upper Level" "Attic" --out-dir <new-artifact-dir>
#
# The port is the target host's HTTP port: `pe-revit service list` shows live hosts; if a live
# host's service file was swept (it happens), pass --port explicitly. The Revit session must
# already have the model open (revit.apply.document.open). See
# source/Pe.Revit.Takeoff/README.md.
import argparse, atexit, glob, json, os, shutil, sys, urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True, help="pea host HTTP port")
parser.add_argument("--session", required=True, help="target Revit bridge session id")
parser.add_argument("--project", default="project-a", help="eval fixture folder name")
parser.add_argument("--levels", nargs="+", required=True, help="LevelNameContains per takeoff run")
parser.add_argument("--detect-only", action="store_true", help="skip Prepare (seed views already exist)")
parser.add_argument("--out-dir", required=True,
                    help="new artifact directory for captured TSVs; fixtures are never overwritten")
args = parser.parse_args()

BASE = f"http://127.0.0.1:{args.port}"
snapshot_dir = os.path.abspath(args.out_dir)
if os.path.exists(snapshot_dir):
    raise SystemExit(f"--out-dir already exists: {snapshot_dir}")
os.makedirs(os.path.dirname(snapshot_dir), exist_ok=True)
staging_dir = os.path.join(
    os.path.dirname(snapshot_dir), f".partial-{os.path.basename(snapshot_dir)}-{os.getpid()}")
if os.path.exists(staging_dir):
    raise SystemExit(f"staging directory already exists: {staging_dir}")
os.makedirs(staging_dir)
atexit.register(lambda: shutil.rmtree(staging_dir, ignore_errors=True))

def run_script(name, content, mode, timeout):
    body = json.dumps({"key": "scripting.execute", "request": {
        "scriptContent": content, "permissionMode": mode,
        "timeoutSeconds": timeout, "sourceName": name,
    }}).encode()
    req = urllib.request.Request(f"{BASE}/call", data=body, headers={
        "content-type": "application/json",
        "x-pe-bridge-session-id": args.session,
    })
    with urllib.request.urlopen(req, timeout=timeout + 60) as resp:
        return json.load(resp)

def check(result, phase, level):
    status = result.get("status")
    print(f"{phase} {level}: {status} {json.dumps(result.get('data'))}", flush=True)
    if status != "Succeeded":
        for d in result.get("diagnostics", []):
            if d["severity"] == "Error":
                print(f"  ERROR {d['message'][:300]}", flush=True)
        sys.exit(1)
    return result


emitted_levels = []
for level in args.levels:
    if not args.detect_only:
        check(run_script(
            f"prepare-{level}.cs",
            f'Pe.Revit.Takeoff.RoomTakeoff.Prepare(doc, new Pe.Revit.Takeoff.TakeoffOptions {{ LevelNameContains = "{level}" }}, WriteLine);',
            "WriteTransaction", 600), "PREPARE", level)
    detected = check(run_script(
        f"detect-{level}.cs",
        f'var r = Pe.Revit.Takeoff.RoomTakeoff.Detect(doc, "{level}", WriteLine);\n'
        f'Result(new {{ level = r.LevelName, rooms = r.Rooms.Count, totalSqft = r.TotalSqft }});',
        "ReadOnly", 1800), "DETECT", level)
    emitted_levels.append(detected["data"]["level"])

# Copy live output into the requested artifact directory. Re-detection can renumber room ids;
# fixture promotion must therefore remain an explicit reviewed operation.
# room-map.json curation binds to the snapshot — recurate after meaningful detection changes.
takeoff_dir = next(d for d in [
    os.path.expanduser(r"~\OneDrive\Documents\Pe.Tools\takeoff"),
    os.path.expanduser(r"~\Documents\Pe.Tools\takeoff"),
] if glob.glob(os.path.join(d, "rooms_*.tsv")))

tsvs = [os.path.join(takeoff_dir, "rooms_" + "".join(
    ch if ch.isalnum() else "_" for ch in level) + ".tsv") for level in emitted_levels]
for tsv in tsvs:
    with open(tsv, encoding="utf-8") as src:
        content = src.read()
    with open(os.path.join(staging_dir, os.path.basename(tsv)), "w", encoding="utf-8") as dst:
        dst.write(content)
os.replace(staging_dir, snapshot_dir)

print(f"{len(tsvs)} takeoff TSVs -> {snapshot_dir}", flush=True)
print("next: pwsh eval/rhvac/review.ps1 -SnapshotManifest <manifest> "
      "-OutputDirectory <new-review-dir>", flush=True)
