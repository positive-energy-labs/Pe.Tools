"""Draw whether a run converges: proof stamps per cycle report against merges per hour and owner messages.

    python cadence.py <run-dir> [--map <map>] [--root <thread>] [--branch <b>] [--base <sha>] [--out <file>]

Proof counts come from the run's `cycle/*.md`, so only a run that writes cycle reports gets this chart; when
the row table has `## Test rows` and `## Journey rows` headings, each kind gets its own PROVEN line. Merges are
the first-parent merges of the integration branch; waves (from the map's `Wave:` lines) are drawn as bands from
their first merge to their last. `--root` adds the owner's messages from T3. A drop of three or more PROVEN rows
between two reports is marked as voided, because proof earned and then lost is what the chart exists to show.
Writes `cadence.html` in the run directory: self-contained, on T3 theme variables with light fallbacks.
"""
import argparse
import collections
import datetime as dt
import json
from pathlib import Path
import re
import sqlite3
import sys

from cycle import DB, STAMPS, git, merged_name

VOID_DROP = 3  # ponytail: a smaller drop is usually one re-stamp, not a void; tune on more runs


def parse_cycle(text):
    """One report: its time, tip, total stamps and stamps per row kind."""
    when = re.search(r'^UTC: (\S+ \S+)', text, re.M)
    rows = text.split('## Rows', 1)[1].split('\n## ', 1)[0] if '## Rows' in text else ''
    counts = lambda line: {s: int(n) for s, n in re.findall(r'(%s) (\d+)' % '|'.join(STAMPS), line)}
    total = next((counts(l) for l in rows.splitlines() if l.strip() and not l.startswith('-')), {})
    kinds = {k: counts(l) for k, l in re.findall(r'^- (\w+) rows: (.+)$', rows, re.M)}
    tip = re.search(r'^Tip: `(\w{8})', text, re.M)
    return dict(n=int(re.search(r'# Cycle (\d+)', text)[1]), t=when[1].replace(' ', 'T')[:16] if when else None,
                tip=tip[1] if tip else '', total=total, kinds=kinds)


def voids(cycles, key=lambda c: c['total'].get('PROVEN', 0)):
    """Where PROVEN fell by VOID_DROP or more from the report before."""
    return [dict(t=b['t'], value=key(b), drop=key(a) - key(b))
            for a, b in zip(cycles, cycles[1:]) if key(a) - key(b) >= VOID_DROP]


def wave_bands(map_text, merges):
    """(wave, first merge, last merge) for each `Wave: <n>` whose words name a merged branch."""
    times = collections.defaultdict(list)
    for n, rest in re.findall(r'^\W*Wave:\s*(\S+)[ \t]+(.+)$', map_text, re.M):
        words = re.findall(r'[\w.-]+(?:/[\w./-]+)?', re.split(r'blockers?:', rest, flags=re.I)[0])
        times[n] += [t for t, subject in merges if any(merged_name(w, subject) for w in words)]
    return [(n, min(ts), max(ts)) for n, ts in times.items() if ts]


def owner_messages(root):
    with sqlite3.connect(DB.as_uri() + '?mode=ro', uri=True) as db:
        rows = db.execute("select created_at, payload_json from orchestration_v2_projection_messages "
                          "where thread_id=? and role='user'", (root,)).fetchall()
    return sorted(c[:16] for c, p in rows if json.loads(p or '{}').get('creationSource') == 'web')


