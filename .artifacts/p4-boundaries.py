from pathlib import Path
import json,re,posixpath,os
root=Path(__file__).resolve().parents[1]
packages={}
for f in (root/'ts/products').glob('*/*/package.json'):
 j=json.loads(f.read_text());packages[j['name']]=(f.parent.relative_to(root).as_posix(),j['exports'])
def owner(p):
 parts=p.split('/');return (parts[2],parts[3]) if p.startswith('ts/products/') else None
bad=[];count=0;paths=[]
for folder,dirs,files in os.walk(root/'ts/products'):
 dirs[:]=[d for d in dirs if d!='node_modules']
 for filename in files:
  p=(Path(folder)/filename).relative_to(root).as_posix()
  if 'sheet' in p.lower() or '/proto/' in p:paths.append(p)
  if not p.endswith(('.ts','.tsx')) or any(x in p for x in ['.test.','test-support','fixture','/tests/','/test-','vite.config']):continue
  a,l=owner(p)
  for spec in re.findall(r'(?:from\s*|import\s*\()["\']([^"\']+)',(root/p).read_text(encoding='utf-8')):
   target=None
   if spec.startswith('.'):target=posixpath.normpath(posixpath.join(posixpath.dirname(p),spec))
   else:
    for package,(base,exports) in packages.items():
     if spec.startswith(package+'/'):
      entry=exports.get('.'+spec[len(package):]);target=posixpath.normpath(base+'/'+entry) if entry else None;break
   if not target or not owner(target):continue
   count+=1;b,k=owner(target)
   illegal=(l=='domain' and k in ['web','host']) or (l=='contract' and k!='contract') or (l=='host' and k=='web')
   illegal |= a!=b and k!='contract' and (b!='ducts' or not (k==l or k=='domain' and l in ['web','host']))
   if illegal:bad.append((p,spec,target))
print('production product edges:',count,'boundary violations:',len(bad),'forbidden paths:',len(paths))
for row in bad:print(' -> '.join(row))
for p in paths:print('PATH',p)
(root/'.artifacts/p4-boundaries.json').write_text(json.dumps({'edges':count,'violations':bad,'forbidden_paths':paths},indent=2)+'\n')
