"""python .agents/skills/slot.mine/scripts/test_retro_timing.py - classifier and keepalive HIT/MISS on a tiny synthetic Claude session."""
import json, os, sys, tempfile, collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retro, swimlanes

assert retro.kind("Bash", {"command": "pnpm -w test"}) == "Bash:TEST"
assert retro.kind("PowerShell", {"command": "dotnet build x.csproj"}) == "PowerShell:build"
assert retro.kind("Bash", {"command": "git status"}) == "Bash:git"
assert retro.kind("Bash", {"command": "npx playwright show"}) == "Bash:BROWSER"
assert retro.kind("Read", {"file_path": "x"}) == "Read"


def asst(t, read, write, tool=None):
    c = [{"type": "tool_use", "id": tool, "name": "Bash", "input": {"command": "vitest run"}}] if tool else []
    return dict(type="assistant", timestamp=t, requestId=t, message=dict(model="m", content=c, usage=dict(cache_read_input_tokens=read, cache_creation_input_tokens=write)))


lines = [
    asst("2026-01-01T00:00:00Z", 1000, 10, tool="t1"),
    dict(type="user", timestamp="2026-01-01T00:10:00Z", message=dict(content=[{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}])),  # 10 min TEST
    dict(type="user", timestamp="2026-01-01T00:30:00Z", message=dict(content="keepalive: nothing is asked")),
    asst("2026-01-01T00:31:00Z", 900, 5),         # wake 1: read > write -> HIT
    dict(type="user", timestamp="2026-01-01T02:00:00Z", message=dict(content="keepalive: nothing is asked")),
    asst("2026-01-01T02:01:00Z", 10, 90000),      # wake 2: write > read -> MISS, and a cold call
]
with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, "s.jsonl")
    open(path, "w").write("\n".join(map(json.dumps, lines)))
    m = retro.new_metrics("t", "t", None); retro.claude(path, m); retro.finish(m)

assert [w["hit"] for w in m["keepalive"]] == [True, False], m["keepalive"]
assert m["keepalive"][0]["idle_min"] == 30 and m["keepalive"][1]["idle_min"] == 89, m["keepalive"]
assert [c["write"] for c in m["cold_calls"]] == [90000], m["cold_calls"]
assert m["tool_wall"] == {"Bash:TEST": round(600 / 3600, 3)} and m["test_share"] == 1.0, m["tool_wall"]

# command prefixes: cd dropped, timeout/pnpm exec stripped, heaviest segment (test) wins, the pipe tail is secondary
assert retro.prefixes("cd x && timeout 300 pnpm exec vitest run a.test.ts | tail") == ("vitest run", ["tail"])
assert retro.prefixes("cd a; FOO=1 pnpm --filter web build 2>&1 | tail -5")[0] == "pnpm build"
assert retro.prefixes("until grep -q done f; do sleep 5; done")[0] == "poll loop"
assert retro.prefixes("echo hi")[0] == "(builtin)"
assert retro.covers("Wave 2 gated: slices 2-3, 5") == {2, 3, 5}
assert retro.covers("Wave 3 merged: slices 6, 7 & 9") == {6, 7, 9}

# gap attribution: the next run's trigger message (created_at == requested_at) names the cause
import sqlite3
db = sqlite3.connect(":memory:")
db.execute("create table orchestration_v2_projection_runs (thread_id, requested_at, completed_at)")
db.execute("create table orchestration_v2_projection_messages (thread_id, role, created_at, payload_json)")
T = "2026-01-01T0%d:00:00.000Z"
db.executemany("insert into orchestration_v2_projection_runs values ('t', ?, ?)", [(T % 0, T % 1), (T % 2, T % 3), (T % 5, T % 6), (T % 8, T % 9)])
for h, p in [(2, dict(createdBy="agent", senderThreadId="x")), (5, dict(createdBy="user", creationSource="web")),
             (8, dict(notification=dict(source=dict(kind="background_command"), summary='Command "build it" finished')))]:
    db.execute("insert into orchestration_v2_projection_messages values ('t', 'user', ?, ?)", (T % h, json.dumps(p)))
