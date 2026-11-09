"""Stage native: one streaming pass over every native transcript (Claude jsonl + Claude subagents/*.jsonl + Codex rollouts) of the T3
threads in t3_provider_threads.json -> native.json, native_summary.json.

native.json = {files: [{path, thread, driver, sidechain, bytes, tokens, tools, commits, ...}], missing: [...]}
  claude_reqs  {requestId: [ts, model, in, cache_create, cache_read, out]}  max per requestId (Claude); Codex: codex_rows, sum of positive
               deltas of the cumulative token_count, model from the latest turn_context
  tools        rows [ts, name, class, flags]; class in read|edit|shell|test|subagent|browser|delegate|agentmsg|skill|wait|other
               flags: T test run, B browser/preview, R pe-revit, D git/file deletion, C git commit
  commits      rows [ts, branch, sha, subject] from `[branch sha] subject` lines in tool output (prefilter: line contains 'changed,')
native_summary.json = tokens and dollars by model (assemble(); an unpriced model has usd null, never 0) and the tool-class mix.
Pricing and rate resolution live in ../pricing.py, shared with retro.py.
"""
import bisect, collections, glob, json, multiprocessing as mp, os, re, time
from common import *

COMMIT_RE = re.compile(r"\[([A-Za-z0-9_./+@-]+)(?: \(root-commit\))? ([0-9a-f]{7,12})\] ([^\\\"\n]{0,200})")
TEST_RE = re.compile(r"\b(vitest|pnpm(?: -[\w./:=@-]+)* (?:run )?test|pnpm test|dotnet test|pe-revit test|pytest|jest|bun test|npm (?:run )?test|playwright test|tsc --noEmit|typecheck)\b")
BROWSER_RE = re.compile(r"playwright|agent-browser|puppeteer|preview_|chrome-devtools|screenshot", re.I)
PEREVIT_RE = re.compile(r"pe-revit")
DELETE_RE = re.compile(r"git rm\b|Remove-Item|\brm\s+-|\brm\s+[./\w]|git clean|git worktree remove|git branch -[dD]|git reset --hard")
COMMITCMD_RE = re.compile(r"git (?:-C \S+ )?commit\b")
EXEC_TOOL_RE = re.compile(r"tools\.([A-Za-z_][A-Za-z_0-9]*)\s*\(")


def flags_of(name, text):
    f = ""
    if TEST_RE.search(text): f += "T"
    if BROWSER_RE.search(name) or BROWSER_RE.search(text): f += "B"
    if PEREVIT_RE.search(text): f += "R"
    if DELETE_RE.search(text): f += "D"
    if COMMITCMD_RE.search(text): f += "C"
    return f


def cls_of(name, inner=None):
    n = inner or name
    if n in ("Read", "Grep", "Glob", "ToolSearch", "read_file", "list_dir", "view_image") or n.startswith("mcp__t3-code__t3_thread_read") or n.startswith("mcp__t3-code__t3_thread_search"): return "read"
    if n in ("Edit", "Write", "NotebookEdit", "apply_patch", "write_file"): return "edit"
    if n in ("Bash", "PowerShell", "shell", "shell_command", "local_shell", "exec_command", "write_stdin"): return "shell"
    if n in ("Agent", "Task") or n == "spawn_agent": return "subagent"
    if "preview_" in n or "browser" in n or "device_" in n: return "browser"
    if n.endswith(("delegate_task", "t3_thread_launch", "create_threads", "t3_worktree_handoff")): return "delegate"
    if n.endswith(("t3_thread_send", "t3_thread_send_attachments", "SendMessage", "t3_thread_transfer")): return "agentmsg"
    if n == "Skill": return "skill"
    if n in ("wait", "t3_thread_wait", "t3_background_wait", "Monitor", "send_input"): return "wait"
    return "other"


def tool_text(inp):
    if isinstance(inp, dict): return " ".join(str(inp.get(k)) for k in ("command", "cmd", "code", "script", "description", "prompt", "file_path") if inp.get(k))
    return str(inp)


