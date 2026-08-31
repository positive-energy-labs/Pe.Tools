#!/usr/bin/env python3
"""Checks the skill set's own invariants. `--fix` repairs what is mechanical.

Run from anywhere: python .agents/skills/check.py [--fix]
"""
import io, os, re, sys, glob, subprocess, collections

HERE = os.path.dirname(os.path.abspath(__file__))
KINDS = ('root', 'lens', 'pass', 'slot', 'loop')
DIR_RE = re.compile(r'^(root|lens|pass|slot|loop)\.([a-z][a-z0-9-]*)$')
# A stance is portable. Anything naming this repo, its tools, or its paths belongs in a slot.
REPO_TOKENS = re.compile(
    r'\bPe\.[A-Za-z]|\bpe-revit\b|\bRevit\b|\bHerd\w*|\bpnpm\b|\bdotnet\b|\btmux\b'
    r'|(?<![\w/.])(?:docs|packages|apps|source|tools)/|\.artifacts/|\.agents/|\.claude/'
    r'|\.ps1\b|\btsx?\b|\bjsx\b|searchParams|\bReact\b|useState|\bnpm\b|\bvitest\b')

fails, fixes = [], []


def fail(where, msg):
    fails.append('%s: %s' % (where, msg))


def read(p):
    return io.open(p, encoding='utf-8').read()


def frontmatter(text):
    m = re.match(r'^---\n(.*?)\n---\n', text, re.S)
    return m.group(1) if m else None


def field(fm, key):
    m = re.search(r'^%s:\s*(.*)$' % key, fm, re.M)
    return m.group(1).strip() if m else None


def triggers(desc):
    # a YAML double-quoted description wraps the whole value and escapes inner quotes; unwrap first
    if desc.startswith('"') and desc.endswith('"'):
        desc = desc[1:-1].replace('\\"', '"')
    return [p.lower() for p in re.findall(r'"([^"]+)"', desc) if p.strip()]


