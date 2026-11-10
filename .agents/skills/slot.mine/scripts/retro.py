"""Retro metrics for named T3 threads: what each main thread paid, and where its context came from.

python .agents/skills/slot.mine/scripts/retro.py [--tree] [--branch B --base COMMIT] --out <run-dir> <t3-thread-id-prefix>...

Resolves each T3 thread to its native Claude session or Codex rollout through T3's own state db, then writes
<run-dir>/retro.json (per thread: span hours and active run hours, owner turns, API calls, compactions, max context, tokens by model, cost, tool calls,
tool output by tool, inflows over 20k chars, the context curve) and <run-dir>/retro.html (curves with compaction marks,
cost table). Cost prices each model's own tokens at its own T3 rate. Main thread only: subagent and sidechain spend is excluded;
descendant_threads_unpriced counts the excluded child threads so the gap is visible; any cost with descendant_threads_unpriced > 0 is a FLOOR
(cost_is_floor in retro.json), never a tree total. Tokens with no model id are priced at the thread's selected model and say so (cost_note).
Speed per thread: tool_wall (hours by tool kind, Bash/PowerShell/exec classified by command), test_share (TEST hours over all tool hours),
idle_gaps (T3 runs table: waiting between runs), keepalive (each wake: idle minutes since the last API call, HIT when the next call reads more cache than it writes),
cold_calls (API calls writing over 50k cache tokens and more than they read). Keepalive and cold_calls are Claude-only (Codex rollouts carry no cache-write count).
--tree also measures every descendant thread (lineage rootThreadId = the named thread) that has runs: native session by provider ref, else by worktree path
(Claude project dir, Codex rollout cwd); each session file counts once. It adds a tree_total row. Descendants with runs but no session make that row a floor.
Waits: each gap between consecutive runs is attributed to the trigger of the next run (owner, message from <thread>, own command, child completion, keepalive, system, unknown); per thread `gaps` and `waits` (hours by cause).
commands: every Bash/PowerShell command and Codex exec cmd split on && ; | and newlines, cd/export/echo/VAR= segments dropped, timeout/npx/pnpm exec/--filter/-C stripped, keyed program + first subcommand (loops: `poll loop`); a call's whole wall (a background command's runs to its completion notification) goes to its heaviest segment (test > build > guard > other).
--branch/--base add `landmark`: per slice N, 80% of final churn, the first `Slice N gated`/`Wave ... gated` first-parent commit, and gate tail = gate - 80% (open slices run to the window end); headline median tail and gated slices per 10 wall hours.
Per slice also `first` (first commit) and `start_lag_h` (first commit minus window start), the tail (commits after the 80% commit) as `tail_commits`, `tail_churn` {test, prod, docs}, `tail_test_share`, `tail_active_h` (gaps between consecutive tail commits, each capped at 30 minutes, from the 80% commit on) and `tail_quiet_h` (the rest of the tail), `tail_segs` (the active spans);
run-level `blocked` (longest stretch with a slice not yet started while a lower slice was past 80%), `writers` (per 30-minute bucket: slices with a commit, descendant threads with a run in flight), `tail_test_share`, `tail_quiet_share`, `trough`, `marks` (gate and merge commits on the integration branch), `commits_read`, `by_branch`, `unattributed`.
A commit's slice is the slice in the title of the thread named by its `T3-Thread` trailer (slice_key, the one title parser, also groups the lanes); commits come from every local branch since --base, kept when they are on the integration branch or written by a thread of the tree (`unmerged` counts those not on it yet, `lost_writers` names threads that ran git commit and left none); a commit whose thread names no slice, or that has no trailer
(then the `<branch>-sN` branch-name fallback, counted in by_branch), is left out of every slice and counted in `unattributed`. Lettered slices (2b, 5a) are their own slices (see landmark()). The slice list is whatever the commits name.
With --tree, retro.json also holds everything swimlanes.py draws: `window`, `lanes` (per lane: runs with trigger text and bar kind, gaps with causes, messages received; the per-thread activity segments `ivs`, keepalive wakes, cold calls, model changes sit in `threads`), `rollup`, and the `commands`;
retro.py then calls swimlanes.render, so one command writes retro.json, retro.html and swimlanes.html. `swimlanes.py <run-dir>` redraws the page from retro.json and never measures.
Per thread `admits` ({t, kind, verdict, free_gib} from tool results with an `ADMIT|HOLD|REFUSE <kind>: free x of y GiB` line, once per result) and `admit_counts` (kind -> verdict -> n); `turn_ends` (a background command still running when its run completed: {thread, t_run_end, t_cmd_end, command, ran_on_h, idle_until_next_run_h}) and `turn_end_idle_h`. Claude sessions only for turn_ends. tree_total sums both.
retro.json is {threads, commands, landmark}. Owner turns are human turns: createdBy=user AND creationSource web|mobile (server-sourced user rows are agent text). Prints aggregates only, never session text.
"""
import argparse, collections, datetime, functools, glob, html, json, math, os, re, sqlite3, statistics, subprocess, sys

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


ADMIT = re.compile(r"\b(ADMIT|HOLD|REFUSE) (light|codegen|suite|revit-test|browser|revit-drive): free ([\d.]+) of [\d.]+ GiB")


def text_of(c):
    return c if isinstance(c, str) else "\n".join(str(x.get("text") or x.get("output") or "") for x in c if isinstance(x, dict)) if isinstance(c, list) else ""


def admits(text, t):
    """Admission readings in one tool result; an identical repeated line counts once."""
    return [dict(t=t, kind=k, verdict=v, free_gib=float(f)) for v, k, f in dict.fromkeys(ADMIT.findall(text))] if "GiB" in text else []


def admit_counts(rs):
    c = collections.defaultdict(collections.Counter)
    for r in rs: c[r["kind"]][r["verdict"]] += 1
    return {k: dict(v) for k, v in sorted(c.items())}


def turn_ends(bgs, runs):
    """Background commands still running when the run that started them completed. bgs: (start, end, prefix) ISO; runs: (requested_at, completed_at|None) ISO.
    Owner = the last run requested at or before the start; skipped if the command started more than a minute after that run ended. idle = run end to the next run's request (None when there is none)."""
    rs = sorted((ts(a), ts(b) if b else None) for a, b in runs); out = []
    for s, e, pre in bgs:
        s, e = ts(s), ts(e); i = max((i for i, r in enumerate(rs) if r[0] <= s), default=None)
        if i is None or rs[i][1] is None or (s - rs[i][1]).total_seconds() > 60 or e <= rs[i][1]: continue
        nxt = rs[i + 1][0] if i + 1 < len(rs) else None
        out.append(dict(t_run_end=rs[i][1].isoformat(), t_cmd_end=e.isoformat(), command=pre, ran_on_h=round((e - rs[i][1]).total_seconds() / 3600, 3),
                        idle_until_next_run_h=round((nxt - rs[i][1]).total_seconds() / 3600, 3) if nxt else None))
    return out


def rollup(ms):
    ad = sorted((r for x in ms for r in x["admits"]), key=lambda r: r["t"] or ""); te = [e for x in ms for e in x["turn_ends"]]
    return dict(admits=ad, admit_counts=admit_counts(ad), turn_ends=te, turn_end_idle_h=round(sum(e["idle_until_next_run_h"] or 0 for e in te), 2))


