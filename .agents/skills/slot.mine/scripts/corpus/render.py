"""render.py: re-render <run-dir>/retro.html from the run's artifacts plus optional roles, without rerunning the pipeline.

python .agents/skills/slot.mine/scripts/corpus/render.py --run <run-dir> [--roles roles.json] [--seed 7] [--samples-per-group 3] [--out retro.html]

Reads: run.json lanes.json epochs.json threads.json events.jsonl coverage.json commits.json native_summary.json survival.json (+ roles).
Writes: retro.html (page.template.html with two JSON blocks substituted: id="retro-data", id="retro-roles") and samples.jsonl (drawn again with the roles).
roles.json schema, exactly as this file consumes it (merge_labels.py writes it; label_brief.md explains how to label):
    { "<lane short id or full thread id>": { "<epoch n as a string>": "<role>", "*": "<default role for the lane>" } }
  a lane or epoch absent from the file is `unlabelled`. Optional sibling roles.detail.json ({"<short>": {"<n>": {...evidence...}}}) is shown in the epoch panel.
The page embeds {"roles": roles.json, "detail": roles.detail.json or {}} in the retro-roles block; no network, no CDN, opens from file://.
"""
import argparse, collections, datetime, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
import stage_samples

OWNER_CAP, PREV_CAP, FIN_CAP, N_FIN = 3000, 1200, 500, 5
PLACEHOLDERS = ("/*__RETRO_DATA__*/", "/*__RETRO_ROLES__*/")