g = retro.gaps(db, "t", {"x": "implementor"})
assert [(x["cause"], x["hours"], x["detail"]) for x in g] == [("message from implementor", 1.0, ""), ("owner", 2.0, ""), ("own command", 2.0, "build it")], g
assert retro.waits(g) == {"owner": 2.0, "own command": 2.0, "message from implementor": 1.0}
# tail composition: bucket by path, .json and generated skipped
assert [retro.bucket(p) for p in ["a/b.test.ts", "ts/x/tests/y.ts", "a/fixtures/z.ts", "a/__snapshots__/q", "docs/a.md", "a/b.ts", "a/b.json", "a/generated/c.ts"]] == ["test", "test", "test", "test", "docs", "prod", None, None]
D = lambda *a: retro.datetime.datetime(2026, 1, 1, *a, tzinfo=retro.datetime.timezone.utc)
sp, act, quiet = retro.tail_split([D(0, 0), D(0, 10), D(2, 0)], D(3, 0))  # gaps 10m and 110m (capped to 30m); tail 3h
assert [(a.minute, b.minute) for a, b in sp] == [(0, 10), (10, 40)] and round(act, 3) == round(40 / 60, 3) and round(quiet, 3) == round(3 - 40 / 60, 3), (act, quiet)
assert round(retro.tail_split([D(0, 0), D(2, 0)], D(1, 0))[2], 3) == round(2 - 0.5, 3)  # a gate before the last commit: the tail runs to that commit

# blocked: slice 2 and 3 start (09:00, 10:00) after slice 1 passed 80% (08:00); slice 1 never waits
I = lambda *a: D(*a).isoformat()
sl = [dict(n="1", first=I(6), t80=I(8)), dict(n="2", first=I(9), t80=I(11)), dict(n="3", first=I(10), t80=I(12))]
assert retro.blocked(sl) == dict(h=2.0, frm=I(8), to=I(10), slices=["2", "3"]), retro.blocked(sl)  # [8,9] and [8,10] merge
assert retro.blocked([dict(n="1", first=I(6), t80=I(8)), dict(n="2", first=I(7), t80=I(9))])["h"] == 0  # 2 started before 1 reached 80%
assert retro.blocked([])["slices"] == []

# writers: 30-minute buckets, slices by commit time (curve), threads by run overlap
w = retro.writers([dict(curve=[[I(0, 10), 5], [I(0, 20), 9], [I(1, 5), 9]])], [("a", D(0, 20), D(0, 40)), ("b", D(0, 50), D(1, 10))], D(0, 0), D(1, 30))
assert [(x["slices"], x["threads"]) for x in w] == [(1, 1), (0, 2), (1, 1)], w

# admission: a repeated line in one result counts once; a different reading does not; text lines and lists both read
r = retro.admits("ADMIT light: free 40.5 of 63.1 GiB\nnoise\nADMIT light: free 40.5 of 63.1 GiB\nHOLD revit-drive: free 3.2 of 63.1 GiB", "t")
assert [(x["kind"], x["verdict"], x["free_gib"]) for x in r] == [("light", "ADMIT", 40.5), ("revit-drive", "HOLD", 3.2)] and retro.admits("ADMIT other: free 1 of 2 GiB", "t") == []
assert retro.text_of([{"type": "text", "text": "REFUSE suite: free 1 of 2 GiB"}]).startswith("REFUSE") and retro.admit_counts(r) == {"light": {"ADMIT": 1}, "revit-drive": {"HOLD": 1}}