def scan_claude(path, out):
    reqs, seen_tool = {}, set()
    for line in open(path, encoding="utf-8", errors="replace"):
        if "changed," in line:
            for m in COMMIT_RE.finditer(line):
                e = None
                try: e = json.loads(line)
                except ValueError: pass
                if e is not None and e.get("type") == "user": out["commits"].append([e.get("timestamp"), m.group(1), m.group(2), m.group(3).strip()])
        if '"type":"assistant"' not in line: continue
        try: e = json.loads(line)
        except ValueError: continue
        if e.get("type") != "assistant": continue
        t = e.get("timestamp") or ""; msg = e.get("message") or {}; mdl = msg.get("model") or "?"; u = msg.get("usage")
        rid = e.get("requestId") or e.get("uuid")
        if u and mdl != "<synthetic>" and rid:
            row = [t, mdl, u.get("input_tokens") or 0, u.get("cache_creation_input_tokens") or 0, u.get("cache_read_input_tokens") or 0, u.get("output_tokens") or 0]
            old = reqs.get(rid)
            if old: row = [old[0], old[1]] + [max(a, b) for a, b in zip(old[2:], row[2:])]
            reqs[rid] = row
        c = msg.get("content")
        for x in c if isinstance(c, list) else []:
            if isinstance(x, dict) and x.get("type") == "tool_use" and x.get("id") not in seen_tool:
                seen_tool.add(x.get("id")); name = x.get("name", "?"); text = tool_text(x.get("input"))
                cl = cls_of(name); fl = flags_of(name, text)
                if "T" in fl and cl == "shell": cl = "test"
                out["tools"].append([t, name, cl, fl])
    out["claude_reqs"] = reqs


def scan_codex(path, out):
    prev = collections.Counter(); model = "?"
    rows = collections.defaultdict(lambda: [0, 0, 0, 0])
    for line in open(path, encoding="utf-8", errors="replace"):
        if "changed," in line and ("_output" in line):
            for m in COMMIT_RE.finditer(line):
                try: e = json.loads(line)
                except ValueError: e = None
                if e: out["commits"].append([e.get("timestamp"), m.group(1), m.group(2), m.group(3).strip()])
        if '"turn_context"' in line[:200] or '"type":"turn_context"' in line[:120]:
            try: model = (json.loads(line).get("payload") or {}).get("model") or model
            except ValueError: pass
        elif '"token_count"' in line[:300]:
            try: e = json.loads(line)
            except ValueError: continue
            p = e.get("payload") or {}
            if p.get("type") != "token_count" or not p.get("info"): continue
            tot = p["info"].get("total_token_usage") or {}
            now = dict(i=tot.get("input_tokens", 0) - tot.get("cached_input_tokens", 0), r=tot.get("cached_input_tokens", 0), o=tot.get("output_tokens", 0))
            d = [max(0, now[k] - prev[k]) for k in ("i", "r", "o")]
            prev = now
            if any(d):
                r = rows[((e.get("timestamp") or "")[:16], model)]
                r[0] += d[0]; r[2] += d[1]; r[3] += d[2]
        elif '"function_call"' in line[:300] or '"custom_tool_call"' in line[:300]:
            try: e = json.loads(line)
            except ValueError: continue
            p = e.get("payload") or {}
            if p.get("type") not in ("function_call", "custom_tool_call"): continue
            t = e.get("timestamp") or ""; name = p.get("name", "?"); text = str(p.get("arguments") or p.get("input") or "")
            if name == "exec":
                for iname in set(EXEC_TOOL_RE.findall(text) or ["exec"]):
                    cl = cls_of(name, iname); fl = flags_of(iname, text)
                    if "T" in fl and cl == "shell": cl = "test"
                    out["tools"].append([t, "exec:" + iname, cl, fl])
            else:
                cl = cls_of(name); fl = flags_of(name, text)
                if "T" in fl and cl == "shell": cl = "test"
                out["tools"].append([t, name, cl, fl])
    out["codex_rows"] = [[k[0], k[1]] + v for k, v in rows.items()]


def work(job):
    path, thread, driver, sidechain = job
    out = dict(path=path, thread=thread, driver=driver, sidechain=sidechain, bytes=os.path.getsize(path), tools=[], commits=[])
    t0 = time.time()
    try: (scan_claude if driver == "claudeAgent" else scan_codex)(path, out)
    except Exception as ex: out["error"] = repr(ex)  # a file failing is a gap, recorded
    out["secs"] = round(time.time() - t0, 1)
    return out


