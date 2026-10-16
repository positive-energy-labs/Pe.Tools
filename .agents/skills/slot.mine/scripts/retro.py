"""Retro metrics for named T3 threads: what each main thread paid, and where its context came from.

python .agents/skills/slot.mine/scripts/retro.py --out <run-dir> <t3-thread-id-prefix>...

Resolves each T3 thread to its native Claude session or Codex rollout through T3's own state db, then writes
<run-dir>/retro.json (per thread: hours, owner turns, API calls, compactions, max context, tokens, cost, tool calls,
tool output by tool, inflows over 20k chars, the context curve) and <run-dir>/retro.html (curves with compaction marks,
cost table). Main thread only: subagent and sidechain spend is excluded. Prints aggregates only, never session text.
"""
import argparse, collections, datetime, glob, html, json, os, sqlite3

HOME = os.path.expanduser("~")
T3 = f"{HOME}/.t3/userdata"
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
    title = (db.execute("select title from orchestration_v2_projection_threads where thread_id like ?", (prefix + "%",)).fetchone() or ["?"])[0]
    refs = [json.loads(p).get("nativeThreadRef") or {} for _, p in rows]
    return rows[0][0] if rows else None, title, [(r["driver"], r["nativeId"]) for r in refs if r.get("nativeId")]


def owner_turns_and_hours(db, tid):
    n = 0
    for (p,) in db.execute("select payload_json from orchestration_v2_projection_messages where thread_id=? and role='user'", (tid,)):
        p = json.loads(p)
        n += p.get("createdBy") == "user" or p.get("creationSource") in ("web", "mobile")
    a, b = db.execute("select min(requested_at), max(completed_at) from orchestration_v2_projection_runs where thread_id=?", (tid,)).fetchone()
    return n, (ts(b) - ts(a)).total_seconds() / 3600 if a and b else None


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
                ctx = sum(u.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
                m["curve"].append([e.get("timestamp"), ctx]); m["max_ctx"] = max(m["max_ctx"], ctx)
        elif t == "user" and isinstance(c, list):
            for x in c:
                if isinstance(x, dict) and x.get("type") == "tool_result":
                    n = names.get(x.get("tool_use_id"), "?"); k = chars(x.get("content"))
                    m["tool_output"][n] += k
                    if k > BIG: m["inflows"].append([e.get("timestamp", "")[:16], n, k])


def codex(path, m):
    names = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        try: e = json.loads(line)
        except ValueError: continue
        t = e.get("type"); p = e.get("payload") or {}; when = e.get("timestamp")
        if t == "compacted":
            m["compactions"] += 1; m["curve"].append([when, 0, "COMPACT"])
        elif t == "turn_context":
            m["models"][p.get("model") or "?"] += 1
        elif t == "event_msg" and p.get("type") == "token_count" and p.get("info"):
            tot = p["info"].get("total_token_usage") or {}
            m["usage"] = collections.Counter(input_tokens=tot.get("input_tokens", 0) - tot.get("cached_input_tokens", 0),
                                             cache_read_input_tokens=tot.get("cached_input_tokens", 0), output_tokens=tot.get("output_tokens", 0))
            ctx = (p["info"].get("last_token_usage") or {}).get("input_tokens") or 0
            m["curve"].append([when, ctx]); m["max_ctx"] = max(m["max_ctx"], ctx)
        elif t == "response_item" and p.get("type") in ("function_call", "custom_tool_call"):
            names[p.get("call_id")] = p.get("name", "?"); m["tool_calls"][p.get("name", "?")] += 1
        elif t == "response_item" and p.get("type") in ("function_call_output", "custom_tool_call_output"):
            n = names.get(p.get("call_id"), "?"); k = chars(p.get("output"))
            m["tool_output"][n] += k
            if k > BIG: m["inflows"].append([(when or "")[:16], n, k])


def rate(rates, model):
    for k in (model, "anthropic." + model, "openai/" + model):
        if k in rates: return rates[k]
    return None


def cost(m, rates):
    model = m["models"].most_common(1)[0][0] if m["models"] else "?"
    r = rate(rates, model); u = m["usage"]
    if not r: return model, None  # ponytail: an unpriced model is a gap, never a zero
    return model, round(u["input_tokens"] * (r.get("input_cost_per_token") or 0)
                        + u["cache_creation_input_tokens"] * (r.get("cache_creation_input_token_cost") or r.get("input_cost_per_token") or 0)
                        + u["cache_read_input_tokens"] * (r.get("cache_read_input_token_cost") or 0)
                        + u["output_tokens"] * (r.get("output_cost_per_token") or 0), 1)


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
    rates = json.load(open(f"{T3}/usage-model-rates.json"))["document"]
    out = []
    for prefix in a.threads:
        tid, title, refs = resolve(db, prefix)
        m = dict(thread=prefix, title=title, sessions=[], compactions=0, max_ctx=0, curve=[], inflows=[], models=collections.Counter(),
                 usage=collections.Counter(), tool_calls=collections.Counter(), tool_output=collections.Counter())
        for driver, nid in refs:
            files = glob.glob(f"{HOME}/.claude/projects/*/{nid}.jsonl") if driver == "claudeAgent" else glob.glob(f"{HOME}/.codex/sessions/*/*/*/rollout-*-{nid}.jsonl")
            for f in files:
                m["sessions"].append(nid); (claude if driver == "claudeAgent" else codex)(f, m)
        if not m["sessions"]:
            print(f"{prefix}: no native session found (UNPROVEN)"); continue
        m["owner_turns"], m["hours"] = owner_turns_and_hours(db, tid)
        m["model"], m["cost"] = cost(m, rates)
        m["api_calls"] = sum(1 for c in m["curve"] if len(c) == 2)
        m["inflows"].sort(key=lambda r: -r[2])
        out.append(m)
    json.dump(out, open(f"{a.out}/retro.json", "w"), indent=1, default=dict)
    cols = ["thread", "model", "hours", "owner_turns", "api_calls", "compactions", "max_ctx", "cost"]
    print(" | ".join(cols + ["tool calls", "tool output MB", "top inflow"]))
    rows = []
    for m in out:
        top = m["tool_output"].most_common(1)
        vals = [m[c] if not isinstance(m[c], float) else round(m[c], 1) for c in cols] + [sum(m["tool_calls"].values()), round(sum(m["tool_output"].values()) / 1e6, 2), top[0][0] if top else "-"]
        print(" | ".join(map(str, vals)))
        rows.append(f"<section><h3>{html.escape(m['title'])} <code>{m['thread']}</code></h3>{svg(m['curve'])}</section>")
    head = "".join(f"<th>{c}</th>" for c in cols)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(m[c]))}</td>" for c in cols) + "</tr>" for m in out)
    open(f"{a.out}/retro.html", "w", encoding="utf-8").write(
        f"<!doctype html><meta charset=utf-8><title>retro</title><style>body{{font:14px system-ui;margin:24px}}td,th{{padding:3px 8px;border-bottom:1px solid #e5e7eb}}</style>"
        f"<h1>Retro: main-thread spend</h1><p>Cost from T3 usage-model-rates.json; an empty cost is an unpriced model. Orange dashes are compactions.</p>"
        f"<table><tr>{head}</tr>{body}</table>{''.join(rows)}")


if __name__ == "__main__":
    main()