# turn ended with a command still running: run 0-1h, command started at 0:30 and finished 1:30, next run at 3h
R = [(I(0), I(1)), (I(3), I(4))]
te = retro.turn_ends([(I(0, 30), I(1, 30), "vp test"), (I(0, 40), I(0, 50), "git log"), (I(3, 10), I(3, 50), "vp test")], R)
assert te == [dict(t_run_end=I(1), t_cmd_end=I(1, 30), command="vp test", ran_on_h=0.5, idle_until_next_run_h=2.0)], te  # the finished-in-run and finished-in-its-own-run commands are not flagged
assert retro.turn_ends([(I(5), I(6), "x")], R) == []  # started over a minute after the last run ended
assert retro.turn_ends([(I(3, 30), I(5), "x")], [(I(3), None)]) == []  # a run with no completion has not ended

# the same through a Claude session: a background command whose notification lands after the result, and an admission line
lines = [
    dict(type="assistant", timestamp=I(0, 5), requestId="r", message=dict(model="m", content=[{"type": "tool_use", "id": "b1", "name": "Bash", "input": {"command": "vp test x", "run_in_background": True}}], usage={})),
    dict(type="user", timestamp=I(0, 5), message=dict(content=[{"type": "tool_result", "tool_use_id": "b1", "content": "started\nADMIT suite: free 10 of 32 GiB"}])),
    dict(type="queue-operation", operation="enqueue", timestamp=I(2), content="<tool-use-id>b1</tool-use-id>"),
]
with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, "s.jsonl"); open(path, "w").write("\n".join(map(json.dumps, lines)))
    m = retro.new_metrics("t", "t", None); retro.claude(path, m); retro.finish(m)
assert m["bgs"] == [(I(0, 5), I(2), "vp test")] and m["admit_counts"] == {"suite": {"ADMIT": 1}}, (m["bgs"], m["admit_counts"])
assert retro.turn_ends(m["bgs"], [(I(0), I(1))])[0]["ran_on_h"] == 1.0
ro = retro.rollup([dict(admits=r, turn_ends=te)])
assert retro.measures_line(None, ro) == "2 admission readings: 1 HOLD (1 revit-drive), 0 REFUSE · 1 turns ended with a command still running (2.0h idle until the next run, 1.5h of it after the command had finished)"
# trough: peak 8, so under 4 is low; the low run between two busy buckets is 3 buckets = 1.5h, and the low edges outside them do not count
tw = [dict(t=I(h, m), threads=n) for (h, m), n in zip([(0, 0), (0, 30), (1, 0), (1, 30), (2, 0), (2, 30), (3, 0)], [1, 8, 3, 2, 1, 5, 0])]
assert retro.trough(tw) == dict(h=1.5, frm=I(1, 0), to=I(2, 30), peak=8), retro.trough(tw)
assert retro.trough([])["h"] == 0 and retro.trough([dict(t=I(0), threads=4), dict(t=I(0, 30), threads=4)])["h"] == 0

# slice by thread title: numbered, lettered, none; the lettered label sorts after its number
assert [retro.slice_key(t) for t in ["Slice 4 owner 3: Ducts", "s5 wave2: kit", "s2b writer B", "Scaffold: slice 5a one", "slice 10 x", "Crusade implementor: slices 1-10 on crusade/kernel", "Pod doors A", "s2bc x", None]] == ["4", "5", "2b", "5a", "10", None, None, None, None]
assert sorted(["3", "2b", "10", "2", "5a", "5"], key=retro.skey) == ["2", "2b", "3", "5", "5a", "10"]

# git log reading: trailer thread, churn without .json/generated, parts by kind
log = "@aaa|2026-01-01T01:00:00+00:00|thr-1\n\n1\t2\tx/a.ts\n5\t0\tx/a.test.ts\n9\t9\tx/data.json\n3\t0\tx/generated/g.ts\n@bbb|2026-01-01T02:00:00+00:00|\n\n-\t-\tbin.png\n4\t1\tdocs/n.md\n"
cm = retro.parse_log(log)
assert [(c["h"], c["thread"], c["churn"], dict(c["parts"])) for c in cm] == [("aaa", "thr-1", 8, {"prod": 3, "test": 5}), ("bbb", None, 5, {"docs": 5, "prod": 0})], cm
assert cm[0]["t"] == D(1, 0) and retro.parse_log("") == []