# first match wins, so TEST outranks the narrower test:* kinds
KINDS = [
    ("TEST", r"vp\s+test|vitest|pnpm\s+(-\S+\s+)*(run\s+)?test|dotnet\s+test|pe-revit\S*\s+test|Test Files|Duration|mutant|/mut/|related\.log|host-full|host-test|webfull"),  # a test file path alone (git diff, sed) is not a test run
    ("BROWSER", r"preview_|playwright|chrome|browser|agent-browser"),
    ("test:pe-revit", r"pe-revit\S*\s+test"), ("test:vitest/pnpm", r"vitest|pnpm\s+(-\S+\s+)*(run\s+)?test|npm\s+test|bun\s+test"),
    ("test:dotnet", r"dotnet\s+test"), ("guard", r"check\.py|guard|lint|oxlint|\bfmt\b"), ("session", r"pe-revit\S*\s+session"),
    ("build", r"dotnet\s+build|pnpm\s+(-\S+\s+)*(run\s+)?(build|typecheck|tsc)|tsc\b|msbuild"),
    ("git", r"^\s*(cd [^;&]+[;&]+\s*)?git\b"), ("t3", r"t3\.cmd|t3 thread"), ("sleep/wait", r"\bsleep\b|Start-Sleep|until "),
]


def classify(cmd):
    return next((k for k, rx in KINDS if re.search(rx, cmd)), "other")


def kind(name, inp):
    return f"{name}:{classify((inp or {}).get('command', ''))}" if name in ("Bash", "PowerShell") else name


SHELLS = ("Bash", "PowerShell", "exec", "exec_command", "shell")
FAM = {"TEST": "test", "build": "build", "guard": "guard", "git": "git", "sleep/wait": "poll", "BROWSER": "browser"}
RANK = {"test": 0, "build": 1, "guard": 2}  # heaviest segment of a command: test > build > guard/lint > the rest
LEAD = re.compile(r"^(?:[({]\s*|(?:npx|time|nohup|env|sudo|command|do|then|else)\s+|timeout\s+(?:-\S+\s+)*[\d.]+[smh]?\s+|pnpm\s+exec\s+|[A-Za-z_]\w*=\S*\s+)+")
DROP = re.compile(r"^(?:#|(?:cd|pushd|popd|export|echo|source|set|unset|printf|true|exit|done|fi|Set-Location|Write-Host|Write-Output)(?:\s|$)|\.\s|\$?\w+=|\$\w+\s*=|[{}()]*$)", re.I)
SUB = {"vp", "git", "pnpm", "npm", "bun", "dotnet", "pe-revit", "vitest", "gh", "python", "python3", "node", "pea", "t3", "uv"}


def family(name, cmd):
    if name in SHELLS:
        k = classify(cmd)
        return "test" if k.startswith("test:") else FAM.get(k, "other")
    return "browser" if re.search(r"preview_|playwright|browser|device_", name) else "poll" if re.search(r"wait|sleep|monitor", name, re.I) else "other"


def prefixes(cmd):
    """(key of the heaviest segment, keys of the others). ponytail: quotes are collapsed and heredocs cut, not parsed; a `;` inside a collapsed string cannot split."""
    cmd = re.sub(r"\"([^\"\s]*\.(?:exe|cmd|bat|ps1))\"", r"\1", re.split(r"<<-?\s*['\"]?\w+", cmd)[0])  # a quoted program path keeps its name
    cmd = re.sub(r"\"(?:[^\"\\]|\\.)*\"|'[^']*'", '""', cmd)
    keys = []
    for seg in re.split(r"&&|[;|&\n]", re.sub(r"\d*>&\d+", "", cmd)):
        seg = LEAD.sub("", re.sub(r"\s(?:--filter|-F|-C|--dir)[= ]\S+", "", " " + seg).strip()).strip()
        if not seg or DROP.match(seg): continue
        t = seg.split()
        if t[0] in ("for", "until", "while"): key = "poll loop"
        else:
            prog = re.sub(r"\.(exe|cmd)$", "", os.path.basename(t[0].replace("\\", "/")).lower())
            sub = next((x for x in t[1:] if not x.startswith("-")), "") if prog in SUB else ""
            sub = os.path.basename(sub) if re.search(r"\.(py|mjs|cjs|js|ts)$", sub) else sub
            key = f"{prog} {sub}" if re.fullmatch(r"[\w.][\w./:-]*", sub) else prog
        keys.append((RANK.get(family("Bash", seg), 3), len(keys), key))
    keys.sort()
    return (keys[0][2], [k[2] for k in keys[1:] if k[2] != keys[0][2]]) if keys else ("(builtin)", [])


def record(m, start, end, kd, name, cmd, bg):
    """One tool call: wall by kind, an interval for the lanes, and (for shells) the command prefix credit."""
    if not (start and end) or ts(end) < ts(start): return
    d = (ts(end) - ts(start)).total_seconds(); fam = family(name, cmd)
    m["tool_wall"][kd] += d; m["ivs"].append([start, end, fam, bg])
    if name in SHELLS and cmd:
        key, rest = prefixes(cmd); c = m["commands"].setdefault(key, [0, 0.0, 0]); c[0] += 1; c[1] += d
        for k in rest: m["commands"].setdefault(k, [0, 0.0, 0])[2] += 1


def share(w):
    tot = sum(w.values())
    return round(sum(v for k, v in w.items() if k.endswith(":TEST")) / tot, 3) if tot else None


def new_metrics(label, title, selected):
    return dict(thread=label, title=title, sessions=[], compactions=0, max_ctx=0, curve=[], inflows=[], models=collections.Counter(), selected=selected,
                usage=collections.Counter(), usage_by_model=collections.defaultdict(collections.Counter), tool_calls=collections.Counter(),
                tool_output=collections.Counter(), tool_wall=collections.Counter(), calls=[], wakes=[], ivs=[], commands={}, model_pts=[], admits=[], bgs=[])


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


def descendants_of(db, tid):
    for t, title, pj in db.execute("select thread_id, title, payload_json from orchestration_v2_projection_threads where payload_json like ?", ("%" + tid + "%",)):
        try: p = json.loads(pj) or {}
        except ValueError: continue
        lin = p.get("lineage") or {}
        if lin.get("rootThreadId") == tid and lin.get("parentThreadId") is not None: yield t, title, p


def idle_gaps(db, tid):
    runs = db.execute("select requested_at, completed_at from orchestration_v2_projection_runs where thread_id=? and completed_at is not null order by requested_at", (tid,)).fetchall()
    g = [(ts(b[0]) - ts(a[1])).total_seconds() / 60 for a, b in zip(runs, runs[1:])]
    return dict(n=len(g), total_h=round(sum(g) / 60, 2), over_5m=sum(x > 5 for x in g), over_60m=sum(x > 60 for x in g), max_min=round(max(g or [0])))


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
    descendants = sum(1 for _ in descendants_of(db, tid))
    span = (ts(b) - ts(a)).total_seconds() / 3600 if a and b else None
    return n, span, round(active, 1), descendants


