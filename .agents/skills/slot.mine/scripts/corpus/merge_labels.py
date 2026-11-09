"""merge_labels.py: merge labelled JSONL batches (see label_brief.md) into roles.json, the file render.py consumes.

python .agents/skills/slot.mine/scripts/corpus/merge_labels.py --out <run-dir>/roles.json [--into old/roles.json] [--epochs <run-dir>/epochs.json] batch1.jsonl batch2.jsonl ...
python .agents/skills/slot.mine/scripts/corpus/merge_labels.py --out <run-dir>/roles.json --remap-roles old/roles.json --remap-from old/epochs.json --epochs <run-dir>/epochs.json

roles.json (exactly what render.py reads):  { "<lane short id>": { "<epoch n>": "<role>", "*": "<optional default role for the lane>" } }
roles.detail.json (written beside it, shown in the epoch panel):  { "<short>": { "<n>": {role, secondary, confidence, evidence, evidence_ts, switch, switch_ts},
                                                                              "_lane": {lane_summary, notable_owner_corrections} } }
Rules: a later batch overrides an earlier one for the same (lane, epoch) and the override is reported; with --epochs, a (lane, epoch) the run does not have
is dropped and reported (labels never silently attach to the wrong epoch); a row without a role is dropped and reported. --remap-roles carries labels from
an older run whose epoch numbers differ: each new epoch takes the role of the old epoch it overlaps most in time (lane matched by short id).
"""
import argparse, datetime, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load, dump


def merge(rows, epochs=None, roles=None, detail=None):
    """rows: parsed JSONL objects. epochs: epochs.json['lanes'] or None. Returns (roles, detail, report)."""
    roles = {k: dict(v) for k, v in (roles or {}).items()}; detail = {k: dict(v) for k, v in (detail or {}).items()}
    valid = {v["short"]: {str(e["n"]) for e in v["epochs"]} for v in (epochs or {}).values() if "short" in v} if epochs else None
    rep = dict(rows=len(rows), set=0, overridden=[], dropped_unknown=[], dropped_no_role=[], lane_summaries=0)
    for r in rows:
        lane, n = r.get("lane"), r.get("epoch")
        if lane is None or n is None: rep["dropped_no_role"].append(r); continue
        if valid is not None and (lane not in valid or (n != 0 and str(n) not in valid[lane])): rep["dropped_unknown"].append([lane, n]); continue
        if n == 0:
            detail.setdefault(lane, {})["_lane"] = {k: r.get(k) for k in ("lane_summary", "notable_owner_corrections")}; rep["lane_summaries"] += 1; continue
        if not r.get("role"): rep["dropped_no_role"].append([lane, n]); continue
        old = roles.get(lane, {}).get(str(n))
        if old and old != r["role"]: rep["overridden"].append([lane, n, old, r["role"]])
        roles.setdefault(lane, {})[str(n)] = r["role"]; rep["set"] += 1
        detail.setdefault(lane, {})[str(n)] = {k: r.get(k) for k in ("role", "secondary", "confidence", "evidence", "evidence_ts", "switch", "switch_ts")}
    return roles, detail, rep


def _secs(s):
    import datetime
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def remap(roles, old_epochs, new_epochs):
    """Carry roles from an older run: per lane (matched by short), each new epoch takes the role of the old epoch with the largest time overlap."""
    old_by = {v["short"]: v for v in old_epochs.values() if "short" in v}; out, report = {}, dict(lanes=0, epochs=0, unmatched=[])
    for v in new_epochs.values():
        sh = v.get("short"); r = roles.get(sh); o = old_by.get(sh)
        if not r or not o: continue
        report["lanes"] += 1; out[sh] = {k: x for k, x in r.items() if k == "*"}
        for e in v["epochs"]:
            best, bo = None, 0
            for oe in o["epochs"]:
                ov = min(_secs(e["end"]), _secs(oe["end"])) - max(_secs(e["start"]), _secs(oe["start"]))
                if ov > bo: best, bo = oe, ov
            role = r.get(str(best["n"])) if best else None
            if role: out[sh][str(e["n"])] = role; report["epochs"] += 1
            else: report["unmatched"].append([sh, e["n"]])
    return out, report


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("batches", nargs="*"); ap.add_argument("--out", required=True); ap.add_argument("--into", help="existing roles.json to extend (its roles.detail.json beside it too)")
    ap.add_argument("--epochs", help="epochs.json of the run, to validate lane/epoch ids"); ap.add_argument("--remap-roles"); ap.add_argument("--remap-from")
    a = ap.parse_args()
    ep = load(a.epochs)["lanes"] if a.epochs else None
    if a.remap_roles:
        if not (a.remap_from and ep): ap.error("--remap-roles needs --remap-from (old epochs.json) and --epochs (new epochs.json)")
        roles, rep = remap(load(a.remap_roles), load(a.remap_from)["lanes"], ep); detail = {}
        print(f"remap: {rep['lanes']} lanes, {rep['epochs']} epochs carried, {len(rep['unmatched'])} new epochs without an old label")
    else:
        roles = detail = None
        if a.into and os.path.exists(a.into):
            roles = load(a.into); dp = os.path.join(os.path.dirname(os.path.abspath(a.into)), "roles.detail.json"); detail = load(dp) if os.path.exists(dp) else None
        rows = []
        for b in a.batches:
            for i, ln in enumerate(open(b, encoding="utf-8"), 1):
                if ln.strip():
                    try: rows.append(json.loads(ln))
                    except ValueError: print(f"skipped unparseable line {b}:{i}")
        roles, detail, rep = merge(rows, ep, roles, detail)
        print(f"merge: {rep['rows']} rows; {rep['set']} epoch roles set; {rep['lane_summaries']} lane summaries; overridden {len(rep['overridden'])}; dropped unknown {len(rep['dropped_unknown'])} {rep['dropped_unknown'][:5]}; dropped without role {len(rep['dropped_no_role'])}")
    dump(a.out, roles)
    with open(os.path.join(os.path.dirname(os.path.abspath(a.out)), "roles.detail.json"), "w", encoding="utf-8") as f: json.dump(detail or {}, f, ensure_ascii=False)
    print(f"wrote {a.out}: {len(roles)} lanes, {sum(len([k for k in v if k != '*']) for v in roles.values())} labelled epochs")


if __name__ == "__main__":
    main()
