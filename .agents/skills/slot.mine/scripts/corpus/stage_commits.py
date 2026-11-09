"""Stage commits: main-branch commits in the window (numstat, generated paths excluded) attributed to T3 threads -> commits.json, landed.json.

Attribution precedence, first hit wins, the method is recorded on every commit:
  trailer       `T3-Thread: <id>` commit trailer (git %(trailers:key=T3-Thread,valueonly)), written by the committing agent itself
  commit-line   `[branch sha] subject` printed by git in tool output; earliest transcript wins; short sha resolved with cat-file --batch-check
  patch-id      unmatched main commit vs a pre-rebase object named by a commit line (git diff-tree -p | git patch-id --stable)
  first-mention earliest transcript line mentioning the sha (>= 7 hex) at or after author time - 120 s. Weak: a reader can beat a creator
                who ran `git commit -q` (measured on the old run: same thread 81.7%, same root 91.7%)
  unknown
Merges stay unattributed; merge_threads carries the attribution of the commits they bring in.
Coverage is reported by commit count and by changed lines (mass-weighted: ins+del of included files), so a weak method on big commits shows.
landed.json: landed.classify per branch thread (landed|open|unknown, strong|weak grade, evidence), using the attribution above.
"""
import collections, datetime, json, multiprocessing as mp, os, re, subprocess
from common import *

METHODS = ["trailer", "commit-line", "patch-id", "first-mention", "unknown"]
RX = re.compile(rb"[0-9a-f]{7,40}")
TS_RE = re.compile(rb'"timestamp":"([^"]+)"')


def attribute(trailer=None, line=None, patch=None, mention=None):
    """Pure precedence rule. Each argument is the evidence dict for one source or None. Returns {thread, method, ...evidence fields}."""
    for method, ev in (("trailer", trailer), ("commit-line", line), ("patch-id", patch), ("first-mention", mention)):
        if ev and ev.get("thread"): return dict(ev, method=method)
    return dict(thread=None, method="unknown")


def parse_log(repo, main):
    raw = git(repo, "log", main, "-M", "--numstat", "-z", "--format=%x01%H%x1f%P%x1f%ct%x1f%at%x1f%an%x1f%s").split(b"\0")
    commits, order, cur, i = {}, [], None, 0
    while i < len(raw):
        tok = raw[i].decode("utf-8", "replace"); i += 1
        if tok.startswith("\x01"):
            h, par, ct, at, an, subj = tok[1:].split("\x1f", 5)
            cur = dict(sha=h, parents=par.split(), ct=int(ct), at=int(at), author=an, subject=subj, files=[])
            commits[h] = cur; order.append(h); continue
        tok = tok.lstrip("\n")
        if not tok or cur is None: continue
        m = re.match(r"^(\d+|-)\t(\d+|-)\t(.*)$", tok, re.S)
        if not m: continue
        a, d, p = m.groups()
        if p == "":  # rename: next two tokens are old, new
            p = raw[i + 1].decode("utf-8", "replace"); i += 2
        binary = a == "-"
        cur["files"].append([p, 0 if binary else int(a), 0 if binary else int(d), binary])
    return commits, order


def measure(c):
    ins = dele = gins = gdel = tins = 0; mods = collections.Counter(); inc = []
    for p, a, d, b in c["files"]:
        if b: continue
        if excluded(p): gins += a; gdel += d; continue
        ins += a; dele += d; inc.append(p); mods[module_of(p)] += a + d
        if is_test(p): tins += a + d
    c.update(ins=ins, dele=dele, gen_ins=gins, gen_del=gdel, test_lines=tins, included_files=len(inc), modules=dict(mods))
    c["file_stats"] = [[p, a, d] for p, a, d, b in c["files"] if not b and not excluded(p)]
    del c["files"]


def patch_ids(repo, shas):
    if not shas: return {}
    p1 = subprocess.run(["git", "-C", repo, "diff-tree", "--stdin", "-p", "--root", "-M"], input=("\n".join(shas) + "\n").encode(), capture_output=True)
    p2 = subprocess.run(["git", "-C", repo, "patch-id", "--stable"], input=p1.stdout, capture_output=True)
    d = {}
    for ln in p2.stdout.decode().splitlines():
        a = ln.split()
        if len(a) == 2: d.setdefault(a[0], []).append(a[1])
    return d


# ---- first-mention scan (multiprocess over transcripts) ----
_SHAS = {}