def claude(path, m):
    seen = set(); names = {}; starts = {}; notif = {}; done = []; last = None
    for line in open(path, encoding="utf-8", errors="replace"):
        try: e = json.loads(line)
        except ValueError: continue
        t = e.get("type")
        if t == "queue-operation":  # a background command's real end: its completion notification, matched by tool-use id
            if e.get("operation") == "enqueue" and (mm := re.search(r"<tool-use-id>(\S+?)</tool-use-id>", e.get("content") or "")): notif[mm[1]] = e.get("timestamp")
            continue
        if e.get("isSidechain"): continue
        msg = e.get("message") or {}; c = msg.get("content")
        if t == "system" and e.get("subtype") == "compact_boundary":
            m["compactions"] += 1; m["curve"].append([e.get("timestamp"), 0, "COMPACT"])
        elif t == "assistant":
            mdl = msg.get("model", "?"); m["models"][mdl] += 1
            if e.get("timestamp") and not mdl.startswith("<") and mdl != last: m["model_pts"].append((e["timestamp"], mdl)); last = mdl
            for x in c if isinstance(c, list) else []:
                if isinstance(x, dict) and x.get("type") == "tool_use":
                    n = x.get("name", "?")
                    if n == "Agent": n += ":" + str((x.get("input") or {}).get("model") or "default")
                    names[x.get("id")] = n; m["tool_calls"][n] += 1; inp = x.get("input") or {}
                    starts[x.get("id")] = (e.get("timestamp"), kind(x.get("name"), inp), x.get("name"), inp.get("command") or "", bool(inp.get("run_in_background")))
            u = msg.get("usage") or {}; rid = e.get("requestId") or e.get("uuid")
            if u and rid not in seen:
                seen.add(rid)
                for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"):
                    m["usage"][k] += u.get(k) or 0
                    m["usage_by_model"][msg.get("model", "?")][k] += u.get(k) or 0
                ctx = sum(u.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
                m["curve"].append([e.get("timestamp"), ctx]); m["max_ctx"] = max(m["max_ctx"], ctx)
                if e.get("timestamp"): m["calls"].append((e["timestamp"], u.get("cache_read_input_tokens") or 0, u.get("cache_creation_input_tokens") or 0))
        elif t == "user":
            txt = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text") if isinstance(c, list) else ""
            if "keepalive: nothing is asked" in txt and e.get("timestamp"): m["wakes"].append(e["timestamp"])
            for x in c if isinstance(c, list) else []:
                if isinstance(x, dict) and x.get("type") == "tool_result":
                    if x.get("tool_use_id") in starts: done.append((x["tool_use_id"], starts.pop(x["tool_use_id"]), e.get("timestamp")))
                    n = names.get(x.get("tool_use_id"), "?"); k = chars(x.get("content"))
                    m["tool_output"][n] += k; m["admits"] += admits(text_of(x.get("content")), e.get("timestamp"))
                    if k > BIG: m["inflows"].append([e.get("timestamp", "")[:16], n, k])
    for tid, (s, kd, nm, cmd, bg), rts in done:
        record(m, s, (bg and notif.get(tid)) or rts, kd, nm, cmd, bg)
        if bg and notif.get(tid) and s: m["bgs"].append((s, notif[tid], prefixes(cmd)[0]))


def codex_cmd(x):
    try: return json.loads(x) if x[0] == '"' else x[1:-1]
    except ValueError: return x[1:-1]


def codex(path, m):
    names = {}; starts = {}; prev = collections.Counter(); last = None; cur_model = m.get("selected") or "?"  # tokens before the first turn_context belong to the selected model, not "?"
    for line in open(path, encoding="utf-8", errors="replace"):
        try: e = json.loads(line)
        except ValueError: continue
        t = e.get("type"); p = e.get("payload") or {}; when = e.get("timestamp")
        if t == "compacted":
            m["compactions"] += 1; m["curve"].append([when, 0, "COMPACT"])
        elif t == "turn_context":
            cur_model = p.get("model") or "?"; m["models"][cur_model] += 1
            if when and cur_model != last: m["model_pts"].append((when, cur_model)); last = cur_model
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
            raw = str(p.get("input") or p.get("arguments") or ""); cmd = "\n".join(codex_cmd(x) for x in re.findall(r'cmd["\']?\s*:\s*("(?:[^"\\]|\\.)*"|`[^`]*`)', raw))  # no cmd: a non-shell exec cell (apply_patch)
            starts[p.get("call_id")] = (when, "exec:" + classify(cmd), p.get("name", "?"), cmd)
        elif t == "response_item" and p.get("type") in ("function_call_output", "custom_tool_call_output"):
            if p.get("call_id") in starts: (s, kd, nm, cmd) = starts.pop(p["call_id"]); record(m, s, when, kd, nm, cmd, False)
            n = names.get(p.get("call_id"), "?"); k = chars(p.get("output"))
            m["tool_output"][n] += k; m["admits"] += admits(text_of(p.get("output")), when)
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


def finish(m):
    calls = sorted(m.pop("calls")); wakes = m.pop("wakes"); m["keepalive"] = []
    for w in wakes:
        prior = [c for c in calls if c[0] < w]; nxt = next((c for c in calls if c[0] > w), None)
        if nxt: m["keepalive"].append(dict(at=w, idle_min=round((ts(w) - ts(prior[-1][0])).total_seconds() / 60) if prior else None, hit=nxt[1] > nxt[2]))
    m["cold_calls"] = [dict(at=b[0], gap_min=round((ts(b[0]) - ts(a[0])).total_seconds() / 60), write=b[2]) for a, b in zip(calls, calls[1:]) if b[2] > 50000 and b[2] > b[1]]
    m["tool_wall"] = {k: round(v / 3600, 3) for k, v in m["tool_wall"].most_common()}
    m["test_share"] = share(m["tool_wall"])
    act = collections.Counter()
    for s, e, fam, bg in m["ivs"]: act[fam] += (ts(e) - ts(s)).total_seconds() / 3600
    m["activity"] = {k: round(v, 3) for k, v in act.most_common()}  # tool hours by family, background commands at their real duration; model time is the rest of the run
    pts = sorted(m.pop("model_pts")); m["model_changes"] = [dict(at=b[0], frm=a[1], to=b[1]) for a, b in zip(pts, pts[1:]) if a[1] != b[1]]
    m["compact_at"] = [c[0] for c in m["curve"] if len(c) == 3]
    m["admit_counts"] = admit_counts(m["admits"])
    m["commands"] = {k: dict(calls=v[0], hours=round(v[1] / 3600, 3), secondary=v[2]) for k, v in sorted(m["commands"].items(), key=lambda kv: -kv[1][1])}


@functools.cache
def thread_names(db):
    return dict(db.execute("select thread_id, title from orchestration_v2_projection_threads"))


def cause(p, names):
    """Why a run started, from its trigger message payload: (cause, detail)."""
    n = p.get("notification") or {}; src = n.get("source") or {}; txt = p.get("text") or ""
    if not p: return "unknown", ""
    if txt.startswith("keepalive") or p.get("scheduledTaskId"): return "keepalive", ""
    if p.get("senderThreadId"): return f"message from {names.get(p['senderThreadId']) or p['senderThreadId'][:8]}", ""
    if p.get("delegatedCompletion") or src.get("kind") == "delegated_task" or src.get("work") == "subagent": return "child completion", ""
    if src.get("kind") in ("background_command", "background_task"):
        d = re.search(r'[Cc]ommand "([^"]+)"', n.get("summary", "") + " " + txt); return "own command", d[1] if d else ""
    if p.get("createdBy") == "user" and p.get("creationSource") in ("web", "mobile"): return "owner", ""
    return ("system" if src.get("kind") == "system" else "unknown"), ""


def gaps(db, tid, names):
    """Each wait between consecutive runs of a thread, attributed to the trigger of the next run (its message created exactly at the run's requested_at)."""
    runs = db.execute("select requested_at, completed_at from orchestration_v2_projection_runs where thread_id=? order by requested_at", (tid,)).fetchall()
    out = []
    for a, b in zip(runs, runs[1:]):
        if not a[1] or a[1] >= b[0]: continue
        r = db.execute("select payload_json from orchestration_v2_projection_messages where thread_id=? and role='user' and created_at=? limit 1", (tid, b[0])).fetchone()
        c, d = cause(json.loads(r[0]) if r else {}, names)
        out.append(dict(start=a[1], end=b[0], hours=round((ts(b[0]) - ts(a[1])).total_seconds() / 3600, 3), cause=c, detail=d))
    # A keepalive wake answered in under 3 minutes did no work, so the wait it split keeps the cause of the run that ended it.
    for g, nxt in reversed(list(zip(out, out[1:]))):
        if g["cause"] == "keepalive" and nxt["cause"] != "keepalive" and (ts(nxt["start"]) - ts(g["end"])).total_seconds() < 180:
            g["cause"], g["detail"] = nxt["cause"], (nxt["detail"] + " (through a keepalive wake)").strip()
    return out


def waits(gs):
    w = collections.Counter()
    for g in gs: w[g["cause"]] += g["hours"]
    return {k: round(v, 2) for k, v in w.most_common()}


norm = lambda p: os.path.normcase(os.path.normpath(p))


@functools.cache
def codex_cwds():
    d = collections.defaultdict(list)
    for f in glob.glob(f"{HOME}/.codex/sessions/*/*/*/rollout-*.jsonl"):
        try: d[norm(json.loads(open(f, encoding="utf-8").readline())["payload"]["cwd"])].append(f)
        except (OSError, ValueError, KeyError): pass
    return d


def native_files(refs, wt, seen):
    """Session files for one thread: its provider refs, else its worktree. Each file is handed out once per `seen`."""
    fs = []
    for driver, nid in refs:
        fs += [(driver, f) for f in glob.glob(f"{HOME}/.claude/projects/*/{nid}.jsonl" if driver == "claudeAgent" else f"{HOME}/.codex/sessions/*/*/*/rollout-*-{nid}.jsonl")]
    if not fs and wt:
        fs = [("claudeAgent", f) for f in glob.glob(f"{HOME}/.claude/projects/{re.sub('[^A-Za-z0-9]', '-', wt)}/*.jsonl")] + [("codex", f) for f in codex_cwds().get(norm(wt), [])]
    fs = [(d, f) for d, f in fs if norm(f) not in seen]; seen.update(norm(f) for _, f in fs)
    return fs


def measure(db, rates, tid, label, title, files):
    if not files: return None
    sel = db.execute("select json_extract(payload_json,'$.modelSelection.model') from orchestration_v2_projection_threads where thread_id=?", (tid,)).fetchone()
    m = new_metrics(label, title, sel[0] if sel else None); m["tid"] = tid
    for driver, f in files:
        m["sessions"].append(os.path.splitext(os.path.basename(f))[0]); (claude if driver == "claudeAgent" else codex)(f, m)
    m["owner_turns"], m["hours"], m["active_hours"], m["descendant_threads_unpriced"] = owner_turns_and_hours(db, tid)
    m["idle_gaps"] = idle_gaps(db, tid); m["gaps"] = gaps(db, tid, thread_names(db)); m["waits"] = waits(m["gaps"])
    m["model"], m["cost"] = cost(m, rates)
    m["cost_is_floor"] = m["descendant_threads_unpriced"] > 0
    m["api_calls"] = sum(1 for c in m["curve"] if len(c) == 2)
    m["inflows"].sort(key=lambda r: -r[2])
    finish(m)
    runs = db.execute("select requested_at, completed_at from orchestration_v2_projection_runs where thread_id=?", (tid,)).fetchall()
    m["turn_ends"] = [dict(e, thread=label) for e in turn_ends(m.pop("bgs"), runs)]; m["turn_end_idle_h"] = sum(e["idle_until_next_run_h"] or 0 for e in m["turn_ends"])
    return m


def merge_commands(ms):
    c = collections.defaultdict(lambda: dict(calls=0, hours=0.0, secondary=0))
    for x in ms:
        for k, v in x["commands"].items():
            for f in v: c[k][f] += v[f]
    return {k: dict(v, hours=round(v["hours"], 3)) for k, v in sorted(c.items(), key=lambda kv: -kv[1]["hours"])}


def tree(db, rates, prefix, seen, kids_too=True):
    """Measure a named thread; with kids_too also every descendant that has runs and a native session. Prints and returns None when the root has none."""
    tid, title, refs = resolve(db, prefix)
    m = measure(db, rates, tid, prefix, title, native_files(refs, None, seen)) if tid else None
    if not m:
        print(f"{prefix}: no native session found (UNPROVEN)"); return None
    if kids_too:
        kids, missing = [], 0
        for t, ktitle, p in descendants_of(db, tid):
            if not db.execute("select 1 from orchestration_v2_projection_runs where thread_id=? limit 1", (t,)).fetchone(): continue  # Agent sidechain: shares its parent's worktree
            k = measure(db, rates, t, t, ktitle, native_files(resolve(db, t)[2], p.get("worktreePath"), seen))
            if k: k["curve"] = []; kids.append(k)
            else: missing += 1
        m["descendants"] = kids; m["tree_total"] = tree_total(m, kids, missing)
        if missing: print(f"{prefix}: {missing} descendant(s) with runs but no native session found; tree row is a floor (UNPROVEN)")
    return m


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True, encoding="utf-8").stdout


