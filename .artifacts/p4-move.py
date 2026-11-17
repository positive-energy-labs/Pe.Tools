"""Executed relocation receipt, followed by package/composition and AST rename passes.

This is a checkpoint-specific codemod, not a supported repository tool. The final
mapping records all later rehomes, including the separately committed flatten pass.
"""
from pathlib import Path
import csv,json,re,posixpath,os,subprocess,collections
root=Path(__file__).resolve().parents[1]
assert subprocess.check_output(['git','rev-parse','--short=8','HEAD'],cwd=root,text=True).strip()=='4288034c', 'Use the recorded pre-move checkpoint only'
rows=list(csv.DictReader(open('C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/runs/fans-20261116/plan-check/phase4-manifest.tsv',encoding='utf-8-sig'),delimiter='\t'))
mapping={r['old_path']:r['proposed_path'].replace('workcalc','calc-breakdown') for r in rows if r['product']!='stays generic' and (root/r['old_path']).is_file() and Path(r['old_path']).name not in ['package.json','tsconfig.json','vite.config.ts']}
mapping.update(json.loads((root/'.artifacts/p4-rehomes.json').read_text()))
mapping.update({
 'ts/apps/web/src/fans/route.ts':'ts/products/fans/web/route.ts',
 'ts/apps/web/src/ducts/route.ts':'ts/products/duct-systems/web/route.ts',
 'ts/apps/web/src/fans/link.ts':'ts/products/fans/contract/src/link.ts',
 'ts/apps/web/src/ducts/picture-options.ts':'ts/products/ducts/web/ducts/picture-options.ts',
 **{'ts/packages/agent-contracts/src/'+n+'.ts':'ts/products/'+p+'/contract/src/'+n+'.ts' for n,p in [('duct-calculation','ducts'),('duct-inputs','ducts'),('fan-calc','fans'),('fans-host-reads','fans')]},
 **{'ts/packages/ducts-domain/src/'+n+'.ts':'ts/products/ducts/domain/src/'+n+'.ts' for n in ['input-layers','input-snapshot','encounter-ruling','roster-inputs','stage-issue','no-run-types']},
 'ts/packages/ducts-domain/src/sheet/network-calcs.ts':'ts/products/fans/domain/src/calc/network-calcs.ts',
 'ts/apps/host/src/ducts-action-runtime.ts':'ts/products/ducts/host/src/action-runtime.ts',
 'ts/apps/host/src/fans-actions.ts':'ts/products/fans/host/src/actions.ts',
 'ts/apps/host/src/duct-systems-actions.ts':'ts/products/duct-systems/host/src/actions.ts',
})
# The old mixed file is now only composition and temporary test re-exports; generated composition replaces it.
mapping.pop('ts/apps/host/src/ducts-actions.ts',None)
tracked=subprocess.check_output(['git','ls-files'],cwd=root,text=True).splitlines()
sources={p:(root/p).read_text(encoding='utf-8') for p in tracked if p.endswith(('.ts','.tsx','.json','.mjs','.css')) and (root/p).is_file()}
pkgs={}
for f in (root/'ts').glob('*/*/package.json'):
    data=json.loads(f.read_text(encoding='utf-8'));pkgs[data.get('name')]=(f.parent.relative_to(root).as_posix(),data.get('exports',{}))
def resolve(p,spec):
    name=None
    if spec.startswith('.'):name=posixpath.normpath(posixpath.join(posixpath.dirname(p),spec))
    elif spec.startswith(('#/','@/')):name='ts/apps/web/src/'+spec[2:]
    else:
        for package,(folder,exports) in pkgs.items():
            if package and (spec==package or spec.startswith(package+'/')):
                sub='.' if spec==package else '.'+spec[len(package):]
                entry=exports.get(sub)
                if entry is None and './*' in exports:entry=exports['./*'];subpart=sub[2:]
                else:subpart=''
                if isinstance(entry,dict):entry=entry.get('import',entry.get('types'))
                if isinstance(entry,str):name=posixpath.normpath(folder+'/'+entry.replace('*',subpart))
                elif package=='@pe/ducts-domain':name=folder+'/src/'+sub[2:]+'.ts'
                break
    if name is None:return None
    return next((x for x in [name,name+'.ts',name+'.tsx',name+'.json',name+'/index.ts'] if x in sources or x in mapping or (root/x).is_file()),None)
