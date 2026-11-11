"""The machine: what holds it, whether a heavy step may start, and a receipted stop.

usage: python machine.py admit <kind> [--json]   ADMIT, HOLD, or REFUSE (suite in a delegated child); exit 0, 3 or 4
       python machine.py who [--all] [--json]     every process this repo's work can attribute, biggest first
       python machine.py stop <pid> [<pid>...]    stop processes `who` marks stoppable; refuses the rest; writes a receipt
       python machine.py prune [--dry]            stop every editor and bystander app; `admit` does this itself before it answers HOLD

kinds: light (one package tsc, touched tests, one C# build, a guard)
       codegen (route-graphs or a multi-package tsc; measured ~2 GiB per run, so the suite floor; children may run it)
       suite (full vitest or workspace tsc, a whole C# test project)
       revit-test (pe-revit test, one Revit, no host)
       browser (dev host + web + one Chrome, no Revit)
       revit-drive (one Revit + host + web + Chrome, all cold; a driver whose Revit is already up asks for browser)

Floors come from the 2026-11-03 machine budget: measured footprint plus about 2 GiB headroom.
`stop` never touches Revit (pe-revit session owns it), the installed product host, T3, Claude, Codex, or Helium.
Owner, 2026-11-10: while a run is on, most of the machine is killable, and Helium is the one app that always stays up. So editors
(Zed, VS Code and their language servers) and bystander apps (ChatGPT, Edge, a Chrome that is not Helium) are stoppable, and a
memory HOLD prunes them before it is reported. Unknown processes stay untouched: a kill list is safer than a keep list on Windows.
Receipts: .artifacts/machine/stops.jsonl in the root checkout, one line per stop, with the caller's T3 thread.
"""
import ctypes
import datetime as dt
import json
import os
import re
import subprocess
import sys

FLOORS_GIB = {"light": 6, "codegen": 8, "suite": 8, "revit-test": 8, "browser": 8, "revit-drive": 14}
REVIT_CAP = 3  # owner, 2026-11-10: "3 is probably a reasonable limit for normal use"
STOP_GIB = 4  # below this, finish the in-flight step and start nothing
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
RECEIPTS = os.path.join(ROOT, ".artifacts", "machine", "stops.jsonl")

# kind, stoppable, and the test on (name, command line). First match wins.
KINDS = [
    ("revit", False, lambda n, c: n in ("revit", "revitworker", "revitbrowsersubprocess")),
    ("agent-host", False, lambda n, c: n in ("claude", "codex", "t3 code (nightly)", "t3 code", "muse") or "\\.codex\\" in c or "\\raycast" in c),
    ("editor", True, lambda n, c: n in ("zed", "code") or "tsserver" in c or "vtsls" in c or "\\zed\\" in c or "language-service" in c),
    ("installed-host", False, lambda n, c: n == "pe.host" and "positive energy" in c and "pe.tools" in c and "bin" in c),
    ("test-worker", True, lambda n, c: n == "node" and "vitest" in c),
    ("codegen", True, lambda n, c: n == "node" and ("route-graphs" in c or "codegen" in c)),
    ("dev-server", True, lambda n, c: n in ("pe.host",) or (n == "node" and ("dev-web.ts" in c or "src/dev.ts" in c or "jiti src/index.ts" in c or "jiti-cli.mjs\" src/index.ts" in c or "vite-plus\\bin\\vp" in c and " dev" in c or "/vp exec jiti" in c))),
    ("build-server", True, lambda n, c: n in ("vbcscompiler", "msbuild") or (n == "dotnet" and ("build-server" in c or "msbuild" in c or "vbcscompiler" in c))),
    ("helium", False, lambda n, c: n == "chrome" and "\\helium\\" in c),
    ("agent-browser", True, lambda n, c: n == "chrome" and ("--remote-debugging-port" in c or "\\.artifacts\\" in c or "pea-browser" in c)),
    ("bystander", True, lambda n, c: n in ("chrome", "msedge", "chatgpt")),
    ("webview", False, lambda n, c: n == "msedgewebview2"),  # hosts other apps' windows, so its owner is unknown
    ("node-other", True, lambda n, c: n == "node"),
    ("dotnet-other", False, lambda n, c: n == "dotnet"),
]
WORKTREE = re.compile(r"(?:\\|/)(?:\.t3(?:\\|/)worktrees(?:\\|/)Pe\.Tools(?:\\|/)([^\\/\" ]+)|source(?:\\|/)repos(?:\\|/)(Pe\.Tools[^\\/\" ]*))", re.I)


