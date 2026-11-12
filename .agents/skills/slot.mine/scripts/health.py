"""Health line between two commits, from git alone. Read-only.

usage: python health.py <old> <new>

Prints every committed ratchet baseline's total at each commit, the commits that raised one, and
the production lines added, deleted and moved. A deleted line is progress as much as an added one.
"""
import json, re, subprocess, sys

DIR = 'ts/tests/repo-guards/src'


def git(*a):
    p = subprocess.run(['git', *a], capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.stdout if p.returncode == 0 else ''


def leaves(x):
    # ponytail: sums every number in the file, so a baseline that also records a file count moves with it
    if isinstance(x, bool): return 0
    if isinstance(x, (int, float)): return x
    if isinstance(x, dict): return sum(leaves(v) for v in x.values())
    if isinstance(x, list): return sum(leaves(v) for v in x) if any(isinstance(v, (int, float, dict, list)) for v in x) else len(x)
    return 0


def totals(ref):
    out = {}
    for f in git('ls-tree', '-r', '--name-only', ref, DIR).split():
        if f.endswith('.baseline.json'):
            body = json.loads(git('show', '%s:%s' % (ref, f)))
            parts = body if f.endswith('health.baseline.json') else {'': body}
            for k, v in parts.items():
                out[f.split('/')[-1].replace('.baseline.json', '') + ('.' + k if k else '')] = leaves(v)
    return out


def is_prod(p):
    return p.endswith(('.ts', '.tsx', '.cs')) and not re.search(
        r'\.d\.ts$|\.(test|spec|guard|journey|gen|generated)\.|(^|/)(tests?|__tests__|fixtures?|generated)/|Tests?/', p)


def main(old, new):
    a, b = totals(old), totals(new)
    rose = False
    for k in sorted(set(a) | set(b)):
        was, now = a.get(k), b.get(k)
        mark = ''
        if was is not None and now is not None and now > was:
            rose = True
            f = '%s/%s.baseline.json' % (DIR, k.split('.')[0])
            mark = '  ROSE in ' + ' '.join(git('log', '--format=%h', '%s..%s' % (old, new), '--', f).split()[:6])
        print('%-28s %6s -> %6s%s' % (k, '-' if was is None else was, '-' if now is None else now, mark))
    add = dele = 0
    for l in git('diff', '--numstat', old, new).splitlines():
        x, y, p = l.split('\t', 2)
        if x != '-' and is_prod(p):
            add += int(x); dele += int(y)
    print('production lines: +%d -%d, moved %d, net %+d' % (add, dele, add + dele, add - dele))
    return 1 if rose else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2]))