def assemble(nat, lo, hi, rates):
    """native.json -> per-thread priced token buckets and tool rows inside [lo, hi). Claude requestIds are de-duplicated across all
    files (fork copies repeat history); the earliest copy owns the request. Returns (nat_files, tools, side_tools, buckets, usd_by_model).
    bucket = [minute, model, in, cache_create, cache_read, out, sidechain, usd|None]; usd_by_model[thread][model] = {usd, tokens, priced}."""
    tok_rows, tools, side_tools, nat_files, claimed = collections.defaultdict(list), collections.defaultdict(list), collections.Counter(), collections.defaultdict(list), {}
    lo_m, hi_m = lo[:16], hi[:16]
    for f in nat["files"]:
        t = f["thread"]
        nat_files[t].append(dict(path=os.path.basename(f["path"]), driver=f["driver"], sidechain=f["sidechain"], mb=round(f["bytes"] / 1e6, 2), error=f.get("error")))
        for rid, row in f.get("claude_reqs", {}).items():
            old = claimed.get(rid); tt = norm(row[0])
            if old is None or tt < old[0]: claimed[rid] = [tt, row[1], row[2], row[3], row[4], row[5], t, f["sidechain"]]
            elif old: old[2:6] = [max(a, b) for a, b in zip(old[2:6], row[2:6])]
        for row in f.get("codex_rows", []): tok_rows[t].append(row + [False])
        for tl in f["tools"]:
            tt = norm(tl[0])
            if not (lo <= tt < hi): continue
            if f["sidechain"]: side_tools[t] += 1
            else: tools[t].append([tt, tl[2], tl[1], tl[3]])
    for rid, r in claimed.items(): tok_rows[r[6]].append([r[0][:16], r[1], r[2], r[3], r[4], r[5], r[7]])
    for t in tools: tools[t].sort()
    buckets = {}
    usd_by_model = collections.defaultdict(lambda: collections.defaultdict(lambda: dict(usd=0.0, tokens=0, priced=True)))
    for t, rows in tok_rows.items():
        agg = collections.defaultdict(lambda: [0, 0, 0, 0])
        for m, mdl, i, cc, cr, o, sc in rows:
            if not (lo_m <= m < hi_m): continue
            a = agg[(m, mdl, sc)]; a[0] += i; a[1] += cc; a[2] += cr; a[3] += o
        bl = []
        for (m, mdl, sc), (i, cc, cr, o) in sorted(agg.items()):
            u = pricing.usd(rates, mdl, i, cc, cr, o)
            bl.append([m, mdl, i, cc, cr, o, sc, u])
            d = usd_by_model[t][mdl]; d["tokens"] += i + cc + cr + o
            if u is None: d["priced"] = False
            else: d["usd"] += u
        buckets[t] = bl
    return nat_files, tools, side_tools, buckets, usd_by_model


def run(R):
    workers = R.opts.get("workers", 8)
    refs = load(R.p("t3_provider_threads.json"))
    cl = {os.path.basename(f)[:-6]: f for f in glob.glob(f"{HOME}/.claude/projects/*/*.jsonl")}
    cx = {os.path.basename(f)[:-6][-36:]: f for f in glob.glob(f"{HOME}/.codex/sessions/*/*/*/rollout-*.jsonl")}
    jobs, missing, seen = [], [], set()
    for r in refs:
        nid, drv = r["native"], r["driver"]
        if not nid: missing.append(dict(r, why="no nativeId")); continue
        if (drv, nid) in seen: continue
        seen.add((drv, nid))
        f = cl.get(nid) if drv == "claudeAgent" else cx.get(nid) if drv == "codex" else None
        if not f: missing.append(dict(r, why="file not found")); continue
        jobs.append((f, r["thread"], drv, False))
        if drv == "claudeAgent":
            for sf in glob.glob(os.path.join(f[:-6], "subagents", "*.jsonl")): jobs.append((sf, r["thread"], drv, True))
    jobs.sort(key=lambda j: -os.path.getsize(j[0]))
    print("native: jobs", len(jobs), "missing", len(missing), "GB", round(sum(os.path.getsize(j[0]) for j in jobs) / 1e9, 2), flush=True)
    t0 = time.time(); res = []
    with mp.Pool(workers) as pool:
        for i, o in enumerate(pool.imap_unordered(work, jobs, chunksize=1)):
            res.append(o)
            if i % 200 == 0: print("  ", i, round(time.time() - t0), "s", flush=True)
    nat = dict(files=res, missing=missing, secs=round(time.time() - t0))
    dump(R.p("native.json"), nat)
    rates = pricing.load_rates(T3)
    nat_files, tools, side, buckets, ubm = assemble(nat, R.lo, R.hi, rates)
    by_model = collections.defaultdict(lambda: dict(usd=0.0, tokens=0, priced=True))
    for t in ubm:
        for m, d in ubm[t].items():
            a = by_model[m]; a["tokens"] += d["tokens"]
            if d["priced"]: a["usd"] += d["usd"]
            else: a["priced"] = False
    mix = collections.Counter(x[1] for v in tools.values() for x in v)
    dump(R.p("native_summary.json"), dict(window=[R.lo, R.hi], threads_with_transcript=len(nat_files), missing=len(missing),
                                          by_model={m: dict(usd=round(d["usd"], 2) if d["priced"] else None, tokens=d["tokens"], priced=d["priced"]) for m, d in by_model.items()},
                                          usd_priced_total=round(sum(d["usd"] for d in by_model.values() if d["priced"]), 2), tool_classes=dict(mix)))
    print("native: done", round(time.time() - t0), "s; errors", sum(1 for o in res if o.get("error")), "commit lines", sum(len(o["commits"]) for o in res),
          "usd (priced models)", round(sum(d["usd"] for d in by_model.values() if d["priced"])))
