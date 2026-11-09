"""Stage epochs: lanes, epochs, fingerprints, shards -> events.jsonl, threads.json, epochs.json, lanes.json, coverage.txt, coverage.json, shards/.

Lane    = a root thread with any activity (its own or a descendant's), plus any non-root thread that received an owner turn.
Own vs tree: a lane's `own` figures are its thread alone; `desc` figures are only its EXCLUSIVE descendants (descendants whose nearest lane ancestor is
          this lane), so summing own + desc over all lanes counts every thread once. A nested lane is never also inside its ancestor's desc.
          threads.json keeps `tree_nested` (all descendants, nested lanes included) for reference only: it must not be summed across lanes.
Epoch rule (build_epochs, the `rule` block of epochs.json records the parameters):
  1. cut the lane's active range at every owner turn (relays are not owner turns);
  2. a segment with fewer than --tiny-events events or shorter than --tiny-minutes merges into its more similar neighbour;
  3. repeatedly merge the most similar adjacent pair while similarity >= --sim (0.90). similarity = cosine of [tool-class share (11),
     msgs-out share, msgs-in share] minus 0.3 when the segments' deletion share of changed lines differ by > 0.25;
  4. CAP: while more than --max-epochs (8) epochs remain, merge the most similar adjacent pair even when below --sim.
     A lane with merge_forced_by_cap > 0 has cap-driven boundaries, not natural breaks; epochs.json records that and min_sim_merged.
Checkpoint debt (per epoch and per lane): the most runs of the lane thread between two consecutive owner turns, the epoch's edges closing the
          first and last gap; relays never reset it.
Inflow: characters of the final replies of the lane thread's DIRECT children only, by reply time (grandchildren reach this lane through the child).
"""
import bisect, collections, json, math, os, re
from common import *
import stage_native

CLASSES = ["read", "edit", "shell", "test", "subagent", "browser", "delegate", "agentmsg", "wait", "other", "skill"]


def trunc(s, n):
    return (s, False) if len(s) <= n else (s[:n] + f"\n[... truncated {len(s) - n} of {len(s)} chars]", True)


def cos(x, y):
    nx = math.sqrt(sum(a * a for a in x)); ny = math.sqrt(sum(a * a for a in y))
    return sum(a * b for a, b in zip(x, y)) / (nx * ny) if nx and ny else 0.0


def vec(f):
    tot = sum(f["tool_classes"].values())
    v = [f["tool_classes"].get(c, 0) / tot if tot else 0.0 for c in CLASSES]
    mo = sum(f["msgs_out"].values()); mi = sum(f["msgs_in"].values()); m = mo + mi
    return v + [mo / (tot + m) if tot + m else 0.0, mi / (tot + m) if tot + m else 0.0]


def del_share(f):
    c = f["commits_own"]; n = c["ins"] + c["dele"]
    return c["dele"] / n if n >= 50 else None


def similarity(fa, fb):
    s = cos(vec(fa), vec(fb)); da, db_ = del_share(fa), del_share(fb)
    if da is not None and db_ is not None and abs(da - db_) > 0.25: s -= 0.3  # a build segment and a delete-heavy segment are not one epoch
    return s


