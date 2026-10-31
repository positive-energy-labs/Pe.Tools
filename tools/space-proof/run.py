"""Space proof harness: MAP "Proof gate" in one command, on the three local model copies.

    python tools/space-proof/run.py run   [--models chadds,cleremont,manuella] [--label L] [--baseline DIR]
                                          [--context link-boxes|triangle-boxes|oriented|meshes] [--pin] [--cold-each] [--settle S] [--plan]
    python tools/space-proof/run.py diff  <runDirA> <runDirB>        A = baseline, B = candidate
    python tools/space-proof/run.py check <artifact.bin> [frames.json]   offline decode + accuracy self-check

One fresh SDK-controlled session (`probe-h`) per model, headless, one hold of `.artifacts/locks/revit-slot-1`.
Per model: open the local copy, settle, read /ducts' `ducts.snapshot`, then per system the page's two scene calls
(focus, then context; `page_requests` names the route source) cold, then once more warm. Cold is the first
read in the process for the model's first system; with --cold-each every system gets its own fresh process.
Every read records private bytes (before, peak, after), Revit-side ms, the scene receipt, the artifact census, and
IsModified; any modification aborts the run. After the reads, the PSC1 artifact of each system's cold context call is
checked against each non-focus element's own frame, read in Revit through `pea script execute` (frames.cs.template).
Results: .artifacts/accept/space-proof/<commit>-<utc>/results.json + results.md (+ diff.md against --baseline).
Focus ids are pinned in fixture.json (the raw snapshot's `scopeOf` members); drift against the live snapshot is reported. The page
also sends connector stubs, so its focus is a superset (Chadds EX 7: 108 members + 45 stubs = 153); each pin records the page's count.
"""
import argparse, datetime, hashlib, json, math, os, struct, subprocess, sys, threading, time
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parent
CHECKOUT = HERE.parents[1]
ROOT = Path(subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=CHECKOUT, capture_output=True, text=True).stdout.strip()).resolve().parent
DETACHED = ROOT / ".artifacts" / "revit" / "detached"
LOCK = ROOT / ".artifacts" / "locks" / "revit-slot-1"
ORDER = LOCK.parent / "ORDER"
# Custody and isolation come from the environment so an agent with its own session id or acceptance-isolated product home
# (PE_TOOLS_PRODUCT_HOME, inherited by every child) runs this unchanged: PE_PROOF_SESSION, PE_PROOF_CACHE (the space-scenes
# dir the host publishes into), PE_PROOF_KEEP_HOST=1 (the caller owns and stops its own host).
CACHE = Path(os.environ.get("PE_PROOF_CACHE") or Path(os.environ["LOCALAPPDATA"]) / "Positive Energy" / "Pe.Tools" / "cache" / "space-scenes")
SID = os.environ.get("PE_PROOF_SESSION", "probe-h")
MIN_FREE_GIB = float(os.environ.get("PE_PROOF_MIN_FREE_GIB", 10))
GUARD_FLOOR_GIB = 3
MODELS = {
    # The 2026-10-19 standalone copy has no IFC link and no loaded links (orchestrator, 2026-10-28), so it is not Chadds.
    # Only the census-checked local copy of the cloud clone `Chadds_Clone_Aug_11` may carry this name.
    "chadds": ("MEP_Chadds_Clone_Aug_11_R25_local_20261028.rvt", ["SA 7", "EX 7"]),
    "cleremont": ("MEP_Brodie_Cleremont_Ross_R25_local_20261028.rvt", ["SA 19", "SA 2", "SA 21"]),
    "manuella": ("MEP_BIG_Manuella_R25_V2_local_20261027.rvt", ["SA 42", "SA 39"]),
}
MIB = 2**20


def git(*args):
    return subprocess.run(["git", *args], cwd=CHECKOUT, capture_output=True, text=True).stdout.strip()


def utc():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def slot_log(message):
    with (LOCK.parent / "QUEUE.txt").open("a", encoding="utf8") as stream:
        stream.write(f"\n{SID} {CHECKOUT.name} {utc()}: {message}\n")


def acquire_slot():
    # ORDER is the sole admission authority. QUEUE.txt is only the human log.
    lines = ORDER.read_text(encoding="utf-8-sig").splitlines()
    if not lines or lines[0] != SID:
        raise RuntimeError(f"Not {SID}'s turn: ORDER starts with {lines[:1]}")
    LOCK.mkdir()  # atomic; never adopt another owner's directory
    try:
        lines = ORDER.read_text(encoding="utf-8-sig").splitlines()
        if not lines or lines[0] != SID:
            raise RuntimeError("ORDER changed before acquisition; no session started")
        ORDER.write_text("\n".join(lines[1:]) + ("\n" if len(lines) > 1 else ""), encoding="utf8")
    except Exception:
        LOCK.rmdir()  # this call's newly created, still-empty directory only
        raise
    (LOCK / "holder").write_text(f"{SID} harness {CHECKOUT.name} {utc()}\n")
    slot_log("TAKING slot-1")


# ---------------------------------------------------------------- PSC1 + accuracy (pure, no Revit)

def decode_psc1(blob: bytes):
    if blob[:4] != b"PSC1":
        raise ValueError("not PSC1")
    n = struct.unpack("<i", blob[4:8])[0]
    return json.loads(blob[8:8 + n])