def _init(shas):
    global _SHAS
    _SHAS = shas


def _scan(job):
    path, thread = job
    found = {}
    try:
        with open(path, "rb") as fh:
            for line in fh:
                hit = []
                for m in RX.findall(line):
                    for fs, at in _SHAS.get(m[:7], ()):
                        if fs.startswith(m.decode()): hit.append(fs)
                if not hit: continue
                tm = TS_RE.search(line)
                if not tm: continue
                t = tm.group(1).decode()
                kind = "assistant" if b'"role":"assistant"' in line else "tool_output" if (b"tool_result" in line or b"_output" in line[:400]) else "user_or_other"
                for fs in set(hit): found.setdefault(fs, []).append((t, kind))
    except Exception:
        return path, thread, {}
    return path, thread, found


def mentions(R, shas_at, workers):
    """shas_at: {full_sha: author_time}. -> {full_sha: {ts, thread, kind, file, count, threads}} earliest qualifying mention."""
    by7 = collections.defaultdict(list)
    for h, at in shas_at.items(): by7[h[:7].encode()].append((h, at))
    nat = load(R.p("native.json"))
    jobs = [(f["path"], f["thread"]) for f in nat["files"]]
    agg = {}
    with mp.Pool(workers, initializer=_init, initargs=(dict(by7),)) as pool:
        for path, thread, found in pool.imap_unordered(_scan, jobs, chunksize=4):
            for fs, lst in found.items():
                a = agg.setdefault(fs, dict(ts=None, count=0, threads=collections.Counter(), at=shas_at[fs]))
                for t, kind in lst:
                    a["count"] += 1; a["threads"][thread] += 1; tt = norm(t)
                    if ts(tt).timestamp() < a["at"] - 120: continue
                    if a["ts"] is None or tt < a["ts"]: a.update(ts=tt, thread=thread, kind=kind, file=os.path.basename(path))
    return {fs: dict(ts=a["ts"], thread=a.get("thread"), kind=a.get("kind"), file=a.get("file"), count=a["count"], threads=dict(a["threads"].most_common(6))) for fs, a in agg.items() if a["ts"]}


def coverage(nm):
    tot_n = len(nm) or 1; tot_l = sum(c["ins"] + c["dele"] for c in nm) or 1
    out = {}
    for m in METHODS:
        cs = [c for c in nm if c["method"] == m]; ln = sum(c["ins"] + c["dele"] for c in cs)
        out[m] = dict(commits=len(cs), share=round(len(cs) / tot_n, 4), lines=ln, line_share=round(ln / tot_l, 4))
    strong = out["trailer"]["commits"] + out["commit-line"]["commits"] + out["patch-id"]["commits"]
    strong_l = out["trailer"]["lines"] + out["commit-line"]["lines"] + out["patch-id"]["lines"]
    out["_strong"] = dict(commits=strong, share=round(strong / tot_n, 4), lines=strong_l, line_share=round(strong_l / tot_l, 4))
    return out


