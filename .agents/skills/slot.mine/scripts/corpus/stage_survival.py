"""Stage survival: churn clock, phases, line survival, and an exploratory per-module table -> survival.json, survival.txt, blame_head.json.

Read-only git (ls-tree, cat-file, blame --line-porcelain, rev-list). Definitions:
  denominator(commit) = insertions in included (non-generated, non-binary) files that were not skipped for blame
  survivors(commit)   = lines at the window-end rev whose `git blame -M` origin commit is that commit. -M follows lines moved within a file, so a
                        reorder does not read as a rewrite; --blame-C also follows lines copied across files (slow, opt-in); --no-move-detect is the old plain blame.
  churn clock         = cumulative included lines changed (ins+del) by non-merge window commits in committer order; churn distance = clock(end) - clock(commit)
  phases              = trailing 60-commit del/ins ratio; enter `overhaul` at >= 1.0, leave at < 0.6, phases < 30 commits absorbed (alternating build/overhaul)
  phase N -> N+1      = lines added in phase N still alive at the end of phase N+1. History is not linear, so the rev is the newest-40 commits before the end of
                        phase N+1 that contains the most phase-N commits; blame there, restricted to reachable phase-N commits (reachability printed)
  module table (EXPLORATORY: apportioned dollars and a head-file module key are rough)
        lines added / surviving per module (module of the file at head, see common.module_of); $ = each attributed thread's own spend split by that thread's
        added lines per module (threads without a transcript contribute nothing; unattributed commits get no $); $/surviving line; retouch-K25 / K100 = share
        of file touches whose file was last touched <= K main commits earlier; co-change top module; blast radius = mean included files per commit touching
        the module; test/src touch ratio. With --blame-C a line may come from another file than the one it is counted in.
"""
import bisect, collections, concurrent.futures as cf, re, statistics, subprocess, time
from common import *

HDR = re.compile(rb"^([0-9a-f]{40}) \d+ \d+", re.M)
KS = (25, 100)


def blame_flags(opts):
    f = ["blame", "--line-porcelain"]
    if opts.get("move_detect", True): f.append("-M")
    if opts.get("blame_C"): f.append("-C")
    return f


def blame(job):
    rev, path, flags, repo = job
    r = subprocess.run(["git", "-C", repo, *flags, rev, "--", path], capture_output=True, timeout=600)
    if r.returncode != 0: return path, None
    return path, collections.Counter(HDR.findall(r.stdout))


def blame_many(repo, rev, paths, workers, flags):
    per_file, failed = {}, []
    with cf.ThreadPoolExecutor(workers) as ex:
        for path, c in ex.map(blame, [(rev, p, flags, repo) for p in paths]):
            if c is None: failed.append(path)
            else: per_file[path] = {k.decode(): v for k, v in c.items()}
    return per_file, failed


def blob_stats(repo, rev, paths):
    inp = "".join(f"{rev}:{p}\n" for p in paths).encode()
    out = subprocess.run(["git", "-C", repo, "cat-file", "--batch"], input=inp, capture_output=True).stdout
    pos, res = 0, {}
    for path in paths:
        nl = out.index(b"\n", pos); head = out[pos:nl].decode(); pos = nl + 1
        if head.endswith("missing"): res[path] = None; continue
        size = int(head.split()[2]); blob = out[pos:pos + size]; pos += size + 1
        res[path] = (blob.count(b"\n") + (1 if blob and not blob.endswith(b"\n") else 0), b"\0" in blob[:8000])
    return res


