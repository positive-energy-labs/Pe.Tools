# Takeoff -> candidate loop driver: runs RoomTakeoff Prepare+Detect per level in a connected
# Revit session (via the pea host's HTTP /call), then refreshes the committed TSV snapshot that
# RhvacProjectAEvalRun converts and scores offline.
#
#   python eval/rhvac/run-takeoff.py --port 57108 --session <bridge-session-id> --project project-a \
#       --levels "Lower Level" "Main Level" "Upper Level" "Attic"
#
# The port is the target host's HTTP port: `pe-revit service list` shows live hosts; if a live
# host's service file was swept (it happens), pass --port explicitly. The Revit session must
# already have the model open (revit.apply.document.open). See
# source/Pe.Revit.Takeoff/Rhvac/README.md "Eval harness".
import argparse, glob, json, os, sys, urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True, help="pea host HTTP port")
parser.add_argument("--session", required=True, help="target Revit bridge session id")
parser.add_argument("--project", default="project-a", help="eval fixture folder name")
parser.add_argument("--levels", nargs="+", required=True, help="LevelNameContains per takeoff run")
parser.add_argument("--detect-only", action="store_true", help="skip Prepare (seed views already exist)")
args = parser.parse_args()

BASE = f"http://127.0.0.1:{args.port}"
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURE = os.path.join(REPO, "eval", "rhvac", args.project)

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

# Per-level detection policy (2026-07-24 falsification pass, all live-measured on projectA):
# flat-ceiling levels take RequireCeiling + both door sealers and drop the compactness kill-gate;
# Upper Level raises the ceiling-search cap for double-height rooms; the attic keeps RequireCeiling
# OFF (framing-stage roof geometry shatters the per-cell ceiling mask — see eval/rhvac/HANDOFF.md).
FLAT = "RequireCeiling = true, SealDoorHeads = true, SealWallRunGaps = true, MinCompactness = 0"
LEVEL_POLICY = {
    "Lower Level": FLAT,
    "Main Level": FLAT,
    "Upper Level": FLAT + ", StoryCapFt = 26",
    # Attic covered-space model: close the patchy rafter ceiling mask, search high enough for the
    # ridge, keep knee-wall area (headroom 3.5), lintel-seal doors. Wall-run sealing measurably
    # fragments knee-wall areas — deliberately absent. 49 rooms / 5,662 sf vs oracle 5,758 (98%).
    "Attic": "RequireCeiling = true, CeilingCloseFt = 3, StoryCapFt = 30, MinHeadroomFt = 3.5, "
             "SealDoorHeads = true, MinCompactness = 0",
}

for level in args.levels:
    if not args.detect_only:
        check(run_script(
            f"prepare-{level}.cs",
            f'Pe.Revit.Takeoff.RoomTakeoff.Prepare(doc, new Pe.Revit.Takeoff.TakeoffOptions {{ LevelNameContains = "{level}" }}, WriteLine);',
            "WriteTransaction", 600), "PREPARE", level)
    policy = next((v for k, v in LEVEL_POLICY.items() if k in level), "")
    opts = f'new Pe.Revit.Takeoff.TakeoffOptions {{ {policy} }}' if policy else "null"
    check(run_script(
        f"detect-{level}.cs",
        f'var r = Pe.Revit.Takeoff.RoomTakeoff.Detect(doc, "{level}", WriteLine, {opts});\n'
        f'Result(new {{ level = r.LevelName, rooms = r.Rooms.Count, totalSqft = r.TotalSqft }});',
        "ReadOnly", 1800), "DETECT", level)

# Refresh the committed TSV snapshot: the C# RhvacCandidateBuilder consumes these offline, so
# Revit is only needed when detection output changes. NOTE: re-detection can renumber room ids;
# room-map.json curation binds to the snapshot — recurate after meaningful detection changes.
takeoff_dir = next(d for d in [
    os.path.expanduser(r"~\OneDrive\Documents\Pe.Tools\takeoff"),
    os.path.expanduser(r"~\Documents\Pe.Tools\takeoff"),
] if glob.glob(os.path.join(d, "rooms_*.tsv")))

snapshot_dir = os.path.join(FIXTURE, "takeoff")
os.makedirs(snapshot_dir, exist_ok=True)
copied = 0
for tsv in sorted(glob.glob(os.path.join(takeoff_dir, "rooms_*.tsv"))):
    with open(tsv, encoding="utf-8") as src:
        content = src.read()
    with open(os.path.join(snapshot_dir, os.path.basename(tsv)), "w", encoding="utf-8") as dst:
        dst.write(content)
    copied += 1

print(f"{copied} takeoff TSVs -> {snapshot_dir}", flush=True)
print("next: dotnet test source/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests "
      '--filter "FullyQualifiedName~RhvacProjectAEvalRun" -v q --nologo', flush=True)