# attribution: the writing thread's title decides; a trailerless commit uses the branch fallback or stays out
cm += [dict(h="ccc", t=D(3), thread="thr-2", churn=1, parts=collections.Counter()), dict(h="ddd", t=D(4), thread="thr-3", churn=7, parts=collections.Counter())]
retro.attribute(cm, {"thr-1": "Slice 1 fabric", "thr-2": "Crusade implementor", "thr-3": "s2b writer"}, {"bbb": "4"})
assert [(c["slice"], c["via"], c["why"]) for c in cm] == [("1", "trailer", None), ("4", "branch", None), (None, "trailer", "thread title names no slice"), ("2b", "trailer", None)]
retro.attribute(cm[:2], {}, {}); assert [(c["slice"], c["why"]) for c in cm[:2]] == [(None, "thread title names no slice"), (None, "no trailer")]

# gates: digits only, so a lettered slice is never gated; a Wave subject gates its slices
assert retro.gate_slices("Slice 2 gated on crusade/kernel (main pending)") == {"2"} and retro.gate_slices("MAP: slice 4 gated on x") == {"4"} and retro.gate_slices("Slice 2b gated") == {"2b"}
assert retro.gate_slices("Wave 2 gated: slices 2-3, 5") == {"2", "3", "5"} and retro.gate_slices("Merge crusade/kernel-s2: slice 2, storage") == set()

# landmark over synthetic commits: slice 1 (churn 10, 80% at the 2nd commit, gated), slice 2b (open, starts late), one commit with no slice
mk = lambda h, t, sl, ch, parts=None, why=None: dict(h=h, t=t, slice=sl, churn=ch, parts=collections.Counter(parts or {}), via="trailer" if sl else None, why=why)
cms = [mk("a", D(1, 0), "1", 6, {"prod": 6}), mk("b", D(2, 0), "1", 2, {"prod": 2}), mk("c", D(2, 40), "1", 2, {"test": 2}), mk("d", D(9, 0), "2b", 4, {"prod": 4}), mk("e", D(3, 0), None, 50, why="thread title names no slice")]
lmk = retro.landmark(cms, {"1": D(5, 0)}, [dict(t=I(5), h="x", subject="Slice 1 gated", kind="gate")], D(0, 0), D(10, 0), [("t", D(0, 0), D(10, 0))])
s1, s2 = lmk["slices"]
assert (s1["n"], s1["commits"], s1["churn"], s1["first"], s1["start_lag_h"], s1["t80"], s1["gate"], s1["open"], s1["tail_h"]) == ("1", 3, 10, I(1), 1.0, I(2), I(5), False, 3.0), s1
assert s1["tail_commits"] == 1 and s1["tail_churn"] == {"test": 2, "prod": 0, "docs": 0} and s1["tail_active_h"] == 0.5 and s1["tail_quiet_h"] == 2.5, s1  # the 40-minute gap is capped at 30
assert s1["tail_test_share"] == 1.0 and s2["tail_test_share"] is None
assert (s2["n"], s2["open"], s2["start_lag_h"], s2["tail_commits"]) == ("2b", True, 9.0, 0) and lmk["open_slices"] == ["2b"]
assert lmk["unattributed"] == dict(commits=1, churn=50, no_trailer=0, no_slice_title=1) and lmk["by_branch"] == 0 and lmk["commits_read"] == 5 and lmk["blocked"]["slices"] == ["2b"] and lmk["marks"][0]["kind"] == "gate"
assert retro.landmark([], {}, [], D(0), D(1))["slices"] == []