def main():
    do_fix = '--fix' in sys.argv
    dirs = sorted(d for d in os.listdir(HERE) if os.path.isdir(os.path.join(HERE, d)) and d[0] not in '._')
    skills = {}

    # 1. directory names carry the kind; every skill dir has a SKILL.md
    for d in dirs:
        m = DIR_RE.match(d)
        if not m:
            fail(d, 'directory name is not <kind>.<name> with kind in %s' % (KINDS,))
            continue
        path = os.path.join(HERE, d, 'SKILL.md')
        if not os.path.exists(path):
            fail(d, 'no SKILL.md')
            continue
        skills[d] = (m.group(1), m.group(2), read(path))

    # 2. frontmatter: name equals the dir suffix, description exists
    owners = collections.defaultdict(list)
    for d, (kind, name, text) in skills.items():
        fm = frontmatter(text)
        if fm is None:
            fail(d, 'no frontmatter')
            continue
        if field(fm, 'name') != name:
            fail(d, 'frontmatter name %r != directory suffix %r' % (field(fm, 'name'), name))
        desc = field(fm, 'description')
        if not desc:
            fail(d, 'no description; the description is the router')
            continue
        for t in triggers(desc):
            owners[t].append(name)

    # 3. one owner per trigger phrase
    for phrase, names in sorted(owners.items()):
        uniq = sorted(set(names))
        if len(uniq) > 1:
            fail('triggers', '%r is claimed by %s' % (phrase, ', '.join(uniq)))

    # 4. the index table is a projection of dirnames + frontmatter; --fix rewrites it, otherwise it must match
    idx = skills.get('root.index')
    if not idx:
        fail('root.index', 'missing')
    else:
        order = {k: i for i, k in enumerate(('root', 'lens', 'pass', 'loop', 'slot'))}
        want = ['| Kind | Stance | Figure/It is | Rounds | User-only | Stop |', '|---|---|---|---|---|---|']
        for d, (kind, name, text) in sorted(skills.items(), key=lambda kv: (order[kv[1][0]], kv[0])):
            fm = frontmatter(text) or ''
            figure, stop = field(fm, 'figure'), field(fm, 'stop')
            if not figure:
                fail(d, 'no frontmatter figure:; the index table projects it')
            if kind in ('pass', 'loop') and not stop:
                fail(d, 'a %s with no frontmatter stop:' % kind)
            if kind == 'slot' and field(fm, 'scope') not in ('skills', 'repo'):
                fail(d, 'a slot needs scope: skills | repo')
            user_only = '**yes**' if field(fm, 'disable-model-invocation') == 'true' else 'no'
            if kind == 'slot':
                want.append('| slot | `%s` | %s | - | - | - |' % (name, figure))
            elif kind == 'root':
                want.append('| root | `%s` | %s | - | %s | - |' % (name, figure, user_only))
            else:
                want.append('| %s | `%s` | %s | %s | %s | %s |' % (
                    kind, name, figure, 'yes' if kind == 'loop' else 'no', user_only, stop or ''))
        want = '\n'.join(want)
        tbl = re.search(r'^\| Kind \| Stance.*?(?=\n\n)', idx[2], re.S | re.M)
        if not tbl:
            fail('root.index', 'no `| Kind | Stance |` table to project into')
        elif tbl.group(0) != want:
            if do_fix:
                path = os.path.join(HERE, 'root.index', 'SKILL.md')
                io.open(path, 'w', encoding='utf-8', newline='\n').write(idx[2].replace(tbl.group(0), want))
                fixes.append('rewrote the index table from frontmatter')
            else:
                fail('root.index', 'table differs from frontmatter projection; run --fix')

    # 5. only slot.* may name this repo, its tools, or its paths
    for d, (kind, name, text) in sorted(skills.items()):
        if kind == 'slot':
            continue
        body = text[text.index('---', 3) + 3:] if frontmatter(text) else text
        # satellites beside the stance are held to the same purity; a non-md satellite is mechanics by definition
        for sat in glob.glob(os.path.join(HERE, d, '*')):
            if sat.endswith('SKILL.md'):
                continue
            if sat.endswith('.md'):
                s = read(sat)
                if field(frontmatter(s) or '', 'scope') != 'skills':  # set-scoped policy may name tools and models
                    body += '\n' + s
            else:
                body += '\n```code\n'
        hits = sorted(set(m.group(0).strip() for m in REPO_TOKENS.finditer(body)))
        if hits:
            fail(d, 'repo-shaped in a portable stance: %s' % ', '.join(hits))
        fenced = re.findall(r'^```(\w*)', body, re.M)
        code = [f for f in fenced if f and f not in ('mermaid', 'text', '')]
        if code:
            fail(d, 'code fence(s) in a portable stance (%s); mechanics belong in a slot' % ', '.join(sorted(set(code))))

    # 5b. Parlance is dead: aliases live in the Lexicon rows of root.index, nowhere else.
    for d, (kind, name, text) in sorted(skills.items()):
        if re.search(r'^## Parlance', text, re.M):
            fail(d, 'a `## Parlance` section; Parlance is dead, pin aliases in the Lexicon row in root.index')

    # 6. the client mirror is a junction, never a copy that can drift
    mirror = os.path.join(os.path.dirname(os.path.dirname(HERE)), '.claude', 'skills')
    if not os.path.exists(mirror):
        if do_fix:
            subprocess.check_call(['cmd', '/c', 'mklink', '/J', mirror, HERE],
                                  stdout=subprocess.DEVNULL)
            fixes.append('created junction %s -> %s' % (mirror, HERE))
        else:
            fail('mirror', '%s does not exist; run with --fix' % mirror)
    elif not os.path.islink(mirror) and os.path.realpath(mirror) != os.path.realpath(HERE):
        fail('mirror', '%s is a copy, not a junction; it will drift. Delete it and run --fix' % mirror)

    # 7. the user-global skills dir carries nothing; the set has one home
    home = os.path.join(os.path.expanduser('~'), '.claude', 'skills')
    stray = [d for d in (os.listdir(home) if os.path.isdir(home) else [])]
    if stray:
        fail('home', '%s holds %s; the set has one home, delete them' % (home, ', '.join(stray)))

    for f in fixes:
        print('FIXED  ' + f)
    for f in fails:
        print('FAIL   ' + f)
    print('\n%d skills, %d trigger phrases, %d failures' % (len(skills), len(owners), len(fails)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
