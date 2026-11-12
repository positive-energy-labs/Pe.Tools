"""One screen on a run's code and schedule between two commits, from git alone. Read-only.

usage: python pulse.py <base> <tip> [--map <MAP.md>] [--all]

Prints pace (production lines added, deleted and moved per wall hour), every ratchet baseline that
changed, the cost of merge conflicts, and each slice whose actual time left its estimate. A figure
inside its band is not printed unless --all, so a quiet run prints the pace line and nothing else.
Exit 1 when a ratchet rose. `--map` names the file whose `Estimate: <branch> <hours>h` lines it scores.

ponytail: conflict cost is lines inside conflict markers over lines merged; it stands in for time
and cannot see a clean merge that breaks behavior. Bands are the constants below; tune them on data.
"""
import datetime, json, re, subprocess, sys

DIR = 'ts/tests/repo-guards/src'
CONFLICT_BAND = 2.0        # percent of merged lines; the owner's ceiling is 12.5 (one part in eight)
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
            for k, v in (body.items() if name == 'health' else [('', body)]):
                out[name + ('.' + k if k else '')] = leaves(v)
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
    base, tip = [a for a in argv if not a.startswith('--') and a != map_path][:2]
    red = False

    add = dele = 0
    for l in git('diff', '--numstat', base, tip).splitlines():
        a, d, p = l.split('\t', 2)
        if a != '-' and is_prod(p): add += int(a); dele += int(d)
    hours = max((when(tip) - when(base)).total_seconds() / 3600, 0.01)
    print('pace: production +%d -%d, moved %d (net %+d) in %.1f h = %d moved per hour' % (add, dele, add + dele, add - dele, hours, (add + dele) / hours))

    a, b = ratchets(base), ratchets(tip)
    for k in sorted(set(a) | set(b)):
        was, now = a.get(k), b.get(k)
        if was is None or now is None or now == was:
            if show_all: print('ratchet %-26s %s -> %s' % (k, was, now))
            continue
        rose = now > was
        red |= rose
        f = '%s/%s.baseline.json' % (DIR, k.split('.')[0])
        print('ratchet %-26s %s -> %s%s' % (k, was, now, '  ROSE in ' + ' '.join(git('log', '--format=%h', '%s..%s' % (base, tip), '--', f).split()[:6]) if rose else ''))

    ms = merges(base, tip)
    lines, merged = sum(m[4] for m in ms), sum(m[5] for m in ms)
    cost = 100 * lines / max(merged, 1)
    if show_all or cost > CONFLICT_BAND:
        hit = [m for m in ms if m[3]]
        print('conflicts: %d of %d merges, %d conflict lines of %d merged = %.2f%%' % (len(hit), len(ms), lines, merged, cost))
        for m in sorted(hit, key=lambda m: -m[4])[:5]:
            print('  %s %d lines: %s' % (m[0][:8], m[4], ', '.join(m[3][:4])))

    if map_path:
        for branch, est in re.findall(r'Estimate:\s*(\S+)\s+([\d.]+)h', open(map_path, encoding='utf-8').read()):
            m = next((m for m in ms if branch in m[1]), None)
            if not m:
                if show_all: print('estimate %s %sh: not merged' % (branch, est))
                continue
            first = git('log', '--reverse', '--format=%cI', '%s..%s' % (m[2][0], m[2][1])).splitlines()
            actual = (when(m[0]) - datetime.datetime.fromisoformat(first[0])).total_seconds() / 3600 if first else 0
            ratio = actual / float(est)
            if show_all or not ESTIMATE_BAND[0] <= ratio <= ESTIMATE_BAND[1]:
                print('estimate %s: %sh planned, %.1fh from first commit to merge = %.1fx' % (branch, est, actual, ratio))
    return 1 if red else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