def free_gib():
    class Status(ctypes.Structure):
        _fields_ = [
            ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    status = Status()
    status.dwLength = ctypes.sizeof(Status)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
    return status.ullAvailPhys / 2**30, status.ullTotalPhys / 2**30


def processes():
    script = ("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,"
              "WorkingSetSize,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress")
    out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True).stdout
    rows = json.loads(out or "[]")
    now = dt.datetime.now(dt.timezone.utc)
    result = []
    for r in rows:
        name = (r.get("Name") or "").lower()
        if name.endswith(".exe"):
            name = name[:-4]
        cmd = r.get("CommandLine") or ""
        kind, stoppable = classify(name, cmd)
        m = WORKTREE.search(cmd)
        checkout = (m.group(1) or m.group(2)) if m else ""
        created = r.get("Created")
        age_min = None
        if created:
            try:
                age_min = int((now - dt.datetime.fromisoformat(created.replace("Z", "+00:00"))).total_seconds() // 60)
            except ValueError:
                age_min = None
        result.append({
            "pid": r.get("ProcessId"), "ppid": r.get("ParentProcessId"), "name": name, "kind": kind,
            "stoppable": stoppable, "gib": round((r.get("WorkingSetSize") or 0) / 2**30, 2),
            "age_min": age_min, "checkout": checkout, "cmd": cmd,
        })
    return result


PRUNE_KINDS = ("editor", "bystander")


def classify(name, cmd):
    for k, s, test in KINDS:
        if test(name, cmd.lower()):
            return k, s
    return "other", False


def prune(dry):
    victims = [p for p in processes() if p["kind"] in PRUNE_KINDS]
    gib = sum(p["gib"] for p in victims)
    print(f"prune: {len(victims)} editor and bystander processes, {gib:.1f} GiB resident" + (" (dry run, nothing stopped)" if dry else ""))
    if dry or not victims:
        for p in sorted(victims, key=lambda p: -p["gib"])[:8]:
            print(f"  pid {p['pid']} {p['kind']} {p['name']} {p['gib']} GiB")
        return 0
    # taskkill /T takes each tree by its root, so a child already gone is "not running", not a failure
    return stop([p["pid"] for p in sorted(victims, key=lambda p: -p["gib"])])


def safe_admit(kind, as_json):
    # A failed reading is a HOLD, never a crash: a caller that misses the exit code must not start unadmitted.
    # The process dump can be cut short when a process exits mid-enumeration (JSONDecodeError seen 2026-11-10).
    try:
        return admit(kind, as_json)
    except Exception as e:
        msg = f"HOLD {kind}: reading failed ({type(e).__name__}: {e}); retry admit in a minute"
        print(json.dumps({"verdict": "HOLD", "kind": kind, "error": msg}) if as_json else msg)
        return 3


def admit(kind, as_json, pruned=False):
    if kind not in FLOORS_GIB:
        print(f"unknown kind {kind}; kinds: {', '.join(FLOORS_GIB)}")
        return 2
    # Owner, 2026-11-10: a full suite runs once per wave, on the merged tip, never inside a writing child. 58% of child tool
    # time in the kernel crusade was tests on code still churning. A delegated child runs touched tests (kind light).
    if kind == "suite" and os.environ.get("T3CODE_THREAD_ID", "").startswith("thread:delegated-task:"):
        print("REFUSE suite: a delegated child runs typecheck and the tests its diff touches (kind light); "
              "the full suite runs once per wave, on the merged tip")
        return 4
    free, total = free_gib()
    procs = processes()
    revits = sum(1 for p in procs if p["name"] == "revit")
    by = {}
    for p in procs:
        c, g = by.get(p["name"], (0, 0.0))
        by[p["name"]] = (c + 1, g + p["gib"])
    top = sorted(by.items(), key=lambda kv: -kv[1][1])[:6]
    floor = FLOORS_GIB[kind]
    reasons = []
    if free < floor:
        reasons.append(f"free {free:.1f} GiB under the {kind} floor {floor} GiB")
    if kind.startswith("revit") and revits >= REVIT_CAP:
        reasons.append(f"{revits} Revit processes at the cap {REVIT_CAP}")
    if free < STOP_GIB:
        reasons.append(f"free {free:.1f} GiB under the stop floor {STOP_GIB} GiB")
    verdict = "HOLD" if reasons else "ADMIT"
    if verdict == "HOLD" and free < floor and not pruned and any(p["kind"] in PRUNE_KINDS for p in procs):
        prune(False)
        return admit(kind, as_json, pruned=True)
    stoppable = sorted((p for p in procs if p["stoppable"]), key=lambda p: -p["gib"])[:5]
    reading = {
        "verdict": verdict, "kind": kind, "free_gib": round(free, 1), "total_gib": round(total, 1),
        "revit": revits, "reasons": reasons,
        "top": [{"name": n, "count": c, "gib": round(g, 1)} for n, (c, g) in top],
        "stoppable": [{k: p[k] for k in ("pid", "kind", "gib", "age_min", "checkout")} for p in stoppable],
    }
    if as_json:
        print(json.dumps(reading))
    else:
        print(f"{verdict} {kind}: free {free:.1f} of {total:.1f} GiB, Revit {revits}. " + "; ".join(reasons))
        print("holders: " + ", ".join(f"{n} x{c} {g:.1f} GiB" for n, (c, g) in top))
        if verdict == "HOLD" and kind == "revit-drive" and revits:
            print("if that Revit is your own warm session, ask for `browser`: its floor covers the host, web and Chrome you still need")
        if verdict == "HOLD" and stoppable:
            print("stoppable, biggest first (python machine.py who for all): " + ", ".join(
                f"pid {p['pid']} {p['kind']} {p['gib']} GiB {p['age_min']} min {p['checkout'] or '-'}" for p in stoppable))
    return 0 if verdict == "ADMIT" else 3


def who(show_all, as_json):
    procs = [p for p in processes() if show_all or p["kind"] != "other"]
    procs.sort(key=lambda p: -p["gib"])
    if as_json:
        print(json.dumps(procs))
        return 0
    free, total = free_gib()
    print(f"free {free:.1f} of {total:.1f} GiB. stoppable = a dev server, test worker, codegen, build server or agent browser; "
          "the rest are never stopped by this tool.")
    print(f"{'pid':>6} {'kind':<14} {'GiB':>5} {'min':>5} {'stop':<4} {'checkout':<40} command")
    for p in procs:
        tail = p["cmd"][-90:] if len(p["cmd"]) > 90 else p["cmd"]
        print(f"{p['pid']:>6} {p['kind']:<14} {p['gib']:>5.2f} {str(p['age_min'] if p['age_min'] is not None else '?'):>5} "
              f"{'yes' if p['stoppable'] else 'no':<4} {p['checkout'][:40]:<40} {tail}")
    return 0


def stop(pids):
    procs = {p["pid"]: p for p in processes()}
    os.makedirs(os.path.dirname(RECEIPTS), exist_ok=True)
    caller = os.environ.get("T3CODE_THREAD_ID", "")
    rc = 0
    for pid in pids:
        p = procs.get(pid)
        if p is None:
            print(f"pid {pid}: not running")
            continue
        if not p["stoppable"]:
            print(f"pid {pid}: refused, {p['kind']} is never stopped by this tool ({p['name']})")
            rc = 3
            continue
        if p["kind"] == "build-server":
            res = subprocess.run(["dotnet", "build-server", "shutdown"], capture_output=True, text=True)
            how = "dotnet build-server shutdown"
        else:
            res = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, text=True)
            how = "taskkill /T /F"
        ok = res.returncode == 0
        receipt = {"at": dt.datetime.now(dt.timezone.utc).isoformat(), "caller": caller, "pid": pid, "kind": p["kind"],
                   "gib": p["gib"], "age_min": p["age_min"], "checkout": p["checkout"], "cmd": p["cmd"][:300],
                   "how": how, "ok": ok, "out": (res.stdout + res.stderr).strip()[:200]}
        with open(RECEIPTS, "a", encoding="utf-8") as f:
            f.write(json.dumps(receipt) + "\n")
        print(f"pid {pid}: {'stopped' if ok else 'FAILED'} {p['kind']} {p['gib']} GiB {p['checkout'] or '-'} via {how}")
        rc = rc or (0 if ok else 1)
    print(f"receipts: {RECEIPTS}")
    return rc


