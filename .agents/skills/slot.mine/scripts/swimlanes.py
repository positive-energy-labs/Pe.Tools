"""Swimlanes: draws <run-dir>/retro.json (every run of the named root threads and all their descendant threads, with waits, cross-thread messages, activity, cache and model events, and the gate-tail landmark) as <run-dir>/swimlanes.html.

python .agents/skills/slot.mine/scripts/swimlanes.py <run-dir>

This page computes nothing: it reads retro.json, written by `retro.py --out <run-dir> --tree [--branch B --base COMMIT] <thread>...` (which also calls render() here, so that one command writes the json and the page),
and lays it out. A missing retro.json, or one written without --tree, exits non-zero naming the retro.py command; it never remeasures.
Lanes (retro.json `lanes`): roots first, then descendants with runs grouped by the slice in the title (numbered, lettered after their number), else OTHER.
Layers (each a checkbox on the page): gap rails (the wait before a run, colored by the cause of the next run's trigger), arrows (a cross-thread message from its sender's lane to
the receiver's; an owner message is a diamond), activity (inside a run bar the tool time by command family, background commands as a strip at their real duration; the bar's own color is
model time), cache (a tick per cold API call; keepalive bars are green on a cache HIT, red on a MISS), model marks (each change of the assistant model, each compaction), child lanes,
a "writers" strip under the time axis (slices with a commit and child threads with a run in flight, per 30 minutes), HOLD/REFUSE marks on the lane that got them plus a free-GiB dot strip, a mark where a turn ended with a background command still running, and a bracket with its minutes above the lane of a --cycles thread for each work cycle (a dashed bracket is an acknowledgement).
With a landmark: merges and gate lines, per slice the 80%-of-churn to gate tail with a mini churn curve under the slice header, the unstarted stretch before its first commit (muted bar) and the tail split into active and quiet time (strip under the curve).
Hover text carries times and at most the first 140 chars of a message.
"""
import argparse, datetime as dt, html, json, math, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retro
from retro import ts

W, LH, LX, MH = 1200, 24, 330, 40
GCLS = {"owner": "owner", "own command": "cmd", "child completion": "child", "keepalive": "kal", "system": "unk", "unknown": "unk"}  # anything else is "message from ..."
LAYERS = [("arrows", "arrows"), ("gaps", "gap rails"), ("acts", "activity segments"), ("cache", "cache ticks"), ("models", "model marks"), ("child", "child lanes"), ("writers", "writers strip"), ("admit", "machine admission"), ("turnend", "turn ended mid-command"), ("cycles", "work cycles")]
LEGEND = ([("run", "model time"), ("f-test", "test"), ("f-build", "build"), ("f-guard", "guard/lint"), ("f-git", "git"), ("f-poll", "poll/sleep"), ("f-browser", "browser"), ("f-other", "other tool")]
          + [("g-owner", "wait: owner"), ("g-msg", "wait: message"), ("g-cmd", "wait: own command"), ("g-child", "wait: child done"), ("g-kal", "wait: keepalive"), ("g-unk", "wait: unknown"),
             ("ok", "keepalive HIT / gate"), ("bad", "keepalive MISS / REFUSE"), ("warn", "cold call / 80% churn / HOLD"),
             ("w-sl", "writers: slices with a commit"), ("run", "writers: threads running"), ("mut", "not yet started / quiet tail"), ("f-test", "active tail"), ("g-cmd", "turn ended, command still running"), ("cyc", "work cycle (minutes; dashed: acknowledgement)")])