def covers(s):
    mm = re.search(r"[Ss]lices? ([\d,\s&\u2013-]+)", s); n = set()
    for a, b in re.findall(r"(\d+)(?:\s*[\u2013-]\s*(\d+))?", mm[1] if mm else ""): n.update(range(int(a), int(b or a) + 1))
    return n


def slice_key(title):
    """The slice a thread title names, as a label: `Slice 5`, `s5` -> "5"; `slice 5a`, `s2b` -> "5a", "2b"; None when it names none. The one parser the lanes and the landmark share."""
    m = re.search(r"\b[Ss](?:lice )?(\d+)([a-z])?(?![a-z0-9])", title or "")
    return m[1] + (m[2] or "") if m else None


def skey(n):
    """Sort key of a slice label: 2 < 2b < 3."""
    return int(re.match(r"\d+", n)[0]), n.lstrip("0123456789")


def bucket(path):
    """test, docs or prod for a changed path; None for the .json and generated paths the landmark skips."""
    if path.endswith(".json") or "generated" in path: return None
    p = path.lower()
    return "test" if re.search(r"\.test\.|(?:^|/)tests/|\.spec\.|fixture|__snapshots__", p) else "docs" if p.endswith(".md") else "prod"


def tail_split(pts, end, cap=1800):
    """pts: commit times from the 80% commit on. Active spans = each gap between consecutive points capped at `cap` seconds; the tail runs to `end` (or the last point if later); quiet = the rest. -> (spans, active_h, quiet_h)"""
    spans = [(a, a + datetime.timedelta(seconds=min((b - a).total_seconds(), cap))) for a, b in zip(pts, pts[1:])]
    act = sum((b - a).total_seconds() for a, b in spans); tot = (max(end, pts[-1]) - pts[0]).total_seconds()
    return spans, act / 3600, (tot - act) / 3600


