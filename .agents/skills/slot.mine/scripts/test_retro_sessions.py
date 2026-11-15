"""Focused regression checks for fork ownership, session matching and idle wall time."""
import contextlib
import io
import json
import os
import sqlite3
import tempfile
from unittest.mock import patch

import retro

I = lambda n: f"2026-01-01T00:{n:02d}:00Z"
with tempfile.TemporaryDirectory() as d:
    path = os.path.join(d, "session.jsonl")
    records = [dict(type="assistant", timestamp=I(n), requestId=str(n), message=dict(model="m", usage=dict(input_tokens=n, output_tokens=n))) for n in (1, 2)]
    with open(path, "w") as f: f.write("\n".join(map(json.dumps, records)))
    m = retro.new_metrics("fork", "fork", "m")
    retro.claude(path, m, retro.ts(I(2)))
    assert m["usage"]["output_tokens"] == 2 and len(m["curve"]) == 1
    records = [dict(type="event_msg", timestamp=I(n), payload=dict(type="token_count", info=dict(total_token_usage=dict(input_tokens=n*100, cached_input_tokens=n*50, output_tokens=n*10)))) for n in (1, 2)]
    with open(path, "w") as f: f.write("\n".join(map(json.dumps, records)))
    m = retro.new_metrics("fork", "fork", "m")
    retro.codex(path, m, retro.ts(I(2)))
    assert m["usage"] == dict(input_tokens=50, cache_read_input_tokens=50, output_tokens=10)

# A shared cwd is insufficient: time must fit, and even two unseen candidates refuse.
sessions = [("/a/rollout-a.jsonl", retro.norm("/wt"), retro.ts(I(2))), ("/b/rollout-b.jsonl", retro.norm("/wt"), retro.ts(I(20)))]
with patch.object(retro, "codex_sessions", return_value=sessions):
    diag = dict(matched=[], ambiguous={})
    assert retro.native_files([("codex", "pending:run")], "/wt", set(), [(I(1), I(3))], diag, "t") == [("codex", sessions[0][0])]
    assert diag["matched"] == ["t"]
    with contextlib.redirect_stdout(io.StringIO()):
        assert retro.native_files([("codex", "pending:run")], "/wt", {retro.norm(sessions[0][0])}, [(I(1), I(30))], diag, "t") == []
    assert diag["ambiguous"]["t"] == ["rollout-a.jsonl", "rollout-b.jsonl"]
    assert retro.native_files([], "/elsewhere", set(), [(I(1), I(3))]) == []
    assert retro.native_files([("codex", "a")], None, set()) == [("codex", sessions[0][0])]

# Include agent forks and unpriced threads; exclude owner forks and their children.
db = sqlite3.connect(":memory:")
db.execute("create table orchestration_v2_projection_threads(thread_id, title, payload_json)")
db.execute("create table orchestration_v2_projection_runs(thread_id, requested_at, completed_at)")
for tid, parent, source in [("child", "root", "mcp"), ("manual", "root", "web"), ("manual-child", "manual", "mcp")]:
    p = dict(lineage=dict(rootThreadId="root", parentThreadId=parent), creationSource=source, forkedFrom=dict(type="run"))
    db.execute("insert into orchestration_v2_projection_threads values (?, ?, ?)", (tid, tid, json.dumps(p)))
assert [t for t, _, _ in retro.descendants_of(db, "root")] == ["child"]
assert len(list(retro.descendants_of(db, "root", True))) == 3
for tid, a, b in [("root", 0, 5), ("root", 3, 4), ("root", 20, 21), ("child", 4, 7), ("child", 8, 9), ("manual", 7, 20), ("manual-child", 7, 20)]:
    db.execute("insert into orchestration_v2_projection_runs values (?, ?, ?)", (tid, I(a), I(b)))
x = retro.idle_wall(db, ["root"])
assert x["total_h"] == 0.2 and x["over_5m_total_h"] == round(11/60, 2)
assert x["over_5m"] == [dict(start=retro.utc(retro.ts(I(9))), end=retro.utc(retro.ts(I(20))), minutes=11)]
assert retro.idle_wall(db, ["absent"])["total_h"] == 0
print("ok: fork records, cumulative baseline, unique fallback, ambiguity, lineage, run union")
