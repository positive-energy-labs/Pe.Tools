# loop-metrics: rerunnable scorecard over Claude Code + Codex session history.
#
# The metric for "is the execution loop getting better": error%, timeout%, and blind-retry runs per
# command family (pe-revit, pea, vp, dotnet, ...) per source, over a date window. Run it after a
# doctrine change (AGENTS.md, execute skill) or an SDK bump, compare windows, and the delta is
# the evidence. First baseline: 2026-06-15..08-18 in .artifacts/runs/history-mining-20260818/.
#
#   python tools/loop-metrics.py --since 2026-08-18 [--until YYYY-MM-DD] [--out DIR]
#
# Emits under --out (default .artifacts/runs/loop-metrics-<today>/):
#   calls.jsonl     one record per tool call: src, sess, ts, fam, cmd, err, exit, timeout, dur_s
#   scorecard.md    per-family table + top error signatures + repeat-run (blind retry) counts
#
# Classifier spec (learned 2026-08-18 from 911-session mining; fixes encoded here ARE the spec):
#   - error = structured evidence only: Claude tool_result.is_error, Codex metadata.exit_code != 0,
#     or a line-anchored "Exit code: N" (N != 0). NEVER free-text "error" matching — advisory
#     stderr banners and PE.BUILD JSON made ~1/3 of naive flags phantom.
#   - timeout = line-anchored "timed out after" / "Command timed out" or a call with no recorded
#     result. NEVER substring "hang" (matches "change").
#   - rg/grep exit 1 is "no matches", not an error.
#   - Codex non-shell tools (wait, update_plan, spawn_agent, ...) are tracked but excluded from
#     family error rates — their "errors" are fan-out mechanics, not loop friction.
import argparse, collections, csv, datetime, glob, json, os, re

FAMILY_RULES = [
    ("pe-revit", re.compile(r"\bpe-revit\b", re.I)),
    ("pe-dev", re.compile(r"\bpe-dev\b", re.I)),
    ("peco", re.compile(r"\bpeco\b", re.I)),
    ("pea", re.compile(r"(^|[\\/;&|\s'\"])pea(\.cmd|\.exe|\.ps1)?($|[\s'\"&|;])", re.I)),
    ("vp", re.compile(r"(^|[\s;&|'\"])(vp|vite-plus)\s", re.I)),
    ("dotnet", re.compile(r"\bdotnet\b", re.I)),
    ("powershell", re.compile(r"\b(powershell|pwsh)\b|\.ps1\b", re.I)),
    ("python", re.compile(r"\bpython3?\b|\.py\b", re.I)),
    ("node-ts", re.compile(r"\b(node|npx|tsx|jiti|pnpm|npm)\b", re.I)),
    ("git", re.compile(r"(^|[\s;&|])git\s", re.I)),
    ("curl", re.compile(r"\bcurl\b|Invoke-WebRequest|Invoke-RestMethod", re.I)),
    ("inline-cs", re.compile(r"\.cs\b|csc\b", re.I)),
]
EXIT_LINE = re.compile(r"^\s*Exit code:?\s+(\d+)", re.I | re.M)
TIMEOUT_LINE = re.compile(r"^.*\b(timed out after|Command timed out)\b", re.I | re.M)
RG_LIKE = re.compile(r"(^|[\s;&|])(rg|grep)\s")

def classify(cmd):
    for fam, pat in FAMILY_RULES:
        if pat.search(cmd):
            return fam
    return "other"

def parse_ts(s):
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            (c.get("text") or c.get("input_text") or "") if isinstance(c, dict) else str(c)
            for c in content
        )
    return ""

def judge(rec, out_text, is_error_flag=None, exit_code=None):
    t = (out_text or "")[:4000]
    if exit_code is None:
        m = EXIT_LINE.search(t)
        if m:
            exit_code = int(m.group(1))
    timeout = bool(TIMEOUT_LINE.search(t))
    err = bool(is_error_flag) or (exit_code not in (None, 0)) or timeout
    # rg/grep exit 1 = no matches, not an error (unless it also timed out)
    if exit_code == 1 and RG_LIKE.search(rec["cmd"] or "") and not timeout:
        err = False
    rec.update(err=err, exit=exit_code, timeout=timeout,
               err_snippet=t[-400:] if err else None)

def mine_claude(path, since, until, calls):
    sess = os.path.basename(path)
    pending = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                o = json.loads(line)
            except Exception:
                continue
            ts = parse_ts(o.get("timestamp", ""))
            if ts and not (since <= ts <= until):
                continue
            msg = o.get("message") or {}
            content = msg.get("content")
            if o.get("type") == "assistant" and isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_use":
                        name, inp = c.get("name", ""), c.get("input") or {}
                        cmd = inp.get("command") or ""
                        fam = (classify(cmd) if name in ("Bash", "PowerShell") and cmd
                               else "mcp:" + name.split("__")[1][:24] if name.startswith("mcp__")
                               else "harness:" + name)
                        pending[c.get("id")] = dict(src="claude", sess=sess, ts=str(ts),
                                                    fam=fam, tool=name, cmd=cmd[:300])
            elif o.get("type") == "user" and isinstance(content, list):
                for r in content:
                    if isinstance(r, dict) and r.get("type") == "tool_result":
                        rec = pending.pop(r.get("tool_use_id"), None)
                        if rec:
                            judge(rec, text_of(r.get("content")), is_error_flag=r.get("is_error"))
                            calls.append(rec)
    for rec in pending.values():  # no result recorded = interrupted/hung/killed
        rec.update(err=True, exit=None, timeout=True, err_snippet="<no result recorded>")
        calls.append(rec)