def run(R):
    repo, main = R.repo, R.main
    lo_ct = ts(R.lo).timestamp(); hi_ct = ts(R.hi).timestamp()
    head = git(repo, "rev-parse", main).decode().strip()
    commits, order = parse_log(repo, main)
    inwin = sorted((commits[h] for h in order if lo_ct <= commits[h]["ct"] < hi_ct), key=lambda c: c["ct"])
    for c in inwin:
        c["merge"] = len(c["parents"]) > 1
        c["ts"] = datetime.datetime.fromtimestamp(c["ct"], datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        measure(c)
    print(f"commits: {main} {head[:8]}; on branch {len(commits)}, in window {len(inwin)}, merges {sum(1 for c in inwin if c['merge'])}")
    # trailer evidence (landed.facts parses every main commit's T3-Thread trailers once)
    F = landed.facts(repo, main)
    trailer_of = {}
    for tid, shas in F["trailer"].items():
        for s in shas: trailer_of.setdefault(s, tid)
    # commit-line index
    nat = load(R.p("native.json"))
    cand = collections.defaultdict(list)
    for f in nat["files"]:
        for t, br, sh, subj in f["commits"]: cand[sh].append((norm(t) if t else "", f["thread"], f["path"], br, subj))
    shorts = sorted(cand)
    out = git(repo, "cat-file", "--batch-check", inp=("\n".join(shorts) + "\n").encode()).decode().splitlines() if shorts else []
    full, amb, miss = {}, 0, 0
    for s, line in zip(shorts, out):
        parts = line.split()
        if len(parts) == 3 and parts[1] == "commit": full[s] = parts[0]
        elif "ambiguous" in line: amb += 1
        else: miss += 1
    by_full = collections.defaultdict(list)
    for s, fs in full.items(): by_full[fs].extend(cand[s])
    index = {}
    for fs, lst in by_full.items():
        lst.sort(); seen = []
        for _, tid, *_r in lst:
            if tid not in seen: seen.append(tid)
        index[fs] = dict(thread=lst[0][1], birth_ts=lst[0][0], birth_branch=lst[0][3], alt_threads=seen[1:])
    nm = [c for c in inwin if not c["merge"]]
    evid = {c["sha"]: dict(trailer=({"thread": trailer_of[c["sha"]]} if c["sha"] in trailer_of else None), line=index.get(c["sha"]), patch=None, mention=None) for c in nm}
    # patch-id for what the first two leave open
    unm = [c for c in nm if not evid[c["sha"]]["trailer"] and not evid[c["sha"]]["line"]]
    inwin_set = {c["sha"] for c in inwin}
    cands = [fs for fs in index if fs not in inwin_set]
    pid_c, pid_u = patch_ids(repo, cands), patch_ids(repo, [c["sha"] for c in unm])
    for pid, shs in pid_u.items():
        if pid in pid_c:
            orig = sorted((index[x]["birth_ts"], x) for x in pid_c[pid])[0][1]
            for s in shs: evid[s]["patch"] = dict(thread=index[orig]["thread"], birth_ts=index[orig]["birth_ts"], orig_sha=orig, alt_threads=index[orig]["alt_threads"])
    # first-mention for what is still open
    still = {c["sha"]: c["at"] for c in unm if not evid[c["sha"]]["patch"]}
    men = mentions(R, still, R.opts.get("workers", 8)) if still else {}
    for s, m in men.items():
        evid[s]["mention"] = dict(thread=m["thread"], birth_ts=m["ts"], mention_kind=m["kind"], alt_threads=[t for t in m["threads"] if t != m["thread"]])
    for c in nm:
        e = evid[c["sha"]]
        c.update(attribute(e["trailer"], e["line"], e["patch"], e["mention"]))
    att = {c["sha"]: c["thread"] for c in nm if c.get("thread")}
    for c in inwin:
        if not c["merge"]: continue
        try: introduced = git(repo, "rev-list", f"{c['parents'][0]}..{c['parents'][1]}").decode().split()
        except RuntimeError: introduced = []
        c.update(thread=None, method="merge", merge_introduced=len(introduced), merge_threads=dict(collections.Counter(att[s] for s in introduced if s in att).most_common(5)))
    cov = coverage(nm)
    # landed tri-state per branch thread
    TH = load(R.p("t3_threads.json"))
    attrib = collections.defaultdict(lambda: collections.defaultdict(list))
    for c in nm:
        if c.get("thread"): attrib[c["thread"]][c["method"]].append(c["sha"])
    lj = {}
    for tid in TH["active"]:
        t = TH["threads"][tid]; b = t.get("branch")
        if b and b != main:
            st, grade, ev = landed.classify(dict(thread=tid, branch=b, created=t["created_at"]), F, attrib)
            lj[tid] = dict(state=st, grade=grade, evidence=ev, branch=b)
        else:
            lj[tid] = dict(state=None, grade=None, evidence="main-direct" if b else "no-branch", branch=b)
    dump(R.p("landed.json"), lj)
    dump(R.p("commits.json"), dict(head=head, branch=main, window=[R.lo, R.hi], commits=inwin, coverage=cov, nonmerge=len(nm), merges=len(inwin) - len(nm),
                                   resolve=dict(shas=len(shorts), resolved=len(full), ambiguous=amb, missing=miss), trailer_commits_on_main=len(trailer_of)))
    print(f"commits: non-merge {len(nm)}, merges {len(inwin) - len(nm)}; " + "; ".join(f"{m} {cov[m]['commits']} ({100 * cov[m]['share']:.1f}% / {100 * cov[m]['line_share']:.1f}% of lines)" for m in METHODS))
    print("commits: landed states", dict(collections.Counter(v["state"] for v in lj.values() if v["state"] is not None or v["evidence"] == "main-direct")))
