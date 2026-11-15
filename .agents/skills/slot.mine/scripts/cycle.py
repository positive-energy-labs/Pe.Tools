"""Write a mechanical cycle report; leave interpretation to the implementor."""
import argparse
import collections
import datetime as dt
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys

from retro import ts

DB = Path('C:/Users/kaitp/.t3/userdata/statev2.sqlite')
ROLES = re.compile(r'\b(driver|purger|integrator|lead)\b', re.I)


def git(*args):
    p = subprocess.run(['git', *args], capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=60)
    if p.returncode:
        raise ValueError(p.stderr.strip() or 'git returned %s' % p.returncode)
    return p.stdout.strip()


def unknown(error):
    return 'unknown: ' + ' '.join(str(error).split())


def optional(fn):
    try:
        return fn()
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as e:
        return unknown(e)


def cycle_files(directory):
    return sorted((p for p in directory.glob('*.md') if p.stem.isdecimal()),
                  key=lambda p: int(p.stem))


def next_n(directory):
    files = cycle_files(directory)
    return int(files[-1].stem) + 1 if files else 1


def read_tip(path):
    match = re.search(r'^Tip: `([0-9a-f]{40,64})`', path.read_text(encoding='utf-8'), re.M)
    if not match:
        raise ValueError('%s has no recorded tip' % path)
    return match[1]


def three_counts(estimates, refs, branches, partners):
    """Inputs are observations, never infer idle or merged from missing data."""
    return (
        sorted(set(estimates) - set(refs)),
        [b['name'] + (' (thread unknown)' if b['running'] is None else '')
         for b in branches if b['has_commits'] and not b['merged'] and b['running'] is not True],
        [p['role'] for p in partners if p['running'] is False
         and isinstance(p['behind'], int) and p['behind'] > 0],
    )


def thread_snapshot(root, now):
    # retro's descendant helper excludes manual forks; a cycle needs every descendant.
    with sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True) as db:
        db.execute('BEGIN')
        rows = {t: dict(json.loads(p), title=title) for t, title, p in db.execute(
            'select thread_id, title, payload_json from orchestration_v2_projection_threads')}
        if root not in rows:
            raise ValueError('root thread not found: ' + root)
        ids = {root}
        while True:
            more = {t for t, p in rows.items() if (p.get('lineage') or {}).get('parentThreadId') in ids}
            if more <= ids:
                break
            ids |= more
        result = []
        for tid in sorted(ids - {root}):
            p = rows[tid]
            runs = db.execute('select status, requested_at, completed_at from '
                              'orchestration_v2_projection_runs where thread_id=? '
                              'order by requested_at desc, ordinal desc', (tid,)).fetchall()
            active = [r for r in runs if r[0] in ('running', 'queued', 'pending', 'starting') and not r[2]]
            ended = next((r for r in runs if r[2]), None)
            direct = (p.get('lineage') or {}).get('parentThreadId') == root
            role = ROLES.search(p['title'] or '') if direct else None
            result.append(dict(id=tid, title=p['title'], branch=p.get('branch'),
                               role=role[1].lower() if role else None, running=bool(active),
                               minutes_running=round((now - ts(min(r[1] for r in active))).total_seconds() / 60, 1) if active else None,
                               since_end=round((now - ts(ended[2])).total_seconds() / 60, 1) if ended else None,
                               failed=ended[0] == 'failed' if ended else None))
        return result


def partner_rows(threads, run_dir, tip):
    history = optional(lambda: git('rev-list', '--first-parent', tip).splitlines())
    rows = []
    for thread in threads:
        if not thread['role']:
            continue
        row = dict(thread, behind=None)
        path = run_dir / 'last-read' / (row['role'] + '.sha')
        if not path.exists():
            row['read'] = 'no file'
        else:
            def last_read():
                raw = path.read_text(encoding='utf-8').strip()
                sha = git('rev-parse', '--verify', raw + '^{commit}')
                if isinstance(history, str):
                    raise ValueError(history)
                if sha not in history:
                    raise ValueError('last-read is not on tip first-parent history')
                row['behind'] = history.index(sha)
                return '%s (%d behind)' % (raw, row['behind'])
            row['read'] = optional(last_read)
        rows.append(row)
    return rows


def branch_rows(tip, base, threads):
    names = git('for-each-ref', '--format=%(refname:short)', '--no-merged=' + tip, 'refs/heads').splitlines()
    merged = git('log', '--first-parent', '--merges', '--format=%s', base + '..' + tip if base != tip else tip)
    prefixes = collections.Counter()
    for line in merged.splitlines():
        # The implementor's merge subject names its slice, including deleted refs.
        match = re.match(r"Merge\s+(?:branch\s+)?['\"]?([\w.-]+/)[\w./-]+", line, re.I)
        if match:
            prefixes[match[1]] += 1
    if not prefixes:
        raise ValueError('no run branch prefix in merge subjects')
    # Once main contains the run, its merge-base is the tip: use the latest slice,
    # not a larger, older campaign elsewhere in the integration branch's history.
    prefix = next(iter(prefixes)) if base == tip else prefixes.most_common(1)[0][0]
    rows = []
    for name in names:
        if not name.startswith(prefix):
            continue
        owners = [t for t in threads if t['branch'] == name]
        running = any(t['running'] for t in owners) if owners else None
        rows.append(dict(name=name, has_commits=True, merged=False, running=running))
    return rows


