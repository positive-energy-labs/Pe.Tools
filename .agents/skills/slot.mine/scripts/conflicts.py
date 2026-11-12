"""Replay every two-parent merge in a window with `git merge-tree` and count what conflicted. Read-only.

usage: python conflicts.py <label> <since-iso> <until-iso> <ref> [<ref>...]
"""
import collections, subprocess, sys


def git(*a, ok=(0,)):
    p = subprocess.run(['git', *a], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode not in ok:
        raise SystemExit('git %s -> %d %s' % (' '.join(a), p.returncode, p.stderr[:300]))
    return p.returncode, p.stdout


label, since, until, refs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
_, out = git('log', '--merges', '--since=' + since, '--until=' + until, '--format=%H %P|%cI|%s', *refs)
rows = []
for line in out.splitlines():
    head, when, subj = line.split('|', 2)
    sha, *parents = head.split()
    if len(parents) != 2:
        continue
    p1, p2 = parents
    rc, mt = git('merge-tree', '--write-tree', '--name-only', '--no-messages', p1, p2, ok=(0, 1))
    lines = mt.splitlines()
    tree, files = lines[0], [f for f in lines[1:] if f]
    hunks = conflict_lines = 0
    for f in files:
        c, body = git('show', '%s:%s' % (tree, f), ok=(0, 128))
        if c:
            continue  # deleted on one side: a conflict with no markers
        inside = False
        for l in body.splitlines():
            if l.startswith('<<<<<<< '):
                hunks += 1; inside = True
            elif l.startswith('>>>>>>> '):
                inside = False
            elif inside:
                conflict_lines += 1
    _, base = git('merge-base', p1, p2)
    _, ns = git('diff', '--numstat', base.strip(), p2)
    size = nfiles = 0
    for l in ns.splitlines():
        a, d, _f = l.split('\t', 2)
        if a != '-':
            size += int(a) + int(d); nfiles += 1
    rows.append(dict(sha=sha[:8], when=when, subject=subj[:90], files=files, hunks=hunks,
                     conflict_lines=conflict_lines, incoming_lines=size, incoming_files=nfiles))

n = len(rows)
hit = [r for r in rows if r['files']]
by_file = collections.Counter(f for r in hit for f in r['files'])
print('%s: %d two-parent merges, %d conflicted (%.0f%%)' % (label, n, len(hit), 100 * len(hit) / max(n, 1)))
print('  conflicted files %d, hunks %d, lines inside conflict markers %d' % (
    sum(len(r['files']) for r in hit), sum(r['hunks'] for r in hit), sum(r['conflict_lines'] for r in hit)))
print('  lines the merged branches brought in: %d (all merges), %d (conflicted merges)' % (
    sum(r['incoming_lines'] for r in rows), sum(r['incoming_lines'] for r in hit)))
print('  conflict cost: %.2f%% of the lines merged (lines inside markers, which stand in for time; a clean merge that breaks behavior is not counted)' % (
    100 * sum(r['conflict_lines'] for r in hit) / max(sum(r['incoming_lines'] for r in rows), 1)))
print('  files by conflict count:')
for f, c in by_file.most_common(14):
    print('    %3d  %s' % (c, f))
big = sorted(hit, key=lambda r: -r['conflict_lines'])[:8]
print('  largest conflicts:')
for r in big:
    print('    %s %s  %d files %d hunks %d lines | incoming %d lines | %s' % (
        r['sha'], r['when'][5:16], len(r['files']), r['hunks'], r['conflict_lines'], r['incoming_lines'], r['subject'][:60]))