def census(meta):
    """Counts of what the artifact drew: representation x focus, and kept per source x category x representation."""
    by_rep, by_source = {}, {}
    for e in meta["elements"]:
        side = "focus" if e["focus"] else "context"
        by_rep.setdefault(e["representation"], {"focus": 0, "context": 0})[side] += 1
        h = e["handle"]
        key = f'{h["linkInstanceId"] if h["linkInstanceId"] is not None else "host"}|{h["category"]}|{e["representation"]}'
        by_source[key] = by_source.get(key, 0) + 1
    return {"byRepresentation": by_rep, "bySourceCategoryRepresentation": dict(sorted(by_source.items(), key=lambda kv: -kv[1]))}


def frame_items(meta):
    """Non-focus elements, in artifact order: the questions for the in-Revit frame pass."""
    return [e for e in meta["elements"] if not e["focus"]]


def _yaw(v):
    return math.degrees(math.atan2(v[1], v[0]))


def _angdiff(a, b, mod):
    d = abs(a - b) % mod
    return min(d, mod - d)


def _dot(a, b):
    return abs(sum(x * y for x, y in zip(a, b)))


def oriented_box_agrees(box, row):
    """An oriented-box element carries its element's own axes (step 3 contract: center, axisX/Y/Z, halfSize).
    Instance frame: every box axis lies along a distinct basis vector of the placed total transform (full 3D, roll included).
    Line frame: some box axis lies along the location line. None when the contract fields or the frame are absent."""
    ax = [box.get("axisX"), box.get("axisY"), box.get("axisZ")]
    v = row[6] if len(row) > 6 else []
    if any(a is None for a in ax):
        return None
    c = math.cos(math.radians(1))
    if row[1] == 1 and len(v) == 9:
        basis = [v[0:3], v[3:6], v[6:9]]
        used = set()
        for a in ax:
            hit = next((i for i, b in enumerate(basis) if i not in used and _dot(a, b) >= c), None)
            if hit is None:
                return False
            used.add(hit)
        return True
    if row[1] == 2 and len(v) == 9:
        return any(_dot(a, v[6:9]) >= c for a in ax)
    return None


def run_agrees(run, row, tol=0.02):
    """A straight run's endpoints are the location line's endpoints (host ft), in either order."""
    v = row[6] if len(row) > 6 else []
    if row[1] != 2 or len(v) != 9 or not run or "start" not in run:
        return None
    s, e = run["start"], run["end"]
    d = lambda p, q: max(abs(x - y) for x, y in zip(p, q))
    return (d(s, v[0:3]) <= tol and d(e, v[3:6]) <= tol) or (d(s, v[3:6]) <= tol and d(e, v[0:3]) <= tol)


def accuracy(meta, frames):
    """Share of non-focus elements drawn axis-aligned (box) while their own frame is rotated, read from `frames` rows."""
    items = frame_items(meta)
    rows = {r[0]: r for r in frames["rows"]}
    z = lambda: {"nonFocus": 0, "rotated": 0, "rotatedBoxes": 0, "unknownFrame": 0}
    out = {**z(), "tally": {}, "bySource": {}, "orientedBoxChecked": 0, "orientedBoxMismatch": 0, "runChecked": 0, "runMismatch": 0}
    kinds = {}
    for i, e in enumerate(items):
        r = rows.get(i, [i, 0, -1, 0, 0, 0, []])
        kind, rot, rep = r[1], r[2], e["representation"]
        src = str(e["handle"]["linkInstanceId"] if e["handle"]["linkInstanceId"] is not None else "host")
        bucket = out["bySource"].setdefault(src, z())
        kinds[kind] = kinds.get(kind, 0) + 1
        t = out["tally"].setdefault(rep, {"rotated": 0, "square": 0, "unknown": 0})
        t["rotated" if rot == 1 else "square" if rot == 0 else "unknown"] += 1
        for b in (out, bucket):
            b["nonFocus"] += 1
            if rot == 1:
                b["rotated"] += 1
                b["rotatedBoxes"] += rep == "box"
            elif rot == -1:
                b["unknownFrame"] += 1
        if rep == "oriented-box" and isinstance(e.get("orientedBox"), dict):
            ok = oriented_box_agrees(e["orientedBox"], r)
            if ok is not None:
                out["orientedBoxChecked"] += 1
                out["orientedBoxMismatch"] += not ok
        if rep == "run":
            ok = run_agrees(e.get("run"), r)
            if ok is not None:
                out["runChecked"] += 1
                out["runMismatch"] += not ok
    share = lambda b: b["rotatedBoxes"] / b["rotated"] if b["rotated"] else None
    out["shareRotatedDrawnAxisAligned"] = share(out)
    for b in out["bySource"].values():
        b["shareRotatedDrawnAxisAligned"] = share(b)
    out["frameKinds"] = {"none": kinds.get(0, 0), "instance": kinds.get(1, 0), "line": kinds.get(2, 0), "curved": kinds.get(3, 0), "geometrySample": kinds.get(4, 0)}
    return out


# ---------------------------------------------------------------- Revit driving

