"""Fixtures for landed.classify on tiny synthetic git repos (temp dir; nothing outside it is touched), plus retro.py cost/owner-turn asserts.
  python -I -B test_landed.py   -> prints PASS/FAIL per case and a count; exit 1 on any failure.
Timeline (UTC): base 2026-01-01, thread created 2026-01-02, branch work 2026-01-03, merge/squash 2026-01-04, later main commit 2026-01-05.
"""
import os, subprocess, sys, tempfile, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import landed as J
import retro

D = lambda day: f"2026-01-0{day}T12:00:00+00:00"
CREATED = "2026-01-02T00:00:00Z"
R = tempfile.mkdtemp(prefix="landed-test-")


def g(*a, day=None, inp=None):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    if day: env.update(GIT_AUTHOR_DATE=D(day), GIT_COMMITTER_DATE=D(day))
    r = subprocess.run(["git", "-C", R, "-c", "core.autocrlf=false", *a], env=env, capture_output=True, text=True, input=inp)
    assert r.returncode == 0, (a, r.stderr)
    return r.stdout


def commit(path, text, msg, day):
    open(os.path.join(R, path), "w", newline="\n").write(text); g("add", path); g("commit", "-q", "-m", msg, day=day)


def branch(name, files, day=3, msg=None, base="main"):
    g("checkout", "-q", "-b", name, base)
    for p, t in files.items(): commit(p, t, msg or f"work {name}", day)
    g("checkout", "-q", "main")


g("init", "-q", "-b", "main"); commit("base.txt", "base\n", "base", 1)
# merged: branch kept, no-ff merged
branch("feat/merged", {"a.txt": "a\n"}); g("merge", "--no-ff", "-q", "feat/merged", "-m", "Merge branch 'feat/merged'", day=4)
# open: branch kept, never merged
branch("feat/open", {"b.txt": "b\n"})
# deleted + merged (merge commit names it)
branch("feat/delmerged", {"c.txt": "c\n"}); g("merge", "--no-ff", "-q", "feat/delmerged", "-m", "Merge branch 'feat/delmerged' into main", day=4); g("branch", "-D", "feat/delmerged")
# deleted, never merged, no trace
branch("feat/delgone", {"d.txt": "d\n"}); g("branch", "-D", "feat/delgone")
# squash, branch DELETED: content on main, no ancestry, no patch-id match (two commits collapsed)
branch("feat/sqdel", {"e1.txt": "e1\n", "e2.txt": "e2\n"}); g("merge", "--squash", "-q", "feat/sqdel"); g("commit", "-q", "-m", "squash sqdel", day=4); g("branch", "-D", "feat/sqdel")
# squash, branch KEPT: content-equal weak
branch("feat/sqkeep", {"f1.txt": "f1\n", "f2.txt": "f2\n"}); g("merge", "--squash", "-q", "feat/sqkeep"); g("commit", "-q", "-m", "squash sqkeep", day=4)
# rebase/cherry-pick landing, branch kept (tip not ancestor, patch-ids match)
branch("feat/pick", {"p.txt": "p\n"}); sha = g("rev-parse", "feat/pick").strip(); g("cherry-pick", sha, day=4)
# empty branch cut from main BEFORE main advanced; ancestor but carries no commit from the thread
g("branch", "feat/empty", "main"); g("checkout", "-q", "main"); commit("later.txt", "later\n", "main moves on", 5)
# trailer: squashed + branch deleted, but the commit carries T3-Thread
branch("feat/trl", {"t.txt": "t\n"}); g("merge", "--squash", "-q", "feat/trl")
g("commit", "-q", "-m", "squash trl\n\nT3-Thread: thr-trailer", day=6); g("branch", "-D", "feat/trl")
# partial: 'Merge branch main into X' reached main because X landed later
branch("feat/part", {"q.txt": "q\n"}); commit("m6.txt", "m6\n", "main advances so the sync merge is real", 6); g("checkout", "-q", "feat/part"); g("merge", "-q", "--no-ff", "main", "-m", "Merge branch 'main' into feat/part", day=6)
g("checkout", "-q", "main"); g("merge", "--no-ff", "-q", "feat/part", "-m", "land part", day=6); g("branch", "-D", "feat/part")

F = J.facts(R)
T = lambda tid, br: dict(thread=tid, branch=br, created=CREATED)
fails = passes = 0


def check(name, got, want):
    global fails, passes
    ok = got == want
    passes += ok; fails += not ok
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  got={got} want={want}"))