def utc(iso):
    return dt.datetime.fromisoformat(iso).astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('run_dir', type=Path)
    parser.add_argument('--map', type=Path)
    parser.add_argument('--root')
    parser.add_argument('--branch')
    parser.add_argument('--base')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args(argv)
    texts = [p.read_text(encoding='utf-8') for p in (args.run_dir / 'cycle').glob('*.md')]
    if not texts:
        sys.exit('no cycle reports in %s: the chart needs a run that writes them' % args.run_dir)
    cycles = sorted((parse_cycle(t) for t in texts), key=lambda c: c['n'])
    first = min(texts, key=lambda t: parse_cycle(t)['n'])
    branch = args.branch or re.search(r'^Branch: (\S+)', texts[0], re.M)[1]
    base_file = args.run_dir / 'base.sha'
    base = args.base or (base_file.read_text(encoding='utf-8').strip() if base_file.exists()
                         else re.search(r'^Previous tip: (\w+)', first, re.M)[1])
    log = git('log', '--first-parent', '--merges', '--format=%cI|%s', '%s..%s' % (base, branch))
    merges = [(utc(t), s) for t, s in (l.split('|', 1) for l in log.splitlines() if l)]
    bands = wave_bands(args.map.read_text(encoding='utf-8'), merges) if args.map else []
    data = dict(cycles=cycles, voids=voids(cycles), merges=[t for t, _ in merges], bands=bands,
                owner=owner_messages(args.root) if args.root else [], branch=branch)
    out = args.out or args.run_dir / 'cadence.html'
    out.write_text(PAGE.replace('__DATA__', json.dumps(data)), encoding='utf-8')
    print(out)


