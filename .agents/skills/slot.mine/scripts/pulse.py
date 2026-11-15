"""One screen on a run's code and schedule between two commits, from git alone. Read-only.

usage: python pulse.py <base> <tip> [--map <MAP.md>] [--all]

Prints pace (production lines added, deleted and moved per wall hour), every ratchet baseline that
changed, the four health counts that changed (escape casts, suppressions, TODO marks, files over
600 lines, counted at each commit, so a run older than the health guard still reads), the cost of
merge conflicts, each slice whose actual time left its estimate, and the slices not started. A
figure inside its band is not printed unless --all, so a quiet run prints the pace line and nothing
else. Exit 1 when a ratchet or a health count rose. `--map` names the file whose
`Estimate: <branch> <hours>h` lines it scores; a slice whose branch does not exist is "not started".

Hours are the time between the two commits, so pace is comparable only between ranges that each
start where a run started.

ponytail: conflict cost is lines inside conflict markers over lines merged; it stands in for time
and cannot see a clean merge that breaks behavior. Bands are the constants below; tune them on data.
"""
import datetime, json, re, subprocess, sys

DIR = 'ts/tests/repo-guards/src'
CONFLICT_BAND = 2.0        # percent of merged lines; the owner's ceiling is 12.5 (one part in eight)
# TODO: Add a tip/last-read watcher that wakes idle partners once per unread integration tip.
# TODO: Arm child time boxes and checkpoint wakes rather than relying on the driver's age checks.
ESTIMATE_BAND = (0.5, 2.0)  # actual over estimate