# a keepalive-triggered run is coloured by its wake; any other run is plain
wk = [dict(at=I(1, 0), hit=True), dict(at=I(5, 0), hit=False)]
assert [retro.run_kind(t, wk, ra, rb) for t, ra, rb in [("keepalive wake", I(1, 0), I(1, 5)), ("keepalive wake", I(5, 0), I(5, 5)), ("keepalive wake", I(8), I(9)), ("owner text", I(1), I(2))]] == ["ka-hit", "ka-miss", "ka", "run"]

# lanes: the slice of a thread title groups it; roots first, lettered after their number, no slice last; runs, gaps and messages come from the state db
db = sqlite3.connect(":memory:")
db.execute("create table orchestration_v2_projection_threads (thread_id, title, payload_json)")
db.execute("create table orchestration_v2_projection_runs (thread_id, requested_at, completed_at)")
db.execute("create table orchestration_v2_projection_messages (thread_id, role, created_at, payload_json)")
for tid, title in [("root", "Root"), ("k1", "Pod doors"), ("k2", "s2b writer"), ("k3", "Slice 2 x"), ("k4", "no runs s9")]:
    db.execute("insert into orchestration_v2_projection_threads values (?, ?, ?)", (tid, title, json.dumps(dict(lineage=dict(rootThreadId="root", parentThreadId=None if tid == "root" else "root"), modelSelection=dict(model="m")))))
    if tid != "k4": db.execute("insert into orchestration_v2_projection_runs values (?, ?, ?)", (tid, I(0), I(1)))
db.execute("insert into orchestration_v2_projection_messages values ('k3', 'user', ?, ?)", (I(0), json.dumps(dict(createdAt=I(0), text="keepalive hello", senderThreadId="root"))))
sp = retro.lane_specs(db, [dict(tid="root", title="Root", selected="m")])
assert [(l["tid"], l["group"], l["slice"], l["root"]) for l in sp] == [("root", "ROOTS", None, True), ("k3", "SLICE 2", "2", False), ("k2", "SLICE 2b", "2b", False), ("k1", "OTHER", None, False)], sp
retro.fill_lanes(db, sp, {}, {"root": "Root"}, D(5))
k3 = next(l for l in sp if l["tid"] == "k3")
assert k3["runs"] == [[I(0), I(1), "keepalive hello", "ka"]] and k3["msgs"] == [dict(t=I(0), frm="root", frm_name="Root", owner=False, text="keepalive hello")] and k3["gaps"] == []

# the page reads retro.json and nothing else: no file, or a json written without --tree, exits non-zero naming the retro.py command
with tempfile.TemporaryDirectory() as d:
    for write in (None, {"threads": [], "lanes": []}):
        if write is not None: json.dump(write, open(os.path.join(d, "retro.json"), "w"))
        try: swimlanes.load(d); raise AssertionError("load accepted a run directory with no lanes")
        except SystemExit as e: assert "retro.py --out" in str(e.code) and "--tree" in str(e.code), e.code
    json.dump({"lanes": [{"tid": "x"}]}, open(os.path.join(d, "retro.json"), "w")); assert swimlanes.load(d)["lanes"][0]["tid"] == "x"
# a lettered slice gates, alone or in a wave line; a range stays digits
assert retro.gate_slices("MAP: slice 2b gated on crusade/kernel") == {"2b"} and retro.gate_slices("Wave 3 merged: slices 5a, 6-7 & 9") == {"5a", "6", "7", "9"}
assert retro.gate_slices("Merge crusade/kernel-s4: slice 4 work") == set()
# a thread that ran git commit and has no commit anywhere is named; one with a commit, or with no git commit, is not
ms = [dict(tid="a", title="A", commands={"git commit": dict(calls=0, hours=0, secondary=2)}), dict(tid="b", title="B", commands={"git commit": [1, 0.0, 0]}), dict(tid="c", title="C", commands={})]
assert retro.lost_writers(ms, {"b"}) == ["A"]
print("ok")
