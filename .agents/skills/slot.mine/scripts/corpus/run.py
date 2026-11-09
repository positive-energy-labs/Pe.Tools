"""corpus: one command from T3 + transcripts + git to a retro page. Stdlib only; read-only on the T3 database and git.

python .agents/skills/slot.mine/scripts/corpus/run.py --project <t3-project-id> --since 2026-10-26T05:00:00Z --until 2026-11-10T06:00:00Z --out <run-dir> [--repo .] [--main main] [--stages t3,native,...]

Bounds are explicit UTC instants (a bare date is 00:00:00Z); since is inclusive, until exclusive; both are echoed in every output (run.json, coverage.txt, the page).
Stages run in order, each a module that reads and writes files in <run-dir>, so any stage reruns alone with the same --out (omitted args fall back to run.json):
  t3        threads, runs (per-run model + effort), messages -> events            t3_threads.json t3_events.jsonl t3_provider_threads.json
  native    transcripts -> tokens, dollars by model, tool-call mix                native.json native_summary.json
  commits   main commits in the window, attribution, landed per branch thread     commits.json landed.json
  epochs    lanes, epochs, fingerprints, shards                                   events.jsonl threads.json epochs.json lanes.json coverage.txt shards/
  survival  churn clock, phases, line survival, per-module table (exploratory)     survival.json survival.txt blame_head.json
  samples   seeded blind-review sample of final replies + the owner turn after    samples.jsonl
  page      render.py -> retro.html (+ optional --roles)
Tuning flags (stage defaults in the module docstrings): --sim --max-epochs --tiny-events --tiny-minutes --shard-cap --workers --blame-C --seed --samples-per-group.
Labelling is a separate loop: label_brief.md -> merge_labels.py -> render.py --run <run-dir> --roles roles.json. The pipeline never asks agents about roles.
"""
import argparse, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--project"); ap.add_argument("--since"); ap.add_argument("--until"); ap.add_argument("--out", required=True)
    ap.add_argument("--repo"); ap.add_argument("--main"); ap.add_argument("--stages", help="comma list, default all: " + ",".join(STAGES))
    ap.add_argument("--roles", help="roles.json for the page stage")
    ap.add_argument("--sim", type=float); ap.add_argument("--max-epochs", type=int); ap.add_argument("--tiny-events", type=int); ap.add_argument("--tiny-minutes", type=float)
    ap.add_argument("--shard-cap", type=int); ap.add_argument("--workers", type=int)
    ap.add_argument("--blame-C", action="store_true", help="also follow lines copied from other files (git blame -C); slow")
    ap.add_argument("--no-move-detect", action="store_true", help="blame without -M (old behaviour: moved lines count as new)")
    ap.add_argument("--seed", type=int); ap.add_argument("--samples-per-group", type=int)
    a = ap.parse_args()
    prev = {}
    if os.path.exists(os.path.join(a.out, "run.json")): prev = load(os.path.join(a.out, "run.json"))
    pick = lambda v, k, d=None: v if v is not None else prev.get(k, d)
    opts = dict(prev.get("opts", {}))
    for k in ("sim", "max_epochs", "tiny_events", "tiny_minutes", "shard_cap", "workers", "seed", "samples_per_group"):
        v = getattr(a, k)
        if v is not None: opts[k] = v
    if a.blame_C: opts["blame_C"] = True
    if a.no_move_detect: opts["move_detect"] = False
    project, since, until = pick(a.project, "project"), pick(a.since, "since"), pick(a.until, "until")
    if not (project and since and until): ap.error("--project, --since and --until are required (or an existing run.json in --out)")
    R = Run(a.out, project, since, until, pick(a.repo, "repo", "."), pick(a.main, "main", "main"), **opts)
    dump(R.p("run.json"), dict(R.params(), command=" ".join(sys.argv), stages_run=prev.get("stages_run", []), stage_secs=prev.get("stage_secs", {})))
    stages = a.stages.split(",") if a.stages else STAGES
    bad = [s for s in stages if s not in STAGES]
    if bad: ap.error(f"unknown stage {bad}; stages are {STAGES}")
    print(f"corpus: project {R.project}\ncorpus: window {R.lo} <= t < {R.hi} (UTC)\ncorpus: repo {R.repo} {R.main}\ncorpus: out {R.out}\ncorpus: stages {stages}", flush=True)
    secs = {}
    for s in STAGES:
        if s not in stages: continue
        t0 = time.time()
        if s == "page":
            import render
            render.render(R.out, a.roles or (R.p("roles.json") if os.path.exists(R.p("roles.json")) else None))
        elif s == "samples":
            import stage_samples; stage_samples.run(R, a.roles)
        else:
            mod = __import__("stage_" + s); mod.run(R)
        secs[s] = round(time.time() - t0, 1)
        print(f"corpus: stage {s} done in {secs[s]} s", flush=True)
        j = load(R.p("run.json")); j["stages_run"] = sorted(set(j.get("stages_run", [])) | {s}); j["stage_secs"] = {**j.get("stage_secs", {}), **{s: secs[s]}}
        dump(R.p("run.json"), j)


if __name__ == "__main__":
    main()