CSS = """:root{--run:var(--chart-1,#3f6fb5);--f-test:var(--chart-3,#d9822b);--f-build:var(--chart-4,#8a63c7);--f-guard:var(--chart-5,#3aa6a0);--f-git:var(--chart-6,#b5527a);--f-poll:var(--muted-foreground,#999);--f-browser:var(--chart-2,#58a55c);--f-other:var(--muted-foreground,#999);
--g-owner:var(--chart-2,#58a55c);--g-msg:var(--chart-4,#8a63c7);--g-cmd:var(--chart-3,#d9822b);--g-child:var(--chart-5,#3aa6a0);--g-kal:var(--chart-6,#b5527a);--g-unk:var(--muted-foreground,#999);
--w-sl:var(--chart-4,#8a63c7);--cyc:var(--chart-5,#3aa6a0);--ok:var(--success,#2f8a4a);--bad:var(--destructive,#d0472f);--warn:var(--warning,#d9a02b);--rail:var(--border,#e5e5e5);--mut:var(--muted-foreground,#888);--fg:var(--foreground,#222)}
body{font:13px/1.4 var(--font-sans,system-ui)} #wrap{--fs:14px;overflow-x:auto} #wrap.wide{--fs:8px} p{max-width:900px} .ctl label{margin-right:14px}
.l{font-size:var(--fs);fill:var(--fg)} .g{font-size:var(--fs);font-weight:700;fill:var(--mut);letter-spacing:.06em} .t,.gt,.mt{font-size:calc(var(--fs)*.85);fill:var(--mut)} .gt{fill:var(--ok)} .mt{fill:var(--fg)}
.run{fill:var(--run)} .ka{fill:var(--mut)} .ka-hit{fill:var(--ok)} .ka-miss{fill:var(--bad)} .rail,.tick{stroke:var(--rail)} .merge{stroke:var(--mut);stroke-dasharray:2 3} .gate{stroke:var(--ok);stroke-width:2}
.f-test{fill:var(--f-test)} .f-build{fill:var(--f-build)} .f-guard{fill:var(--f-guard)} .f-git{fill:var(--f-git)} .f-poll{fill:var(--f-poll)} .f-browser{fill:var(--f-browser)} .f-other{fill:var(--f-other);fill-opacity:.4}
.g-owner{fill:var(--g-owner)} .g-msg{fill:var(--g-msg)} .g-cmd{fill:var(--g-cmd)} .g-child{fill:var(--g-child)} .g-kal{fill:var(--g-kal)} .g-unk{fill:var(--g-unk)}
.cold{stroke:var(--warn);stroke-width:2} .mm{stroke:var(--fg)} .cp{fill:var(--fg)} .ar{stroke:var(--fg);stroke-opacity:.4} .ah{fill:var(--fg);fill-opacity:.55} .ow{fill:var(--g-owner);stroke:var(--fg)}
.cyc{stroke:var(--cyc);stroke-width:2;fill:none} .cyk{stroke-dasharray:3 2} .cyt{font-size:calc(var(--fs)*.8);fill:var(--cyc);text-anchor:middle} .ws{fill:var(--w-sl)} .wt{fill:var(--run)} .unst{fill:var(--mut);fill-opacity:.2} .tq{fill:var(--mut);fill-opacity:.35} .ta{fill:var(--f-test)} .da{fill:var(--mut)} .dh{fill:var(--warn)} .dr{fill:var(--bad)} .hm{fill:var(--warn);stroke:var(--fg)} .rm{fill:var(--bad);stroke:var(--fg)} .tec{stroke:var(--g-cmd);stroke-width:2;stroke-dasharray:3 2} .tem{fill:var(--g-cmd);stroke:var(--fg)}
.cv{fill:none;stroke:var(--run);stroke-width:1.5} .c80{fill:var(--warn)} .cg{stroke:var(--ok);stroke-width:2}
line,path.cv{vector-effect:non-scaling-stroke} .hide-arrows .arrows,.hide-gaps .gaps,.hide-acts .acts,.hide-cache .cache,.hide-models .models,.hide-child .child,.hide-child .ch,.hide-writers .writers,.hide-admit .admit,.hide-turnend .turnend,.hide-cycles .cycles{display:none}
.k span{display:inline-block;width:10px;height:10px;margin:0 4px 0 12px;vertical-align:middle}""" + retro.BARS_CSS
JS = """const w=document.getElementById("wrap"),s=document.getElementById("s");
function sync(){for(const c of document.querySelectorAll("[data-layer]"))w.classList.toggle("hide-"+c.dataset.layer,!c.checked);
const wide=document.getElementById("wide").checked;w.classList.toggle("wide",wide);s.style.width=wide?"2400px":"100%";
s.setAttribute("viewBox","0 0 """ + str(W) + """ "+(w.classList.contains("hide-child")?s.dataset.rh:s.dataset.h))}
document.addEventListener("change",sync);sync();"""