def blocked(slices):
    """Longest stretch (hours) in which a slice had not started while a lower slice was past 80% of its churn. Per slice m the stretch is [earliest t80 of a lower slice, first of m]; overlapping stretches merge.
    slices: dicts with n, first, t80 (ISO). -> dict(h, frm, to, slices)"""
    iv = []
    for m in slices:
        lo = [ts(s["t80"]) for s in slices if skey(s["n"]) < skey(m["n"]) and ts(s["t80"]) < ts(m["first"])]
        if lo: iv.append([min(lo), ts(m["first"]), [m["n"]]])
    iv.sort(key=lambda i: i[0]); out = []
    for i in iv:
        if out and i[0] <= out[-1][1]: out[-1][1] = max(out[-1][1], i[1]); out[-1][2] += i[2]
        else: out.append(i)
    b = max(out, key=lambda i: i[1] - i[0], default=None)
    return dict(h=round((b[1] - b[0]).total_seconds() / 3600, 2), frm=b[0].isoformat(), to=b[1].isoformat(), slices=b[2]) if b else dict(h=0, frm=None, to=None, slices=[])


def writers(slices, runs, t0, t1, step=1800):
    """Per `step`-second bucket of [t0, t1]: slices with at least one commit in it (slice curve times are its commit times) and descendant threads with a run in flight. runs: (thread, start, end) datetimes."""
    out = []
    for i in range(math.ceil((t1 - t0).total_seconds() / step)):
        a = t0 + datetime.timedelta(seconds=i * step); b = a + datetime.timedelta(seconds=step)
        out.append(dict(t=a.isoformat(), slices=sum(any(a <= ts(c[0]) < b for c in s["curve"]) for s in slices), threads=len({t for t, s, e in runs if s < b and e >= a})))
    return out


def trough(w, step_h=0.5):
    """Longest stretch of `writers` buckets with fewer than half the peak number of threads running, between the first and last bucket at or above half.
    It needs no slice names, so it sees idle writing capacity that `blocked` misses when a slice has no slice branch. -> dict(h, frm, to, peak)"""
    peak = max((x["threads"] for x in w), default=0); busy = [i for i, x in enumerate(w) if peak and x["threads"] * 2 >= peak]
    best, start = None, None
    for i in range(busy[0], busy[-1] + 1) if busy else []:
        if w[i]["threads"] * 2 >= peak: start = None; continue
        start = i if start is None else start
        if best is None or i - start > best[1] - best[0]: best = (start, i)
    return dict(h=(best[1] - best[0] + 1) * step_h, frm=w[best[0]]["t"], to=w[best[1] + 1]["t"], peak=peak) if best else dict(h=0, frm=None, to=None, peak=peak)


def desc_runs(db, tids):
    """(thread, start, end) of every run of every descendant thread of the roots `tids`; a run with no completion ends at its request."""
    out = []
    for tid in tids:
        for t, _, _ in descendants_of(db, tid):
            out += [(t, ts(a), ts(b or a)) for a, b in db.execute("select requested_at, completed_at from orchestration_v2_projection_runs where thread_id=?", (t,))]
    return out


def utc(t):
    return t.astimezone(datetime.timezone.utc).isoformat()


def parse_log(text):
    """`git log --no-merges --numstat --format=@%H|%cI|<T3-Thread trailer>` -> [dict(h, t, thread, churn, parts)]. Churn skips the .json and generated paths (bucket() is None)."""
    out = []
    for line in text.splitlines():
        if line.startswith("@"):
            h, c, th = (line[1:].split("|", 2) + [""])[:3]; out.append(dict(h=h, t=ts(c), thread=th.split(",")[0] or None, churn=0, parts=collections.Counter()))
        elif out and line.count("\t") == 2:
            a, b, path = line.split("\t"); k = bucket(path)
            if k: d = (int(a) if a.isdigit() else 0) + (int(b) if b.isdigit() else 0); out[-1]["churn"] += d; out[-1]["parts"][k] += d
    return out


def attribute(commits, names, fallback):
    """Set slice, via and why on each commit. A commit with a `T3-Thread` trailer belongs to the slice in that thread's title (None when the title names none); a commit with no trailer
    takes `fallback[hash]` (the branch-name slice) if it has one. via is trailer|branch|None."""
    for c in commits:
        if c["thread"]: c["slice"] = slice_key(names.get(c["thread"])); c["via"] = "trailer"; c["why"] = None if c["slice"] else "thread title names no slice"
        elif c["h"] in fallback: c["slice"] = fallback[c["h"]]; c["via"] = "branch"; c["why"] = None
        else: c["slice"] = None; c["via"] = None; c["why"] = "no trailer"
    return commits


def branch_slices(branch, base):
    """Fallback for trailerless commits only: slice of the lowest `<branch>-sN[a]*` / `t3/<branch>-sN[a]*` branch that holds the commit. -> {hash: label}"""
    pat = re.compile(rf"(?:t3/)?{re.escape(branch)}-s(\d+[a-z]?)(?![a-z0-9]).*"); out = {}
    for n, r in sorted(((m[1], r) for r in git("for-each-ref", "--format=%(refname:short)", "refs/heads").split() if (m := pat.fullmatch(r))), key=lambda x: skey(x[0])):
        for h in git("log", "--no-merges", "--format=%H", f"^{base}", r).split(): out.setdefault(h, n)
    return out


def commit_log(db, branch, base, roots):
    """Non-merge commits since `base` on any local branch, kept when they are on the integration branch or their `T3-Thread` trailer names a thread of the run tree.
    No branch name is trusted: T3 keeps a thread's old branch name after a rename, and the trailer already says who wrote the commit. A commit whose branch was deleted before it merged is
    unreachable and cannot be read; lost_writers() names the threads that happened to. -> (commits kept, how many of them are not on the integration branch yet, ids of every thread with a commit, merges included)"""
    tree_ids = set(roots) | {t for r in roots for t, _, _ in descendants_of(db, r)}
    merged = set(git("log", "--no-merges", "--format=%H", f"^{base}", branch).split())
    kept = [c for c in parse_log(git("log", "--branches", "--no-merges", "--numstat", "--format=@%H|%cI|%(trailers:key=T3-Thread,valueonly,separator=%x2C)", f"^{base}")) if c["h"] in merged or c["thread"] in tree_ids]
    authors = set(git("log", "--branches", "--format=%(trailers:key=T3-Thread,valueonly,separator=%x2C)", f"^{base}").replace(",", " ").split())
    return kept, sum(c["h"] not in merged for c in kept), authors


