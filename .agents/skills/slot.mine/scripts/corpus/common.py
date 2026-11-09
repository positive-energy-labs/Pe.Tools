"""Shared plumbing for the corpus stages (stdlib only). Every stage reads and writes files in the run directory, so any one reruns alone."""
import collections, datetime, hashlib, json, os, re, sqlite3, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.dirname(HERE)
for _p in (HERE, SCRIPTS):
    if _p not in sys.path: sys.path.insert(0, _p)
import landed, pricing  # noqa: E402  (sys.path set above)

HOME = pricing.HOME
T3 = pricing.T3
STAGES = ["t3", "native", "commits", "epochs", "survival", "samples", "page"]


def instant(s):
    """Explicit UTC instant -> the T3 stored form 'YYYY-MM-DDTHH:MM:SS.mmmZ' (bare date = 00:00:00Z), so string comparison is exact.
    A bound spelled loosely moves every count (23:59:59 vs next-day 00:00 changed one window by 35 commits), so bounds are echoed everywhere."""
    d = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    if d.tzinfo is None: d = d.replace(tzinfo=datetime.timezone.utc)
    return d.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def ts(s):
    return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))


def norm(s):
    """Any timestamp string -> UTC 'YYYY-MM-DDTHH:MM:SS.mmmZ'."""
    return s if (s and len(s) == 24 and s.endswith("Z")) else (instant(s) if s else s)


def jl(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip(): yield json.loads(line)


def dump(path, obj):
    with open(path, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False)


def load(path):
    with open(path, encoding="utf-8") as f: return json.load(f)


class Run:
    """A run directory plus the explicit bounds: since inclusive, until exclusive, both UTC instants."""
    def __init__(self, out, project, since, until, repo=".", main="main", **opts):
        self.out = os.path.abspath(out); self.project = project
        self.since, self.until = instant(since), instant(until)
        self.repo = os.path.abspath(repo); self.main = main; self.opts = opts
        os.makedirs(self.out, exist_ok=True)

    lo = property(lambda s: s.since)
    hi = property(lambda s: s.until)

    def p(self, name): return os.path.join(self.out, name)

    def inwin(self, t): return self.lo <= t < self.hi

    def params(self):
        return dict(project=self.project, since=self.since, until=self.until, repo=self.repo, main=self.main, opts=self.opts)

    @classmethod
    def from_dir(cls, out):
        j = load(os.path.join(out, "run.json"))
        return cls(out, j["project"], j["since"], j["until"], j["repo"], j["main"], **j.get("opts", {}))


def db():
    path = f"{T3}/statev2.sqlite"
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def git(repo, *a, inp=None, check=True):
    r = subprocess.run(["git", "-C", repo, *a], input=inp, capture_output=True)
    if check and r.returncode != 0: raise RuntimeError(f"git {' '.join(a[:3])} rc={r.returncode}: {r.stderr.decode('utf-8', 'replace')[:200]}")
    return r.stdout


def short(t):
    """Stable unique short id: uuid -> first 8 hex; mcp ids -> 'mcp-' + 8 hex; anything else -> 'x-' + md5[:8]."""
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f-]{27}", t): return t[:8]
    m = re.fullmatch(r"mcp:(?:launch:)?([0-9a-f]{8})[0-9a-f-]*", t)
    if m: return "mcp-" + m.group(1)
    return "x-" + hashlib.md5(t.encode()).hexdigest()[:8]


# ---- path classes (folded from the old churn.py: module_of, excluded, is_test) ----
GEN_RE = re.compile(r"(/generated/|\.generated\.|source-closure|/proto/|\.proto$|(^|/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|packages\.lock\.json|Cargo\.lock|poetry\.lock)$|\.lock$)")


def excluded(p):
    """Generated, proto and lockfile paths are counted nowhere in quality metrics."""
    return bool(GEN_RE.search(p if p.startswith("/") else "/" + p))


def module_of(p):
    parts = p.split("/")
    if len(parts) >= 3 and parts[0] == "ts" and parts[1] in ("apps", "packages"): return f"ts/{parts[1]}/{parts[2]}"
    if len(parts) >= 2 and parts[0] == "dotnet": return f"dotnet/{parts[1]}"
    if len(parts) >= 3 and parts[0] == "docs" and parts[1] == "features": return f"docs/features/{parts[2]}"
    return "other"


def is_test(p):
    parts = p.split("/"); name = parts[-1].lower()
    if any(s.lower() in ("test", "tests", "__tests__", "testing") for s in parts[:-1]): return True
    if ".test." in name or ".spec." in name: return True
    if name.startswith("test_") or name.endswith(("_test.py", "_test.go", "test.cs", "tests.cs")): return True
    return len(parts) >= 2 and parts[0] == "dotnet" and bool(re.search(r"\.Tests?$", parts[1]))


def debt(run_stamps, owner_stamps, lo=None, hi=None):
    """Checkpoint debt: the most runs between two consecutive owner turns, runs counted in (a, b]. Bounds lo/hi (an epoch's edges)
    close the first and last gap; with no owner turn the debt is the run count. Relays are not owner turns, so they never reset it."""
    if not run_stamps: return 0
    bounds = [lo] + sorted(owner_stamps) + [hi]
    return max(sum(1 for r in run_stamps if (a is None or r > a) and (b is None or r <= b)) for a, b in zip(bounds, bounds[1:]))


# ---- lane / epoch / role lookups shared by samples and render ----
def lane_of(parent_of, lane_set, t):
    """Nearest lane at or above thread t (parent_of: {thread: parent|None})."""
    x = t
    while x:
        if x in lane_set: return x
        x = parent_of.get(x)
    return None


def epoch_n(epochs, when):
    """Epoch number of a lane at time `when`; epochs = epochs.json lanes[lane]['epochs'] (start/end ISO strings, last one open-ended)."""
    for i, e in enumerate(epochs):
        if e["start"] <= when < (epochs[i + 1]["start"] if i + 1 < len(epochs) else "9999"): return e["n"]
    return epochs[0]["n"] if epochs and when < epochs[0]["start"] else (epochs[-1]["n"] if epochs else None)


def role_for(roles, lane_short, lane_id, n):
    """roles.json lookup: {"<lane short or full id>": {"<epoch n>": role, "*": default}} -> role or None (unlabelled)."""
    r = (roles or {}).get(lane_short) or (roles or {}).get(lane_id)
    if not r: return None
    return r.get(str(n)) or r.get("*")