PAGE = r'''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Run Cadence</title>
<style>
:root{--ink:var(--foreground,#0b0b0b);--ink2:var(--muted-foreground,#52514e);--grid:var(--border,#e6e5e1);--band:var(--foreground,#000);--proven:var(--success,#008300);--fals:var(--destructive,#e34948);--total:var(--muted-foreground,#52514e);--merge:var(--chart-1,#2a78d6);--owner:var(--chart-4,#6250d6);--paper:var(--background,#fcfcfb)}
body{margin:0;font-size:14px;line-height:1.45;color:var(--ink)}
p{color:var(--ink2);margin:0 0 8px}
.legend{display:flex;flex-wrap:wrap;gap:14px;color:var(--ink2);font-size:13px;margin:4px 0}
.legend i{display:inline-block;width:14px;height:0;border-top:3px solid;vertical-align:middle;margin-right:6px}
svg{width:100%;height:auto;display:block} svg text{fill:var(--ink2);font-size:15px}
.tip{position:fixed;pointer-events:none;background:var(--paper);border:1px solid var(--grid);border-radius:6px;padding:6px 8px;font-size:12px;display:none;max-width:280px}
details{margin-top:12px;color:var(--ink2)} table{border-collapse:collapse;font-size:12px} td,th{padding:2px 8px;text-align:right;border-bottom:1px solid var(--grid)}
</style></head><body>
<p id="lede"></p>
<div class="legend" id="legend"></div>
<svg id="c" viewBox="0 0 1060 560" role="img" aria-label="Proof stamps over time with merges per hour"></svg>
<div class="tip" id="tip"></div>
<details><summary>Table view</summary><table id="tbl"><tr><th>cycle</th><th>UTC</th><th>tip</th><th>PROVEN</th><th>FALSIFIED</th><th>UNPROVEN</th></tr></table></details>
<script>
const D=__DATA__,NS='http://www.w3.org/2000/svg',svg=document.getElementById('c'),tip=document.getElementById('tip');
const t=s=>Date.parse(s+'Z'),C=D.cycles.filter(c=>c.t),H=3600e3;
const all=[...C.map(c=>t(c.t)),...D.merges.map(t),...D.owner.map(t)];
const t0=Math.floor(Math.min(...all)/H)*H,t1=Math.ceil(Math.max(...all)/H)*H+H,end=Math.max(...C.map(c=>t(c.t)));
const L=56,R=950,W=R-L,x=v=>L+(v-t0)/(t1-t0)*W;
const sum=o=>Object.values(o).reduce((a,b)=>a+b,0),rows=Math.max(...C.map(c=>sum(c.total)),1);
const TP={y0:40,y1:330,max:rows%8?Math.ceil(rows/8)*8:rows+4},bins={};D.merges.forEach(m=>{const h=Math.floor(t(m)/H);bins[h]=(bins[h]||0)+1});
const BT={y0:400,y1:520,max:Math.max(4,Math.ceil(Math.max(0,...Object.values(bins))/4)*4)};
const yT=v=>TP.y1-v/TP.max*(TP.y1-TP.y0),yB=v=>BT.y1-v/BT.max*(BT.y1-BT.y0);
const el=(n,a)=>{const e=document.createElementNS(NS,n);for(const k in a)e.setAttribute(k,a[k]);svg.appendChild(e);return e};
const txt=(s,a)=>{const e=el('text',a);e.textContent=s;return e};
const last=C[C.length-1],kinds=Object.keys(last.kinds||{});
document.getElementById('lede').textContent=`Proof stamps from ${C.length} cycle reports, merges on ${D.branch}${D.owner.length?', and the owner\'s messages':''}. UTC. Latest: PROVEN ${last.total.PROVEN||0} of ${sum(last.total)}.`;
const legend=[['PROVEN','var(--proven)','solid'],...kinds.map((k,i)=>[`PROVEN, ${k} rows`,'var(--proven)',i?'dotted':'dashed']),['FALSIFIED','var(--fals)','solid'],['rows declared','var(--total)','dashed'],['merges per hour','var(--merge)','solid'],...(D.owner.length?[['owner message','var(--owner)','solid']]:[])];
document.getElementById('legend').innerHTML=legend.map(([n,c,s])=>`<span><i style="border-top:3px ${s} ${c}"></i>${n}</span>`).join('');
// waves as bands, then the tail
// a wave runs from the end of the one before (the run's first report for the first) to its last merge;
// ponytail: overlapping waves draw as a sequence, give each its own row if a run overlaps them often
const bands=[...D.bands].sort((p,q)=>t(p[2])-t(q[2])).map(([n,a,b],i,s)=>['Wave '+n,i?t(s[i-1][2]):Math.min(t(a),t(C[0].t)),t(b)]);
if(bands.length){const e=Math.max(...bands.map(b=>b[2]));if(end>e)bands.push(['Tail',e,end])}
bands.forEach(([n,a,b],i)=>{if(i%2==0)el('rect',{x:x(a),y:TP.y0-14,width:Math.max(x(b)-x(a),2),height:BT.y1-TP.y0+14,fill:'var(--band)','fill-opacity':.06});
 txt(n,{x:(x(a)+x(b))/2,y:TP.y0-2-(i%2)*14,'text-anchor':'middle',style:'fill:var(--ink);font-weight:600'})});
const step=TP.max>24?8:4;
for(let v=0;v<=TP.max;v+=step){el('line',{x1:L,x2:R,y1:yT(v),y2:yT(v),stroke:'var(--grid)'});txt(v,{x:L-8,y:yT(v)+4,'text-anchor':'end'})}
for(let v=0;v<=BT.max;v+=BT.max/4){el('line',{x1:L,x2:R,y1:yB(v),y2:yB(v),stroke:'var(--grid)'});txt(v,{x:L-8,y:yB(v)+4,'text-anchor':'end'})}
txt('proof rows',{x:L,y:TP.y0-30,style:'fill:var(--ink);font-weight:600'});txt('merges per hour',{x:L,y:BT.y0-12,style:'fill:var(--ink);font-weight:600'});
const every=(t1-t0)/H>30?4:2;let lastDay='';
for(let h=t0;h<=t1;h+=H){const d=new Date(h);if(d.getUTCHours()%every)continue;el('line',{x1:x(h),x2:x(h),y1:BT.y1,y2:BT.y1+5,stroke:'var(--ink2)'});
 txt(String(d.getUTCHours()).padStart(2,'0')+':00',{x:x(h),y:BT.y1+18,'text-anchor':'middle'});const day=d.toISOString().slice(5,10);if(day!=lastDay){txt(day,{x:x(h),y:BT.y1+34,'text-anchor':'middle'});lastDay=day}}
const path=(f,y)=>C.map((c,i)=>(i?`H${x(t(c.t))}V${y(f(c))}`:`M${x(t(c.t))},${y(f(c))}`)).join('')+`H${x(end)}`;
el('path',{d:path(c=>sum(c.total),yT),fill:'none',stroke:'var(--total)','stroke-width':1.5,'stroke-dasharray':'5 4'});
el('path',{d:path(c=>c.total.FALSIFIED||0,yT),fill:'none',stroke:'var(--fals)','stroke-width':2});
kinds.forEach((k,i)=>el('path',{d:path(c=>(c.kinds[k]||{}).PROVEN||0,yT),fill:'none',stroke:'var(--proven)','stroke-width':2,'stroke-dasharray':i?'2 3':'7 4'}));
el('path',{d:path(c=>c.total.PROVEN||0,yT),fill:'none',stroke:'var(--proven)','stroke-width':2.5});
txt('PROVEN '+(last.total.PROVEN||0),{x:x(end)+6,y:yT(last.total.PROVEN||0)+5,style:'fill:var(--ink)'});
txt('FALSIFIED '+(last.total.FALSIFIED||0),{x:x(end)+6,y:yT(last.total.FALSIFIED||0)-8,style:'fill:var(--ink)'});
const peak=C.reduce((a,c)=>(c.total.PROVEN||0)>(a.total.PROVEN||0)?c:a,C[0]);
[...D.voids.map(v=>[v.t,v.value,`${v.drop} voided`]),...(peak.total.PROVEN?[[peak.t,peak.total.PROVEN,'peak '+peak.total.PROVEN]]:[])].forEach(([s,v,l],i)=>{
 const X=x(t(s)),Y=yT(v);el('circle',{cx:X,cy:Y,r:4,fill:'var(--paper)',stroke:'var(--ink)','stroke-width':1.5});txt(l,{x:X+6,y:Y-10-(i%2)*14,style:'fill:var(--ink)'})});
const bw=W/((t1-t0)/H)-2;
Object.entries(bins).forEach(([h,n])=>{const r=el('rect',{x:x(h*H)+1,y:yB(n),width:bw,height:BT.y1-yB(n),fill:'var(--merge)',rx:2});r.dataset.tip=`${new Date(h*H).toISOString().slice(5,16).replace('T',' ')} UTC: ${n} merges`});
if(D.owner.length)txt('owner',{x:L-8,y:TP.y1+32,'text-anchor':'end'});
D.owner.forEach(o=>{const c=el('circle',{cx:x(t(o)),cy:TP.y1+28,r:4.5,fill:'var(--owner)'});c.dataset.tip=`owner message ${o.replace('T',' ')} UTC`});
C.forEach(c=>{const X=x(t(c.t)),r=el('rect',{x:X-6,y:TP.y0,width:12,height:TP.y1-TP.y0,fill:'transparent'});
 r.dataset.tip=`cycle ${c.n} · ${c.t.replace('T',' ')} UTC · ${c.tip}<br>`+STAMPS.map(s=>`${s} ${c.total[s]||0}`).join(' · ')+Object.entries(c.kinds||{}).map(([k,v])=>`<br>${k}: PROVEN ${v.PROVEN||0} of ${sum(v)}`).join('');
 const row=document.getElementById('tbl').insertRow();[c.n,c.t.replace('T',' '),c.tip,...STAMPS.map(s=>c.total[s]||0)].forEach(v=>row.insertCell().textContent=v)});
svg.addEventListener('pointermove',e=>{const s=e.target.dataset&&e.target.dataset.tip;if(!s){tip.style.display='none';return}tip.innerHTML=s;tip.style.display='block';tip.style.left=Math.min(e.clientX+12,innerWidth-290)+'px';tip.style.top=(e.clientY+12)+'px'});
svg.addEventListener('pointerleave',()=>tip.style.display='none');
</script></body></html>'''.replace('STAMPS', json.dumps(list(STAMPS)))

if __name__ == '__main__':
    main()