def lost_writers(ms, authors):
    """Titles of threads that ran `git commit` and have no commit of theirs on any local branch: the sign of a branch deleted before it merged (or of commits that all failed). ms: thread metrics; authors: ids of threads with any commit, merges included."""
    wrote = set(authors); n = lambda v: (v["calls"] + v["secondary"]) if isinstance(v, dict) else (v[0] + v[2]) if v else 0
    return sorted(m["title"] or m["tid"] for m in ms if m["tid"] not in wrote and n((m.get("commands") or {}).get("git commit")))


def gate_slices(subj):
    """Slice labels a first-parent subject gates: `Slice N gated|merged` or `Wave ... gated|merged: slices ...`. A label may carry a letter (`Slice 2b gated`, `slices 5a, 6-7`); a range is digits only."""
    if mm := re.search(r"\b[Ss]lice (\d+[a-z]?) (?:gated|merged)", subj): return {mm[1]}  # search: the subject may lead with a file name
    if not re.match(r"Wave\b.*\b(?:gated|merged)", subj): return set()
    part = re.search(r"[Ss]lices? ((?:\d+[a-z]?|[,\s&\u2013-])+)", subj); out = set()
    for a, letter, b in re.findall(r"(\d+)([a-z])?(?:\s*[\u2013-]\s*(\d+))?", part[1] if part else ""):
        out.update([a + letter] if letter else map(str, range(int(a), int(b or a) + 1)))
    return out


def gates_and_marks(branch, base, t0, t1):
    """First-parent walk of the integration branch: the first gating commit per slice, and the gate/merge commits inside [t0, t1] for the page. -> ({label: time}, [dict(t, h, subject, kind)])"""
    gates, marks = {}, []
    for line in git("log", "--first-parent", "--reverse", "--format=%H\t%cI\t%s", f"{base}..{branch}").splitlines():
        h, c, subj = line.split("\t", 2)
        for n in gate_slices(subj): gates.setdefault(n, ts(c))
        kind = "gate" if "gated" in subj else "merge" if subj.startswith("Merge") else None
        if kind and t0 <= ts(c) <= t1: marks.append(dict(t=utc(ts(c)), h=h[:8], subject=subj, kind=kind))
    return gates, marks


def landmark(commits, gates, marks, t0, t1, runs=()):
    """Tail per slice: time from 80% of its final churn to its marker commit (`gates`, see gates_and_marks). A slice with no marker is open and runs to t1.
    A slice is the set of commits whose writing thread (the `T3-Thread` trailer) has that slice in its title; see attribute(). The slice list is whatever the commits name, so a slice needs no branch.
    Lettered slices (2b, 5a) are their own slices, ordered after their number (2 < 2b < 3): their work is cut later than the numbered slice's gate, so folding it in would stretch that slice's
    start, 80% mark and tail with commits made hours after it gated. A lettered slice gates on its own label (`Slice 2b gated`).No branch-name rule is needed for trailered commits:
    a commit has one writing thread, so it has one slice and no 'lowest slice that contains it' tie-break, and a late-cut branch (the old s2b exclusion) cannot hand a slice another's commits.
    Commits with no slice are counted, not hidden: `unattributed` {commits, churn, no_trailer, no_slice_title}; `by_branch` counts commits attributed by the branch-name fallback."""
    own = collections.defaultdict(list)
    for c in commits:
        if c["slice"]: own[c["slice"]].append(c)
    un = [c for c in commits if not c["slice"]]; out = []
    for n in sorted(own, key=skey):
        cs = sorted(own[n], key=lambda c: c["t"]); tot = sum(c["churn"] for c in cs); cum = 0; curve = []
        for c in cs: cum += c["churn"]; curve.append([utc(c["t"]), cum])
        i80 = next(i for i, cm in enumerate(curve) if cm[1] >= 0.8 * tot); t80 = cs[i80]["t"]; tail = cs[i80 + 1:]
        spans, act, quiet = tail_split([c["t"] for c in cs[i80:]], gates.get(n) or t1)
        out.append(dict(n=n, commits=len(cs), churn=tot, t80=utc(t80), gate=utc(gates[n]) if n in gates else None, first=utc(cs[0]["t"]), start_lag_h=round((cs[0]["t"] - t0).total_seconds() / 3600, 2),
                        tail_h=round(((gates.get(n) or t1) - t80).total_seconds() / 3600, 2), open=n not in gates, curve=curve, tail_commits=len(tail),
                        tail_churn=(tcn := {k: sum(c["parts"][k] for c in tail) for k in ("test", "prod", "docs")}), tail_test_share=round(tcn["test"] / sum(tcn.values()), 3) if sum(tcn.values()) else None, tail_active_h=round(act, 2), tail_quiet_h=round(quiet, 2), tail_segs=[[utc(a), utc(b)] for a, b in spans]))
    wall = (t1 - t0).total_seconds() / 3600; g = sum(not x["open"] for x in out); tc = sum(sum(x["tail_churn"].values()) for x in out); th = sum(x["tail_active_h"] + x["tail_quiet_h"] for x in out)
    # The median is over gated slices only: an open slice's 80% mark is 80% of what it has written so far, so a slice begun an hour ago would pull the headline down.
    done = [x["tail_h"] for x in out if not x["open"]]
    return dict(slices=out, median_tail_h=round(statistics.median(done), 2) if done else None, open_slices=[x["n"] for x in out if x["open"]], open_max_tail_h=max((x["tail_h"] for x in out if x["open"]), default=None),
                gated=g, wall_h=round(wall, 1), gated_per_10h=round(g / wall * 10, 2) if wall else None, blocked=blocked(out), writers=(w := writers(out, runs, t0, t1) if out else []), trough=trough(w),
                tail_test_share=round(sum(x["tail_churn"]["test"] for x in out) / tc, 3) if tc else None, tail_quiet_share=round(sum(x["tail_quiet_h"] for x in out) / th, 3) if th else None,
                marks=marks, commits_read=len(commits), by_branch=sum(c["via"] == "branch" for c in commits),
                unattributed=dict(commits=len(un), churn=sum(c["churn"] for c in un), no_trailer=sum(c["why"] == "no trailer" for c in un), no_slice_title=sum(c["why"] == "thread title names no slice" for c in un)))


RUNS = "select requested_at, completed_at from orchestration_v2_projection_runs where thread_id=? order by requested_at"


def run_kind(trig, wakes, ra, rb):
    """Bar class of one run: `run`, or for a keepalive-triggered run `ka` (no wake record), `ka-hit` or `ka-miss` by the wake whose next call hit or missed the cache."""
    if not trig.startswith("keepalive"): return "run"
    w = next((w for w in wakes if -60 <= (ts(w["at"]) - ts(ra)).total_seconds() <= (ts(rb) - ts(ra)).total_seconds() + 60), None)
    return "ka" if not w else "ka-hit" if w["hit"] else "ka-miss"


