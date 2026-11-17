"""Remove a scratch tree an agent made: a worktree, a baseline copy, or a run's temp folder.

    python tools/clean.py <path> [<path>...]

Agents call this instead of an inline recursive delete, because a harness may stop an
inline delete for an approval nobody can give: in two runs, every one of seven approval
prompts that stalled a thread was one. A registered worktree is removed with git first, then
its ignored leftovers (node_modules) are deleted. Only a path strictly inside an allowed root
is touched: the shared worktree folder, this checkout's .artifacts, the system temp folder,
or a sibling checkout named Pe.Tools-*. Prints one JSON line per path; exit 1 if any refused.
"""

import json, os, shutil, stat, subprocess, sys, tempfile
from pathlib import Path

CHECKOUT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.run(['git', '-C', str(CHECKOUT), *args], capture_output=True, text=True)


def main_checkout():
    common = git('rev-parse', '--path-format=absolute', '--git-common-dir').stdout.strip()
    return Path(common).resolve().parent if common else CHECKOUT


def roots():
    main = main_checkout()
    found = [Path.home() / '.t3' / 'worktrees', main / '.artifacts', CHECKOUT / '.artifacts',
             Path(tempfile.gettempdir())]
    found += [p for p in main.parent.glob(main.name + '-*') if p.is_dir()]  # sibling checkouts
    return [p.resolve() for p in found]


def refusal(path, allowed):
    if path == main_checkout() or path == CHECKOUT:
        return 'a checkout itself'
    if any(path == r for r in allowed):
        return 'an allowed root itself'
    if not any(path.is_relative_to(r) for r in allowed):
        return 'outside every allowed root'
    return None


def long(path):
    text = str(path)
    return '\\\\?\\' + text if os.name == 'nt' and not text.startswith('\\\\') else text


def writable(fn, target, _):
    os.chmod(target, stat.S_IWRITE)  # git marks pack files read-only
    fn(target)


def worktrees():
    out = git('worktree', 'list', '--porcelain').stdout
    return {Path(l[9:]).resolve() for l in out.splitlines() if l.startswith('worktree ')}


def clean(raw, allowed):
    path = Path(raw).resolve()
    why = refusal(path, allowed)
    if why:
        return dict(path=str(path), removed=False, refused=why)
    registered = path in worktrees()
    if registered:
        git('worktree', 'remove', '--force', str(path))
    if path.exists():
        shutil.rmtree(long(path), onexc=writable)
    if registered:
        git('worktree', 'prune')
    return dict(path=str(path), removed=not path.exists(), worktree=registered)


def main(argv):
    if not argv:
        sys.exit(__doc__)
    allowed = roots()
    results = [clean(a, allowed) for a in argv]
    for r in results:
        print(json.dumps(r))
    return 1 if any(not r['removed'] for r in results) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