def run(R):
    P = dict(tiny_minutes=R.opts.get("tiny_minutes", 10), tiny_events=R.opts.get("tiny_events", 8), sim=R.opts.get("sim", 0.90),
             max_epochs=R.opts.get("max_epochs", 8), shard_cap=R.opts.get("shard_cap", 40000))
    LO, HI = R.lo, R.hi
    T = load(R.p("t3_threads.json")); threads = T["threads"]; runs = T["runs"]
    events = list(jl(R.p("t3_events.jsonl"))); NAT = load(R.p("native.json")); CM = load(R.p("commits.json")); LJ = load(R.p("landed.json"))
    rates = pricing.load_rates(T3)
    nat_files, tools, side_tools, buckets, usd_by_model = stage_native.assemble(NAT, LO, HI, rates)
    tool_ts = {t: [x[0] for x in v] for t, v in tools.items()}
    bucket_ts = {t: [b[0] for b in v] for t, v in buckets.items()}

    def spend(t, a, b):
        bl = buckets.get(t)
        if not bl: return 0.0, 0
        i0 = bisect.bisect_left(bucket_ts[t], a[:16]); i1 = bisect.bisect_left(bucket_ts[t], b[:16]); s = 0.0; un = 0
        for x in bl[i0:i1]:
            if x[7] is None: un += x[2] + x[3] + x[4] + x[5]
            else: s += x[7]
        return s, un

    # ---- ancestry
    root_of = lambda t: threads[t]["root"] if t in threads else t
    title = lambda t, n=70: (threads[t]["title"] if t in threads else t).replace("\n", " ")[:n]
    children = collections.defaultdict(list)
    for t, v in threads.items():
        if v["parent"] in threads: children[v["parent"]].append(t)

    def descendants(t):
        out, st = [], list(children[t])
        while st: x = st.pop(); out.append(x); st.extend(children[x])
        return out

    commits = CM["commits"]
    for c in commits: c["epoch_ts"] = c.get("birth_ts") or c["ts"]
    by_thread_commits = collections.defaultdict(list)
    for c in commits:
        if c.get("thread"): by_thread_commits[c["thread"]].append(c)
    for t in by_thread_commits: by_thread_commits[t].sort(key=lambda c: c["epoch_ts"])
    commit_ts = {t: [c["epoch_ts"] for c in v] for t, v in by_thread_commits.items()}

    owner, finals, msg_in, msg_out, other_ev, relays = (collections.defaultdict(list) for _ in range(6))
    for e in events:
        k = e["kind"]
        if k == "owner_turn": owner[e["thread"]].append(e)
        elif k == "relay": relays[e["thread"]].append(e)
        elif k == "final_reply": finals[e["thread"]].append(e)
        elif k == "agent_msg": msg_in[e["target"]].append(e); msg_out[e["sender"]].append(e)
        elif k in ("child_completion", "automation", "notification"): other_ev[e["thread"]].append(e)
    all_owner = sorted((e["ts"], e["thread"]) for v in owner.values() for e in v)
    run_by_thread = collections.defaultdict(list)
    for r in runs: run_by_thread[r["thread"]].append(r)
    for t in run_by_thread: run_by_thread[t].sort(key=lambda r: r["requested"])

    own_activity = lambda t: bool(run_by_thread.get(t) or owner.get(t) or finals.get(t) or msg_in.get(t) or msg_out.get(t))
    lane_ids = [t for t, v in threads.items() if (not v["parent"] and (own_activity(t) or any(own_activity(d) for d in descendants(t)))) or owner.get(t)]
    lane_set = set(lane_ids)

    def lane_of(t):
        if t in lane_set: return t
        x = t
        while x in threads and threads[x]["parent"]:
            x = threads[x]["parent"]
            if x in lane_set: return x
        return root_of(t)

    def excl_desc(t): return [d for d in descendants(t) if lane_of(d) == t]

    def first_last(t):
        ts_ = [r["requested"] for r in run_by_thread.get(t, [])] + [e["ts"] for e in owner.get(t, []) + finals.get(t, []) + msg_in.get(t, []) + msg_out.get(t, [])]
        te_ = [r["completed"] or r["requested"] for r in run_by_thread.get(t, [])] + ts_
        return (min(ts_), max(te_)) if ts_ else (None, None)

    def fingerprint(t, a, b, with_desc=True):
        f = {}
        i0 = bisect.bisect_left(tool_ts.get(t, []), a); i1 = bisect.bisect_left(tool_ts.get(t, []), b)
        tl = tools.get(t, [])[i0:i1]
        f["tool_calls"] = len(tl); f["tool_classes"] = dict(collections.Counter(x[1] for x in tl)); f["tool_names"] = dict(collections.Counter(x[2] for x in tl).most_common(14))
        fl = collections.Counter(ch for x in tl for ch in x[3])
        f["flags"] = dict(test_runs=fl["T"], browser_preview=fl["B"], pe_revit=fl["R"], git_deletions=fl["D"], git_commit_cmds=fl["C"])

        def commit_block(tt_list):
            cs = []
            for x in tt_list:
                ct = commit_ts.get(x, []); cs.extend(by_thread_commits[x][bisect.bisect_left(ct, a):bisect.bisect_left(ct, b)])
            ins = sum(c["ins"] for c in cs); de = sum(c["dele"] for c in cs); tl_ = sum(c["test_lines"] for c in cs); mods = collections.Counter()
            for c in cs:
                for m, n in c["modules"].items(): mods[m] += n
            return dict(commits=len(cs), ins=ins, dele=de, test_share=round(tl_ / (ins + de), 3) if ins + de else None,
                        files_per_commit=round(sum(c["included_files"] for c in cs) / len(cs), 2) if cs else None,
                        modules=dict(mods.most_common(8)), methods=dict(collections.Counter(c["method"] for c in cs)))
        f["commits_own"] = commit_block([t])
        ed = excl_desc(t) if with_desc else []
        f["commits_desc"] = commit_block(ed) if with_desc else None
        f["children_launched"] = sum(1 for c in children.get(t, []) if a <= threads[c]["created_at"] < b)
        mi = collections.Counter(lane_of(e["sender"]) for e in msg_in.get(t, []) if a <= e["ts"] < b)
        mo = collections.Counter(lane_of(e["target"]) for e in msg_out.get(t, []) if a <= e["ts"] < b)
        f["msgs_in"] = dict(mi); f["msgs_out"] = dict(mo)
        ots = [e["ts"] for e in owner.get(t, []) if a <= e["ts"] < b]
        f["owner_turns"] = len(ots); f["relays"] = sum(1 for e in relays.get(t, []) if a <= e["ts"] < b)
        f["other_events"] = dict(collections.Counter(e["kind"] for e in other_ev.get(t, []) if a <= e["ts"] < b))
        rs = [r for r in run_by_thread.get(t, []) if a <= r["requested"] < b]
        f["runs"] = len(rs)
        f["models"] = dict(collections.Counter(r["model"] for r in rs)); f["efforts"] = dict(collections.Counter(r["effort"] for r in rs))
        f["active_hours_ub"] = round(sum((ts(r["completed"]) - ts(r["requested"])).total_seconds() for r in rs if r["completed"]) / 3600, 2)
        f["debt"] = debt([r["requested"] for r in rs], ots, a, None if b == "9999" else b)
        kids = [x for c in children.get(t, []) for x in finals.get(c, []) if a <= x["ts"] < b]
        f["inflow_chars"] = sum(x["chars"] for x in kids); f["inflow_replies"] = len(kids)
        s, un = spend(t, a, b)
        f["usd_own"] = round(s, 2) if nat_files.get(t) else None; f["unpriced_tokens_own"] = un
        if with_desc:
            sd = 0.0; und = 0
            for d in ed:
                x, y = spend(d, a, b); sd += x; und += y
            f["usd_desc"] = round(sd, 2); f["unpriced_tokens_desc"] = und; f["desc_threads"] = len(ed)
        f["events"] = f["tool_calls"] + sum(mi.values()) + sum(mo.values()) + f["commits_own"]["commits"] + f["owner_turns"]
        return f

    def build_epochs(t):
        st, en = first_last(t)
        if st is None: return []
        st = max(st, LO); en = min(max(en, st), HI)
        cuts = sorted({e["ts"] for e in owner.get(t, []) if st <= e["ts"] <= en})
        bounds = [st] + [c for c in cuts if c > st] + ["~"]  # '~' sorts after every ISO digit
        segs = [[bounds[i], "9999" if bounds[i + 1] == "~" else bounds[i + 1]] for i in range(len(bounds) - 1)]
        initial = len(segs)
        F = lambda s: fingerprint(t, s[0], s[1], with_desc=False)
        fp = [F(s) for s in segs]

        def dur_min(s): return (ts(en if s[1] == "9999" else s[1]) - ts(s[0])).total_seconds() / 60

        def merge(i): segs[i] = [segs[i][0], segs[i + 1][1]]; del segs[i + 1]; del fp[i + 1]; fp[i] = F(segs[i])
        changed = True
        while changed and len(segs) > 1:
            changed = False
            for i in range(len(segs)):
                if fp[i]["events"] < P["tiny_events"] or dur_min(segs[i]) < P["tiny_minutes"]:
                    if i == 0: j = 0
                    elif i == len(segs) - 1: j = i - 1
                    else: j = i - 1 if similarity(fp[i], fp[i - 1]) >= similarity(fp[i], fp[i + 1]) else i
                    merge(j); changed = True; break
        trace = []
        while len(segs) > 1:
            sims = [similarity(fp[i], fp[i + 1]) for i in range(len(segs) - 1)]
            i = max(range(len(sims)), key=lambda k: sims[k])
            if sims[i] >= P["sim"] or len(segs) > P["max_epochs"]: trace.append(dict(sim=round(sims[i], 3), forced_by_cap=sims[i] < P["sim"])); merge(i)
            else: break
        return [dict(n=n, start=s[0], end=(s[1] if s[1] != "9999" else en), range_hi=s[1]) for n, s in enumerate(segs, 1)], initial, trace

    # ---- threads.json
    th_out = {}
    for t, v in threads.items():
        rs = run_by_thread.get(t, []); fl = first_last(t)
        ub = round(sum((ts(r["completed"]) - ts(r["requested"])).total_seconds() for r in rs if r["completed"]) / 3600, 2)
        ubm = collections.defaultdict(float)
        for r in rs:
            if r["completed"]: ubm[r["model"]] += (ts(r["completed"]) - ts(r["requested"])).total_seconds() / 3600
        um = {m: dict(usd=round(d["usd"], 2) if d["priced"] else None, usd_priced_part=round(d["usd"], 2), tokens=d["tokens"], priced=d["priced"]) for m, d in usd_by_model.get(t, {}).items()}
        th_out[t] = dict(id=t, short=short(t), title=v["title"], parent=v["parent"], root=v["root"], created_at=v["created_at"], relationship=v["relationship"],
                         branch=v["branch"], worktree=v["worktree"], default_model_selection=v["model_selection"], archived_at=v["archived_at"], deleted_at=v["deleted_at"],
                         is_lane=t in lane_set, owner_turns=len(owner.get(t, [])), relays=len(relays.get(t, [])), first_activity=fl[0], last_activity=fl[1],
                         landed=LJ.get(t),
                         runs=[dict(run=r["run_id"], ordinal=r["ordinal"], requested=r["requested"], completed=r["completed"], status=r["status"], model=r["model"], effort=r["effort"], provider=r["provider"]) for r in rs],
                         run_count=len(rs), models=dict(collections.Counter(r["model"] for r in rs)), efforts=dict(collections.Counter(r["effort"] for r in rs)),
                         active_hours_upper_bound=ub, active_hours_upper_bound_by_model={m: round(h, 2) for m, h in ubm.items()},
                         native_files=nat_files.get(t, []), native_found=bool(nat_files.get(t)), subagent_tool_calls=side_tools.get(t, 0),
                         tokens_usd_by_model=um, usd_own=round(sum(d["usd_priced_part"] for d in um.values()), 2) if nat_files.get(t) else None,
                         usd_unpriced_tokens=sum(d["tokens"] for d in um.values() if not d["priced"]),
                         commits_attributed=len(by_thread_commits.get(t, [])), commit_ins=sum(c["ins"] for c in by_thread_commits.get(t, [])), commit_del=sum(c["dele"] for c in by_thread_commits.get(t, [])))

    def rollup(allt):
        return dict(threads=len(allt), runs=sum(th_out[x]["run_count"] for x in allt), active_hours_upper_bound=round(sum(th_out[x]["active_hours_upper_bound"] for x in allt), 2),
                    usd=round(sum(th_out[x]["usd_own"] or 0 for x in allt), 2), threads_without_transcript=sum(1 for x in allt if not th_out[x]["native_found"]),
                    unpriced_tokens=sum(th_out[x]["usd_unpriced_tokens"] for x in allt), commits=sum(th_out[x]["commits_attributed"] for x in allt),
                    ins=sum(th_out[x]["commit_ins"] for x in allt), dele=sum(th_out[x]["commit_del"] for x in allt))
    for t in lane_ids:
        th_out[t]["exclusive"] = rollup([t] + excl_desc(t))  # sums across lanes without double counting
        th_out[t]["tree_nested"] = rollup([t] + descendants(t))  # reference only; nested lanes appear in their ancestors' trees
        th_out[t]["debt"] = debt([r["requested"] for r in run_by_thread.get(t, [])], [e["ts"] for e in owner.get(t, [])])
        th_out[t]["inflow_chars"] = sum(x["chars"] for c in children.get(t, []) for x in finals.get(c, []))
    dump(R.p("threads.json"), dict(window=[LO, HI], project=T["project"], main_head=CM["head"], note="active_hours_upper_bound = sum(completed-requested) over runs requested in window; includes queue/wait/idle-inside-run. usd_own null = no transcript (a gap, not zero).", threads=th_out))

    # ---- events.jsonl
    ev_out = list(events)
    for c in commits:
        base = dict(ts=c["ts"], sha=c["sha"], subject=c["subject"], thread=c.get("thread"), method=c["method"], ins=c["ins"], dele=c["dele"], gen_ins=c["gen_ins"], gen_del=c["gen_del"],
                    test_lines=c["test_lines"], files=c["included_files"], modules=c["modules"], birth_ts=c.get("birth_ts"), alt_threads=c.get("alt_threads"), author=c["author"])
        ev_out.append(dict(base, kind="merge", parents=c["parents"], merge_introduced=c.get("merge_introduced"), merge_threads=c.get("merge_threads")) if c["merge"] else dict(base, kind="commit"))
    ev_out.sort(key=lambda e: (e["ts"], e["kind"]))
    with open(R.p("events.jsonl"), "w", encoding="utf-8") as f:
        for e in ev_out: f.write(json.dumps(e, ensure_ascii=False) + "\n")
    print("epochs: events", len(ev_out), dict(collections.Counter(e["kind"] for e in ev_out)))

    # ---- coverage
    nm = [c for c in commits if not c["merge"]]; cov = CM["coverage"]
    act = T["active"]; with_nat = [t for t in act if nat_files.get(t)]
    priced = sum(d["usd"] for t in usd_by_model for d in usd_by_model[t].values() if d["priced"])
    un_tok = sum(d["tokens"] for t in usd_by_model for d in usd_by_model[t].values() if not d["priced"])
    tot_tok = sum(d["tokens"] for t in usd_by_model for d in usd_by_model[t].values())
    bym = collections.defaultdict(lambda: [0.0, 0, True])
    for t in usd_by_model:
        for m, d in usd_by_model[t].items():
            bym[m][0] += d["usd"]; bym[m][1] += d["tokens"]; bym[m][2] = bym[m][2] and d["priced"]
    missing = len(NAT["missing"])
    L = [f"window {LO} <= t < {HI} (UTC; since inclusive, until exclusive)   {CM['branch']} head {CM['head']}",
         f"non-merge commits in window: {len(nm)}   merges: {CM['merges']}   non-merge commits with no included files (generated-only): {sum(1 for c in nm if not c['included_files'])}"]
    for m in ("trailer", "commit-line", "patch-id", "first-mention", "unknown"):
        x = cov[m]; L.append(f"  attributed by {m:13s}: {x['commits']:5d} ({100 * x['share']:.1f}%)   changed lines {x['lines']} ({100 * x['line_share']:.1f}%)")
    s = cov["_strong"]
    L.append(f"  strong (trailer + commit-line + patch-id): {100 * s['share']:.1f}% of commits, {100 * s['line_share']:.1f}% of changed lines   any method: {100 - 100 * cov['unknown']['share']:.1f}%")
    L += [f"threads active in window: {len(act)}; with >=1 native transcript found: {len(with_nat)} ({100 * len(with_nat) / max(1, len(act)):.1f}%)",
          f"  lanes: {len(lane_ids)}; lanes with transcript: {sum(1 for t in lane_ids if nat_files.get(t))}",
          f"  provider threads with no transcript file: {missing} of {missing + len(NAT['files'])} (main files + {sum(1 for f in NAT['files'] if f['sidechain'])} claude subagent files)",
          f"spend (priced at usage-model-rates.json): ${priced:,.0f} on priced models; unpriced tokens {un_tok:,} of {tot_tok:,} -> an unpriced model is a gap, not zero"]
    for m, (u, n, pr) in sorted(bym.items(), key=lambda x: -x[1][0]): L.append(f"    {m:22s} ${u:10,.0f}  tokens {n:,}  {'' if pr else 'UNPRICED'}")
    L.append("note: Claude subagent (sidechain) transcript spend is included in the thread total; Codex fork copies of history may double count.")
    open(R.p("coverage.txt"), "w", encoding="utf-8").write("\n".join(L) + "\n"); print("\n".join(L))
    dump(R.p("coverage.json"), dict(window=[LO, HI], head=CM["head"], nonmerge=len(nm), merges=CM["merges"], methods=cov, threads_active=len(act), threads_with_transcript=len(with_nat),
                                    lanes=len(lane_ids), lanes_with_transcript=sum(1 for t in lane_ids if nat_files.get(t)), provider_threads_missing=missing,
                                    usd_priced=round(priced, 2), unpriced_tokens=un_tok, tokens=tot_tok, by_model={m: dict(usd=round(u, 2) if pr else None, tokens=n) for m, (u, n, pr) in bym.items()}))

    # ---- epochs + shards
    def owner_flow(t, first_ts, last_ts):
        prev = None
        for ts_, th_ in all_owner:
            if ts_ >= first_ts: break
            prev = (ts_, th_)
        nxt = next(((a_, b_) for a_, b_ in all_owner if a_ > last_ts and b_ != t), None)
        return dict(prev_owner_turn_thread=prev and prev[1], prev_gap_min=prev and round((ts(first_ts) - ts(prev[0])).total_seconds() / 60, 1),
                    next_owner_turn_in_other_thread=nxt and nxt[1], next_gap_min=nxt and round((ts(nxt[0]) - ts(last_ts)).total_seconds() / 60, 1),
                    owner_returned_to_thread_later=any(e["ts"] > last_ts for e in owner.get(t, [])))

    import shutil
    shutil.rmtree(R.p("shards"), ignore_errors=True); os.makedirs(R.p("shards"))
    epochs_out, lane_rows = {}, []
    for t in sorted(lane_ids, key=lambda x: (th_out[x]["first_activity"] or "9")):
        res = build_epochs(t)
        if not res: epochs_out[t] = dict(title=title(t), epochs=[], initial_segments=0); continue
        eps, initial, trace = res; items = []
        for e in eps:
            a, b = e["start"], e["range_hi"]
            fp = fingerprint(t, a, b); fp.update(n=e["n"], start=a, end=e["end"], role=None)
            ot = [x["ts"] for x in owner.get(t, []) if a <= x["ts"] < b]
            if ot: fp["owner_flow"] = owner_flow(t, ot[0], ot[-1])
            items.append(fp)
        epochs_out[t] = dict(short=short(t), title=title(t, 120), root=th_out[t]["root"], is_root=not threads[t]["parent"], initial_segments=initial,
                             merge_forced_by_cap=sum(1 for x in trace if x["forced_by_cap"]), merge_by_similarity=sum(1 for x in trace if not x["forced_by_cap"]),
                             min_sim_merged=min([x["sim"] for x in trace], default=None), epochs=items)
        d = R.p(f"shards/{short(t)}"); os.makedirs(d, exist_ok=True)
        for fp in items:
            a, b = fp["start"], ("9999" if fp is items[-1] else items[fp["n"]]["start"])
            n_own = [x for x in owner.get(t, []) if a <= x["ts"] < b]; fin = [x for x in finals.get(t, []) if a <= x["ts"] < b]
            rel = [x for x in relays.get(t, []) if a <= x["ts"] < b]
            head = [f"# {title(t, 120)}  (`{t}`)  epoch {fp['n']:02d}/{len(items):02d}",
                    f"- window {a} .. {fp['end']}  (UTC)  initial owner-turn segments merged into this lane's epochs: {initial}->{len(items)}",
                    f"- root: `{th_out[t]['root']}` {'(this is the root)' if t == th_out[t]['root'] else ''}   runs {fp['runs']}  models {fp['models']}  efforts {fp['efforts']}  active h (UB) {fp['active_hours_ub']}",
                    f"- owner turns {fp['owner_turns']}  relays (agent text, not the owner) {fp['relays']}; usd own ${fp['usd_own']} (+exclusive descendants ${fp.get('usd_desc')}); tool calls {fp['tool_calls']}  classes {fp['tool_classes']}",
                    f"- checkpoint debt {fp['debt']} runs between owner turns; inflow from direct children {fp['inflow_chars']} chars in {fp['inflow_replies']} final replies",
                    f"- flags {fp['flags']}  children launched {fp['children_launched']}  other {fp['other_events']}", f"- commits own {fp['commits_own']}",
                    f"- commits by exclusive descendants {fp['commits_desc']}",
                    f"- msgs in {[(title(k, 30), n) for k, n in fp['msgs_in'].items()]}  out {[(title(k, 30), n) for k, n in fp['msgs_out'].items()]}"]
            if "owner_flow" in fp: head.append(f"- owner flow {fp['owner_flow']}")
            edges = []
            am = sorted([x for x in msg_in.get(t, []) if a <= x["ts"] < b] + [x for x in msg_out.get(t, []) if a <= x["ts"] < b], key=lambda x: x["ts"])
            for x in am[:14]:
                cp = x["sender"] if x["target"] == t else x["target"]
                edges.append(f"- {x['ts']} {'IN <-' if x['target'] == t else 'OUT ->'} {title(cp, 40)} ({short(cp)}) {x['chars']}ch: {x['text'][:160]!r}")
            if len(am) > 14: edges.append(f"- ... {len(am) - 14} more agent messages (see events.jsonl)")
            ch = [c for c in children.get(t, []) if a <= threads[c]["created_at"] < b]
            edges.append(f"- children launched: {[title(c, 40) for c in ch[:10]]}{' ...' if len(ch) > 10 else ''}")
            cl = [c for c in by_thread_commits.get(t, []) if a <= c["epoch_ts"] < b]
            for c in cl[:25]: edges.append(f"- commit {c['sha'][:8]} {c['ts'][:16]} +{c['ins']}/-{c['dele']} [{c['method']}] {c['subject'][:90]}")
            if len(cl) > 25: edges.append(f"- ... {len(cl) - 25} more commits")

            def render(cap):
                entries, answered = [], set()
                for x in n_own:
                    ans = [y for y in finals.get(t, []) if y["ts"] < x["ts"]]
                    if ans:
                        y = ans[-1]; txt, _ = trunc(y["text"], cap); answered.add(y["msg"])
                        entries.append((x["ts"], 0, f"\n### final reply being answered  [{y['ts']}  {y['model']}/{y['effort']}  run {y['run']}]\n{txt}\n"))
                    txt = x["text"]; flag = ""
                    if len(txt) > 8000: txt = txt[:8000] + f"\n[... truncated {len(x['text']) - 8000} chars]"; flag = " TRUNCATED"
                    entries.append((x["ts"], 1, f"\n## OWNER TURN  [{x['ts']}  src={x['source']}  run {x['run']}]{flag}\n{txt}\n"))
                for y in fin:
                    if y["msg"] in answered: continue
                    txt, tr = trunc(y["text"], cap)
                    entries.append((y["ts"], 2, f"\n### final reply  [{y['ts']}  {y['model']}/{y['effort']}  run {y['run']}]{' (truncated)' if tr else ''}\n{txt}\n"))
                for x in rel[:12]:
                    entries.append((x["ts"], 3, f"\n### relay (agent text sent up through the user role; NOT the owner)  [{x['ts']}]\n{x['text'][:500]}\n"))
                entries.sort(key=lambda z: (z[0], z[1]))
                return "\n".join(head) + (f"\n[shard reply truncation tightened to {cap} chars to stay under cap {P['shard_cap']}]\n" if cap < 2500 else "\n") + "".join(e[2] for e in entries) + "\n## edges summary\n" + "\n".join(edges) + "\n"
            cap = 2500; text = render(cap)
            while len(text) > P["shard_cap"] and cap > 300: cap //= 2; text = render(cap)
            if len(text) > P["shard_cap"]: text = text[:P["shard_cap"]] + f"\n[... shard cut at cap {P['shard_cap']}; full text in events.jsonl]\n"
            open(f"{d}/{fp['n']:02d}.md", "w", encoding="utf-8").write(text)
        lane_rows.append(t)
    dump(R.p("epochs.json"), dict(window=[LO, HI], rule=dict(P, text="cut at every owner turn; merge tiny segments (<tiny_events events or <tiny_minutes) into the more similar neighbour; merge adjacent pairs while similarity>=sim; "
                                                              "then merge the most similar pair until <=max_epochs (cap-driven boundaries are flagged by merge_forced_by_cap)"), lanes=epochs_out))

    # ---- lanes.json (what the page draws)
    lanes = []
    for t in lane_rows:
        x = th_out[t]
        lanes.append(dict(id=t, short=short(t), title=title(t, 110), is_root=not threads[t]["parent"], runs=x["run_count"], runs_excl=x["exclusive"]["runs"], runs_tree=x["tree_nested"]["runs"],
                          models=x["models"], usd_own=x["usd_own"], usd_excl=x["exclusive"]["usd"], usd_tree=x["tree_nested"]["usd"], no_transcript=x["native_found"] is False,
                          first=x["first_activity"], last=x["last_activity"], debt=x["debt"], inflow_chars=x["inflow_chars"], landed=(x["landed"] or {}).get("state"),
                          epochs=[dict(n=e["n"], start=e["start"], end=e["end"], runs=e["runs"], models=e["models"], efforts=e["efforts"], owner_turns=e["owner_turns"], relays=e["relays"], tool_calls=e["tool_calls"],
                                       commits=e["commits_own"]["commits"], ins=e["commits_own"]["ins"], dele=e["commits_own"]["dele"], desc_commits=e["commits_desc"]["commits"], usd=e["usd_own"], usd_desc=e.get("usd_desc"),
                                       test_share=e["commits_own"]["test_share"], classes=e["tool_classes"], flags=e["flags"], debt=e["debt"], inflow_chars=e["inflow_chars"], inflow_replies=e["inflow_replies"],
                                       msgs_in=e["msgs_in"], msgs_out=e["msgs_out"], owner_flow=e.get("owner_flow"), modules=e["commits_own"]["modules"]) for e in epochs_out[t]["epochs"]],
                          cap_driven=epochs_out[t].get("merge_forced_by_cap", 0),
                          owner=[e["ts"] for e in owner.get(t, [])],
                          commits=[[c["ts"], c["sha"][:8], c["ins"] + c["dele"], c["subject"][:70]] for c in by_thread_commits.get(t, [])],
                          desc_commits=[[c["ts"], c["sha"][:8], c["ins"] + c["dele"]] for d_ in excl_desc(t) for c in by_thread_commits.get(d_, [])]))
    edges = collections.Counter()
    for e in events:
        if e["kind"] != "agent_msg": continue
        a_, b_ = lane_of(e["sender"]), lane_of(e["target"])
        if a_ != b_: edges[(a_, b_, e["ts"][:13])] += 1  # hourly bins
    dump(R.p("lanes.json"), dict(window=[LO, HI], lanes=lanes, edges=[[a_, b_, h, n] for (a_, b_, h), n in edges.items()],
                                 lane_title={x["id"]: x["title"] for x in lanes}))
    print("epochs: lanes", len(lane_rows), "epochs", sum(len(v["epochs"]) for v in epochs_out.values()), "cap-driven lanes", sum(1 for v in epochs_out.values() if v.get("merge_forced_by_cap")))
