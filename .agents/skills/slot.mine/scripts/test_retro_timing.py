"""python .agents/skills/slot.mine/scripts/test_retro_timing.py - classifier and keepalive HIT/MISS on a tiny synthetic Claude session."""
import json, os, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retro

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
sl = [dict(n=1, first=I(6), t80=I(8)), dict(n=2, first=I(9), t80=I(11)), dict(n=3, first=I(10), t80=I(12))]
assert retro.blocked(sl) == dict(h=2.0, frm=I(8), to=I(10), slices=[2, 3]), retro.blocked(sl)  # [8,9] and [8,10] merge
assert retro.blocked([dict(n=1, first=I(6), t80=I(8)), dict(n=2, first=I(7), t80=I(9))])["h"] == 0  # 2 started before 1 reached 80%
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
print("ok")