def churn_table(cs):
    """Retouch, co-change, blast radius, test ratio per module over non-merge window commits in order (folded from the old churn.py)."""
    touches, test_t, src_t = collections.Counter(), collections.Counter(), collections.Counter()
    retouch = {k: collections.Counter() for k in KS}; gaps = collections.defaultdict(list)
    blast_sum, blast_n = collections.Counter(), collections.Counter(); co = collections.defaultdict(collections.Counter); last_idx = {}
    for idx, c in enumerate(cs):
        inc = [p for p, a, d in c["file_stats"]]; mods = {module_of(p) for p in inc}
        for m in mods:
            blast_sum[m] += len(inc); blast_n[m] += 1
            for o in mods - {m}: co[m][o] += 1
        for p in inc:
            m = module_of(p); touches[m] += 1
            (test_t if is_test(p) else src_t)[m] += 1
            if p in last_idx:
                gap = idx - last_idx[p]; gaps[m].append(gap)
                for K in KS:
                    if gap <= K: retouch[K][m] += 1
            last_idx[p] = idx
    return {m: dict(touches=t, retouch25=round(retouch[25][m] / t, 3), retouch100=round(retouch[100][m] / t, 3), median_gap=statistics.median(gaps[m]) if gaps[m] else None,
                    test_ratio=round(test_t[m] / src_t[m], 3) if src_t[m] else None, blast=round(blast_sum[m] / blast_n[m], 2) if blast_n[m] else None,
                    commits=blast_n[m], top_co=(co[m].most_common(1)[0] if co[m] else None)) for m, t in touches.items()}