def lane_specs(db, roots):
    """Lanes in page order: every named root first, then each root's descendants that have runs, grouped by the slice in the title (numbered, lettered after their number) and the rest last. -> [dict(tid, title, model, group, slice, root)]"""
    sp = []
    for r in roots:
        sp.append(((0, (0, "")), dict(tid=r["tid"], title=r["title"], model=r.get("selected"), group="ROOTS", slice=None, root=True)))
        for t, title, p in descendants_of(db, r["tid"]):
            if not db.execute("select 1 from orchestration_v2_projection_runs where thread_id=? limit 1", (t,)).fetchone(): continue
            n = slice_key(title); sp.append(((1, skey(n)) if n else (2, (0, "")), dict(tid=t, title=title, model=(p.get("modelSelection") or {}).get("model"), group=f"SLICE {n}" if n else "OTHER", slice=n, root=False)))
    return [s for _, s in sorted(sp, key=lambda x: x[0])]


def fill_lanes(db, specs, M, names, t1):
    """Add to each lane what the page draws from the state db: runs [requested, completed|None, trigger text, kind], gaps and their causes, and the messages it received (with sender)."""
    for sp in specs:
        m = M.get(sp["tid"]) or {}; trig = {}; msgs = []
        for (pj,) in db.execute("select payload_json from orchestration_v2_projection_messages where thread_id=? and role='user'", (sp["tid"],)):
            p = json.loads(pj); txt = (p.get("text") or "")[:140]; snd = p.get("senderThreadId"); trig[p.get("createdAt")] = txt
            msgs.append(dict(t=p.get("createdAt"), frm=snd, frm_name=(names.get(snd) or snd) if snd else None, owner=p.get("createdBy") == "user" and p.get("creationSource") in ("web", "mobile"), text=txt))
        sp["runs"] = [[ra, rb, trig.get(ra) or "", run_kind(trig.get(ra) or "", m.get("keepalive", []), ra, rb or t1.isoformat())] for ra, rb in db.execute(RUNS, (sp["tid"],))]
        sp["gaps"] = m["gaps"] if m else gaps(db, sp["tid"], names); sp["msgs"] = msgs


def measures_line(lm, ro):
    """The headline numbers of the four measurements, one compact line beside the landmark line. ro: rollup()."""
    p = []
    if lm and lm["slices"]:
        p.append(f"slices not yet started while an earlier one was past 80%: {lm['blocked']['h']:.1f}h longest" + (f" (slices {', '.join(map(str, lm['blocked']['slices']))})" if lm["blocked"]["slices"] else ""))
        if (tr := lm.get("trough")) and tr["h"]: p.append(f"fewer than half the peak of {tr['peak']} child threads ran for {tr['h']:.1f}h ({tr['frm'][11:16]}Z to {tr['to'][11:16]}Z)")
        if lm["tail_test_share"] is not None: p.append(f"{lm['tail_test_share']:.0%} of tail churn is test code")
        if lm["tail_quiet_share"] is not None: p.append(f"{lm['tail_quiet_share']:.0%} of tail hours quiet")
    v = collections.Counter(r["verdict"] for r in ro["admits"]); d = sum(r["verdict"] == "HOLD" and r["kind"] == "revit-drive" for r in ro["admits"])
    p.append(f"{len(ro['admits'])} admission readings: {v['HOLD']} HOLD ({d} revit-drive), {v['REFUSE']} REFUSE")
    # idle after the command finished is the stall; idle while it still ran is the thread waiting on its own command, which its completion ends
    late = sum(max(x["idle_until_next_run_h"] - x["ran_on_h"], 0) for x in ro["turn_ends"] if x["idle_until_next_run_h"] is not None)
    p.append(f"{len(ro['turn_ends'])} turns ended with a command still running ({ro['turn_end_idle_h']:.1f}h idle until the next run, {late:.1f}h of it after the command had finished)")
    return " · ".join(p)


def commits_line(lm):
    """What the slice numbers leave out, in one line for the console and the page."""
    u = lm["unattributed"]; lost = lm.get("lost_writers") or []
    return (f"{lm['commits_read']} commits read, {lm.get('unmerged', 0)} not merged yet \u00b7 {u['commits']} belong to no slice (churn {u['churn']}: their thread's title names none)"
            + (f" \u00b7 {len(lost)} threads ran git commit and left no commit on any branch: {', '.join(t[:30] for t in lost[:4])}" if lost else ""))


def landmark_line(lm):
    if not lm or not lm["slices"]: return "Gate tail: no slice commits found."
    med = f"median {lm['median_tail_h']:.2f}h over {lm['gated']} gated slices" if lm["median_tail_h"] is not None else "no slice gated yet"
    opn = f" \u00b7 {len(lm['open_slices'])} open, the longest {lm['open_max_tail_h']:.1f}h past its 80% so far" if lm["open_slices"] else ""
    return f"Gate tail (80% of a slice's churn to its gate): {med}{opn} \u00b7 {lm['gated']} gated in {lm['wall_h']}h = {lm['gated_per_10h']} per 10 wall hours."


BARS_CSS = (".bar{display:grid;grid-template-columns:11em 1fr 16em;gap:8px;align-items:center;font-size:12px;max-width:900px}.bar i{display:block;height:10px;background:var(--chart-1,#3f6fb5)}"
            ".bar b{font-weight:400;color:var(--muted-foreground,#888)}")


def bars(cmds, n=25):
    top = list(cmds.items())[:n]; mx = max((v["hours"] for _, v in top), default=0) or 1
    return "".join(f'<div class="bar"><span>{html.escape(k)}</span><i style="width:{100 * v["hours"] / mx:.1f}%"></i><b>{v["hours"]:.2f}h \u00b7 {v["calls"]} calls \u00b7 +{v["secondary"]} 2nd</b></div>' for k, v in top)


def tree_total(root, kids, missing):
    ms = [root] + kids; wall = collections.Counter()
    for x in ms: wall.update(x["tool_wall"])
    costs = [x["cost"] for x in ms]
    return dict(thread=root["thread"] + ":tree", title=root["title"], model="-", hours=root["hours"], active_hours=round(sum(x["active_hours"] for x in ms), 1),
                owner_turns=root["owner_turns"], api_calls=sum(x["api_calls"] for x in ms), compactions=sum(x["compactions"] for x in ms), max_ctx=max(x["max_ctx"] for x in ms),
                cost=None if None in costs else round(sum(costs), 1), descendant_threads_unpriced=missing, cost_is_floor=missing > 0, descendants_measured=len(kids),
                tool_wall={k: round(v, 3) for k, v in wall.most_common()}, test_share=share(wall),
                idle_gaps=dict(n=sum(x["idle_gaps"]["n"] for x in ms), total_h=round(sum(x["idle_gaps"]["total_h"] for x in ms), 2)),
                keepalive=[w for x in ms for w in x["keepalive"]], cold_calls=[c for x in ms for c in x["cold_calls"]],
                waits={k: round(v, 2) for k, v in sum((collections.Counter(x["waits"]) for x in ms), collections.Counter()).most_common()}, commands=merge_commands(ms),
                activity={k: round(v, 3) for k, v in sum((collections.Counter(x["activity"]) for x in ms), collections.Counter()).most_common()},
                tool_calls=sum((x["tool_calls"] for x in ms), collections.Counter()), tool_output=sum((x["tool_output"] for x in ms), collections.Counter()), **rollup(ms))


