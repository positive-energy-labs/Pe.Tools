"""Region admission A/B: the same Region-shaped Space requests against two builds of this checkout (spatial ledger, 2026-11-02).

    python tools/space-proof/admission.py run --model chadds|cleremont|manuella [--models a,b] --variants A,B [--base-ref REF] [--extras] [--label L] [--plan]

One hold of `.artifacts/locks/revit-slot-1` (ORDER decides; id from PE_PROOF_SESSION). Per model and variant one fresh headless
SDK-controlled session on the model's local copy (the same Session, floors and peak sampler as run.py / verbs.py). Variants:
    A   --base-ref (default 85db8cb5): the Space files exactly as the damage left them (every verb prepares the whole region box)
    B   HEAD: Sweep and Probe prepare their own reach, cost planning counts every prepare before geometry acquisition
The driver switches the product files with `git checkout <ref> -- <files>` and renames files A does not have to `*.off`, and refuses to
finish unless `git diff HEAD` is empty afterwards. Requests are verbs.py's (pinned picks, verbs-requests.json) in the Region shape.
Per request: pass 1 (first touch) and pass 2 (repeat); wall s, host ms, Revit private bytes before/after and 4 Hz peak. A refusal or
error is recorded as the answer (A must be able to refuse a Curve2D sweep) and does not stop the run; any IsModified does.
--extras link,meshes,ladder (Chadds): the read-cost ladder, one kind per process so each first touch is cold. link: SA 7 and SA 7 + EX 7 scenes under
link-boxes; meshes: SA 7 meshes at 2, 5, 10, 15 ft; ladder: nested boxes through space-census (count, time, memory).
"""
import argparse, json, os, subprocess, sys, time
from pathlib import Path

import psutil

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run as R  # noqa: E402
import verbs as V  # noqa: E402

MIB = 2**20
NEW_FILES = ["dotnet/Pe.Revit.Space/GeometryCost.cs"]


def git(*a):
    return R.git(*a)


def changed_files(base):
    names = git("diff", "--name-only", "--diff-filter=ACM", base, "HEAD", "--", "dotnet").splitlines()
    return [n for n in names if "/Pe.Revit.Tests/" not in n and n.endswith(".cs") and n not in NEW_FILES]


def to_variant(variant, base, files):
    if variant == "A":
        git("checkout", base, "--", *files)
        for f in NEW_FILES:
            p = R.CHECKOUT / f
            if p.exists():
                p.rename(str(p) + ".off")
    else:
        for f in NEW_FILES:
            off = Path(str(R.CHECKOUT / f) + ".off")
            if off.exists():
                off.rename(R.CHECKOUT / f)
        git("checkout", "HEAD", "--", *files)


REVIT_LOG = Path(os.environ["LOCALAPPDATA"]) / "Positive Energy" / "Pe.Tools" / "logs" / "revit.log.txt"


def log_size():
    return REVIT_LOG.stat().st_size if REVIT_LOG.exists() else 0


def budget_lines(since):
    """Historical budget log lines (new builds report cost in their stamp) written since `since` (Serilog's file sink; `session logs` does not carry them)."""
    if not REVIT_LOG.exists():
        return []
    with REVIT_LOG.open("rb") as f:
        f.seek(since)
        text = f.read().decode("utf8", "replace")
    return [line.strip() for line in text.splitlines() if "Space budget" in line]