def git(*a, ok=(0,)):
    p = subprocess.run(['git', *a], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode not in ok:
        raise SystemExit('git %s -> %d %s' % (' '.join(a)[:200], p.returncode, p.stderr[:300]))
    return p.stdout


def when(ref):
    return datetime.datetime.fromisoformat(git('log', '-1', '--format=%cI', ref).strip())


def is_prod(p):
    return p.endswith(('.ts', '.tsx', '.cs')) and not re.search(
        r'\.d\.ts$|\.(test|spec|guard|journey|gen|generated)\.|(^|/)(tests?|__tests__|fixtures?|generated)/|Tests?/', p)


def leaves(x):
    # sums every number in the file, so a baseline that also records a file count moves with it
    if isinstance(x, bool): return 0
    if isinstance(x, (int, float)): return x
    if isinstance(x, dict): return sum(leaves(v) for v in x.values())
    if isinstance(x, list): return sum(leaves(v) for v in x) if any(isinstance(v, (int, float, dict, list)) for v in x) else len(x)
    return 0


def ratchets(ref):
    out = {}
    for f in git('ls-tree', '-r', '--name-only', ref, DIR).split():
        if f.endswith('.baseline.json'):
            body = json.loads(git('show', '%s:%s' % (ref, f)))
            name = f.split('/')[-1].replace('.baseline.json', '')
            if name != 'health': out[name] = leaves(body)  # health is counted below, at any commit
    return out


HEALTH = {  # the patterns of ts/tests/repo-guards/src/health-census.ts
    'casts': r'\bas (any|unknown as)\b|\(dynamic\)|\bas never\b',
    'suppressions': r'@ts-(ignore|expect-error)|(eslint|oxlint)-disable|#pragma warning disable|SuppressMessage',
    'todos': r'\b(TODO|HACK|FIXME|XXX)\b',
    'lines': '^',
}


def health(ref):
    out = {}
    for name, pattern in HEALTH.items():
        per = [l.rsplit(':', 1) for l in git('grep', '-c', '-E', pattern, ref, '--', '*.ts', '*.tsx', '*.cs', ok=(0, 1)).splitlines()]
        per = [int(n) for f, n in per if is_prod(f.split(':', 1)[1])]
        if name == 'lines': out['health.longFiles'] = sum(1 for n in per if n > 600)
        else: out['health.' + name] = sum(per)
    return out


def merges(base, tip):
    """Every two-parent merge in base..tip, replayed with merge-tree: (sha, subject, parents, conflicted files, conflict lines, lines merged)."""
    rows = []
    for line in git('log', '--merges', '--format=%H %P|%s', '%s..%s' % (base, tip)).splitlines():
        head, subj = line.split('|', 1)
        sha, *parents = head.split()
        if len(parents) != 2: continue
        p1, p2 = parents
        mt = git('merge-tree', '--write-tree', '--name-only', '--no-messages', p1, p2, ok=(0, 1)).splitlines()
        files = [f for f in mt[1:] if f]
        inside = n = 0
        for f in files:
            p = subprocess.run(['git', 'show', '%s:%s' % (mt[0], f)], capture_output=True, text=True, encoding='utf-8', errors='replace')
            for l in p.stdout.splitlines() if p.returncode == 0 else []:  # deleted on one side: a conflict with no markers
                if l.startswith('<<<<<<< '): inside = 1
                elif l.startswith('>>>>>>> '): inside = 0
                else: n += inside
        mb = git('merge-base', p1, p2).strip()
        size = sum(int(a) + int(d) for a, d, _ in (l.split('\t', 2) for l in git('diff', '--numstat', mb, p2).splitlines()) if a != '-')
        rows.append((sha, subj, (p1, p2), files, n, size))
    return rows


def main(argv):
    show_all = '--all' in argv
    map_path = argv[argv.index('--map') + 1] if '--map' in argv else None
    refs = [a for a in argv if not a.startswith('--') and a != map_path]
    if len(refs) != 2 or '--help' in argv: raise SystemExit(__doc__)
    base, tip = refs
    red = False

    add = dele = 0
    for l in git('diff', '--numstat', base, tip).splitlines():
        a, d, p = l.split('\t', 2)
        if a != '-' and is_prod(p): add += int(a); dele += int(d)
    hours = max((when(tip) - when(base)).total_seconds() / 3600, 0.01)
    print('pace: production +%d -%d, moved %d (net %+d) in %.1f h = %d moved per hour' % (add, dele, add + dele, add - dele, hours, (add + dele) / hours))

    a, b = {**ratchets(base), **health(base)}, {**ratchets(tip), **health(tip)}
    for k in sorted(set(a) | set(b)):
        was, now = a.get(k), b.get(k)
        if was is None or now is None or now == was:
            if show_all: print('ratchet %-26s %s -> %s' % (k, was, now))
            continue
        rose = now > was
        red |= rose
        f = '%s/%s.baseline.json' % (DIR, k)
        print('ratchet %-26s %s -> %s%s' % (k, was, now, '  ROSE' + ('' if k.startswith('health.') else ' in ' + ' '.join(git('log', '--format=%h', '%s..%s' % (base, tip), '--', f).split()[:6])) if rose else ''))

    ms = merges(base, tip)
    lines, merged = sum(m[4] for m in ms), sum(m[5] for m in ms)
    cost = 100 * lines / max(merged, 1)
    if show_all or cost > CONFLICT_BAND:
        hit = [m for m in ms if m[3]]
        print('conflicts: %d of %d merges, %d conflict lines of %d merged = %.2f%%' % (len(hit), len(ms), lines, merged, cost))
        for m in sorted(hit, key=lambda m: -m[4])[:5]:
            print('  %s %d lines: %s' % (m[0][:8], m[4], ', '.join(m[3][:4])))

    if map_path:
        estimates = re.findall(r'Estimate:\s*(\S+)\s+([\d.]+)h', open(map_path, encoding='utf-8').read())
        if not estimates: print('estimates: %s has no `Estimate: <branch> <hours>h` line, so none is scored' % map_path)
        idle = []
        for branch, est in estimates:
            hits = [m for m in ms if re.search(re.escape(branch) + r'(?![\w-])', m[1])]  # k2/store must not match k2/store-sweeps
            m = min(hits, key=lambda m: when(m[0])) if hits else None  # the first merge is when the slice became drivable
            if not m:
                if subprocess.run(['git', 'rev-parse', '-q', '--verify', branch], capture_output=True).returncode: idle.append(branch)
                elif show_all: print('estimate %s %sh: not merged' % (branch, est))
                continue
            # a writer commits just before it merges, so the branch's creation in the reflog is the start; first commit when the reflog is gone
            born = subprocess.run(['git', 'reflog', 'show', '--date=iso-strict', '--format=%gd', branch], capture_output=True, text=True).stdout.split()
            first = [born[-1].split('{')[1].rstrip('}')] if born else git('log', '--reverse', '--format=%cI', '%s..%s' % (m[2][0], m[2][1])).splitlines()
            actual = (when(m[0]) - datetime.datetime.fromisoformat(first[0])).total_seconds() / 3600 if first else 0
            ratio = actual / float(est)
            if show_all or not ESTIMATE_BAND[0] <= ratio <= ESTIMATE_BAND[1]:
                print('estimate %s: %sh planned, %.1fh from branch start to merge = %.1fx' % (branch, est, actual, ratio))
        if idle: print('not started (no branch): ' + ', '.join(idle))
    if red: print('exit 1: a ratchet or a health count rose')
    return 1 if red else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