COLS = ["thread", "model", "hours", "active_hours", "owner_turns", "api_calls", "compactions", "max_ctx", "cost", "descendant_threads_unpriced"]
EXTRA = ["test_share", "idle_h", "keepalive hit/total", "cold_calls"]


def cells(m):
    ka = m["keepalive"]; t = m["test_share"]
    return [round(m[c], 1) if isinstance(m[c], float) else m[c] for c in COLS] + [f"{t:.0%}" if t is not None else "-", m["idle_gaps"]["total_h"], f"{sum(w['hit'] for w in ka)}/{len(ka)}", len(m["cold_calls"])]


def window(db, tids):
    a, b = db.execute(f"select min(requested_at), max(coalesce(completed_at, requested_at)) from orchestration_v2_projection_runs where thread_id in ({','.join('?' * len(tids))})", tids).fetchone()
    return ts(a), ts(b)


def main():
    a = argparse.ArgumentParser(); a.add_argument("--out", required=True); a.add_argument("--tree", action="store_true"); a.add_argument("--branch"); a.add_argument("--base")
    a.add_argument("threads", nargs="+"); a = a.parse_args()
    if a.branch and not a.base: a.error("--branch needs --base")
    os.makedirs(a.out, exist_ok=True)
    db = sqlite3.connect(f"file:{T3}/statev2.sqlite?mode=ro", uri=True)
    rates = pricing.load_rates(T3)
    seen = set(); out = [m for m in (tree(db, rates, p, seen, a.tree) for p in a.threads) if m]
    allm = [x for m in out for x in [m] + m.get("descendants", [])]
    cmds = merge_commands(allm); lm = None; names = thread_names(db); ro = rollup(allm)
    specs = lane_specs(db, out) if a.tree else []  # the lanes' threads, with or without a native session, set the window
    win = window(db, [s["tid"] for s in specs] or [x["tid"] for x in allm]) if allm else None
    if a.branch and allm:
        commits, unmerged, authors = commit_log(db, a.branch, a.base, [m["tid"] for m in out])
        commits = attribute(commits, names, branch_slices(a.branch, a.base) if any(not c["thread"] for c in commits) else {})
        lm = landmark(commits, *gates_and_marks(a.branch, a.base, *win), *win, desc_runs(db, [m["tid"] for m in out]))
        lm["unmerged"] = unmerged; lm["lost_writers"] = lost_writers(allm, authors)
    fill_lanes(db, specs, {x["tid"]: x for x in allm}, names, win[1]) if specs else None
    json.dump(dict(threads=out, commands=cmds, landmark=lm, window=[t.isoformat() for t in win] if win else None, lanes=specs, rollup=ro), open(f"{a.out}/retro.json", "w"), indent=1, default=dict)
    print(" | ".join(COLS + EXTRA + ["tool calls", "tool output MB", "top inflow"]))
    rows = [x for m in out for x in [m] + ([m["tree_total"]] if "tree_total" in m else [])]
    for m in rows:
        top = m["tool_output"].most_common(1)
        print(" | ".join(map(str, cells(m) + [sum(m["tool_calls"].values()), round(sum(m["tool_output"].values()) / 1e6, 2), top[0][0] if top else "-"])))
    floors = [m["thread"] for m in out if m["cost_is_floor"] and "tree_total" not in m]
    if floors: print(f"cost is a main-thread FLOOR for {len(floors)} thread(s) with unpriced descendants: {', '.join(floors)}. Tree totals: rerun with --tree, or `census`.")
    print(measures_line(lm, ro))
    if lm: u = lm["unattributed"]; print(commits_line(lm)); print(f"commits detail: {lm['by_branch']} attributed by the branch-name fallback; {u['commits']} with no slice, churn {u['churn']} ({u['no_trailer']} no trailer, {u['no_slice_title']} thread title names no slice)")
    if lm: print(landmark_line(lm));[print(f"  slice {x['n']}: {x['commits']} commits, churn {x['churn']}, first {x['first'][11:16]}Z (+{x['start_lag_h']}h), 80% {x['t80'][11:16]}Z, gate {(x['gate'] or 'open')[11:16]}, tail {x['tail_h']}h{' (open)' if x['open'] else ''}: {x['tail_commits']} commits, test/prod/docs churn {x['tail_churn']['test']}/{x['tail_churn']['prod']}/{x['tail_churn']['docs']}, active {x['tail_active_h']}h quiet {x['tail_quiet_h']}h") for x in lm["slices"]]
    print("top commands (hours, calls, secondary): " + "; ".join(f"{k} {v['hours']}h {v['calls']} +{v['secondary']}" for k, v in list(cmds.items())[:10]))
    th = lambda cs: "".join(f"<th>{c}</th>" for c in cs)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(v))}</td>" for v in cells(m)) + "</tr>" for m in rows)
    wall = "".join(f"<tr><td>{html.escape(m['thread'])}</td><td>{', '.join(f'{k} {v}h' for k, v in list(m['tool_wall'].items())[:8])}</td></tr>" for m in rows)
    wt = "".join(f"<tr><td>{html.escape(m['thread'])}</td><td>{', '.join(f'{html.escape(k)} {v}h' for k, v in m['waits'].items())}</td></tr>" for m in allm if m["waits"])
    curves = "".join(f"<section><h3>{html.escape(m['title'])} <code>{m['thread']}</code></h3>{svg(m['curve'])}</section>" for m in out)
    open(f"{a.out}/retro.html", "w", encoding="utf-8").write(
        f"<!doctype html><meta charset=utf-8><title>retro</title><style>body{{font:14px system-ui;margin:24px}}td,th{{padding:3px 8px;border-bottom:1px solid #e5e7eb}}{BARS_CSS}</style>"
        f"<h1>Retro: main-thread spend</h1><p>{landmark_line(lm) if a.branch else ''}<br>{html.escape(measures_line(lm, ro))}</p><p>Cost from T3 usage-model-rates.json; an empty cost is an unpriced model; cost_is_floor rows exclude descendants. Orange dashes are compactions. "
        f"test_share is TEST tool-wall hours over all tool hours; idle_h is waiting between runs; keepalive counts wakes whose next call hit the cache.</p>"
        f"<table><tr>{th(COLS + EXTRA)}</tr>{body}</table><h3>Tool wall hours by kind (top 8)</h3><table>{wall}</table>"
        f"<h3>Command prefixes (top 25 by hours; background commands at their real duration; +n = counted as a lighter segment of another command)</h3>{bars(cmds)}"
        f"<h3>Waits between runs, by cause of the next run (hours)</h3><table>{wt}</table>{curves}")
    if a.tree: import swimlanes; swimlanes.render(a.out)  # the page only draws retro.json; `swimlanes.py <run-dir>` redraws it without remeasuring


if __name__ == "__main__":
    main()
