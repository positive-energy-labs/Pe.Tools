"""Stage samples: a seeded blind-review sample of final replies, each paired with the owner turn that followed it (if any) -> samples.jsonl.

Groups are (model, lane role) where the role comes from roles.json (run dir or --roles) and is `unlabelled` when no role exists. Per group, up to
--samples-per-group (default 3) final replies are drawn with random.Random(f"{seed}:{group}") over replies sorted by message id, so a rerun with
the same seed and the same labels draws the same replies. A reply is paired with the next event of its own thread when that event is an owner turn
(not another final reply). The page shows the reply with its source hidden, and reveals model, lane, role and the owner turn on demand.
render.py calls build() again with the roles it is given, so labelling never needs a pipeline rerun.
"""
import collections, json, random
from common import *


def build(run_dir, roles=None, seed=7, per_group=3, reply_cap=3000, owner_cap=2000):
    TH = load(os.path.join(run_dir, "threads.json"))["threads"]; EP = load(os.path.join(run_dir, "epochs.json"))["lanes"]
    parent_of = {t: v["parent"] for t, v in TH.items()}; lane_set = set(EP)
    by_thread = collections.defaultdict(list)
    for e in jl(os.path.join(run_dir, "events.jsonl")):
        if e["kind"] in ("final_reply", "owner_turn"): by_thread[e["thread"]].append(e)
    groups = collections.defaultdict(list)
    for t, evs in by_thread.items():
        evs.sort(key=lambda e: (e["ts"], 0 if e["kind"] == "final_reply" else 1))
        lane = lane_of(parent_of, lane_set, t)
        for i, e in enumerate(evs):
            if e["kind"] != "final_reply" or not (e.get("text") or "").strip(): continue
            n = epoch_n(EP[lane]["epochs"], e["ts"]) if lane and EP[lane]["epochs"] else None
            role = role_for(roles, TH[lane]["short"], lane, n) if lane else None
            nxt = evs[i + 1] if i + 1 < len(evs) and evs[i + 1]["kind"] == "owner_turn" else None
            groups[(e.get("model") or "?", role or "unlabelled")].append((e, lane, n, role, nxt))
    rows = []
    for key in sorted(groups):
        items = sorted(groups[key], key=lambda x: x[0]["msg"])
        for e, lane, n, role, nxt in random.Random(f"{seed}:{key[0]}|{key[1]}").sample(items, min(per_group, len(items))):
            rows.append(dict(id=e["msg"], group=f"{key[0]} / {key[1]}", model=key[0], effort=e.get("effort"), role=role or "unlabelled", lane=lane, lane_short=TH[lane]["short"] if lane else None,
                             lane_title=TH[lane]["title"][:90] if lane else None, epoch=n, thread=e["thread"], ts=e["ts"], reply=e["text"][:reply_cap], reply_chars=e["chars"],
                             next_owner=dict(ts=nxt["ts"], text=nxt["text"][:owner_cap], chars=nxt["chars"], gap_min=round((ts(nxt["ts"]) - ts(e["ts"])).total_seconds() / 60, 1)) if nxt else None))
    return rows, {f"{k[0]} / {k[1]}": len(v) for k, v in groups.items()}


def run(R, roles_path=None):
    rp = roles_path or (R.p("roles.json") if os.path.exists(R.p("roles.json")) else None)
    roles = load(rp) if rp else None
    rows, pop = build(R.out, roles, R.opts.get("seed", 7), R.opts.get("samples_per_group", 3))
    with open(R.p("samples.jsonl"), "w", encoding="utf-8") as f:
        for r in rows: f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"samples: {len(rows)} replies from {len(pop)} (model, role) groups; roles {'from ' + rp if rp else 'none -> all unlabelled'}; {sum(1 for r in rows if r['next_owner'])} paired with a following owner turn")