c = lambda tid, br, at=None: J.classify(T(tid, br), F, at)
check("merged (branch kept, ancestor)", c("t1", "feat/merged"), ("landed", "strong", "branch-ancestor"))
check("open (branch kept, own commit, unmerged)", c("t2", "feat/open"), ("open", "-", "branch-unmerged"))
check("deleted-branch + merge subject -> landed", c("t3", "feat/delmerged"), ("landed", "strong", "merge-subject"))
check("deleted-branch, no trace -> unknown (NOT open)", c("t4", "feat/delgone"), ("unknown", "-", "branch-gone"))
check("squash + deleted branch -> unknown (NOT open)", c("t5", "feat/sqdel"), ("unknown", "-", "branch-gone"))
check("squash + kept branch -> landed weak content-equal", c("t6", "feat/sqkeep"), ("landed", "weak", "content-equal"))
check("cherry-pick landing, kept branch -> landed cherry-all", c("t7", "feat/pick"), ("landed", "strong", "cherry-all"))
check("empty branch (ancestor, no own commit) -> unknown, not landed", J.classify(dict(T("t8", "feat/empty"), created="2026-01-06T00:00:00Z"), F), ("unknown", "-", "empty-tip"))
check("trailer beats everything even on deleted squash branch", c("thr-trailer", "feat/trl"), ("landed", "strong", "trailer"))
check("trailer threads not on other branches stay unknown", c("t9", "feat/trl"), ("unknown", "-", "branch-gone"))
check("main-merges-into-X subject, branch gone -> landed weak partial", c("t10", "feat/part"), ("landed", "weak", "merge-subject-partial"))
mainsha = next(iter(F["main_ct"]))
check("first-mention only -> landed WEAK", c("t11", "feat/delgone", {"t11": {"first-mention": [mainsha]}}), ("landed", "weak", "first-mention"))
check("commit-line beats first-mention", c("t12", "feat/delgone", {"t12": {"first-mention": [mainsha], "commit-line": [mainsha]}}), ("landed", "strong", "commit-line"))
check("patch-id beats first-mention", c("t13", "feat/delgone", {"t13": {"first-mention": [mainsha], "patch-id": [mainsha]}}), ("landed", "strong", "patch-id"))
check("no branch recorded -> unknown no-branch", c("t14", None), ("unknown", "-", "no-branch"))
# invariant: a branch absent from refs can never be 'open'
gone = ["feat/delmerged", "feat/delgone", "feat/sqdel", "feat/trl", "feat/part", "nonexistent"]
check("INVARIANT branch-gone never open", {c("x", b)[0] for b in gone} <= {"landed", "unknown"}, True)
# owner-turn predicate (775 vs 861)
check("owner_turn web user", J.owner_turn("user", "web"), True)
check("owner_turn mobile user", J.owner_turn("user", "mobile"), True)
check("owner_turn server user (agent text) excluded", J.owner_turn("user", "server"), False)
check("owner_turn web but not createdBy user excluded", J.owner_turn("agent", "web"), False)
# trailer parse sees comma/multi trailers on main
check("facts: trailer index", sorted(F["trailer"]), ["thr-trailer"])

# ---- retro.py: cost() on tokens with no model id; owner-turn predicate (user,web) (user,server) (agent,web) -> 1,0,0 ----
import collections, json, sqlite3
RATES = {"test-model": {"input_cost_per_token": 1.0}}
def retro_cost(selected):
    m = dict(models=collections.Counter(), selected=selected, usage_by_model=collections.defaultdict(collections.Counter))
    m["usage_by_model"]["?"].update(input_tokens=10)
    return retro.cost(m, RATES)[1], m["cost_note"]
priced, note = retro_cost("test-model")
check("retro.cost: '?' tokens priced at selected model", priced, 10.0)
check("retro.cost: '?' tokens say so in cost_note", bool(note) and "selected model" in note, True)
check("retro.cost: '?' tokens without selected model -> None (gap, never zero)", retro_cost(None)[0], None)
db = sqlite3.connect(":memory:")
db.execute("create table orchestration_v2_projection_messages (thread_id, role, payload_json)")
db.execute("create table orchestration_v2_projection_runs (thread_id, requested_at, completed_at)")
db.execute("create table orchestration_v2_projection_threads (payload_json)")
def owner_n(by, src):
    db.execute("delete from orchestration_v2_projection_messages")
    db.execute("insert into orchestration_v2_projection_messages values ('t', 'user', ?)", (json.dumps(dict(createdBy=by, creationSource=src)),))
    return retro.owner_turns_and_hours(db, "t")[0]
check("retro owner turn (user,web) counts", owner_n("user", "web"), 1)
check("retro owner turn (user,server) excluded", owner_n("user", "server"), 0)
check("retro owner turn (agent,web) excluded", owner_n("agent", "web"), 0)

shutil.rmtree(R, ignore_errors=True)
print(f"\n{passes} passed, {fails} failed, {passes + fails} total")
sys.exit(1 if fails else 0)
