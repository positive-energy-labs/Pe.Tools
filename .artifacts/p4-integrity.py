from pathlib import Path
import subprocess,json,re,hashlib
root=Path(__file__).resolve().parents[1]
mapping=json.loads((root/'.artifacts/p4-final-mapping.json').read_text())
hashes=[]
for old,new in mapping.items():
    if '/native-recordings/' not in old or not old.endswith('.json'):continue
    before=subprocess.check_output(['git','show','1999f3fa:'+old],cwd=root)
    after=(root/new).read_bytes()
    # Git may store LF while the worktree uses CRLF; hash the tracked blob at both ends.
    staged=subprocess.check_output(['git','show','HEAD:'+new],cwd=root)
    assert before==staged,new
    hashes.append({'old':old,'new':new,'sha256':hashlib.sha256(staged).hexdigest()})
old='ts/packages/mcps/src/pea/ducts-skill.ts';new='ts/products/fans/contract/src/pea/ducts-skill.ts'
before=subprocess.check_output(['git','show','1999f3fa:'+old],cwd=root,text=True)
after=(root/new).read_text()
literal=re.compile(r'`(?:\\.|[^`\\])*`',re.S)
assert literal.findall(before)==literal.findall(after),'guide template changed'
print('byte-identical recorded JSON:',len(hashes),'unchanged guide template strings:',len(literal.findall(after)))
result={'native_recording_blobs':hashes,'guide_templates_equal':True,'guide_path':new}
(root/'.artifacts/p4-integrity.json').write_text(json.dumps(result,indent=2)+'\n')
