"""Structural-delta sensor (index rule 5 landing block). Generated LOC prints on its own column and is excluded from every headline. Counts per ref: LOC by kind and dir, contracts and their properties,
string-literal state unions, boolean fields, routes and per-route LOC, kernel LOC, old-kernel import count."""
import subprocess,re,collections,sys,json
def git(*a): return subprocess.run(["git",*a],capture_output=True,text=True,encoding="utf-8",errors="replace").stdout
def blobs(ref,paths):
    """(path, source) for every ts/tsx/cs file under paths at ref: one ls-tree, one cat-file --batch."""
    rows=[l.split(None,3) for l in git("ls-tree","-r",ref,*paths).splitlines()]
    want=[(sha,path) for _,_,sha,path in rows if re.search(r"\.(ts|tsx|cs)$",path)]
    out=subprocess.run(["git","cat-file","--batch"],input="".join(sha+"\n" for sha,_ in want).encode(),capture_output=True).stdout
    i=0
    for sha,path in want:
        nl=out.index(b"\n",i); size=int(out[i:nl].split()[2]); i=nl+1
        yield path,out[i:i+size].decode("utf-8","replace"); i+=size+1
def kind(f):
    if re.search(r"generated|\.generated\.",f): return "generated"
    if re.search(r"\.(test|spec)\.|/tests?/|Tests?/|repo-guards|e2e/",f): return "test"
    if "/proto/" in f or f.startswith("examples/") or f.startswith("tools/"): return "proto/tools"
    return "source"
def census(ref):
    out=dict(ref=ref,consumer=0,loc=collections.Counter(),dirs=collections.Counter(),contracts=0,props=0,unions=0,union_states=0,bools=0,routes={},kernel=0,oldkernel=0)
    for f,src in blobs(ref,["ts/apps","ts/packages","dotnet"]):
        n=src.count("\n"); k=kind(f); out["loc"][k]+=n
        p=f.split("/"); out["dirs"]["/".join(p[:3])+("" if k=="source" else f" [{k}]")]+=n
        if k!="source": continue
        if f.endswith((".ts",".tsx")):
            s=len(re.findall(r"Schema\.(Struct|Class|TaggedStruct|TaggedClass|Union)\b|z\.object\(",src)); out["contracts"]+=s
            if s: out["props"]+=len(re.findall(r"^\s+\w+\??:\s*(Schema\.|S\.|z\.)",src,re.M))
            for m in re.finditer(r"(?:type|export type)\s+\w+\s*=\s*((?:\s*\|?\s*\"[\w-]+\")+)\s*;?",src):
                st=m.group(1).count('"')//2
                if st>=2: out["unions"]+=1; out["union_states"]+=st
            out["bools"]+=len(re.findall(r"^\s+\w+\??:\s*boolean\b",src,re.M))
            if re.search(r"ts/apps/web/src/routes/",f):
                r=f.split("ts/apps/web/src/routes/")[1].split("/")[0].split(".")[0]; out["routes"][r]=out["routes"].get(r,0)+n
            if re.search(r"ts/apps/web/src/(route|kernel|shell)/",f): out["kernel"]+=n
            # consumer lines: what a route still hand-writes (ADR 0026 declaration + wiring files). ponytail: name-based; a renamed wiring file escapes it
            if re.search(r"ts/apps/web/src/[^/]+/(graph|manifest|route|sources|actions|store|context)\.tsx?$",f) and not re.search(r"/(route|shell|kernel)/",f): out["consumer"]+=n
            out["oldkernel"]+=len(re.findall(r"entityRoute\b|EntityRouteView\b",src))
    return out
refs=sys.argv[1:] or ["2fa00104","main","t3/unification-2"]
C=[census(r) for r in refs]
print("ref | source | test | test/source | proto/tools | contracts | props | unions | states | bool fields | kernel LOC | consumer lines | route files LOC (n routes) | old-kernel refs")
for c in C:
    rl=sum(c["routes"].values()); print(c["ref"][:14],c["loc"]["source"],c["loc"]["test"],f'{c["loc"]["test"]/max(1,c["loc"]["source"]):.0%}',c["loc"]["proto/tools"],c["contracts"],c["props"],c["unions"],c["union_states"],c["bools"],c["kernel"],c["consumer"],f"{rl} ({len(c['routes'])})",c["oldkernel"],sep=" | ")
print("\nper-route LOC (web/src/routes/<route>):")
names=sorted(set(k for c in C for k in c["routes"]))
print("route | "+" | ".join(c["ref"][:12] for c in C))
for n in names: print(n," | ".join(str(c["routes"].get(n,0)) for c in C),sep=" | ")
print("\nsource LOC by dir, delta first->last (top movers):")
d0,d1=C[0]["dirs"],C[-1]["dirs"]
for k in sorted(set(d0)|set(d1),key=lambda k:-abs(d1.get(k,0)-d0.get(k,0)))[:25]: print(f"  {k}: {d0.get(k,0)} -> {d1.get(k,0)} ({d1.get(k,0)-d0.get(k,0):+d})")
json.dump([{k:(dict(v) if isinstance(v,collections.Counter) else v) for k,v in c.items()} for c in C],open(".artifacts/tmp/structural-delta.json","w"),indent=1)