def run(R):
    t0 = time.time(); repo = R.repo; workers = R.opts.get("workers", 8)
    flags = blame_flags(R.opts)
    CM = load(R.p("commits.json")); head = git(repo, "rev-parse", R.main).decode().strip()
    assert head == CM["head"], f"{R.main} moved: {head} != {CM['head']} (rerun the commits stage)"
    EP = load(R.p("epochs.json"))["lanes"]; TH = load(R.p("threads.json"))["threads"]
    cs = sorted([c for c in CM["commits"] if not c["merge"]], key=lambda c: (c["ct"], c["sha"]))
    win_sha = {c["sha"] for c in cs}
    at_head = set(git(repo, "ls-tree", "-r", "--name-only", head).decode().splitlines())
    touched = sorted({p for c in cs for p, a, d in c["file_stats"]} & at_head)
    st = blob_stats(repo, head, touched); max_lines = R.opts.get("max_lines", 5000)
    skipped, todo = {}, []
    for p in touched:
        s = st[p]
        if s is None: skipped[p] = "missing"
        elif s[1]: skipped[p] = "binary"
        elif s[0] > max_lines: skipped[p] = f"{s[0]} lines > {max_lines}"
        else: todo.append(p)
    print(f"survival: blame flags {' '.join(flags[2:])}; touched files at head {len(touched)}; blame {len(todo)}; skipped {len(skipped)}", flush=True)
    cache = R.p("blame_head.json")
    if os.path.exists(cache) and load(cache).get("head") == head and load(cache).get("flags") == flags:
        c_ = load(cache); per_file, failed = c_["per_file"], c_["failed"]
    else:
        per_file, failed = blame_many(repo, head, todo, workers, flags); dump(cache, dict(head=head, flags=flags, per_file=per_file, failed=failed))
    print("survival: head blame done", round(time.time() - t0), "s; failed", len(failed), flush=True)
    skipped.update({p: "blame failed" for p in failed})
    surv = collections.Counter()
    for cnt in per_file.values():
        for sha, n in cnt.items(): surv[sha] += n
    # ---- per-commit survival + churn clock
    clock, rows = 0, []
    for i, c in enumerate(cs):
        den = sum(a for p, a, d in c["file_stats"] if p not in skipped)
        clock += c["ins"] + c["dele"]
        rows.append(dict(i=i, sha=c["sha"], ts=c["ts"], thread=c.get("thread"), method=c["method"], birth_ts=c.get("birth_ts"), ins=c["ins"], dele=c["dele"], den=den, den_all=c["ins"], surv=surv.get(c["sha"], 0), clock=clock))
    total = clock
    for r in rows: r["churn_dist"] = total - r["clock"]
    # ---- phases
    W, ENTER, EXIT, MINP = R.opts.get("phase_window", 60), R.opts.get("enter", 1.0), R.opts.get("exit", 0.6), R.opts.get("min_phase", 30)
    state, lab = "build", []
    for i in range(len(cs)):
        w = cs[max(0, i - W + 1):i + 1]; ratio = sum(c["dele"] for c in w) / max(sum(c["ins"] for c in w), 1)
        if state == "build" and ratio >= ENTER and i >= W - 1: state = "overhaul"
        elif state == "overhaul" and ratio < EXIT: state = "build"
        lab.append(state)
    segs = []
    for i, s in enumerate(lab):
        if segs and segs[-1][0] == s: segs[-1][2] = i
        else: segs.append([s, i, i])
    changed = True
    while changed and len(segs) > 1:
        changed = False
        for k in range(1, len(segs)):
            if segs[k][2] - segs[k][1] + 1 < MINP: segs[k - 1][2] = segs[k][2]; del segs[k]; changed = True; break
        merged = []
        for s in segs:
            if merged and merged[-1][0] == s[0]: merged[-1][2] = s[2]
            else: merged.append(s)
        segs = merged
    phases = []
    for n, (s, a, b) in enumerate(segs, 1):
        w = rows[a:b + 1]
        phases.append(dict(n=n, kind=s, first=a, last=b, start=rows[a]["ts"], end=rows[b]["ts"], commits=b - a + 1, ins=sum(r["ins"] for r in w), dele=sum(r["dele"] for r in w)))
        for r in w: r["phase"] = n
    for p in phases:
        w = rows[p["first"]:p["last"] + 1]
        p["del_ins_ratio"] = round(p["dele"] / max(p["ins"], 1), 2); p["den"] = sum(r["den"] for r in w); p["surv_end"] = sum(r["surv"] for r in w)
        p["survival_to_end"] = round(p["surv_end"] / p["den"], 3) if p["den"] else None
    p2 = []
    if not R.opts.get("skip_phase_blame"):
        for k in range(len(phases) - 1):
            n_, nxt = phases[k], phases[k + 1]
            end_ts = int(ts(rows[nxt["last"]]["ts"]).timestamp()) + 1
            members = {r["sha"] for r in rows[n_["first"]:n_["last"] + 1]}
            best = None
            for cand in git(repo, "rev-list", "-40", f"--before={end_ts}", head).decode().split():
                reach = set(git(repo, "rev-list", cand).decode().split()) & members
                if best is None or len(reach) > len(best[1]): best = (cand, reach)
            rev, reach = best
            reach_ins = sum(r["den"] for r in rows[n_["first"]:n_["last"] + 1] if r["sha"] in reach)
            paths = sorted({p for c in cs[n_["first"]:n_["last"] + 1] if c["sha"] in reach for p, a, d in c["file_stats"]} & set(git(repo, "ls-tree", "-r", "--name-only", rev).decode().splitlines()))
            paths = [p for p in paths if p not in skipped]
            t1 = time.time(); pf, fl = blame_many(repo, rev, paths, workers, flags)
            kept = sum(v for cnt in pf.values() for s_, v in cnt.items() if s_ in reach)
            p2.append(dict(phase=n_["n"], kind=n_["kind"], through_end_of_phase=nxt["n"], rev=rev, reachable_commits=len(reach), phase_commits=len(members), reachable_den=reach_ins, phase_den=n_["den"],
                           files_blamed=len(paths), blame_failed=len(fl), den=reach_ins, surviving=kept, share=round(kept / reach_ins, 3) if reach_ins else None, secs=round(time.time() - t1)))
            print("survival: phase", n_["n"], "->", nxt["n"], p2[-1]["share"], f"{p2[-1]['secs']}s", flush=True)
    # ---- aggregation keys
    def lane_of(t):
        x = t
        while x in TH:
            if x in EP: return x
            x = TH[x]["parent"]
            if not x: break
        return TH[t]["root"] if t in TH else t
    run_idx = {}
    for t, v in TH.items():
        rs = sorted(v["runs"], key=lambda r: r["requested"]); run_idx[t] = ([r["requested"] for r in rs], rs)
    def model_at(t, when):
        if t not in run_idx or not run_idx[t][1]: return "unknown"
        ks, rs = run_idx[t]; r = rs[max(bisect.bisect_right(ks, when) - 1, 0)]; return f"{r['model']}/{r['effort']}"
    def epoch_of(lane, when):
        eps = EP.get(lane, {}).get("epochs") or []
        for e in eps:
            if e["start"] <= when < (e["end"] if e is not eps[-1] else "9999"): return e["n"]
        return eps[-1]["n"] if eps and when >= eps[-1]["start"] else (eps[0]["n"] if eps else None)
    groups = {k: collections.defaultdict(lambda: dict(ins_den=0, surv=0, commits=0)) for k in ("root", "model", "epoch", "method", "lane", "phase")}
    for r in rows:
        when = r["birth_ts"] or r["ts"]; t = r["thread"]; ks = dict(method=r["method"], phase=str(r.get("phase")))
        if t and t in TH:
            ln = lane_of(t); ks.update(root=TH[t]["root"], lane=ln, model=model_at(t, when)); ks["epoch"] = f"{TH[ln]['short'] if ln in TH else ln[:8]}#{epoch_of(ln, when)}"
        else: ks.update(root="UNATTRIBUTED", lane="UNATTRIBUTED", model="UNATTRIBUTED", epoch="UNATTRIBUTED")
        for g, k in ks.items():
            a = groups[g][k]; a["ins_den"] += r["den"]; a["surv"] += r["surv"]; a["commits"] += 1
    agg = {g: sorted([dict(key=k, commits=a["commits"], ins_den=a["ins_den"], surviving=a["surv"], share=round(a["surv"] / a["ins_den"], 3) if a["ins_den"] else None) for k, a in v.items()], key=lambda x: -x["ins_den"]) for g, v in groups.items()}
    per = []
    for q in range(10):
        w = [r for r in rows if int(min(9, (r["clock"] - 1) * 10 // total)) == q]
        den = sum(r["den"] for r in w); sv = sum(r["surv"] for r in w)
        per.append(dict(decile=q + 1, churn_distance_from=total - w[-1]["clock"] if w else None, churn_distance_to=total - w[0]["clock"] if w else None, commits=len(w), ins_den=den, surviving=sv, share=round(sv / den, 3) if den else None))
    # ---- module table
    added, den_m, surv_m, usd_m = collections.Counter(), collections.Counter(), collections.Counter(), collections.defaultdict(float)
    thr_lines = collections.defaultdict(collections.Counter)
    for c in cs:
        for p, a, d in c["file_stats"]:
            m = module_of(p); added[m] += a
            if p not in skipped: den_m[m] += a
            if c.get("thread"): thr_lines[c["thread"]][m] += a
    for p, cnt in per_file.items(): surv_m[module_of(p)] += sum(n for sha, n in cnt.items() if sha in win_sha)
    usd_unapportioned = 0.0
    for t, ml in thr_lines.items():
        u = (TH.get(t) or {}).get("usd_own"); tl = sum(ml.values())
        if u is None or not tl: usd_unapportioned += 0; continue
        for m, n in ml.items(): usd_m[m] += u * n / tl
    ch = churn_table(cs)
    modules = []
    for m in added:
        c_ = ch.get(m, {})
        modules.append(dict(module=m, added=added[m], den=den_m[m], surviving=surv_m[m], survival=round(surv_m[m] / den_m[m], 3) if den_m[m] else None, usd=round(usd_m[m], 2),
                            usd_per_surviving_line=round(usd_m[m] / surv_m[m], 4) if surv_m[m] and usd_m[m] else None, retouch25=c_.get("retouch25"), retouch100=c_.get("retouch100"),
                            touches=c_.get("touches"), blast=c_.get("blast"), test_ratio=c_.get("test_ratio"), top_co=c_.get("top_co")))
    modules.sort(key=lambda x: -x["added"])
    res = dict(head=head, window=CM["window"], blame_flags=flags, blame_files=len(todo), skipped=skipped, churn_total_lines=total, phases=phases, phase_params=dict(window=W, enter=ENTER, exit=EXIT, min_phase=MINP),
               survive_next_phase=p2, by=agg, churn_deciles=per, commits=rows, modules=dict(status="exploratory", rows=modules, note="$ apportioned by a thread's added lines per module; threads without a transcript and unattributed commits carry no $; module = file at head"),
               totals=dict(den=sum(r["den"] for r in rows), surviving=sum(r["surv"] for r in rows)), secs=round(time.time() - t0))
    dump(R.p("survival.json"), res)
    L = [f"survival at {head} (window {CM['window'][0]} <= t < {CM['window'][1]}); blame flags {' '.join(flags[2:])}",
         f"non-merge window commits {len(rows)}; files blamed {len(todo)}; skipped {len(skipped)} (binary/large/failed); surviving {res['totals']['surviving']} of denominator {res['totals']['den']} ({100 * res['totals']['surviving'] / max(1, res['totals']['den']):.1f}%)",
         f"churn clock total {total} included lines (ins+del)", "", f"== phases (rolling del/ins over trailing {W} commits; enter overhaul >= {ENTER}, exit < {EXIT}; phases < {MINP} commits absorbed)"]
    for p in phases: L.append(f"  phase {p['n']:2d} {p['kind']:8s} {p['start'][5:16]} .. {p['end'][5:16]}  commits {p['commits']:4d}  +{p['ins']:6d} -{p['dele']:6d} ratio {p['del_ins_ratio']:.2f}  survive-to-end {p['survival_to_end']}")
    L += ["", "== lines added in phase N still alive at the end of phase N+1"]
    for x in p2: L.append(f"  phase {x['phase']:2d} ({x['kind']}) -> end of {x['through_end_of_phase']:2d}: {x['surviving']}/{x['den']} = {x['share']}  ({x['reachable_commits']}/{x['phase_commits']} phase commits reachable from {x['rev'][:8]})")
    L += ["", "== survival vs churn distance (deciles of the churn clock; decile 1 = oldest)"]
    for d in per: L.append(f"  d{d['decile']:2d} churn-dist {d['churn_distance_from']}..{d['churn_distance_to']}  commits {d['commits']:4d}  surv {d['surviving']}/{d['ins_den']} = {d['share']}")
    for g, tt, n in (("lane", "by attributed LANE", 25), ("model", "by model/effort at commit birth", 20), ("method", "by attribution method", 10), ("phase", "by phase", 20), ("epoch", "by lane epoch (top 40)", 40)):
        L += ["", f"== survival {tt}"]
        for x in agg[g][:n]: L.append(f"  {x['key'][:60]:62s} commits {x['commits']:4d}  surv {x['surviving']:6d}/{x['ins_den']:6d} = {x['share']}")
    L += ["", "== modules (EXPLORATORY) added / surviving / $ / $ per surviving line / retouch25 / blast / top co-change"]
    for m in modules[:25]: L.append(f"  {m['module']:36s} +{m['added']:6d} surv {m['surviving']:6d} ({m['survival']})  ${m['usd']:8.0f}  ${m['usd_per_surviving_line']}  ret25 {m['retouch25']}  blast {m['blast']}  co {m['top_co']}")
    open(R.p("survival.txt"), "w", encoding="utf-8").write("\n".join(L) + "\n")
    print(f"survival: {res['totals']['surviving']}/{res['totals']['den']}; phases {len(phases)}; modules {len(modules)}; {round(time.time() - t0)} s")
