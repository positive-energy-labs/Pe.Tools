from pathlib import Path
import os, subprocess, json, re, sys
sys.stdout.reconfigure(encoding='utf-8')
root=Path(__file__).resolve().parents[1]
packages=['products/fans/host','products/fans/web','products/duct-systems/web','products/ducts/web','products/ducts/host','products/duct-systems/host','products/ducts/contract','products/fans/contract','products/ducts/domain','products/duct-systems/domain','products/fans/domain']
results={}
for package in packages:
    files=[]
    for folder,dirs,names in os.walk(root/'ts'/package/'src'):
        dirs[:]=[d for d in dirs if d!='node_modules']
        files.extend((Path(folder)/n).as_posix() for n in names if re.search(r'\.test\.tsx?$',n))
    log=root/'.artifacts'/('final-'+package.replace('/','-')+'.log')
    with log.open('w',encoding='utf-8') as out:
        run=subprocess.run(['C:/Users/kaitp/.vite-plus/bin/vp.exe','test','run',*files],cwd=root/'ts'/package,stdout=out,stderr=subprocess.STDOUT)
    summary=[line.strip() for line in log.read_text(encoding='utf-8').splitlines() if re.match(r'^\s*(Test Files|Tests|Duration)\s',line)]
    results[package]={'exit':run.returncode,'files_selected':len(files),'summary':summary}
    (root/'.artifacts/p4-final-tests.json').write_text(json.dumps(results,indent=2)+'\n')
    print(package,run.returncode,'; '.join(summary),flush=True)