CODEX_FANOUT_TOOLS = {"wait", "update_plan", "spawn_agent", "send_message", "wait_agent",
                      "list_agents", "followup_task", "get_goal", "js"}

def mine_codex(path, since, until, calls):
    sess = os.path.basename(path)
    pending = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                o = json.loads(line)
            except Exception:
                continue
            ts = parse_ts(o.get("timestamp", ""))
            if ts and not (since <= ts <= until):
                continue
            p = o.get("payload") or {}
            pt = p.get("type") if isinstance(p, dict) else None
            if o.get("type") != "response_item":
                continue
            if pt in ("function_call", "custom_tool_call"):
                name = p.get("name") or pt
                if name in CODEX_FANOUT_TOOLS:
                    fam = "tool:" + name
                    cmd = ""
                else:
                    if pt == "function_call":
                        try:
                            args = json.loads(p.get("arguments") or "{}")
                            c = args.get("command")
                            cmd = " ".join(c) if isinstance(c, list) else (c or "")
                        except Exception:
                            cmd = (p.get("arguments") or "")[:300]
                    else:
                        cmd = (p.get("input") or "")[:300]
                    fam = classify(cmd) if cmd else "tool:" + name
                pending[p.get("call_id")] = dict(src="codex", sess=sess, ts=str(ts),
                                                 fam=fam, tool=name, cmd=(cmd or "")[:300])
            elif pt in ("function_call_output", "custom_tool_call_output"):
                rec = pending.pop(p.get("call_id"), None)
                if rec is None:
                    continue
                out = p.get("output")
                txt, exit_code = (out if isinstance(out, str) else text_of(out)), None
                if isinstance(out, str) and out.startswith("{"):
                    try:
                        oo = json.loads(out)
                        exit_code = (oo.get("metadata") or {}).get("exit_code")
                        txt = oo.get("output") or txt
                    except Exception:
                        pass
                judge(rec, txt, exit_code=exit_code)
                calls.append(rec)
    for rec in pending.values():
        rec.update(err=True, exit=None, timeout=True, err_snippet="<no result recorded>")
        calls.append(rec)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True)
    ap.add_argument("--until", default=str(datetime.date.today()))
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    since = datetime.datetime.fromisoformat(a.since)
    until = datetime.datetime.fromisoformat(a.until) + datetime.timedelta(days=1)
    out = a.out or os.path.join(".artifacts", "runs", f"loop-metrics-{datetime.date.today()}")
    os.makedirs(out, exist_ok=True)

    home = os.path.expanduser("~")
    claude_files = glob.glob(os.path.join(home, ".claude", "projects", "*", "*.jsonl"))
    codex_files = (glob.glob(os.path.join(home, ".codex", "sessions", "*", "*", "*", "*.jsonl"))
                   + glob.glob(os.path.join(home, ".codex", "archived_sessions", "*.jsonl")))
    in_window = lambda p: datetime.datetime.fromtimestamp(os.path.getmtime(p)) >= since
    calls = []
    for p in filter(in_window, claude_files):
        mine_claude(p, since, until, calls)
    for p in filter(in_window, codex_files):
        mine_codex(p, since, until, calls)

    with open(os.path.join(out, "calls.jsonl"), "w", encoding="utf-8") as f:
        for r in calls:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    fam = collections.defaultdict(lambda: [0, 0, 0])
    sig = collections.Counter()
    repeats = collections.Counter()  # blind-retry proxy: identical failing cmd re-run in a session
    seen_fail = collections.Counter()
    for r in calls:
        s = fam[(r["src"], r["fam"])]
        s[0] += 1
        s[1] += bool(r.get("err"))
        s[2] += bool(r.get("timeout"))
        if r.get("err"):
            if r.get("err_snippet"):
                lines = [x for x in r["err_snippet"].strip().splitlines() if x.strip()]
                if lines:
                    sig[(r["fam"], re.sub(r"[0-9a-f]{8,}|\d+", "N", lines[-1][:140]))] += 1
            key = (r["sess"], r["cmd"])
            if r["cmd"]:
                seen_fail[key] += 1
                if seen_fail[key] > 1:
                    repeats[(r["fam"], r["cmd"][:100])] += 1

    with open(os.path.join(out, "scorecard.md"), "w", encoding="utf-8") as f:
        f.write(f"# Loop scorecard {a.since}..{a.until}\n\ntotal calls {len(calls)}\n\n"
                "| src | family | calls | err | err% | timeouts |\n|---|---|--:|--:|--:|--:|\n")
        for (src, fm), (n, e, to) in sorted(fam.items(), key=lambda kv: -kv[1][0]):
            if n >= 10:
                f.write(f"| {src} | {fm} | {n} | {e} | {100*e/n:.1f}% | {to} |\n")
        f.write("\n## Blind retries (same failing command re-run in one session)\n\n")
        for (fm, cmd), n in repeats.most_common(20):
            f.write(f"- {n}x [{fm}] {cmd}\n")
        f.write("\n## Top error signatures\n\n")
        for (fm, s), n in sig.most_common(40):
            f.write(f"- {n}x [{fm}] {s}\n")
    print(f"{len(calls)} calls -> {out}")

if __name__ == "__main__":
    main()
