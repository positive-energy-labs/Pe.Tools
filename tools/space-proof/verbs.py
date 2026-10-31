"""Space verbs proof: Pea's Sweep, Probe, Slice and Census (step 6), the same requests against several builds of this checkout.

    python tools/space-proof/verbs.py run --model cleremont|chadds --variants main,scoped,nopack [--first-only] [--no-repeat] [--settle S] [--label L] [--plan]
    python tools/space-proof/verbs.py compare <runDir> <variantA> <variantB>      offline: answers of two variants, semantic fields only
    python tools/space-proof/verbs.py report  <runDir>                            offline: timing/memory table
    python tools/space-proof/verbs.py selftest                                    offline, no Revit

One hold of `.artifacts/locks/revit-slot-1` (ORDER decides the turn; id from PE_PROOF_SESSION, default probe-s6). Per variant one fresh
headless SDK-controlled session on the model's local copy. Variants are builds of THIS checkout, switched by the driver:
    main    the Space files exactly as on `main` (whole-model Prepare per verb call), via `git checkout main -- <files>`
    scoped  HEAD (scoped read, pack on)
    nopack  HEAD with PE_SPACE_NO_PACK=1 in the Revit process's environment (the pack is not opened); its effect is witnessed by the
            pack directory not growing (files/bytes recorded around every process)
The driver restores the tree to HEAD at the end and refuses to finish if `git diff HEAD` is not empty.
Requests are pinned in tools/space-proof/verbs-requests.json: first run on a model reads the longest focus ducts through verbs.cs.template
and writes the pins. Per request: the four verbs, in this order, pass 1 (first touch in the process) then pass 2 (repeat). Every call records
wall seconds, the host-reported elapsed ms, Revit private bytes before/after and the 4 Hz peak, IsModified, and keeps the raw response file.
"""
import argparse, hashlib, json, math, os, subprocess, sys, time
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run as R  # noqa: E402  (the scene harness: session, slot, backend host, peak sampler)

MIB = 2**20
VERBS = ["sweep", "probe", "slice", "census"]
PINS = HERE / "verbs-requests.json"
PACK_DIR = Path(os.environ["LOCALAPPDATA"]) / "Positive Energy" / "Pe.Tools" / "cache" / "space-linked-geometry"


# ---------------------------------------------------------------- requests (pure)

