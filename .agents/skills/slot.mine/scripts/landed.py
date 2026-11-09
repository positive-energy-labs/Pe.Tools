"""landed.py - library: landed tri-state per thread that survives branch deletion. No CLI, no network, read-only git.

  import landed; F = landed.facts(repo); landed.classify(thread_row, F, attrib)

State = landed | open | unknown.  A branch absent from local refs is NEVER open/unmerged: it is landed on positive
evidence or unknown. Evidence precedence (first hit wins):
  strong: trailer > commit-line > patch-id > branch-ancestor > cherry-all > merge-subject
  weak  : content-equal > merge-subject-partial > first-mention
Rates are a ladder strong/n <= (strong+weak)/n <= (strong+weak+unknown)/n, never one point; `unknown` is never a failure.
ponytail: branch-level evidence (ref/merge-subject) is shared by every thread on that branch; thread-level needs the trailer.
Tests: test_landed.py.
"""
import collections, datetime, json, re, subprocess

MERGE = re.compile(r"^Merge (?:remote-tracking )?branch '([^']+)'(?: of \S+)?(?: into (\S+))?")
PRMERGE = re.compile(r"^Merge pull request #\d+ from [^/\s]+/(\S+)")


def git(repo, *a, inp=None, ok=(0,)):
    """Fail loud: a silent non-zero exit once read as 'content equal' (git diff has no --pathspec-from-file)."""
    r = subprocess.run(["git", "-C", repo, *a], input=inp, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode not in ok: raise RuntimeError(f"git {' '.join(a[:3])} rc={r.returncode}: {r.stderr.strip()[:200]}")
    return r.stdout


def epoch(iso):
    return datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def owner_turn(createdBy, creationSource):
    """Human turn needs BOTH. `createdBy=='user' OR source in (web,mobile)` and `createdBy=='user'` alone both count
    server-sourced rows, which are child->parent agent text (86 of the 861 published owner turns)."""
    return createdBy == "user" and creationSource in ("web", "mobile")


def facts(repo, main="main"):
    """Everything classify() needs from git, computed once. No refs are written."""
    tips = {}  # branch name -> (sha, commit unixtime); local first, then remotes with the remote prefix stripped
    for ln in git(repo, "for-each-ref", "--format=%(refname)\t%(objectname)\t%(committerdate:unix)", "refs/heads", "refs/remotes").splitlines():
        ref, sha, ct = ln.split("\t")
        name = re.sub(r"^refs/(?:heads|remotes/[^/]+)/", "", ref)
        if name != "HEAD": tips.setdefault(name, (sha, int(ct)))
    main_ct, trailer, subj_strong, subj_partial = {}, collections.defaultdict(set), {}, {}
    fmt = "%H%x1f%ct%x1f%s%x1f%(trailers:key=T3-Thread,valueonly,unfold,separator=%x2c)%x1e"
    for rec in git(repo, "log", main, "--format=" + fmt).split("\x1e"):
        if not rec.strip(): continue
        sha, ct, subj, tr = rec.strip("\n").split("\x1f")
        main_ct[sha] = int(ct)
        for tid in filter(None, (x.strip() for x in tr.split(","))): trailer[tid].add(sha)
        m = MERGE.match(subj) or PRMERGE.match(subj)
        if not m: continue
        src, dst = re.sub(r"^origin/", "", m.group(1)), (m.group(2) if m.re is MERGE else None)
        if dst is None or dst in (main, "master"): subj_strong[src] = sha
        elif src in (main, "master"): subj_partial[dst] = sha  # 'merge main into X' sits in main => X reached main at least to here
    return dict(main=main, repo=repo, tips=tips, main_ct=main_ct, trailer=trailer, subj_strong=subj_strong, subj_partial=subj_partial)


def content_equal(F, tip):
    """Squash-with-branch-kept detector: every path the branch changed has the same blob on main today (deleted == deleted).
    Weak: a later edit on main masks a true landing. ponytail: paths containing newlines are not supported."""
    r, main = F["repo"], F["main"]
    mb = git(r, "merge-base", main, tip, ok=(0, 1)).strip()
    paths = [p for p in git(r, "diff", "-z", "--name-only", mb, tip).split("\0") if p] if mb else []
    if not paths: return False
    out = git(r, "cat-file", "--batch-check=%(objectname)", inp="".join(f"{rev}:{p}\n" for p in paths for rev in (tip, main))).splitlines()
    norm = [("missing" if x.endswith(" missing") else x) for x in out]
    return len(norm) == 2 * len(paths) and all(norm[i] == norm[i + 1] for i in range(0, len(norm), 2))


def classify(t, F, attrib=None):
    """-> (state, grade, evidence). t needs thread, branch, created. attrib: {tid: {method: [sha]}}."""
    tid, b, a = t["thread"], t.get("branch"), (attrib or {}).get(t["thread"], {})
    on_main = lambda shas: any(s in F["main_ct"] for s in shas)
    if on_main(F["trailer"].get(tid, ())): return "landed", "strong", "trailer"
    for meth in ("commit-line", "patch-id"):
        if a.get(meth): return "landed", "strong", meth
    tip = F["tips"].get(b) if b else None
    reason = "branch-gone" if b and not tip else "no-branch"
    if tip:
        sha, ct = tip
        if sha in F["main_ct"]:
            if ct > epoch(t["created"]): return "landed", "strong", "branch-ancestor"
            reason = "empty-tip"  # tip predates the thread: it committed nothing here, ancestry proves nothing about it
        else:
            ch = git(F["repo"], "cherry", F["main"], sha).split()
            if ch and all(x == "-" for x in ch[::2]): return "landed", "strong", "cherry-all"
            if content_equal(F, sha): return "landed", "weak", "content-equal"
            reason = "open"
    if b and b in F["subj_strong"]: return "landed", "strong", "merge-subject"
    if b and b in F["subj_partial"]: return "landed", "weak", "merge-subject-partial"
    if a.get("first-mention"): return "landed", "weak", "first-mention"
    return ("open", "-", "branch-unmerged") if reason == "open" else ("unknown", "-", reason)


def load_attrib(events):
    """topology events.jsonl -> {thread: {method: [sha]}}; commit events only."""
    at = collections.defaultdict(lambda: collections.defaultdict(list))
    for ln in open(events, encoding="utf-8"):
        e = json.loads(ln)
        if e.get("kind") == "commit" and e.get("thread"): at[e["thread"]][e["method"]].append(e["sha"])
    return at


def pct(n, d): return f"{n / d:.2f}" if d else "-"
