"""Retro metrics for named T3 threads: what each main thread paid, and where its context came from.

python .agents/skills/slot.mine/scripts/retro.py --out <run-dir> <t3-thread-id-prefix>...

Resolves each T3 thread to its native Claude session or Codex rollout through T3's own state db, then writes
<run-dir>/retro.json (per thread: span hours and active run hours, owner turns, API calls, compactions, max context, tokens by model, cost, tool calls,
tool output by tool, inflows over 20k chars, the context curve) and <run-dir>/retro.html (curves with compaction marks,
cost table). Cost prices each model's own tokens at its own T3 rate. Main thread only: subagent and sidechain spend is excluded;
descendant_threads_unpriced counts the excluded child threads so the gap is visible; any cost with descendant_threads_unpriced > 0 is a FLOOR
(cost_is_floor in retro.json), never a tree total. Tokens with no model id are priced at the thread's selected model and say so (cost_note).
Owner turns are human turns: createdBy=user AND creationSource web|mobile (server-sourced user rows are agent text). Prints aggregates only, never session text.
"""
import argparse, collections, datetime, glob, html, json, os, sqlite3, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pricing
from pricing import HOME, T3
BIG = 20000


def ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def chars(c):
    if isinstance(c, str):
        return len(c)
    if isinstance(c, list):
        return sum(len(x.get("text", "") or x.get("output", "") or "") for x in c if isinstance(x, dict))
    return 0


def resolve(db, prefix):
    rows = db.execute("select thread_id, payload_json from orchestration_v2_projection_provider_threads where thread_id like ?", (prefix + "%",)).fetchall()
    tids = sorted({r[0] for r in rows})
    if prefix in tids:
        tids = [prefix]
    if len(tids) > 1:
        print(f"{prefix}: ambiguous prefix matches {len(tids)} threads (UNPROVEN)"); return None, "?", []
    tid = tids[0] if tids else None
    title = (db.execute("select title from orchestration_v2_projection_threads where thread_id=?", (tid,)).fetchone() or ["?"])[0] if tid else "?"
    refs = [json.loads(p).get("nativeThreadRef") or {} for t, p in rows if t == tid]
    return tid, title, [(r["driver"], r["nativeId"]) for r in refs if r.get("nativeId")]


def owner_turns_and_hours(db, tid):
    # span = first request to last completion (includes idle); active = sum of run durations (includes queue/wait, an upper bound)
    n = 0
    for (p,) in db.execute("select payload_json from orchestration_v2_projection_messages where thread_id=? and role='user'", (tid,)):
        p = json.loads(p)
        n += p.get("createdBy") == "user" and p.get("creationSource") in ("web", "mobile")  # server rows = child->parent agent text
    a, b = db.execute("select min(requested_at), max(completed_at) from orchestration_v2_projection_runs where thread_id=?", (tid,)).fetchone()
    active = 0.0
    for ra, co in db.execute("select requested_at, completed_at from orchestration_v2_projection_runs where thread_id=? and completed_at is not null", (tid,)):
        active += (ts(co) - ts(ra)).total_seconds() / 3600
    descendants = 0
    for (pj,) in db.execute("select payload_json from orchestration_v2_projection_threads where payload_json like ?", ("%" + tid + "%",)):
        try: lin = (json.loads(pj) or {}).get("lineage") or {}
        except ValueError: continue
        descendants += lin.get("rootThreadId") == tid and lin.get("parentThreadId") is not None
    span = (ts(b) - ts(a)).total_seconds() / 3600 if a and b else None
    return n, span, round(active, 1), descendants