def build_requests(picks, pad_ft=10.0):
    """Two requests per verb per picked duct, all in host internal feet. Sweep runs along the duct excluding itself; the others look
    at the same neighbourhood. Returns an ordered list of {id, verb, idx, request}."""
    out = []
    for i, p in enumerate(picks):
        (sx, sy, sz), (ex, ey, ez) = p["start"], p["end"]
        mx, my, mz = (sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2
        lo = [min(sx, ex), min(sy, ey), min(sz, ez)]
        hi = [max(sx, ex), max(sy, ey), max(sz, ez)]
        exclude = {"excludeElementIds": [p["id"]]}
        reqs = {
            "sweep": {"polyline": [[sx, sy, sz], [ex, ey, ez]], "widthFt": p["widthFt"], "heightFt": p["heightFt"], "clearanceFt": 1.0, "filter": exclude},
            "probe": {"at": [mx, my, mz], "filter": exclude},
            "slice": {"z0": mz - 1.5, "z1": mz + 1.5, "xyClip": [lo[0] - 2 * pad_ft, lo[1] - 2 * pad_ft, mz - 1.5, hi[0] + 2 * pad_ft, hi[1] + 2 * pad_ft, mz + 1.5], "filter": exclude},
            "census": {"box": [lo[0] - pad_ft, lo[1] - pad_ft, lo[2] - pad_ft, hi[0] + pad_ft, hi[1] + pad_ft, hi[2] + pad_ft], "filter": exclude},
        }
        for verb in VERBS:
            out.append({"id": f"{verb}{i}", "verb": verb, "idx": i, "request": reqs[verb]})
    return out


# ---------------------------------------------------------------- answers (pure)

def _num(x, nd=6):
    return round(x, nd) if isinstance(x, float) else x


def _handle(h):
    return None if h is None else (h["linkInstanceId"], h["elementId"], h["category"], h["kind"], h.get("layer"))


def canonical(verb, ans):
    """Semantic content of an answer: what it says about the model, not how long it took or what the world held."""
    if verb == "sweep":
        return {"segments": [[s["index"], s["verdict"], _num(s["minGapFt"]), _handle(s.get("nearest")), [_num(v) for v in s["closestPoint"]] if s.get("closestPoint") else None]
                             for s in ans["segments"]]}
    if verb == "probe":
        hit = lambda h: None if h is None else [_handle(h["handle"]), _num(h["distanceFt"]), _num(h["z"])]
        return {"floor": hit(ans.get("floor")), "ceiling": hit(ans.get("ceiling")), "maxDistanceFt": ans["maxDistanceFt"], "purpose": ans.get("purpose")}
    if verb == "slice":
        els = {}
        for e in ans["elements"]:
            h = _handle(e["handle"])
            els[h] = json.dumps([[_num(v, 4) for v in piece] for piece in e["pieces"]])
        return {"elements": els, "pieces": ans["pieces"], "total": ans["total"], "truncated": ans["truncated"]}
    if verb == "census":
        buckets = {(b["source"], b["category"], b["kind"], b.get("layer")): (b["elements"], b["triangles"]) for b in ans["buckets"]}
        return {"buckets": buckets, "top": [[_handle(t["handle"]), t["triangles"]] for t in ans["top"]]}
    raise ValueError(verb)


def compare_answers(verb, a, b):
    """-> (same, detail). `a` is the baseline (main). Differences are described, never hidden; the caller classifies them."""
    ca, cb = canonical(verb, a), canonical(verb, b)
    if ca == cb:
        return True, {}
    d = {}
    if verb in ("sweep", "probe"):
        d = {"a": ca, "b": cb}
    elif verb == "slice":
        ea, eb = ca["elements"], cb["elements"]
        d = {"onlyInA": [list(k) for k in ea.keys() - eb.keys()], "onlyInB": [list(k) for k in eb.keys() - ea.keys()],
             "piecesDiffer": [list(k) for k in ea.keys() & eb.keys() if ea[k] != eb[k]],
             "pieces": [ca["pieces"], cb["pieces"]], "total": [ca["total"], cb["total"]], "truncated": [ca["truncated"], cb["truncated"]]}
    elif verb == "census":
        ba, bb = ca["buckets"], cb["buckets"]
        keys = sorted(set(ba) | set(bb), key=str)
        d = {"bucketDeltas": [[list(k), ba.get(k), bb.get(k)] for k in keys if ba.get(k) != bb.get(k)],
             "topA": ca["top"], "topB": cb["top"]}
    return False, d


def dominated(verb, detail):
    """True when B's difference is only fewer things than A (a subset answer): the shape main's axis-aligned false positives take."""
    if verb == "census":
        return all(b is None or (a is not None and b[0] <= a[0] and b[1] <= a[1]) for _, a, b in detail["bucketDeltas"])
    if verb == "slice":
        return not detail["onlyInB"] and not detail["piecesDiffer"] and not detail["truncated"][0]
    return False


# ---------------------------------------------------------------- driving

def pack_state():
    files = [f for f in PACK_DIR.rglob("*") if f.is_file()] if PACK_DIR.exists() else []
    return {"files": len(files), "bytes": sum(f.stat().st_size for f in files)}


def git(*a):
    return R.git(*a)


def space_files(ref):
    """Product files the scoped-read work changed against main: the bytes that differ between the `main` and `scoped` variants."""
    names = git("diff", "--name-only", "main", ref, "--", "dotnet").splitlines()
    return [n for n in names if "/Pe.Revit.Tests/" not in n and n.endswith(".cs")]


def to_variant(variant, files, head):
    if variant == "main":
        git("checkout", "main", "--", *files)
    else:
        git("checkout", head, "--", *files)


def read_pins():
    return json.loads(PINS.read_text(encoding="utf8")) if PINS.exists() else {}


def get_or_pin_picks(s, name, ev, ids, pins, take):
    if name in pins:
        return pins[name]
    reqf = ev / "verbs-picks.req.json"
    reqf.write_text(json.dumps({"ids": ids, "take": take}), encoding="utf8")
    cs = ev / "verbs-picks.cs"
    cs.write_text((HERE / "verbs.cs.template").read_text(encoding="utf8").replace("__REQ__", str(reqf)), encoding="utf8")
    code, res, wall = s.pea("picks", ["script", "execute", "--file", str(cs), "--permission-mode", "NoTransaction", "--timeout-seconds", "3000", "--open-document-id", s.doc, "--json"])
    if res is None or res.get("status") != "Succeeded" or len(res["data"]["picks"]) < take:
        raise RuntimeError(f"verb picks script failed or found too few ducts: exit {code} {json.dumps(res)[:600] if res else None}")
    pins[name] = {"picks": res["data"]["picks"], "ductsInFixture": res["data"]["ducts"], "fixtureIds": len(ids), "pinnedAtCommit": git("rev-parse", "--short", "HEAD"), "pinnedUtc": R.utc()}
    PINS.write_text(json.dumps(pins, indent=1), encoding="utf8")
    return pins[name]


def run_variant(variant, name, args, out, results, pins):
    file_, systems = R.MODELS[name]
    path = R.DETACHED / file_
    open_floor = max(R.MIN_FREE_GIB, 16 if name == "chadds" else 10)
    start_floor = open_floor + 3
    for _ in range(int(os.environ.get("PE_PROOF_WAIT_FREE_S", 300)) // 5):
        if psutil.virtual_memory().available / 2**30 >= start_floor:
            break
        time.sleep(5)
    avail = psutil.virtual_memory().available / 2**30
    if avail < start_floor:
        raise RuntimeError(f"{avail:.1f} GiB free < {start_floor} GiB required before starting {variant}")
    ev = out / "ev" / name / variant
    ev.mkdir(parents=True, exist_ok=True)
    R.ensure_backend_host()
    if variant == "nopack":
        os.environ["PE_SPACE_NO_PACK"] = "1"
    else:
        os.environ.pop("PE_SPACE_NO_PACK", None)
    s = R.Session(ev)
    proc = {"variant": variant, "startedUtc": R.utc(), "availableGiBBeforeStart": round(avail, 2), "packBeforeStart": pack_state(), "reads": []}
    results["processes"].append(proc)
    try:
        proc.update(s.start(f"{name}-{variant}", R.GUARD_FLOOR_GIB))
        avail = psutil.virtual_memory().available / 2**30
        proc["availableGiBBeforeOpen"] = round(avail, 2)
        if avail < open_floor:
            raise RuntimeError(f"{avail:.1f} GiB free < {open_floor} GiB required before opening {name}")
        R.slot_log(f"OPENING {name} {variant}; PID {s.pid}; free {avail:.1f} GiB")
        code, env = s.sdk("open", "doc", "open", str(path), "--id", R.SID, "--window", "headless")
        if code != 0:
            s.sdk("dialogs", "session", "dialogs", "--id", R.SID)
            raise RuntimeError(f"open exit {code}: {[d.get('code') for d in (env or {}).get('diagnostics', [])]}")
        s.doc = env["result"]["document"]["openId"]
        R.slot_log(f"OPENED {name} {variant}; PID {s.pid}; timed verb reads follow")
        ps = psutil.Process(s.pid)
        proc["privateAtOpen"] = ps.memory_info().private
        time.sleep(args.settle)
        proc["privateAfterSettle"] = ps.memory_info().private
        mod = s.modified()
        if mod is None or any(mod):
            raise RuntimeError(f"IsModified {mod} after open")
        fixture = json.loads((HERE / "fixture.json").read_text(encoding="utf8"))
        ids = fixture[name][systems[0]]["ids"]
        pin = get_or_pin_picks(s, name, ev, ids, pins, args.take)
        reqs = build_requests(pin["picks"][: args.take])
        if args.first_only:
            reqs = [r for r in reqs if r["idx"] == 0]
        for r in reqs:
            (ev / f"req-{r['id']}.json").write_text(json.dumps(r["request"]), encoding="utf8")
        proc["requests"] = [r["id"] for r in reqs]
        proc["packAfterOpen"] = pack_state()
        for pas in (1, 2):
            if pas == 2 and args.no_repeat:
                break
            for r in reqs:
                before = ps.memory_info().private
                peak = R.Peak(s.pid)
                peak.start()
                tag = f"{r['id']}-p{pas}"
                code, resp, wall = s.pea(tag, ["host", "call", "--key", f"revit.detail.space-{r['verb']}", "--open-document-id", s.doc, "--request-file", str(ev / f"req-{r['id']}.json"), "--verbosity", "full"])
                peak.stop_ = True
                after = ps.memory_info().private
                mod = s.modified()
                read = {"id": r["id"], "verb": r["verb"], "pass": pas, "file": f"{s.n:03d}-{tag}.stdout", "wallS": round(wall, 2), "privateBefore": before, "privateAfter": after,
                        "privatePeak": max(peak.peak, after), "deltaMiB": round((after - before) / MIB, 1), "isModified": mod,
                        "elapsedMs": (resp or {}).get("elapsedMs"), "queryMs": ((resp or {}).get("response") or {}).get("ms")}
                proc["reads"].append(read)
                if code != 0 or resp is None or "response" not in resp:
                    read["error"] = json.dumps({k: v for k, v in (resp or {}).items() if k not in ("operation", "resolvedTarget")})[:1500] if resp else f"pea exit {code}"
                    raise RuntimeError(f"{tag}: {read['error'][:400]}")
                if mod is None or any(mod):
                    raise RuntimeError(f"IsModified {mod} after {tag}")
        proc["packAfterReads"] = pack_state()
        proc["endedUtc"] = R.utc()
    finally:
        try:
            proc["revitPidGone"] = s.stop(discard=True)
        except Exception as error:
            proc["stopError"] = str(error)
            proc["revitPidGone"] = not (s.pid and psutil.pid_exists(s.pid))
        (out / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf8")
        if not proc["revitPidGone"]:
            raise RuntimeError(f"Own Revit PID {s.pid} remains alive; keep slot and backend for SDK recovery")


def cmd_run(args):
    name = args.model
    variants = args.variants.split(",")
    head = git("rev-parse", "HEAD")
    files = space_files(head)
    pins = read_pins()
    out = R.CHECKOUT / ".artifacts" / "accept" / "space-verbs" / f"{git('rev-parse', '--short', 'HEAD')}-{R.utc()}-{name}-{args.label}"
    plan = {"model": name, "variants": variants, "filesSwitched": files, "pinned": name in pins, "out": str(out), "freeGiB": round(psutil.virtual_memory().available / 2**30, 1),
            "dirty": git("status", "--porcelain", "--", "dotnet", "ts"), "otherRevit": [p.pid for p in psutil.process_iter(["name"]) if p.info["name"] == "Revit.exe"]}
    print(json.dumps(plan, indent=1))
    if args.plan:
        return
    if plan["dirty"]:
        sys.exit("working tree has uncommitted product changes; commit them first so every variant is a named commit")
    others = plan["otherRevit"]
    if others and os.environ.get("PE_PROOF_ALLOW_OTHERS") != "1":
        sys.exit(f"Revit.exe running {others}; PE_PROOF_ALLOW_OTHERS=1 only if they are kaitpw's")
    try:
        R.acquire_slot()
    except (OSError, RuntimeError) as error:
        sys.exit(f"Slot not acquired: {error}")
    (R.LOCK / "holder").write_text(f"{R.SID} {R.CHECKOUT} {R.utc()} verbs {name} {variants}\n")
    out.mkdir(parents=True)
    results = {"run": {"head": head, "utc": R.utc(), "label": args.label, "model": name, "variants": variants, "checkout": str(R.CHECKOUT), "sdk": "pe-revit (pinned tool of this checkout)"}, "processes": []}
    failed = None
    try:
        for v in variants:
            print(f"== {name} {v}", flush=True)
            to_variant(v, files, head)
            run_variant(v, name, args, out, results, pins)
    except Exception as e:
        failed = f"{type(e).__name__}: {e}"
        results["aborted"] = failed
        print("ABORTED:", failed, flush=True)
    finally:
        git("checkout", head, "--", *files)
        results["treeRestored"] = git("diff", "HEAD", "--stat") == ""
        (out / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf8")
        alive = [p for p in results["processes"] if p.get("revitPidGone") is False]
        if alive:
            print(f"SLOT KEPT: probe Revit still alive: {[p.get('pid') for p in alive]}", flush=True)
            R.slot_log(f"SLOT KEPT: own Revit still alive; evidence {out}")
        else:
            results["devHostStopped"] = R.stop_dev_host()
            for f in ("owner.txt", "holder"):
                (R.LOCK / f).unlink(missing_ok=True)
            R.LOCK.rmdir()
            R.slot_log(f"RELEASE slot-1; verbs {name} {variants}; own Revit PIDs gone, backend stopped; evidence {out}")
        (out / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf8")
        print(f"results: {out}", flush=True)
    if failed:
        sys.exit(1)


# ---------------------------------------------------------------- offline reports

def load_run(d):
    d = Path(d)
    res = json.loads((d / "results.json").read_text(encoding="utf8"))
    return d, res


def answers(d, res, variant, pas=1):
    out = {}
    for p in res["processes"]:
        if p["variant"] != variant:
            continue
        for r in p["reads"]:
            if r["pass"] == pas and "error" not in r:
                resp = json.loads((d / "ev" / res["run"]["model"] / variant / r["file"]).read_text(encoding="utf8"))
                out[r["id"]] = (r["verb"], resp["response"])
    return out


def cmd_compare(args):
    d, res = load_run(args.run)
    a, b = answers(d, res, args.a), answers(d, res, args.b)
    rows = []
    for rid in sorted(set(a) & set(b)):
        verb = a[rid][0]
        same, detail = compare_answers(verb, a[rid][1], b[rid][1])
        rows.append((rid, verb, same, detail, dominated(verb, detail) if not same else None))
    for rid, verb, same, detail, dom in rows:
        print(f"{rid:9s} {'SAME' if same else ('SUBSET-OF-A' if dom else 'DIFFERENT')}")
        if not same:
            print("   ", json.dumps(detail)[:1800])
    print(f"{sum(1 for r in rows if r[2])}/{len(rows)} identical; {sum(1 for r in rows if r[4])} subset-only; {sum(1 for r in rows if r[2] is False and not r[4])} otherwise different")


def cmd_report(args):
    d, res = load_run(args.run)
    L = [f'# Space verbs {res["run"]["model"]} {res["run"]["head"][:8]} {res["run"]["utc"]}', ""]
    for p in res["processes"]:
        L.append(f'## {p["variant"]} pid {p.get("pid")} build {p.get("buildStamp")}; private at open {p.get("privateAtOpen", 0) / MIB:.0f} MiB, after settle {p.get("privateAfterSettle", 0) / MIB:.0f} MiB; free before open {p.get("availableGiBBeforeOpen")} GiB; pack {p.get("packBeforeStart")} -> {p.get("packAfterReads")}')
        L += ["", "| request | pass | host s | wall s | query ms | delta MiB | peak GiB | modified |", "|---|--:|--:|--:|--:|--:|--:|--|"]
        for r in p["reads"]:
            L.append(f'| {r["id"]} | {r["pass"]} | {(r.get("elapsedMs") or 0) / 1000:.2f} | {r["wallS"]} | {r.get("queryMs")} | {r["deltaMiB"]} | {r["privatePeak"] / 2**30:.2f} | {r["isModified"]} |')
        L.append("")
    print("\n".join(L))


def cmd_selftest(_):
    picks = [{"id": 1, "start": [0, 0, 10], "end": [20, 0, 10], "widthFt": 1.0, "heightFt": 0.5}, {"id": 2, "start": [5, 5, 12], "end": [5, 35, 12], "widthFt": 2.0, "heightFt": 2.0}]
    reqs = build_requests(picks)
    assert [r["id"] for r in reqs] == ["sweep0", "probe0", "slice0", "census0", "sweep1", "probe1", "slice1", "census1"]
    assert reqs[3]["request"]["box"] == [-10, -10, 0, 30, 10, 20]
    assert reqs[0]["request"]["filter"] == {"excludeElementIds": [1]}
    h = lambda i, cat="Ducts": {"documentKey": "k", "elementId": i, "uniqueId": "u", "linkInstanceId": None, "category": cat, "kind": "Solid"}
    ex = {"segments": [{"index": 0, "verdict": "CLEAR", "minGapFt": 1.5, "nearest": h(7), "closestPoint": [1, 2, 3]}], "ms": 5, "stamp": {"x": 1}}
    ex2 = json.loads(json.dumps(ex)); ex2["ms"] = 99; ex2["stamp"] = {"x": 2}
    assert compare_answers("sweep", ex, ex2)[0]
    ex2["segments"][0]["minGapFt"] = 1.6
    assert not compare_answers("sweep", ex, ex2)[0]
    ca = {"buckets": [{"source": "Host", "category": "Walls", "kind": "Solid", "elements": 5, "triangles": 50}], "top": [], "ms": 1}
    cb = {"buckets": [{"source": "Host", "category": "Walls", "kind": "Solid", "elements": 4, "triangles": 40}], "top": [], "ms": 1}
    same, d = compare_answers("census", ca, cb)
    assert not same and dominated("census", d) and not dominated("census", {"bucketDeltas": [[["x"], [1, 1], [2, 1]]]})
    sa = {"elements": [{"handle": h(1), "pieces": [[0.0, 0.0, 1.0, 0.0, 1.0, 1.0]]}, {"handle": h(2), "pieces": [[0.0, 0.0, 1.0, 0.0, 1.0, 1.0]]}], "pieces": 2, "total": 2, "truncated": False, "ms": 1}
    sb = {**sa, "elements": sa["elements"][:1], "pieces": 1, "total": 1}
    same, d = compare_answers("slice", sa, sb)
    assert not same and dominated("slice", d) and d["onlyInA"] == [[None, 2, "Ducts", "Solid", None]]
    pa = {"floor": {"handle": h(3), "distanceFt": 2.0, "z": 8.0}, "ceiling": None, "maxDistanceFt": 200.0, "purpose": "Obstructions", "ms": 3}
    assert compare_answers("probe", pa, json.loads(json.dumps(pa)))[0]
    print("selftest ok")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--model", required=True, choices=["cleremont", "chadds"])
    r.add_argument("--variants", default="main,scoped,nopack")
    r.add_argument("--label", default="verbs")
    r.add_argument("--first-only", action="store_true")
    r.add_argument("--no-repeat", action="store_true")
    r.add_argument("--take", type=int, default=2)
    r.add_argument("--settle", type=int, default=90)
    r.add_argument("--plan", action="store_true")
    c = sub.add_parser("compare"); c.add_argument("run"); c.add_argument("a"); c.add_argument("b")
    p = sub.add_parser("report"); p.add_argument("run")
    sub.add_parser("selftest")
    args = ap.parse_args()
    {"run": cmd_run, "compare": cmd_compare, "report": cmd_report, "selftest": cmd_selftest}[args.cmd](args)


if __name__ == "__main__":
    main()