class Session:
    def __init__(self, evdir: Path):
        self.ev, self.n = evdir, 0
        self.pid = self.receipt = self.doc = None
        self.guard = None

    def sdk(self, name, *args, timeout=1800):
        self.n += 1
        t = time.monotonic()
        r = subprocess.run(["dotnet", "tool", "run", "pe-revit", "--", *args, "--json"], cwd=CHECKOUT, capture_output=True, text=True, timeout=timeout)
        (self.ev / f"{self.n:03d}-{name}.json").write_text(r.stdout, encoding="utf8")
        (self.ev / f"{self.n:03d}-{name}.stderr").write_text(r.stderr, encoding="utf8")
        try:
            env = json.loads(r.stdout)
        except Exception:
            env = None
        print(f"  sdk {name}: exit {r.returncode} {time.monotonic() - t:.1f}s", flush=True)
        return r.returncode, env

    def pea(self, name, args, timeout=3600):
        self.n += 1
        t = time.monotonic()
        r = subprocess.run([str(Path.home() / ".vite-plus/bin/vp.exe"), "exec", "jiti", "src/main.ts", *args], cwd=CHECKOUT / "ts/apps/pea",
                           capture_output=True, text=True, timeout=timeout, env=dict(os.environ, NO_COLOR="1"))
        (self.ev / f"{self.n:03d}-{name}.stdout").write_text(r.stdout, encoding="utf8")
        (self.ev / f"{self.n:03d}-{name}.stderr").write_text(r.stderr, encoding="utf8")
        wall = time.monotonic() - t
        print(f"  pea {name}: exit {r.returncode} {wall:.1f}s", flush=True)
        try:
            return r.returncode, json.loads(r.stdout[r.stdout.index("{"):]), wall
        except Exception:
            return r.returncode, None, wall

    def modified(self):
        _, env = self.sdk("doclist", "doc", "list", "--id", SID)
        docs = (env or {}).get("result", {}).get("documents", []) if env else None
        return [d.get("isModified") for d in docs] if docs is not None else None

    def start(self, label, floor):
        code, env = self.sdk(f"start-{label}", "session", "start", "--id", SID, "--background")
        if code != 0:
            raise RuntimeError(f"session start exit {code}")
        s = env["result"]["session"]
        self.pid, self.receipt = s["process"]["pid"], s["receipt"]["receiptPath"]
        self.guard = subprocess.Popen([sys.executable, str(HERE / "guard.py"), str(self.pid), self.receipt, str(self.ev / f"mem-{label}.jsonl"), str(floor), str(CHECKOUT), SID],
                                      creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
        return {"pid": self.pid, "generation": s["receipt"]["generationId"], "buildStamp": s["receipt"]["buildStamp"]}

    def stop(self, discard=True):
        if self.pid and psutil.pid_exists(self.pid):
            self.sdk("stop", "session", "stop", "--id", SID, "--unsaved", "discard" if discard else "keep", "--expect-session", self.receipt)
            for _ in range(60):
                if not psutil.pid_exists(self.pid):
                    break
                time.sleep(1)
        if self.guard and self.guard.poll() is None:
            time.sleep(2)
            if self.guard.poll() is None:
                self.guard.terminate()
        gone = not (self.pid and psutil.pid_exists(self.pid))
        print(f"  session stopped, revit pid gone: {gone}", flush=True)
        return gone


_BACKEND = None


def service_pid():
    """Live host pid for this checkout from the service files, else None."""
    svc = Path(os.environ["LOCALAPPDATA"]) / "Positive Energy" / "Pe.Tools" / "state" / "service"
    for f in svc.glob("host-source-*.json"):
        try:
            j = json.loads(f.read_text(encoding="utf8"))
            if Path(j.get("sourceRoot", "")).resolve() == CHECKOUT and psutil.pid_exists(j["pid"]):
                return j["pid"]
        except Exception:
            pass
    return None


def ensure_backend_host():
    """`session start` boots the dev host WITH its vite frontend (~2.5 GiB). A backend-only host (`vp run start`, ~0.55 GiB, no web)
    started first is reused by the session, so the harness starts one when this checkout has none. Not for PE_PROOF_KEEP_HOST callers."""
    global _BACKEND
    if os.environ.get("PE_PROOF_KEEP_HOST") == "1" or service_pid():
        return
    _BACKEND = subprocess.Popen([str(Path.home() / ".vite-plus/bin/vp.exe"), "run", "start"], cwd=CHECKOUT / "ts/apps/host",
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    for _ in range(60):
        if service_pid():
            print(f"  backend-only host up: pid {service_pid()}", flush=True)
            return
        time.sleep(1)
    raise RuntimeError("backend-only host did not claim this checkout's service name within 60 s")


def stop_dev_host():
    """`session start` brings up this checkout's dev host plus its web frontend (~2.5 GiB). The harness started them, so it ends them."""
    if os.environ.get("PE_PROOF_KEEP_HOST") == "1":
        print("  dev host kept (PE_PROOF_KEEP_HOST=1); the caller stops it", flush=True)
        return []
    svc = Path(os.environ["LOCALAPPDATA"]) / "Positive Energy" / "Pe.Tools" / "state" / "service"
    stopped = []
    for f in svc.glob("host-source-*.json"):
        try:
            j = json.loads(f.read_text(encoding="utf8"))
            if Path(j.get("sourceRoot", "")).resolve() != CHECKOUT or not psutil.pid_exists(j["pid"]):
                continue
            root = psutil.Process(j["pid"])
            tree = root.children(recursive=True) + [root]
            for p in tree:
                p.terminate()
            psutil.wait_procs(tree, timeout=15)
            stopped += [p.pid for p in tree if not p.is_running()]
        except Exception as e:
            print(f"  dev host stop: {f.name}: {e}", flush=True)
    if _BACKEND is not None and _BACKEND.poll() is None:
        try:
            tree = psutil.Process(_BACKEND.pid).children(recursive=True) + [psutil.Process(_BACKEND.pid)]
            for p in tree:
                p.terminate()
            psutil.wait_procs(tree, timeout=15)
            stopped += [p.pid for p in tree]
        except psutil.Error:
            pass
    print(f"  dev host stack stopped: {stopped}", flush=True)
    return stopped


class Peak(threading.Thread):
    """Samples the probe's private bytes at 4 Hz while a call runs."""
    def __init__(self, pid):
        super().__init__(daemon=True)
        self.p, self.peak, self.stop_ = psutil.Process(pid), 0, False

    def run(self):
        while not self.stop_:
            try:
                self.peak = max(self.peak, self.p.memory_info().private)
            except psutil.Error:
                return
            time.sleep(0.25)


def find_artifact(response):
    if isinstance(response, dict) and "scene" in response and "id" in response:
        return response
    raise ValueError("no scene artifact in response")


def load_artifact(art):
    path = CACHE / f'{art["id"]}.bin'
    blob = path.read_bytes()
    if hashlib.sha256(blob).hexdigest() != art["id"]:
        raise ValueError("artifact bytes do not hash to their id")
    return blob


def page_requests(ids, context):
    """The two calls the /ducts model picture makes with its default `halo` layer on (main `df45210a`): scene/picture/picture.tsx
    `captureRequest` (sorted ids, maxTriangles 3,000,000, radius = page `contextRadiusFt`, default 10 in agent-contracts
    routes/picture.ts; scene/host.ts's 15 is never used by the picture), then scene/picture/read.ts `useCapture` (focus first with
    padding 0 and `none`, context after focus arrives). The ids are the pinned members, not the page's members + stubs."""
    base = {"elementIds": ids, "maxTriangles": 3_000_000}
    return ({**base, "contextPaddingFt": 0, "focusOnly": True, "contextRepresentation": "none"},
            {**base, "contextPaddingFt": 10, "focusOnly": False, "contextRepresentation": context})


def run_model(name, args, out: Path, fixture, results):
    file_, systems = MODELS[name]
    path = DETACHED / file_
    if not path.exists():
        raise FileNotFoundError(path)
    mdir = out / "ev" / name
    mdir.mkdir(parents=True, exist_ok=True)
    groups = [[s] for s in systems] if args.cold_each else [systems]
    model = results["models"].setdefault(name, {"file": file_, "systems": systems, "processes": [], "reads": [], "accuracy": {}, "snapshot": None, "pins": {}})
    for gi, group in enumerate(groups):
        open_floor = max(MIN_FREE_GIB, 16 if name == "chadds" else 10)
        start_floor = open_floor + 3  # preserve headroom for an empty Revit before the model open
        for _ in range(int(os.environ.get("PE_PROOF_WAIT_FREE_S", 300)) // 5):  # hold the slot, wait out a dip; never open under the gate
            avail = psutil.virtual_memory().available / 2**30
            if avail >= start_floor:
                break
            time.sleep(5)
        avail = psutil.virtual_memory().available / 2**30
        if avail < start_floor:
            raise RuntimeError(f"{avail:.1f} GiB free < {start_floor} GiB required before starting {name}")
        ev = mdir / f"p{gi}"
        ev.mkdir(parents=True, exist_ok=True)
        ensure_backend_host()
        s = Session(ev)
        proc = {"group": group, "startedUtc": utc(), "availableGiBBeforeStart": round(avail, 2)}
        model["processes"].append(proc)
        try:
            proc.update(s.start(f"{name}{gi}", GUARD_FLOOR_GIB))
            avail = psutil.virtual_memory().available / 2**30
            proc["availableGiBBeforeOpen"] = round(avail, 2)
            if avail < open_floor:
                raise RuntimeError(f"{avail:.1f} GiB free < {open_floor} GiB required before opening {name}")
            slot_log(f"OPENING {name}; PID {s.pid}; free {avail:.1f} GiB")
            code, env = s.sdk("open", "doc", "open", str(path), "--id", SID, "--window", "headless")
            if code != 0:
                s.sdk("dialogs", "session", "dialogs", "--id", SID)
                raise RuntimeError(f"open exit {code}: {[d.get('code') for d in (env or {}).get('diagnostics', [])]}")
            s.doc = env["result"]["document"]["openId"]
            slot_log(f"OPENED {name}; PID {s.pid}; SDK open completed, timed reads follow")
            ps = psutil.Process(s.pid)
            proc["privateAtOpen"] = ps.memory_info().private
            time.sleep(args.settle)
            proc["privateAfterSettle"] = ps.memory_info().private
            mod = s.modified()
            if mod is None or any(mod):
                raise RuntimeError(f"IsModified {mod} after open")
            # the page reads the snapshot first
            code, snap, wall = s.pea("snapshot", ["host", "call", "--key", "ducts.snapshot", "--open-document-id", s.doc, "--request-file", str(HERE / "empty.json"), "--verbosity", "full"])
            if snap is None:
                raise RuntimeError("ducts.snapshot gave no response")
            model["snapshot"] = {"wallS": round(wall, 1), "revitMs": snap.get("elapsedMs")}
            snapfile = ev / f"{s.n:03d}-snapshot.stdout"
            code2 = subprocess.run([str(Path.home() / ".vite-plus/bin/vp.exe"), "exec", "jiti", str(HERE / "scope-ids.ts"), str(snapfile), *group],
                                   cwd=CHECKOUT / "ts/apps/pea", capture_output=True, text=True, env=dict(os.environ, NO_COLOR="1"))
            scoped = json.loads(code2.stdout[code2.stdout.index("{"):])
            derived, page_ids = scoped["members"], scoped["page"]
            for ps_path in args.pre_script:  # extra read-only native actions (e.g. a levels witness) before the first scene read
                before = ps.memory_info().private
                code, res, wall = s.pea(f"prescript-{Path(ps_path).stem}", ["script", "execute", "--file", str(Path(ps_path).resolve()), "--permission-mode", "NoTransaction", "--timeout-seconds", "3000", "--open-document-id", s.doc, "--json"])
                mod = s.modified()
                model.setdefault("preScripts", []).append({"file": str(ps_path), "process": gi, "status": (res or {}).get("status"), "wallS": round(wall, 1),
                                                           "privateDeltaMiB": round((ps.memory_info().private - before) / MIB, 1), "isModified": mod,
                                                           "output": (res or {}).get("output"), "data": (res or {}).get("data")})
                if res is None or res.get("status") != "Succeeded" or mod is None or any(mod):
                    raise RuntimeError(f"pre-script {ps_path}: exit {code} status {(res or {}).get('status')} isModified {mod}")
            for system in group:
                pinned = fixture.get(name, {}).get(system)
                ids = derived[system]
                if ids is None:
                    raise RuntimeError(f"{system}: scopeOf found no such system in {name}")
                drift = None if pinned is None else {"pinned": len(pinned["ids"]), "derived": len(ids), "same": pinned["ids"] == ids,
                                                     "added": len(set(ids) - set(pinned["ids"])), "removed": len(set(pinned["ids"]) - set(ids))}
                if args.pin:
                    fixture.setdefault(name, {})[system] = {"ids": ids, "pinnedAt": git("rev-parse", "--short", "HEAD"), "pinnedUtc": utc()}
                    pinned = fixture[name][system]
                use = pinned["ids"] if pinned else ids
                model["pins"][system] = {"idCount": len(use), "idsSha": hashlib.sha256(json.dumps(use).encode()).hexdigest()[:16],
                                         "source": "fixture" if pinned else "derived-unpinned", "drift": drift,
                                         "pageFocusCount": len(page_ids[system] or [])}
                focus_req, ctx_req = page_requests(use, args.context)
                for temp in ("cold", "warm"):
                    for call, req in (("focus", focus_req), ("context", ctx_req)):
                        rf = ev / f"req-{system.replace(' ', '')}-{call}.json"
                        rf.write_text(json.dumps(req), encoding="utf8")
                        before = ps.memory_info().private
                        peak = Peak(s.pid); peak.start()
                        code, resp, wall = s.pea(f"scene-{system.replace(' ', '')}-{call}-{temp}", ["host", "call", "--key", "revit.detail.space-scene", "--open-document-id", s.doc, "--request-file", str(rf), "--verbosity", "full"])
                        peak.stop_ = True
                        after = ps.memory_info().private
                        mod = s.modified()
                        read = {"system": system, "call": call, "temp": temp, "process": gi, "wallS": round(wall, 2), "privateBefore": before, "privateAfter": after,
                                "privatePeak": max(peak.peak, after), "deltaMiB": round((after - before) / MIB, 1), "isModified": mod}
                        if code != 0 or resp is None:
                            read["error"] = f"pea exit {code}"
                            model["reads"].append(read)
                            raise RuntimeError(f"{system} {call} {temp}: pea exit {code}")
                        if "response" not in resp:  # ok:false bodies carry status/message/problem instead of a response
                            read["error"] = json.dumps({k: v for k, v in resp.items() if k not in ("operation", "resolvedTarget")})[:1500]
                            model["reads"].append(read)
                            raise RuntimeError(f"{system} {call} {temp}: host refused: {read['error'][:300]}")
                        art = find_artifact(resp["response"])
                        receipt = art["scene"]
                        blob = load_artifact(art)
                        meta = decode_psc1(blob)
                        read.update({"revitMs": receipt["work"]["nativeMilliseconds"], "peaElapsedMs": resp.get("elapsedMs"), "receipt": receipt,
                                     "artifact": {"id": art["id"], "bytes": art["bytes"], "format": meta["format"], "hashVerified": True},
                                     "census": census(meta), "sources": meta["sources"], "unavailable": len(meta["unavailableElements"]),
                                     "levels": meta.get("levels") and {"sources": len(meta["levels"].get("sources", [])), "planes": len(meta["levels"].get("planes", [])), "work": meta["levels"].get("work")}})
                        model["reads"].append(read)
                        if mod is None or any(mod):
                            raise RuntimeError(f"IsModified {mod} after {system} {call} {temp}")
                        if call == "context" and temp == "cold":
                            model.setdefault("_meta", {})[system] = meta
                            (ev / f"artifact-{system.replace(' ', '')}.id").write_text(art["id"])
            # accuracy pass after all reads so its own cost never lands in a read's delta
            for system in group:
                meta = model["_meta"].pop(system)
                items = frame_items(meta)
                per = {}
                for e in items:
                    per[e["handle"]["linkInstanceId"]] = per.get(e["handle"]["linkInstanceId"], 0) + 1
                seen = {}
                req = {"items": [], "geometrySamplePerSource": 300, "out": str(ev / f"frames-{system.replace(' ', '')}.rows.json")}
                for e in items:  # deterministic stride per source: about 900 flagged, the script keeps the first 300 that have no readable frame
                    k = e["handle"]["linkInstanceId"]
                    seen[k] = seen.get(k, 0) + 1
                    req["items"].append({"link": k, "id": e["handle"]["elementId"], "geo": seen[k] % max(1, per[k] // 900) == 0})
                rf = ev / f"frames-{system.replace(' ', '')}.items.json"
                rf.write_text(json.dumps(req), encoding="utf8")
                cs = ev / f"frames-{system.replace(' ', '')}.cs"
                cs.write_text((HERE / "frames.cs.template").read_text(encoding="utf8").replace("__REQ__", str(rf)), encoding="utf8")
                before = ps.memory_info().private
                code, res, wall = s.pea(f"frames-{system.replace(' ', '')}", ["script", "execute", "--file", str(cs), "--permission-mode", "NoTransaction", "--timeout-seconds", "3000", "--open-document-id", s.doc, "--json"])
                if res is None or res.get("status") != "Succeeded":
                    raise RuntimeError(f"frames script failed for {system}: exit {code}")
                frames = res["data"]
                frames["rows"] = json.loads(Path(req["out"]).read_text(encoding="utf8"))
                if len(frames["rows"]) != frames["rowCount"] or len(frames["rows"]) != len(items):
                    raise RuntimeError(f"frames rows {len(frames['rows'])} != items {len(items)}")
                (ev / f"frames-{system.replace(' ', '')}.result.json").write_text(json.dumps({k: v for k, v in frames.items() if k != "rows"}), encoding="utf8")
                acc = accuracy(meta, frames)
                acc.update({"scriptWallS": round(wall, 1), "privateDeltaMiB": round((ps.memory_info().private - before) / MIB, 1),
                            "frameSources": frames["sources"], "isModifiedAfter": frames["isModifiedAfter"]})
                model["accuracy"][system] = acc
                for ps_path in args.post_script:  # per artifact, after the frames pass: __METADATA__ becomes the decoded PSC1 metadata json
                    mf = ev / f"artifact-{system.replace(' ', '')}.metadata.json"
                    mf.write_text(json.dumps(meta), encoding="utf8")
                    cs2 = ev / f"post-{Path(ps_path).stem}-{system.replace(' ', '')}.cs"
                    text = Path(ps_path).read_text(encoding="utf8").replace("__METADATA__", str(mf)).replace("__CACHE__", str(CACHE))
                    for token in args.post_token:
                        name, _, value = token.partition("=")
                        text = text.replace(f"__{name}__", value)
                    cs2.write_text(text, encoding="utf8")
                    before = ps.memory_info().private
                    code, res, wall = s.pea(f"post-{Path(ps_path).stem}-{system.replace(' ', '')}", ["script", "execute", "--file", str(cs2), "--permission-mode", "NoTransaction", "--timeout-seconds", "3000", "--open-document-id", s.doc, "--json"])
                    mod = s.modified()
                    acc.setdefault("postScripts", []).append({"file": str(ps_path), "status": (res or {}).get("status"), "wallS": round(wall, 1),
                                                              "privateDeltaMiB": round((ps.memory_info().private - before) / MIB, 1), "isModified": mod,
                                                              "output": (res or {}).get("output"), "data": (res or {}).get("data")})
                    if res is None or res.get("status") != "Succeeded" or mod is None or any(mod):
                        raise RuntimeError(f"post-script {ps_path}: exit {code} status {(res or {}).get('status')} isModified {mod}")
            mod = s.modified()
            if mod is None or any(mod):
                raise RuntimeError(f"IsModified {mod} at end")
            proc["endedUtc"] = utc()
        finally:
            try:
                proc["revitPidGone"] = s.stop(discard=True)
            except Exception as error:
                proc["stopError"] = str(error)
                proc["revitPidGone"] = not (s.pid and psutil.pid_exists(s.pid))
            (out / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf8")
            if not proc["revitPidGone"]:
                raise RuntimeError(f"Own Revit PID {s.pid} remains alive; keep slot and backend for SDK recovery")


# ---------------------------------------------------------------- tables

def mib(b):
    return round(b / MIB, 1)


def table(results):
    r = results["run"]
    L = [f'# Space proof {r["commit"]} {r["utc"]}', "", f'label `{r["label"]}`, context `{r["context"]}`, dirty `{r["dirty"]}`, lane session dev (payload byte copy of this checkout), SDK `{r.get("sdk")}`', ""]
    for name, m in results["models"].items():
        L += [f"## {name}", ""]
        for p in m["processes"]:
            L.append(f'- process pid {p.get("pid")} build `{p.get("buildStamp")}` systems {p["group"]}; private at open {mib(p.get("privateAtOpen", 0))} MiB, after settle {mib(p.get("privateAfterSettle", 0))} MiB; free before open {p.get("availableGiBBeforeOpen")} GiB; revit pid gone: {p.get("revitPidGone")}')
        L += ["", "| system | call | temp | Revit s | wall s | Δ MiB | peak MiB | broad | elements (focus/ctx) | mesh | box | run | obox | complete | modified |", "|---|---|---|--:|--:|--:|--:|--:|--|--:|--:|--:|--:|--|--|"]
        for x in m["reads"]:
            if "receipt" not in x:
                L.append(f'| {x["system"]} | {x["call"]} | {x["temp"]} | ERROR {x.get("error")} |||||||||||')
                continue
            rep = x["census"]["byRepresentation"]
            g = lambda k: sum(rep.get(k, {"focus": 0, "context": 0}).values())
            rc = x["receipt"]
            L.append(f'| {x["system"]} | {x["call"]} | {x["temp"]} | {x["revitMs"] / 1000:.2f} | {x["wallS"]} | {x["deltaMiB"]} | {mib(x["privatePeak"] - x["privateBefore"])} | {rc["work"]["broadCandidates"]} | {rc["focusElements"]}/{rc["contextElements"]} | {g("mesh")} | {g("box")} | {g("run")} | {g("oriented-box")} | {rc["completeness"]["complete"]} | {x["isModified"]} |')
        L += ["", "Focus ids: " + "; ".join(f'{s} {v["idCount"]} ids `{v["idsSha"]}` ({v["source"]}{", drift " + json.dumps(v["drift"]) if v["drift"] and not v["drift"]["same"] else ""})' for s, v in m["pins"].items()), ""]
        L += ["Sources per context cold read (receipt sources, kept elements per source):", ""]
        for x in m["reads"]:
            if x.get("call") == "context" and x["temp"] == "cold" and "sources" in x:
                kept = {}
                for k, n in x["census"]["bySourceCategoryRepresentation"].items():
                    kept[k.split("|")[0]] = kept.get(k.split("|")[0], 0) + n
                L.append(f'- {x["system"]}: ' + ", ".join(f'{s.get("linkInstanceId") or "host"} kept {kept.get(str(s.get("linkInstanceId") or "host"), 0)}' + "".join(f" {k} {v}" for k, v in s.items() if k not in ("documentKey", "linkInstanceId", "sourceToHost")) for s in x["sources"]))
        L += ["", "### Accuracy (non-focus elements of the cold context artifact against their own frame, read in Revit)", "",
              "| system | non-focus | own frame rotated | rotated drawn as box | **share rotated drawn axis-aligned** | frame unknown | oriented-box mismatch | run endpoint mismatch | frame kinds (none/instance/line/curved/geo) |", "|---|--:|--:|--:|--:|--:|--|--|--|"]
        for s, a in m["accuracy"].items():
            sh = a["shareRotatedDrawnAxisAligned"]
            k = a["frameKinds"]
            L.append(f'| {s} | {a["nonFocus"]} | {a["rotated"]} | {a["rotatedBoxes"]} | **{"n/a" if sh is None else f"{sh:.1%}"}** | {a["unknownFrame"]} | {a["orientedBoxMismatch"]}/{a["orientedBoxChecked"]} | {a.get("runMismatch", "-")}/{a.get("runChecked", "-")} | {k["none"]}/{k["instance"]}/{k["line"]}/{k["curved"]}/{k["geometrySample"]} |')
        L.append("")
    return "\n".join(L)


def diff(a, b):
    L = [f'# Diff {a["run"]["commit"]} {a["run"]["utc"]} (baseline) -> {b["run"]["commit"]} {b["run"]["utc"]}', ""]
    L += ["| model | system | call | temp | Revit s | Δ MiB | elements | boxes | share rotated drawn axis-aligned |", "|---|---|---|---|--|--|--|--|--|"]
    for name, mb in b["models"].items():
        ma = a["models"].get(name)
        if not ma:
            continue
        ia = {(x["system"], x["call"], x["temp"]): x for x in ma["reads"] if "receipt" in x}
        for x in mb["reads"]:
            y = ia.get((x["system"], x["call"], x["temp"]))
            if not y or "receipt" not in x:
                continue
            same = ma["pins"].get(x["system"], {}).get("idsSha") == mb["pins"].get(x["system"], {}).get("idsSha")
            ba = sum(y["census"]["byRepresentation"].get("box", {"focus": 0, "context": 0}).values())
            bb = sum(x["census"]["byRepresentation"].get("box", {"focus": 0, "context": 0}).values())
            sa = ma["accuracy"].get(x["system"], {}).get("shareRotatedDrawnAxisAligned") if x["call"] == "context" and x["temp"] == "cold" else None
            sb = mb["accuracy"].get(x["system"], {}).get("shareRotatedDrawnAxisAligned") if x["call"] == "context" and x["temp"] == "cold" else None
            fmt = lambda v: "" if v is None else f"{v:.1%}"
            L.append(f'| {name} | {x["system"]}{"" if same else " (IDS DIFFER)"} | {x["call"]} | {x["temp"]} | {y["revitMs"] / 1000:.2f} -> {x["revitMs"] / 1000:.2f} | {y["deltaMiB"]} -> {x["deltaMiB"]} | {y["receipt"]["elements"]} -> {x["receipt"]["elements"]} | {ba} -> {bb} | {fmt(sa)} -> {fmt(sb)} |')
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- commands

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--models", default="chadds,cleremont,manuella")
    r.add_argument("--label", default="main")
    r.add_argument("--baseline")
    r.add_argument("--context", default="link-boxes")  # the product default; main before step 3 knew only boxes|meshes
    r.add_argument("--pin", action="store_true")
    r.add_argument("--cold-each", action="store_true")
    r.add_argument("--settle", type=int, default=120)
    r.add_argument("--plan", action="store_true")
    r.add_argument("--post-script", action="append", default=[], help="read-only .cs template run per artifact after the frames pass; __METADATA__ = decoded PSC1 metadata json path (repeatable)")
    r.add_argument("--pre-script", action="append", default=[], help="read-only .cs script run once per process before the first scene read (repeatable)")
    r.add_argument("--post-token", action="append", default=[], help="NAME=VALUE: replace __NAME__ in every post-script (repeatable); __CACHE__ is the scene cache dir")
    d = sub.add_parser("diff"); d.add_argument("a"); d.add_argument("b")
    m = sub.add_parser("merge", help="one table from the models of several runs (later runs win a model)")
    m.add_argument("out"); m.add_argument("runs", nargs="+")
    c = sub.add_parser("check"); c.add_argument("artifact"); c.add_argument("frames", nargs="?")
    args = ap.parse_args()
    if args.cmd == "diff":
        a, b = (json.loads((Path(p) / "results.json").read_text(encoding="utf8")) for p in (args.a, args.b))
        print(diff(a, b)); return
    if args.cmd == "merge":
        runs = [json.loads((Path(p) / "results.json").read_text(encoding="utf8")) for p in args.runs]
        merged = {"run": {**runs[0]["run"], "mergedFrom": [{"dir": Path(p).name, "commit": r["run"]["commit"], "models": list(r["models"])} for p, r in zip(args.runs, runs)]}, "models": {}}
        for r in runs:
            merged["models"].update(r["models"])
        out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
        (out / "results.json").write_text(json.dumps(merged, indent=1, default=str), encoding="utf8")
        note = "\nMerged from: " + ", ".join(f'{x["dir"]} ({x["commit"]}: {", ".join(x["models"])})' for x in merged["run"]["mergedFrom"]) + "\n"
        (out / "results.md").write_text(table(merged) + note, encoding="utf8")
        print(out); return
    if args.cmd == "check":
        meta = decode_psc1(Path(args.artifact).read_bytes())
        print(json.dumps(census(meta), indent=1)[:3000])
        if args.frames:
            print(json.dumps(accuracy(meta, json.loads(Path(args.frames).read_text(encoding="utf8"))), indent=1))
        return
    names = args.models.split(",")
    others = [p.pid for p in psutil.process_iter(["name"]) if p.info["name"] == "Revit.exe"]
    if len(others) > 1 and os.environ.get("PE_PROOF_ALLOW_OTHERS") != "1" and not args.plan:
        sys.exit(f"{len(others)} Revit.exe are running {others}; only the person's session may run beside a probe (2026-10-28 03:17Z and 04:43Z: a concurrent open took available RAM to 1.4 GiB). PE_PROOF_ALLOW_OTHERS=1 overrides.")
    fixture_path = HERE / "fixture.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf8")) if fixture_path.exists() else {}
    commit = git("rev-parse", "--short", "HEAD")
    out = CHECKOUT / ".artifacts" / "accept" / "space-proof" / f"{commit}-{utc()}"
    plan = {"models": {n: {"file": str(DETACHED / MODELS[n][0]), "exists": (DETACHED / MODELS[n][0]).exists(), "systems": MODELS[n][1], "pinned": {s: s in fixture.get(n, {}) for s in MODELS[n][1]}} for n in names},
            "out": str(out), "lock": str(LOCK), "freeGiB": round(psutil.virtual_memory().available / 2**30, 1)}
    print(json.dumps(plan, indent=1))
    if args.plan:
        return
    try:
        acquire_slot()
    except (OSError, RuntimeError) as error:
        sys.exit(f"Slot not acquired: {error}")
    out.mkdir(parents=True)
    results = {"run": {"commit": commit, "utc": utc(), "label": args.label, "context": args.context, "dirty": bool(git("status", "--porcelain", "--", "dotnet", "ts")), "baseline": args.baseline,
                       "checkout": str(CHECKOUT), "sdk": "pe-revit (pinned tool of this checkout)"}, "models": {}}
    try:
        for n in names:
            print(f"== {n}", flush=True)
            run_model(n, args, out, fixture, results)
            if args.pin:
                fixture_path.write_text(json.dumps(fixture, indent=1), encoding="utf8")
    except Exception as e:
        results["aborted"] = f"{type(e).__name__}: {e}"
        print("ABORTED:", results["aborted"], flush=True)
    finally:
        for m in results["models"].values():
            m.pop("_meta", None)
        (out / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf8")
        (out / "results.md").write_text(table(results), encoding="utf8")
        if args.baseline:
            (out / "diff.md").write_text(diff(json.loads((Path(args.baseline) / "results.json").read_text(encoding="utf8")), results), encoding="utf8")
        alive = [p for m in results["models"].values() for p in m["processes"] if p.get("revitPidGone") is False]
        if alive:  # the slot stays held while a probe Revit of ours may still run
            print(f"SLOT KEPT: probe Revit still alive: {[p.get('pid') for p in alive]}", flush=True)
            slot_log(f"SLOT KEPT: own Revit still alive; evidence {out}")
        else:
            results["devHostStopped"] = stop_dev_host()
            (LOCK / "holder").unlink()
            LOCK.rmdir()
            slot_log(f"RELEASE slot-1; own Revit PIDs gone and backend stopped; evidence {out}")
        (out / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf8")
        print(f"results: {out}", flush=True)
    if "aborted" in results:
        sys.exit(1)


if __name__ == "__main__":
    main()