def claude(path, m):
    seen = set(); names = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        try: e = json.loads(line)
        except ValueError: continue
        if e.get("isSidechain"): continue
        t = e.get("type"); msg = e.get("message") or {}; c = msg.get("content")
        if t == "system" and e.get("subtype") == "compact_boundary":
            m["compactions"] += 1; m["curve"].append([e.get("timestamp"), 0, "COMPACT"])
        elif t == "assistant":
            m["models"][msg.get("model", "?")] += 1
            for x in c if isinstance(c, list) else []:
                if isinstance(x, dict) and x.get("type") == "tool_use":
                    n = x.get("name", "?")
                    if n == "Agent": n += ":" + str((x.get("input") or {}).get("model") or "default")
                    names[x.get("id")] = n; m["tool_calls"][n] += 1
            u = msg.get("usage") or {}; rid = e.get("requestId") or e.get("uuid")
            if u and rid not in seen:
                seen.add(rid)
                for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"):
                    m["usage"][k] += u.get(k) or 0
                    m["usage_by_model"][msg.get("model", "?")][k] += u.get(k) or 0
                ctx = sum(u.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
                m["curve"].append([e.get("timestamp"), ctx]); m["max_ctx"] = max(m["max_ctx"], ctx)
        elif t == "user" and isinstance(c, list):
            for x in c:
                if isinstance(x, dict) and x.get("type") == "tool_result":
                    n = names.get(x.get("tool_use_id"), "?"); k = chars(x.get("content"))
                    m["tool_output"][n] += k
                    if k > BIG: m["inflows"].append([e.get("timestamp", "")[:16], n, k])


def codex(path, m):
    names = {}; prev = collections.Counter(); cur_model = m.get("selected") or "?"  # tokens before the first turn_context belong to the selected model, not "?"
    for line in open(path, encoding="utf-8", errors="replace"):
        try: e = json.loads(line)
        except ValueError: continue
        t = e.get("type"); p = e.get("payload") or {}; when = e.get("timestamp")
        if t == "compacted":
            m["compactions"] += 1; m["curve"].append([when, 0, "COMPACT"])
        elif t == "turn_context":
            cur_model = p.get("model") or "?"; m["models"][cur_model] += 1
        elif t == "event_msg" and p.get("type") == "token_count" and p.get("info"):
            tot = p["info"].get("total_token_usage") or {}
            now = collections.Counter(input_tokens=tot.get("input_tokens", 0) - tot.get("cached_input_tokens", 0),
                                             cache_read_input_tokens=tot.get("cached_input_tokens", 0), output_tokens=tot.get("output_tokens", 0))
            for k, v in now.items():  # cumulative per file: add only the delta, attributed to the turn's model
                d = v - prev[k]
                if d > 0: m["usage"][k] += d; m["usage_by_model"][cur_model][k] += d
            prev = now
            ctx = (p["info"].get("last_token_usage") or {}).get("input_tokens") or 0
            m["curve"].append([when, ctx]); m["max_ctx"] = max(m["max_ctx"], ctx)
        elif t == "response_item" and p.get("type") in ("function_call", "custom_tool_call"):
            names[p.get("call_id")] = p.get("name", "?"); m["tool_calls"][p.get("name", "?")] += 1
        elif t == "response_item" and p.get("type") in ("function_call_output", "custom_tool_call_output"):
            n = names.get(p.get("call_id"), "?"); k = chars(p.get("output"))
            m["tool_output"][n] += k
            if k > BIG: m["inflows"].append([(when or "")[:16], n, k])


def cost(m, rates):
    # price each model's own tokens at its own rate; any model with tokens but no rate makes the total a gap, never a zero
    model = m["models"].most_common(1)[0][0] if m["models"] else "?"
    total = 0.0; m["cost_note"] = None
    for mdl, u in m["usage_by_model"].items():
        if not sum(u.values()): continue
        if mdl == "?" and m.get("selected"):
            mdl = m["selected"]; m["cost_note"] = "tokens with no model id priced at the thread's selected model"
        u_ = pricing.usd(rates, mdl, u["input_tokens"], u["cache_creation_input_tokens"], u["cache_read_input_tokens"], u["output_tokens"])
        if u_ is None: m["cost_note"] = f"unpriced: {mdl}"; return model, None
        total += u_
    return model, round(total, 1)


def svg(curve):
    pts = [c for c in curve if len(c) == 2 and c[0]]
    if not pts: return ""
    t0 = ts(pts[0][0]); hrs = lambda s: (ts(s) - t0).total_seconds() / 3600
    xmax = max(hrs(p[0]) for p in pts) or 1; ymax = max(p[1] for p in pts) or 1; W, H, P = 560, 120, 28
    X = lambda h: P + (W - 2 * P) * h / xmax; Y = lambda v: H - P / 2 - (H - P) * v / ymax
    step = max(1, len(pts) // 150)
    path = " ".join(f"{'M' if i == 0 else 'L'}{X(hrs(p[0])):.0f},{Y(p[1]):.0f}" for i, p in enumerate(pts[::step]))
    marks = "".join(f'<line x1="{X(hrs(c[0])):.1f}" x2="{X(hrs(c[0])):.1f}" y1="{P / 2}" y2="{H - P / 2}" stroke="#b45309" stroke-dasharray="3 3"/>' for c in curve if len(c) == 3)
    return f'<svg viewBox="0 0 {W} {H}" width="{W}" height="{H}"><text x="2" y="12" font-size="10" fill="#6b7280">{ymax // 1000}k</text><text x="{W - P}" y="{H - 2}" font-size="10" fill="#6b7280">{xmax:.1f}h</text><path d="{path}" fill="none" stroke="#2563eb" stroke-width="1.5"/>{marks}</svg>'


def main():
    a = argparse.ArgumentParser(); a.add_argument("--out", required=True); a.add_argument("threads", nargs="+"); a = a.parse_args()
    os.makedirs(a.out, exist_ok=True)
    db = sqlite3.connect(f"file:{T3}/statev2.sqlite?mode=ro", uri=True)
    rates = pricing.load_rates(T3)
    out = []
    for prefix in a.threads:
        tid, title, refs = resolve(db, prefix)
        sel = db.execute("select json_extract(payload_json,'$.modelSelection.model') from orchestration_v2_projection_threads where thread_id=?", (tid,)).fetchone() if tid else None
        m = dict(thread=prefix, title=title, sessions=[], compactions=0, max_ctx=0, curve=[], inflows=[], models=collections.Counter(),
                 selected=sel[0] if sel else None,
                 usage=collections.Counter(), usage_by_model=collections.defaultdict(collections.Counter), tool_calls=collections.Counter(), tool_output=collections.Counter())
        for driver, nid in refs:
            files = glob.glob(f"{HOME}/.claude/projects/*/{nid}.jsonl") if driver == "claudeAgent" else glob.glob(f"{HOME}/.codex/sessions/*/*/*/rollout-*-{nid}.jsonl")
            for f in files:
                m["sessions"].append(nid); (claude if driver == "claudeAgent" else codex)(f, m)
        if not m["sessions"]:
            print(f"{prefix}: no native session found (UNPROVEN)"); continue
        m["owner_turns"], m["hours"], m["active_hours"], m["descendant_threads_unpriced"] = owner_turns_and_hours(db, tid)
        m["model"], m["cost"] = cost(m, rates)
        m["cost_is_floor"] = m["descendant_threads_unpriced"] > 0
        m["api_calls"] = sum(1 for c in m["curve"] if len(c) == 2)
        m["inflows"].sort(key=lambda r: -r[2])
        out.append(m)
    json.dump(out, open(f"{a.out}/retro.json", "w"), indent=1, default=dict)
    cols = ["thread", "model", "hours", "active_hours", "owner_turns", "api_calls", "compactions", "max_ctx", "cost", "descendant_threads_unpriced"]
    print(" | ".join(cols + ["tool calls", "tool output MB", "top inflow"]))
    rows = []
    for m in out:
        top = m["tool_output"].most_common(1)
        vals = [m[c] if not isinstance(m[c], float) else round(m[c], 1) for c in cols] + [sum(m["tool_calls"].values()), round(sum(m["tool_output"].values()) / 1e6, 2), top[0][0] if top else "-"]
        print(" | ".join(map(str, vals)))
        rows.append(f"<section><h3>{html.escape(m['title'])} <code>{m['thread']}</code></h3>{svg(m['curve'])}</section>")
    floors = [m["thread"] for m in out if m["cost_is_floor"]]
    if floors: print(f"cost is a main-thread FLOOR for {len(floors)} thread(s) with unpriced descendants: {', '.join(floors)}. Tree totals come from `census`.")
    head = "".join(f"<th>{c}</th>" for c in cols)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(m[c]))}</td>" for c in cols) + "</tr>" for m in out)
    open(f"{a.out}/retro.html", "w", encoding="utf-8").write(
        f"<!doctype html><meta charset=utf-8><title>retro</title><style>body{{font:14px system-ui;margin:24px}}td,th{{padding:3px 8px;border-bottom:1px solid #e5e7eb}}</style>"
        f"<h1>Retro: main-thread spend</h1><p>Cost from T3 usage-model-rates.json; an empty cost is an unpriced model; cost_is_floor rows exclude descendants. Orange dashes are compactions.</p>"
        f"<table><tr>{head}</tr>{body}</table>{''.join(rows)}")


if __name__ == "__main__":
    main()