def short(model):
    return re.sub(r"^claude-|-\d-\d$", "", model or "?")


def load(run_dir):
    """retro.json of a run directory, or exit non-zero naming the retro.py command that writes what the page needs. This page never measures."""
    path = f"{run_dir}/retro.json"; cmd = f"python .agents/skills/slot.mine/scripts/retro.py --out {run_dir} --tree [--branch B --base COMMIT] <t3-thread-id-prefix>..."
    if not os.path.exists(path): raise SystemExit(f"{path} is missing; write it with: {cmd}")
    J = json.load(open(path, encoding="utf-8"))
    if not J.get("lanes"): raise SystemExit(f"{path} was written without --tree, so it holds no lanes; write it with: {cmd}")
    return J


def render(run_dir):
    J = load(run_dir); lanes = J["lanes"]; lm = J["landmark"]; ro = J["rollup"]; M = {}
    for r in J["threads"] + J.get("partners", []):
        for x in [r] + r.get("descendants", []): M[x["tid"]] = x
    T0, T1 = (ts(t) for t in J["window"]); by = {l["tid"]: l for l in lanes}
    x = lambda t: LX + max(0, min(1, ((ts(t) if isinstance(t, str) else t) - T0).total_seconds() / (T1 - T0).total_seconds())) * (W - LX - 10)
    slices = {s["n"]: s for s in (lm or {"slices": []})["slices"]}; admits = [r for r in ro["admits"] if r["t"] and T0 <= ts(r["t"]) <= T1]
    rows, ypos, y, last, rh = [], {}, 48, None, None
    if lm and lm["writers"]:  # strips under the time axis: two small bar rows (slices with a commit, threads running per 30 minutes), then free GiB per admission reading
        ws = lm["writers"]; mx = lambda k: max(w[k] for w in ws) or 1; bw = x(T0 + dt.timedelta(minutes=30)) - x(T0)
        rows.append('<g class="writers"><text x="4" y="52" class="t">slices with a commit (max %d)</text><text x="4" y="64" class="t">threads running (max %d)</text>' % (mx("slices"), mx("threads")) + "".join(
            f'<rect x="{x(w["t"]):.1f}" y="{yb - 9 * w[k] / mx(k):.1f}" width="{max(1, bw - 1):.1f}" height="{9 * w[k] / mx(k):.1f}" class="{c}"><title>{w["t"][11:16]}Z: {w[k]} {lab}</title></rect>'
            for k, c, lab, yb in (("slices", "ws", "slices with a commit", 54), ("threads", "wt", "threads with a run in flight", 66)) for w in ws if w[k]) + "</g>")
        y = 72
    if admits:
        fm = max(r["free_gib"] for r in admits) or 1
        rows.append(f'<g class="admit"><text x="4" y="{y+10}" class="t">free GiB (max {fm:.0f})</text>' + "".join(
            f'<circle cx="{x(r["t"]):.1f}" cy="{y+12 - 11 * r["free_gib"] / fm:.1f}" r="{1.6 if r["verdict"] == "ADMIT" else 2.6}" class="d{r["verdict"][0].lower()}"><title>{r["t"][11:16]}Z {r["verdict"]} {r["kind"]}: free {r["free_gib"]} GiB</title></circle>' for r in admits) + "</g>")
        y += 18
    for ln in lanes:
        tid = ln["tid"]; g = ln["group"]; child = not ln["root"]; cls = "row child" if child else "row"
        name = ln["title"][:40] if ln["root"] else f"{ln['title'][:30]} · {short(ln['model'])}"
        if g != last:
            if child and rh is None: rh = y
            sl = slices.get(ln["slice"]) if ln["slice"] else None
            tail = f" · {sl['tail_h']:.1f}h {'open' if sl['open'] else 'tail'}" if sl else ""
            tip = f"<title>tail {sl['tail_h']}h{' (open)' if sl['open'] else ''}, started {sl['start_lag_h']}h after the window start" + (f", {sl['tail_test_share']:.0%} of tail churn is test code" if sl["tail_test_share"] is not None else "") + "</title>" if sl else ""
            rows.append(f'<g class="{cls}"><text x="4" y="{y+17}" class="g">{g}{tail}{tip}</text>'); y += LH; last = g
            if sl:  # mini churn curve: cumulative churn by time, with its 80% mark and its gate
                yb, tot = y + MH - 10, sl["churn"] or 1; pts = sl["curve"]; yy = lambda c: yb - (MH - 16) * c / tot; te = sl["gate"] or T1
                if ts(sl["first"]) > T0: rows.append(f'<rect x="{x(T0):.1f}" y="{y+2}" width="{x(sl["first"]) - x(T0):.1f}" height="{yb - y - 2}" class="unst"><title>not started: first commit {sl["first"][11:16]}Z, {sl["start_lag_h"]}h after the window start</title></rect>')
                rows.append(f'<rect x="{x(sl["t80"]):.1f}" y="{y+MH-8}" width="{max(1, x(te) - x(sl["t80"])):.1f}" height="6" class="tq"><title>tail {sl["tail_h"]}h: {sl["tail_active_h"]}h active (commits within 30m), {sl["tail_quiet_h"]}h quiet; {sl["tail_commits"]} commits, churn test/prod/docs {sl["tail_churn"]["test"]}/{sl["tail_churn"]["prod"]}/{sl["tail_churn"]["docs"]}</title></rect>'
                            + "".join(f'<rect x="{x(a):.1f}" y="{y+MH-8}" width="{max(1, x(b) - x(a)):.1f}" height="6" class="ta"/>' for a, b in sl["tail_segs"]))
                path = f"M{x(pts[0][0]):.1f},{yb} " + " ".join(f"H{x(t):.1f} V{yy(c):.1f}" for t, c in pts) + f" H{x(sl['gate'] or T1):.1f}"
                rows.append(f'<line x1="{LX}" x2="{W-10}" y1="{yb}" y2="{yb}" class="rail"/><path d="{path}" class="cv"><title>{sl["commits"]} commits, churn {sl["churn"]}</title></path>'
                            f'<circle cx="{x(sl["t80"]):.1f}" cy="{yy(0.8 * tot):.1f}" r="3.5" class="c80"><title>80% of churn {sl["t80"][11:16]}Z</title></circle>'
                            + (f'<line x1="{x(sl["gate"]):.1f}" x2="{x(sl["gate"]):.1f}" y1="{y+2}" y2="{yb}" class="cg"><title>gated {sl["gate"][11:16]}Z</title></line>' if sl["gate"] else ""))
                y += MH
            rows.append("</g>")
        m = M.get(tid) or {}; y += 10 if m.get("cycles") else 0  # room above the lane for its cycle brackets
        ypos[tid] = y
        lab = name[:27] + (f" · {m['test_share']:.0%} test" if m.get("test_share") is not None else "")
        r = [f'<g class="{cls}"><text x="4" y="{y+17}" class="l">{html.escape(lab)}</text><line x1="{LX}" x2="{W-10}" y1="{y+12}" y2="{y+12}" class="rail"/>']
        r += ['<g class="gaps">'] + [f'<rect x="{x(gp["start"]):.1f}" y="{y+10}" width="{max(1, x(gp["end"]) - x(gp["start"])):.1f}" height="4" class="g-{GCLS.get(gp["cause"], "msg")}">'
                                     f'<title>wait {gp["hours"]}h: {html.escape(gp["cause"])}{html.escape(" - " + gp["detail"]) if gp["detail"] else ""}</title></rect>' for gp in ln["gaps"]] + ["</g>"]
        for ra, rb, t, k in ln["runs"]:
            rb = rb or T1.isoformat()
            r.append(f'<rect x="{x(ra):.1f}" y="{y+2}" width="{max(2, x(rb) - x(ra)):.1f}" height="{LH-6}" class="{k}"><title>{ra[11:16]}–{rb[11:16]}Z ({(ts(rb)-ts(ra)).total_seconds()/60:.0f}m)\n{html.escape(t)}</title></rect>')
        r.append('<g class="acts">')
        for s, e, fam, bg in m.get("ivs", []):
            if ts(e) < T0 or ts(s) > T1 or x(e) - x(s) < 0.25: continue
            r.append(f'<rect x="{x(s):.1f}" y="{y+19 if bg else y+2}" width="{x(e)-x(s):.1f}" height="{3 if bg else LH-6}" class="f-{fam}"><title>{fam}{" (background)" if bg else ""} {(ts(e)-ts(s)).total_seconds()/60:.1f}m</title></rect>')
        r.append('</g><g class="cache">' + "".join(f'<line x1="{x(c["at"]):.1f}" x2="{x(c["at"]):.1f}" y1="{y}" y2="{y+6}" class="cold"><title>cold call {c["at"][11:16]}Z: wrote {c["write"]//1000}k tokens after {c["gap_min"]}m idle</title></line>' for c in m.get("cold_calls", [])))
        r.append('</g><g class="models">' + "".join(f'<line x1="{x(c["at"]):.1f}" x2="{x(c["at"]):.1f}" y1="{y}" y2="{y+LH-2}" class="mm"><title>{c["at"][11:16]}Z model {short(c["frm"])} to {short(c["to"])}</title></line>'
                                                 f'<text x="{x(c["at"])+2:.1f}" y="{y+8}" class="mt">{html.escape(short(c["to"]))}</text>' for c in m.get("model_changes", []))
                 + "".join(f'<path d="M{x(c)-4:.1f},{y} h8 l-4,7 z" class="cp"><title>compaction {c[11:16]}Z</title></path>' for c in m.get("compact_at", [])) + "</g>")
        r.append('<g class="cycles">' + "".join(
            f'<path d="M{x(c["start"]):.1f},{y-2} v-4 H{x(c["end"]):.1f} v4" class="cyc{" cyk" if c["ack"] else ""}"><title>{c["start"][11:16]}Z {c["minutes"]} min for {html.escape(c["for_title"][:40])}'
            f'{" (acknowledgement)" if c["ack"] else ""}: {html.escape(", ".join(f"{k} {v}" for k, v in c["families"].items()))}; first browser call {c["first_browser_min"]} min in</title></path>'
            f'<text x="{(x(c["start"]) + x(c["end"])) / 2:.1f}" y="{y-8}" class="cyt">{c["minutes"]:.0f}m</text>' for c in m.get("cycles", [])) + "</g>")
        r.append('<g class="admit">' + "".join(
            (f'<rect x="{x(a["t"])-3:.1f}" y="{y+LH-9}" width="6" height="6" class="hm">' if a["verdict"] == "HOLD" else f'<circle cx="{x(a["t"]):.1f}" cy="{y+LH-6}" r="3.5" class="rm">')
            + f'<title>{a["t"][11:16]}Z {a["verdict"]} {a["kind"]}: free {a["free_gib"]} GiB</title>' + ("</rect>" if a["verdict"] == "HOLD" else "</circle>")
            for a in m.get("admits", []) if a["verdict"] != "ADMIT" and a["t"] and T0 <= ts(a["t"]) <= T1) + "</g>")
        r.append('<g class="turnend">' + "".join(
            f'<line x1="{x(e["t_run_end"]):.1f}" x2="{x(e["t_cmd_end"]):.1f}" y1="{y+LH-1}" y2="{y+LH-1}" class="tec"/><circle cx="{x(e["t_run_end"]):.1f}" cy="{y+LH-1}" r="3" class="tem">'
            f'<title>run ended {e["t_run_end"][11:16]}Z with {html.escape(e["command"])} still running; it ran on {e["ran_on_h"]}h; idle until the next run: {e["idle_until_next_run_h"]}h</title></circle>'
            for e in m.get("turn_ends", []) if T0 <= ts(e["t_run_end"]) <= T1) + "</g></g>")
        rows.append("".join(r)); y += LH
    H = y + 20; rh = rh or H
    arrows = ['<g class="arrows">']  # drawn after every lane so each lane's row position is known
    for ln in lanes:
        tid = ln["tid"]
        for mg in ln["msgs"]:
            c, snd, owner, t = mg["t"], mg["frm"], mg["owner"], mg["text"]
            if not c or not (T0 <= ts(c) <= T1): continue
            yr = ypos[tid] + 12; ch = "ch" if not (ln["root"] and by.get(snd, {"root": True})["root"]) else ""
            if owner: arrows.append(f'<polygon points="{x(c)-5:.1f},{yr} {x(c):.1f},{yr-5} {x(c)+5:.1f},{yr} {x(c):.1f},{yr+5}" class="ow {ch}"><title>owner {c[11:16]}Z\n{html.escape(t)}</title></polygon>')
            elif snd in ypos:
                ys = ypos[snd] + 12; d = 1 if yr > ys else -1; xc = x(c)
                arrows.append(f'<g class="{ch}"><line x1="{xc:.1f}" x2="{xc:.1f}" y1="{ys}" y2="{yr - 5*d}" class="ar"/><polygon points="{xc-3:.1f},{yr-6*d} {xc+3:.1f},{yr-6*d} {xc:.1f},{yr}" class="ah"/>'
                              f'<title>{html.escape(mg["frm_name"][:30])} → {html.escape(ln["title"][:30])} {c[11:16]}Z\n{html.escape(t)}</title></g>')
    arrows.append("</g>")
    marks = []
    for mk in (lm or {}).get("marks", []):
        xt = x(mk["t"]); gate = mk["kind"] == "gate"
        marks.append(f'<line x1="{xt:.1f}" x2="{xt:.1f}" y1="28" y2="{H}" class="{mk["kind"]}"><title>{mk["h"]} {mk["t"][11:16]}Z {html.escape(mk["subject"])}</title></line>'
                     + (f'<text x="{xt+2:.1f}" y="22" class="gt">{html.escape(mk["subject"].split(" gated")[0])} gated</text>' if gate else ""))
    step = max(1, math.ceil((T1 - T0).total_seconds() / 3600 / 6)); t = T0.replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1); ticks = ""
    while t < T1:
        ticks += f'<line x1="{x(t):.1f}" x2="{x(t):.1f}" y1="30" y2="{H}" class="tick"/><text x="{x(t)+2:.1f}" y="40" class="t">{t:%H}Z</text>'; t += dt.timedelta(hours=step)
    ctl = "".join(f'<label><input type="checkbox" data-layer="{k}" checked> {v}</label>' for k, v in LAYERS) + '<label><input type="checkbox" id="wide"> wide (2400px)</label>'
    key = "".join(f'<span style="background:var(--{c}){";opacity:.4" if c in ("f-other", "mut") else ""}"></span>{t}' for c, t in LEGEND)
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><title>Run swimlanes</title><style>{CSS}</style></head><body>
<p>{html.escape(retro.landmark_line(lm)) if lm else ""}<br>{html.escape(retro.measures_line(lm, ro))}{"<br>" + html.escape(retro.commits_line(lm)) if lm else ""}</p>
<p class="ctl">{ctl}</p>
<p class="k">Bars are agent runs (hover for the message that started each one); the thin rail between bars is the wait, colored by what started the next run. {key}</p>
<div id="wrap"><svg id="s" viewBox="0 0 {W} {H}" data-h="{H}" data-rh="{rh}" style="width:100%">{ticks}{''.join(marks)}{''.join(rows)}{''.join(arrows)}</svg></div>
<h3>Command prefixes, top 25 by hours (background commands at their real duration; +n = lighter segment of another command)</h3>{retro.bars(J["commands"])}
<script>{JS}</script></body></html>"""
    open(f"{run_dir}/swimlanes.html", "w", encoding="utf-8").write(doc)
    print(f"swimlanes: lanes {len(lanes)} span {T0:%Y-%m-%d %H:%M}Z..{T1:%H:%M}Z markers {len(marks)} height {H}")
    for ln in lanes:
        if ln["root"]: print(f"waits {ln['title'][:40]}: " + json.dumps(M[ln["tid"]]["waits"]))


def main():
    a = argparse.ArgumentParser(); a.add_argument("run_dir"); render(a.parse_args().run_dir)


if __name__ == "__main__":
    main()