def call(s, ps, ev, tag, key, request, extra_args=()):
    """One host call with its memory envelope. Errors are answers: the response (or its refusal) is kept."""
    logged = log_size()
    reqf = ev / f"req-{tag}.json"
    reqf.write_text(json.dumps(request), encoding="utf8")
    before = ps.memory_info().private
    peak = R.Peak(s.pid)
    peak.start()
    code, resp, wall = s.pea(tag, ["host", "call", "--key", key, "--open-document-id", s.doc, "--request-file", str(reqf), "--verbosity", "full", *extra_args])
    peak.stop_ = True
    after = ps.memory_info().private
    mod = s.modified()
    read = {"id": tag, "key": key, "file": f"{s.n:03d}-{tag}.stdout", "wallS": round(wall, 2), "privateBefore": before, "privateAfter": after,
            "privatePeak": max(peak.peak, after), "deltaMiB": round((after - before) / MIB, 1), "isModified": mod,
            "elapsedMs": (resp or {}).get("elapsedMs"), "queryMs": ((resp or {}).get("response") or {}).get("ms")}
    if code != 0 or resp is None or "response" not in resp:
        read["error"] = json.dumps({k: v for k, v in (resp or {}).items() if k not in ("operation", "resolvedTarget")})[:2500] if resp else f"pea exit {code}"
    read["budget"] = budget_lines(logged)
    if mod is None or any(mod):
        raise RuntimeError(f"IsModified {mod} after {tag}")
    return read, resp


def ladder(s, ps, ev, proc, centre, cap_cost):
    """Nested boxes round the pinned SA 7 neighbourhood through space-census (a Verbs.Census prepare): count, time, memory per box."""
    cx, cy = centre
    for half in [10, 20, 40, 60, 80, 120, 160]:
        box = [cx - half, cy - half, -20, cx + half, cy + half, 60]
        read, resp = call(s, ps, ev, f"ladder-{half}", "revit.detail.space-census", {"box": box})
        read["half"] = half
        read["box"] = box
        if resp and "response" in resp:
            a = resp["response"]
            read["candidates"] = a["searched"]["candidates"]
            read["examined"] = a["searched"]["examined"]
            read["sources"] = [{"source": x.get("kind"), "elements": x.get("elements")} for x in a["stamp"]["sources"]]
        proc["reads"].append(read)
        print(f"  ladder half={half}: candidates {read.get('candidates')} {read['wallS']}s {read['deltaMiB']} MiB", flush=True)
        if read.get("error"):
            break
        if read.get("candidates", 0) > cap_cost:
            break


def scenes(s, ps, ev, proc, ids, label, plan):
    """Chadds scenes at stated reaches. One representation per process: a first touch is paid once, so cold costs need fresh processes."""
    for rep, pad in plan:
        tag = f"scene-{label}-{rep}-{pad}"
        read, resp = call(s, ps, ev, tag, "revit.detail.space-scene",
                          {"elementIds": ids, "contextPaddingFt": pad, "contextRepresentation": rep, "focusOnly": False, "maxTriangles": 3000000})
        read["representation"] = rep
        read["padFt"] = pad
        if resp and "response" in resp:
            sc = resp["response"].get("scene") or resp["response"]
            read["receipt"] = {k: sc.get(k) for k in ("elements", "focusElements", "contextElements", "triangles", "completeness", "work", "sources")}
            read["artifact"] = resp["response"].get("id")
        proc["reads"].append(read)
        print(f"  {tag}: {read['wallS']}s {read['deltaMiB']} MiB {'ERROR' if read.get('error') else ''}", flush=True)
        if read.get("error"):
            break