def package_for(p):
    parts=p.split('/')
    return ('@pe/'+parts[2]+'-'+parts[3],'/'.join(parts[:4])) if p.startswith('ts/products/') else (None,None)
def spec_for(source,target):
    new=mapping.get(target,target);owner,folder=package_for(new)
    own,_=package_for(source)
    if owner and owner!=own:
        key=new[len(folder)+1:];key=key[4:] if key.startswith('src/') else key
        key=re.sub(r'\.tsx?$','',key)
        return owner+'/'+key
    value=posixpath.relpath(new,posixpath.dirname(source))
    return value if value.startswith('.') else './'+value
renames={}
for r in rows:
    for pair in r['symbol_renames'].split(';'):
        if ' -> ' in pair:
            a,b=pair.strip().split(' -> ');renames[a]=b.replace('Workcalc','CalcBreakdown').replace('workcalc','calcBreakdown')
for name in ['sheet','sheets','SheetSlot','sheetSnapshot']:renames.pop(name,None)
renames.update({'SHEET_ENGINE_VERSION':'CALC_ENGINE_VERSION','SHEET_GROUP':'CALC_GROUP','EMPTY_SHEET_STATE':'EMPTY_CALC_STATE','DomainSheet':'DomainCalc','WireSheet':'WireCalc','Worksheet':'CalcBreakdown','worksheet':'calcBreakdown'})
token=re.compile(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`|//[^\n]*|/\*[\s\S]*?\*/)|\b[A-Za-z_$][\w$]*\b')
def rename_code(s):
    return token.sub(lambda m:m.group(0) if m.group(1) else renames.get(m.group(0),m.group(0)),s)
string=re.compile(r'(["\'])([^"\'\n]+)\1')
for old,s in sources.items():
    new=mapping.get(old,old)
    if old.endswith(('.ts','.tsx','.mjs')):
        def rewrite(m):
            target=resolve(old,m.group(2))
            if target and (old!=new or target in mapping):return m.group(1)+spec_for(new,target)+m.group(1)
            return m.group(0)
        s=string.sub(rewrite,s)
        s=rename_code(s)
        if old in ['ts/apps/web/src/fans/route.ts','ts/apps/web/src/ducts/route.ts']:
            product='fans' if '/fans/' in old else 'duct-systems'
            branch='fans' if product=='fans' else 'ducts'
            s=s.replace('host: "./host.ts"','host: "./../host/'+branch+'/host.ts"')
    dest=root/new
    if s!=sources[old] or old!=new:
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(s,encoding='utf-8',newline='\n')
# Assets not held in the textual source map keep their bytes exactly.
for old,new in mapping.items():
    if old not in sources and (root/old).is_file():
        dest=root/new;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((root/old).read_bytes())
    if old!=new and (root/old).is_file():(root/old).unlink()
# Each package exports its concrete public source modules, never a wildcard filesystem door.
for product in ['ducts','fans','duct-systems']:
  for runtime in ['contract','domain','host','web']:
    folder=root/'ts/products'/product/runtime;folder.mkdir(parents=True,exist_ok=True)
    exports={}
    for f in folder.rglob('*'):
      if not f.is_file() or not f.name.endswith(('.ts','.tsx','.json','.css')) or '.test' in f.name or f.name in ['tsconfig.json','package.json','vite.config.ts']:continue
      key=f.relative_to(folder).as_posix();key=key[4:] if key.startswith('src/') else key
      key=re.sub(r'\.tsx?$','',key);exports['./'+key]='./'+f.relative_to(folder).as_posix()
    name='@pe/'+product+'-'+runtime
    data={'name':name,'version':'0.0.0','private':True,'type':'module','exports':exports,'scripts':{'check':'vp exec tsc --noEmit','test':'vp test'},'dependencies':{},'devDependencies':{'@types/node':'^25.6.2','typescript':'^6.0.3','vite-plus':'catalog:'}}
    # Derive exact dependencies from imports after every package has been written below.
    (folder/'package.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    if runtime=='domain':config=json.loads((root/'ts/packages/ducts-domain/tsconfig.json').read_text().replace('// tsc reuses its last check; the build info lives under ignored node_modules.',''))
    else:
      config={'extends':os.path.relpath(root/('ts/apps/web/tsconfig.json' if runtime=='web' else 'ts/apps/host/tsconfig.json'),folder).replace('\\','/'),'include':['**/*.ts','**/*.tsx'],'exclude':['node_modules']}
    (folder/'tsconfig.json').write_text(json.dumps(config,indent=2)+'\n',encoding='utf-8')
    prefix='../../../tests/isolated-home/'
    setup=['"'+prefix+'setup.ts"']
    if runtime=='web':setup+=['"../../../apps/web/src/test-setup.ts"']
    test='import { defineConfig } from "vite-plus";\nexport default defineConfig({ test: { globalSetup: ["'+prefix+'global-setup.ts"], setupFiles: ['+', '.join(setup)+'], env: { PE_LANE: "dev" }, testTimeout: 15000 } });\n'
    if runtime in ['host','web']:
        global_setup=['"'+prefix+'global-setup.ts"']
        if runtime=='host':global_setup+=['"../../../apps/host/tests/build-kit.global-setup.ts"']
        test='import base from "../../../apps/'+runtime+'/vite.config.ts";\nimport { defineConfig, mergeConfig } from "vite-plus";\nexport default defineConfig(async env => mergeConfig(await (typeof base === "function" ? base(env) : base), { test: { globalSetup: ['+', '.join(global_setup)+'], setupFiles: ['+', '.join(setup)+'] } }));\n'
    (folder/'vite.config.ts').write_text(test,encoding='utf-8')
all_packages={}
for f in [*(root/'ts').glob('*/*/package.json'),*(root/'ts/products').glob('*/*/package.json')]:
    j=json.loads(f.read_text(encoding='utf-8'));all_packages[j['name']]=(f,j)
versions={}
for f,j in all_packages.values():versions.update(j.get('dependencies',{}));versions.update(j.get('devDependencies',{}))
for name,(f,j) in all_packages.items():
    used=set()
    files=[x for x in sources if x.startswith(f.parent.relative_to(root).as_posix()+'/')] if '/products/' not in f.as_posix() else [x.relative_to(root).as_posix() for x in f.parent.rglob('*.ts*') if x.is_file()]
    for p in files:
      if not (root/p).is_file():continue
      for spec in re.findall(r'(?:from\s*|import\s*\()["\']([^"\']+)',(root/p).read_text(encoding='utf-8')):
        if spec.startswith(('.', '#','node:','@/')):continue
        dep='/'.join(spec.split('/')[:2]) if spec.startswith('@') else spec.split('/')[0]
        if dep!=name:used.add(dep)
    deps=j.setdefault('dependencies',{})
    for dep in sorted(used):
      if dep not in deps and dep not in j.get('devDependencies',{}):
        if dep in all_packages:deps[dep]='workspace:*'
        elif dep in versions:deps[dep]=versions[dep]
    if name=='pe-tools':j['workspaces']['packages'].append('products/*/*')
    f.write_text(json.dumps(j,indent=2)+'\n',encoding='utf-8')
j=json.loads((root/'ts/package.json').read_text());j['workspaces']['packages'].append('products/*/*');(root/'ts/package.json').write_text(json.dumps(j,indent=2)+'\n',encoding='utf-8')
(root/'.artifacts/p4-final-mapping.json').write_text(json.dumps(mapping,indent=2)+'\n',encoding='utf-8')
print('relocated',len(mapping),'files')
