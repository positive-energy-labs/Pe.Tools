"""Final mechanical source flattening; run from the P4 move checkpoint, once."""
from pathlib import Path
import json, re, posixpath, subprocess, os
root=Path(__file__).resolve().parents[1]
assert subprocess.check_output(['git','rev-parse','--short=8','HEAD'],cwd=root,text=True).strip()=='531f66ce', 'Use the recorded pre-flatten checkpoint only'
tracked=subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()
mapping={}
for p in tracked:
    if not p.startswith('ts/products/'): continue
    parts=p.split('/'); tail=parts[4:]
    if len(tail)==1 and tail[0] in ['package.json','tsconfig.json','vite.config.ts','route.ts']:continue
    if tail[0] in ['src','ducts','fans']:tail=tail[1:]
    new='/'.join(parts[:4]+['src']+tail)
    if p!=new:mapping[p]=new
for name in ['fans-plan-composition.test.tsx','fans-plan-composition.test-support.tsx','fans-oob-work.journey.test.tsx']:
    mapping['ts/apps/web/src/shell/'+name]='ts/products/fans/web/src/'+name
destinations={}
for old,new in mapping.items():
    if new in destinations or (root/new).exists():raise Exception('collision '+new)
    destinations[new]=old
packages={}
aliases={}
for p in tracked:
    if p.startswith('ts/products/') and p.endswith('/package.json'):
        data=json.loads((root/p).read_text()); folder=posixpath.dirname(p)
        packages[folder]=data
        for key,value in data['exports'].items():
            old=posixpath.normpath(folder+'/'+value)
            new=mapping.get(old,old)
            sub=new[len(folder)+1:]
            if sub.startswith('src/'):sub=sub[4:]
            sub=re.sub(r'\.tsx?$','',sub)
            aliases[data['name']+'/'+key[2:]]=data['name']+'/'+sub
def relative(source,target):
    value=posixpath.relpath(target,posixpath.dirname(source))
    return value if value.startswith('.') else './'+value
def rewrite_spec(old,new,spec):
    if spec in aliases:return aliases[spec]
    if not spec.startswith('.'):return spec
    target=posixpath.normpath(posixpath.join(posixpath.dirname(old),spec))
    resolved=next((x for x in [target,target+'.ts',target+'.tsx',target+'.json',target+'/index.ts'] if (root/x).is_file()),None)
    if resolved:
        if old!=new or resolved in mapping:
            value=relative(new,mapping.get(resolved,resolved))
            if not spec.endswith(('.ts','.tsx','.json','.css')):value=re.sub(r'\.tsx?$','',value)
            return value
    elif old!=new and ((root/target).is_dir() or spec.endswith('/')):
        # File-relative fixture roots and source census roots are not module imports.
        candidate=next((posixpath.dirname(mapping[p]) for p in mapping if posixpath.dirname(p)==target.rstrip('/')),target)
        value=relative(new,candidate)
        return value+'/' if spec.endswith('/') and not value.endswith('/') else value
    return spec
string=re.compile(r'(["\'])([^"\'\n]+)\1')
for old in tracked:
    path=root/old
    if not path.is_file():continue
    new=mapping.get(old,old)
    if old.endswith(('.ts','.tsx','.mjs','.json')):
        source=path.read_text(encoding='utf-8')
        if not old.endswith('.json'):
            source=string.sub(lambda m:m[1]+rewrite_spec(old,new,m[2])+m[1],source)
        if old=='ts/apps/host/tests/native-recordings.ts':source=source.replace('host/tests/native-recordings','host/src/tests/native-recordings')
        if old.endswith('/vite.config.ts') and old.startswith('ts/products/'):
            source=re.sub(r'new URL\("\./(?:ducts|fans|tests)/\*\*/\*\.test\.\{ts,tsx\}"', 'new URL("./src/**/*.test.{ts,tsx}"',source)
        dest=root/new;dest.parent.mkdir(parents=True,exist_ok=True)
        if new!=old or source!=path.read_text(encoding='utf-8'):dest.write_text(source,encoding='utf-8',newline='\n')
    elif new!=old:
        dest=root/new;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(path.read_bytes())
for old,new in mapping.items():(root/old).unlink()
for folder,data in packages.items():
    data['exports']={aliases[data['name']+'/'+k[2:]][len(data['name'])+1:]:v for k,v in data['exports'].items()}
    data['exports']={'./'+k:'./'+mapping.get(posixpath.normpath(folder+'/'+v),posixpath.normpath(folder+'/'+v))[len(folder)+1:] for k,v in data['exports'].items()}
    (root/folder/'package.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
prior=json.loads((root/'.artifacts/p4-final-mapping.json').read_text())
prior={old:mapping.get(new,new) for old,new in prior.items()}
for old,new in mapping.items():
    if old not in prior.values() and old.startswith('ts/apps/'):prior[old]=new
(root/'.artifacts/p4-final-mapping.json').write_text(json.dumps(prior,indent=2)+'\n',encoding='utf-8')
(root/'.artifacts/p4-flatten-mapping.json').write_text(json.dumps(mapping,indent=2)+'\n',encoding='utf-8')
print('flattened',len(mapping),'files; rewritten',len(aliases),'export paths')