def run_variant(variant, model, args, out, results, pins):
    file_, systems = R.MODELS[model]
    path = R.DETACHED / file_
    open_floor = max(R.MIN_FREE_GIB, 16 if model == "chadds" else 10)
    start_floor = open_floor + 3
    for _ in range(int(os.environ.get("PE_PROOF_WAIT_FREE_S", 300)) // 5):
        if psutil.virtual_memory().available / 2**30 >= start_floor:
            break
        time.sleep(5)
    avail = psutil.virtual_memory().available / 2**30
    if avail < start_floor:
        raise RuntimeError(f"{avail:.1f} GiB free < {start_floor} GiB required before starting {model} {variant}")
    ev = out / "ev" / model / variant
    ev.mkdir(parents=True, exist_ok=True)
    R.ensure_backend_host()
    s = R.Session(ev)
    proc = {"model": model, "variant": variant, "startedUtc": R.utc(), "availableGiBBeforeStart": round(avail, 2), "reads": []}
    results["processes"].append(proc)
    try:
        proc.update(s.start(f"{model}-{variant}", R.GUARD_FLOOR_GIB))
        # The payload build leaves compiler and MSBuild servers resident (≈4 GiB): they would count against the open floor.
        subprocess.run(["dotnet", "build-server", "shutdown"], capture_output=True, timeout=120)
        # Other holders' memory moves under us; the floor is a rule, so wait for it with the idle session up (it holds 2.3 GiB).
        for _ in range(int(os.environ.get("PE_PROOF_WAIT_FREE_S", 300)) // 5):
            if psutil.virtual_memory().available / 2**30 >= open_floor:
                break
            time.sleep(5)
        avail = psutil.virtual_memory().available / 2**30
        proc["availableGiBBeforeOpen"] = round(avail, 2)
        if avail < open_floor:
            raise RuntimeError(f"{avail:.1f} GiB free < {open_floor} GiB required before opening {model}")
        R.slot_log(f"OPENING {model} {variant}; PID {s.pid}; free {avail:.1f} GiB")
        code, env = s.sdk("open", "doc", "open", str(path), "--id", R.SID, "--window", "headless")
        if code != 0:
            s.sdk("dialogs", "session", "dialogs", "--id", R.SID)
            raise RuntimeError(f"open exit {code}: {[d.get('code') for d in (env or {}).get('diagnostics', [])]}")
        s.doc = env["result"]["document"]["openId"]
        R.slot_log(f"OPENED {model} {variant}; PID {s.pid}; timed reads follow")
        ps = psutil.Process(s.pid)
        proc["privateAtOpen"] = ps.memory_info().private
        time.sleep(args.settle)
        proc["privateAfterSettle"] = ps.memory_info().private
        mod = s.modified()
        if mod is None or any(mod):
            raise RuntimeError(f"IsModified {mod} after open")
        fixture = json.loads((HERE / "fixture.json").read_text(encoding="utf8"))
        ids = fixture[model][systems[0]]["ids"]
        pin = V.get_or_pin_picks(s, model, ev, ids, pins, args.take)
        reqs = [] if args.no_verbs else V.build_requests(pin["picks"][: args.take])
        if args.first_only:
            reqs = [r for r in reqs if r["idx"] == 0]
        # A Curve2D sweep, the request step 6 made refuse on a region-prepared world (Cleremont has the DWGs that make it non-trivial).
        first = next((r for r in reqs if r["verb"] == "sweep"), None)
        if first: reqs.append({"id": "sweepcad0", "verb": "sweep", "idx": 0, "request": {**first["request"], "filter": {**first["request"]["filter"], "kinds": ["Curve2D"]}}})
        proc["requests"] = [r["id"] for r in reqs]
        for pas in range(1, (0 if args.no_repeat else 1) + 2):
            for r in reqs:
                tag = f"{r['id']}-p{pas}"
                read, resp = call(s, ps, ev, tag, f"revit.detail.space-{r['verb']}", r["request"])
                read.update({"verb": r["verb"], "pass": pas, "reqId": r["id"]})
                proc["reads"].append(read)
        extras = (args.extras or "").split(",")
        if model == "chadds" and "link" in extras:
            scenes(s, ps, ev, proc, fixture[model]["SA 7"]["ids"], "sa7", [("link-boxes", 15)])
            scenes(s, ps, ev, proc, fixture[model]["SA 7"]["ids"] + fixture[model]["EX 7"]["ids"], "sa7ex7", [("link-boxes", 15)])
        if model == "chadds" and "meshes" in extras:
            scenes(s, ps, ev, proc, fixture[model]["SA 7"]["ids"], "sa7", [("meshes", 2), ("meshes", 5), ("meshes", 10), ("meshes", 15)])
        if model == "chadds" and "ladder" in extras:
            c = pin["picks"][0]
            ladder(s, ps, ev, proc, ((c["start"][0] + c["end"][0]) / 2, (c["start"][1] + c["end"][1]) / 2), args.ladder_cap)
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
    models = (args.models or args.model).split(",")
    variants = args.variants.split(",")
    head = git("rev-parse", "HEAD")
    files = changed_files(args.base_ref)
    pins = V.read_pins()
    out = R.CHECKOUT / ".artifacts" / "accept" / "space-admission" / f"{git('rev-parse', '--short', 'HEAD')}-{R.utc()}-{args.label}"
    plan = {"models": models, "variants": variants, "base": args.base_ref, "filesSwitched": files, "out": str(out),
            "freeGiB": round(psutil.virtual_memory().available / 2**30, 1), "dirty": git("status", "--porcelain", "--", "dotnet", "ts"),
            "otherRevit": [p.pid for p in psutil.process_iter(["name"]) if p.info["name"] == "Revit.exe"]}
    print(json.dumps(plan, indent=1))
    if args.plan:
        return
    if plan["dirty"]:
        sys.exit("working tree has uncommitted product changes; commit them first so every variant is a named commit")
    if plan["otherRevit"] and os.environ.get("PE_PROOF_ALLOW_OTHERS") != "1":
        sys.exit(f"Revit.exe running {plan['otherRevit']}; PE_PROOF_ALLOW_OTHERS=1 only if they are not this proof's")
    holder = R.LOCK / "holder"
    held = holder.exists() and holder.read_text(encoding="utf8").startswith(R.SID)
    if not held:
        try:
            R.acquire_slot()
        except (OSError, RuntimeError) as error:
            sys.exit(f"Slot not acquired: {error}")
    holder.write_text(f"{R.SID} {R.CHECKOUT} {R.utc()} admission {models} {variants}\n")
    out.mkdir(parents=True)
    results = {"run": {"head": head, "base": args.base_ref, "utc": R.utc(), "label": args.label, "models": models, "variants": variants}, "processes": []}
    failed = None
    try:
        for model in models:
            for v in variants:
                print(f"== {model} {v}", flush=True)
                to_variant(v, args.base_ref, files)
                run_variant(v, model, args, out, results, pins)
    except Exception as e:
        failed = f"{type(e).__name__}: {e}"
        results["aborted"] = failed
        print("ABORTED:", failed, flush=True)
    finally:
        to_variant("B", args.base_ref, files)
        results["treeRestored"] = git("diff", "HEAD", "--stat") == ""
        (out / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf8")
        alive = [p for p in results["processes"] if p.get("revitPidGone") is False]
        if alive:
            print(f"SLOT KEPT: own Revit still alive: {[p.get('pid') for p in alive]}", flush=True)
            R.slot_log(f"SLOT KEPT: own Revit still alive; evidence {out}")
        elif args.keep_slot:
            print("slot kept for the next step", flush=True)
        else:
            results["devHostStopped"] = R.stop_dev_host()
            for f in ("owner.txt", "holder"):
                (R.LOCK / f).unlink(missing_ok=True)
            R.LOCK.rmdir()
            R.slot_log(f"RELEASE slot-1; admission {models} {variants}; own Revit PIDs gone, backend stopped; evidence {out}")
        (out / "results.json").write_text(json.dumps(results, indent=1, default=str), encoding="utf8")
        print(f"results: {out}", flush=True)
    if failed:
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--model", default="chadds")
    r.add_argument("--models")
    r.add_argument("--variants", default="A,B")
    r.add_argument("--base-ref", default="85db8cb5")
    r.add_argument("--extras", default="", help="comma list: link, meshes, ladder (Chadds, B)")
    r.add_argument("--label", default="admission")
    r.add_argument("--take", type=int, default=2)
    r.add_argument("--settle", type=float, default=20)
    r.add_argument("--first-only", action="store_true")
    r.add_argument("--no-verbs", action="store_true", help="skip the verb requests (a process kept cold for an extras measurement)")
    r.add_argument("--no-repeat", action="store_true")
    r.add_argument("--ladder-cap", type=int, default=60000)
    r.add_argument("--keep-slot", action="store_true")
    r.add_argument("--plan", action="store_true")
    r.set_defaults(func=cmd_run)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