def main():
    argv = sys.argv[1:]
    as_json = "--json" in argv
    show_all = "--all" in argv
    args = [a for a in argv if not a.startswith("--")]
    verb = args[0] if args else "admit"
    if verb == "admit":
        return safe_admit(args[1] if len(args) > 1 else "suite", as_json)
    if verb == "who":
        return who(show_all, as_json)
    if verb == "stop":
        pids = [int(a) for a in args[1:] if a.isdigit()]
        if not pids:
            print("stop needs one or more pids from `who`")
            return 2
        return stop(pids)
    if verb == "prune":
        return prune("--dry" in argv)
    if verb == "selftest":
        helium = r'"C:\Program Files\imput\Helium\Application\chrome.exe" --type=renderer'
        assert classify("chrome", helium) == ("helium", False)
        assert classify("chrome", r'"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=0') == ("agent-browser", True)
        assert classify("chrome", r'"C:\Program Files\Google\Chrome\Application\chrome.exe"') == ("bystander", True)
        assert classify("chatgpt", "") == ("bystander", True) and classify("zed", "") == ("editor", True)
        assert classify("revit", "")[1] is False and classify("claude", "")[1] is False and classify("svchost", "") == ("other", False)
        print("ok")
        return 0
    if verb in FLOORS_GIB:
        return safe_admit(verb, as_json)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