def pulse(previous, tip, map_path):
    if previous == tip:
        return 'no new commits'
    args = [sys.executable, str(Path(__file__).with_name('pulse.py')), previous, tip]
    if map_path:
        args += ['--map', str(map_path)]
    p = subprocess.run(args, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
    # Exit 1 is pulse's normal signal for a rising ratchet, not a failed measurement.
    if p.returncode not in (0, 1) or p.stderr.strip():
        return (p.stdout.rstrip() + '\n' if p.stdout else '') + unknown(p.stderr or 'pulse exited %d' % p.returncode)
    return p.stdout.rstrip() or unknown('pulse printed nothing')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run_dir', type=Path)
    parser.add_argument('--root', required=True)
    parser.add_argument('--branch', required=True)
    parser.add_argument('--map', type=Path)
    parser.add_argument('--base')
    parser.add_argument('--if-older-than', type=float)
    args = parser.parse_args(argv)
    now = dt.datetime.now(dt.timezone.utc)
    directory = args.run_dir / 'cycle'
    files = cycle_files(directory)
    tip = optional(lambda: git('rev-parse', '--verify', args.branch + '^{commit}'))
    previous = optional(lambda: read_tip(files[-1])) if files else optional(
        lambda: git('rev-parse', '--verify', args.base + '^{commit}') if args.base else git('merge-base', args.branch, 'main'))
    if files and args.if_older_than is not None:
        age = (now.timestamp() - files[-1].stat().st_mtime) / 60
        if age < args.if_older_than and not tip.startswith('unknown:') and tip == previous:
            return 0
    n = next_n(directory)
    subject = optional(lambda: git('log', '-1', '--format=%s', tip))
    lines = ['# Cycle %d' % n, '', 'UTC: ' + now.strftime('%Y-%m-%d %H:%M:%S %Z'),
             'Local: ' + now.astimezone().strftime('%Y-%m-%d %H:%M:%S %Z (%z)'),
             'Branch: ' + args.branch, 'Tip: `%s` (%s) %s' % (tip, tip[:8], subject),
             'Previous tip: ' + previous, '', '## Merged since the last cycle', '']
    lines.append(optional(lambda: git('log', '--merges', '--reverse', '--format=%h %s', previous + '..' + tip)) or 'none')
    lines += ['', '## Pulse', '', optional(lambda: pulse(previous, tip, args.map)), '', '## Partners', '']
    threads = optional(lambda: thread_snapshot(args.root, now))
    partners = partner_rows(threads, args.run_dir, tip) if isinstance(threads, list) else []
    if isinstance(threads, str):
        lines.append(threads)
    else:
        for p in partners:
            ended = '%s min since end' % p['since_end'] if p['since_end'] is not None else 'unknown: no ended run'
            failed = str(p['failed']).lower() if p['failed'] is not None else 'unknown: no ended run'
            lines.append('- %s: %s; %s; last failed: %s; %s' % (
                p['role'], 'running' if p['running'] else 'idle', ended, failed, p['read']))
        if not partners:
            lines.append('none')
    lines += ['', '## Children running', '']
    lines += (['- %s: %s min' % (t['title'], t['minutes_running']) for t in threads
               if t['running'] and not t['role']] or ['none']) if isinstance(threads, list) else [threads]
    estimates = optional(lambda: re.findall(r'Estimate:\s*(\S+)\s+[\d.]+h', args.map.read_text(encoding='utf-8'))) if args.map else []
    refs = optional(lambda: git('for-each-ref', '--format=%(refname:short)').splitlines())
    # Prefix inference needs the whole run, even when this cycle has no new merges.
    base = optional(lambda: git('rev-parse', args.base + '^{commit}') if args.base else git('merge-base', args.branch, 'main'))
    branches = optional(lambda: branch_rows(tip, base, threads if isinstance(threads, list) else []))
    counts = three_counts(estimates if isinstance(estimates, list) else [], refs if isinstance(refs, list) else [],
                          branches if isinstance(branches, list) else [], partners)
    for title, items, error in (
        ('Slices not started', counts[0], estimates if isinstance(estimates, str) else refs if isinstance(refs, str) and args.map else None),
        ('Checked and unmerged', counts[1], branches if isinstance(branches, str) else None),
        ('Partners behind with nothing running', counts[2], threads if isinstance(threads, str) else next(
            (p['read'] for p in partners if p['read'].startswith('unknown:')), None)),
    ):
        lines += ['', '## ' + title, '']
        if error:
            lines.append(error)
        else:
            lines.append(str(len(items)))
            lines += ['- ' + item for item in items] or ['no map' if title == 'Slices not started' and not args.map else 'none']
    lines += ['', '## What changed (implementor)', '', 'Pending implementor judgment.',
              '', '## Owed (implementor)', '', 'Pending implementor judgment.', '']
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / ('%d.md' % n)
    with path.open('x', encoding='utf-8', newline='\n') as out:
        out.write('\n'.join(lines))
    print(path)
    return 0


if __name__ == '__main__':
    sys.exit(main())