def safe_json(obj):
    """JSON for an inline <script type=application/json> block: no `</script`, no `<!--`."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/").replace("<!--", "<\\u0021--")


def substitute(template, data, roles_block):
    """Each placeholder must occur exactly once in the template (a template that lost one would silently drop the data)."""
    bad = [p for p in PLACEHOLDERS if template.count(p) != 1]
    if bad: raise ValueError(f"template must contain each placeholder exactly once: {bad}")
    html = template.replace(PLACEHOLDERS[0], safe_json(data)).replace(PLACEHOLDERS[1], safe_json(roles_block))
    left = [p for p in PLACEHOLDERS if p in html]
    if left: raise ValueError(f"placeholders left unreplaced: {left}")
    return html


def trunc(s, n): return (s or "")[:n]


def build_data(run_dir, roles, detail, seed, per_group):
    P = lambda n: os.path.join(run_dir, n)
    RJ = load(P("run.json")); LN = load(P("lanes.json")); EP = load(P("epochs.json")); TH = load(P("threads.json"))["threads"]
    parent_of = {t: v["parent"] for t, v in TH.items()}; lane_set = {l["id"] for l in LN["lanes"]}; lane_by_id = {l["id"]: l for l in LN["lanes"]}
    runs = {r["run"]: r for v in TH.values() for r in v["runs"]}
    finals = collections.defaultdict(list); owners = []
    for e in jl(P("events.jsonl")):
        if e["kind"] == "final_reply": finals[e["thread"]].append(e)
        elif e["kind"] == "owner_turn": owners.append(e)
    for v in finals.values(): v.sort(key=lambda e: e["ts"])
    owner_rows, by_epoch = [], collections.defaultdict(list)
    for e in sorted(owners, key=lambda e: e["ts"]):
        lane = lane_of(parent_of, lane_set, e["thread"]); L = lane_by_id.get(lane)
        n = epoch_n(L["epochs"], e["ts"]) if L and L["epochs"] else None
        prev = None
        for y in finals.get(e["thread"], []):
            if y["ts"] < e["ts"]: prev = y
            else: break
        r = runs.get(e.get("run")) or {}
        row = dict(i=len(owner_rows), ts=e["ts"], lane=lane, lane_short=L["short"] if L else None, lane_title=L["title"][:80] if L else None, epoch=n, thread=e["thread"], src=e.get("source"),
                   model=r.get("model"), effort=r.get("effort"), text=trunc(e["text"], OWNER_CAP), chars=e["chars"],
                   prev=dict(ts=prev["ts"], model=prev.get("model"), effort=prev.get("effort"), text=trunc(prev["text"], PREV_CAP), chars=prev["chars"]) if prev else None)
        owner_rows.append(row)
        if lane and n is not None: by_epoch[(lane, n)].append(row["i"])
    answered = {(r["thread"], r["prev"]["ts"]) for r in owner_rows if r["prev"]}
    for L in LN["lanes"]:
        for ep in L["epochs"]:
            ep["oi"] = by_epoch.get((L["id"], ep["n"]), [])
            fin = [y for t in [L["id"]] for y in finals.get(t, []) if ep["start"] <= y["ts"] < (ep["end"] if ep is not L["epochs"][-1] else "9999") and (t, y["ts"]) not in answered]
            ep["nfin"] = len(fin)
            ep["fin"] = [dict(ts=y["ts"], model=y.get("model"), effort=y.get("effort"), text=trunc(y["text"], FIN_CAP), chars=y["chars"]) for y in fin[-N_FIN:]]
    samples, pop = stage_samples.build(run_dir, roles, seed, per_group)
    with open(P("samples.jsonl"), "w", encoding="utf-8") as f:
        for r in samples: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    S = load(P("survival.json")) if os.path.exists(P("survival.json")) else None
    numbers = dict(coverage=load(P("coverage.json")), coverage_text=open(P("coverage.txt"), encoding="utf-8").read(), native=load(P("native_summary.json")) if os.path.exists(P("native_summary.json")) else None,
                   rule=EP["rule"], epoch_stats=dict(lanes=len(LN["lanes"]), epochs=sum(len(l["epochs"]) for l in LN["lanes"]), cap_driven_lanes=sum(1 for l in LN["lanes"] if l["cap_driven"])),
                   owner_turns=len(owner_rows), relays=sum(l["epochs"][i]["relays"] for l in LN["lanes"] for i in range(len(l["epochs"]))))
    phases = []
    if S:
        by = S["by"]
        numbers["survival"] = dict(head=S["head"], blame_flags=S["blame_flags"], totals=S["totals"], churn_total_lines=S["churn_total_lines"], skipped=len(S["skipped"]), phases=S["phases"], phase_params=S["phase_params"],
                                   next_phase=S["survive_next_phase"], deciles=S["churn_deciles"], by_model=by["model"][:20], by_lane=[dict(x, key=(lane_by_id.get(x["key"], {}).get("short", x["key"]) + " " + lane_by_id.get(x["key"], {}).get("title", "")[:40])) for x in by["lane"][:25]],
                                   by_method=by["method"], by_phase=by["phase"], by_epoch=by["epoch"][:40], modules=S["modules"])
        phases = [dict(n=p["n"], kind=p["kind"], start=p["start"], end=p["end"], commits=p["commits"], ratio=p["del_ins_ratio"], survival=p["survival_to_end"]) for p in S["phases"]]
    return dict(meta=dict(window=LN["window"], project=RJ["project"], head=RJ.get("head") or numbers["coverage"]["head"], repo=RJ["repo"], main=RJ["main"], opts=RJ.get("opts", {}), command=RJ.get("command"),
                          stage_secs=RJ.get("stage_secs", {}), rendered=datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), roles=bool(roles), seed=seed),
                lanes=LN["lanes"], edges=LN["edges"], phases=phases, owner=owner_rows, samples=samples, sample_pop=pop, numbers=numbers)


def render(run_dir, roles_path=None, seed=None, per_group=None, out=None):
    run_dir = os.path.abspath(run_dir)
    RJ = load(os.path.join(run_dir, "run.json"))
    roles = load(roles_path) if roles_path else {}
    dpath = os.path.join(os.path.dirname(os.path.abspath(roles_path)), "roles.detail.json") if roles_path else None
    detail = load(dpath) if dpath and os.path.exists(dpath) else {}
    seed = seed if seed is not None else RJ.get("opts", {}).get("seed", 7)
    per_group = per_group if per_group is not None else RJ.get("opts", {}).get("samples_per_group", 3)
    data = build_data(run_dir, roles, detail, seed, per_group)
    html = substitute(open(os.path.join(HERE, "page.template.html"), encoding="utf-8").read(), data, dict(roles=roles, detail=detail))
    path = out or os.path.join(run_dir, "retro.html")
    open(path, "w", encoding="utf-8").write(html)
    print(f"render: {path} {len(html) / 1e6:.2f} MB; lanes {len(data['lanes'])}; owner turns {len(data['owner'])}; samples {len(data['samples'])}; roles {'yes' if roles else 'none'}")
    return path


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--run", required=True); ap.add_argument("--roles"); ap.add_argument("--seed", type=int); ap.add_argument("--samples-per-group", type=int); ap.add_argument("--out")
    a = ap.parse_args()
    render(a.run, a.roles, a.seed, a.samples_per_group, a.out)
