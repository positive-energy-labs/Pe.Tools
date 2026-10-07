"""Headless-check kit pages: zero JS errors, then the page's own window.__walk() must return without throwing.

usage: python check.py [page.html ...] [--shot] [--no-walk]
  no pages:  every template beside this file (review, diagram, lineup, sandbox)
  --shot:    also write .check/<page>.png beside each page
  --no-walk: errors only. The template walks assert fixture ids; a built page keeps its walk only if it keeps
             those ids or you adapt the walk to its data.
Prints PASS/FAIL per page with the walk's asserted steps; exits 1 on any FAIL.
Also fails when two checked pages carry different kernels (the kernel is copied, never imported).
Needs Edge or Chrome; stdlib only.
"""
import html, json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATES = ["review.html", "diagram.html", "lineup.html", "sandbox.html"]
BROWSERS = [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
KERNEL = re.compile(r"/\* ==== kernel .*?/\* ==== end kernel ==== \*/", re.S)
# Injected first in <head>: collect every error (script, resource, rejection, console.error), then run the walk after load.
HOOK = """<script>window.__check={errors:[],walk:WALK};
addEventListener('error',e=>__check.errors.push(e.message?e.message+' @'+e.lineno+':'+e.colno:'resource failed: '+(e.target&&(e.target.src||e.target.href))),true);
addEventListener('unhandledrejection',e=>__check.errors.push('rejection: '+(e.reason&&e.reason.message||e.reason)));
const __ce=console.error;console.error=(...a)=>{__check.errors.push('console.error: '+a.join(' '));__ce(...a)};
addEventListener('load',()=>setTimeout(()=>{let steps=[],walk=null;try{if(__check.walk){if(!window.__walk)throw new Error('page defines no window.__walk');steps=window.__walk()}}catch(x){walk=String(x&&x.message||x)}
const pre=document.createElement('pre');pre.id='__check';pre.textContent=JSON.stringify({errors:__check.errors,walk,steps});document.body.appendChild(pre)},50));</script>"""


def browsers():
    found = [b for b in BROWSERS + [shutil.which(n) for n in ("msedge", "google-chrome", "chromium", "chrome")] if b and os.path.exists(b)]
    return list(dict.fromkeys(found)) or sys.exit("no Edge or Chrome found; add its path to BROWSERS in check.py")


def browser():
    return browsers()[0]


def run(exe, page, shot, walk):
    src = open(page, encoding="utf-8").read()
    if '<meta charset="utf-8">' not in src:
        return None, 'no <meta charset="utf-8"> to hook after'
    tmp = os.path.join(os.path.dirname(page), ".check-" + os.path.basename(page))   # beside the page, so relative images resolve
    open(tmp, "w", encoding="utf-8").write(src.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + HOOK.replace("WALK", "true" if walk else "false"), 1))
    prof = tempfile.mkdtemp(prefix="kitcheck-")
    base = [exe, "--headless=new", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files", f"--user-data-dir={prof}",
            "--virtual-time-budget=6000", "--window-size=1400,900"]
    url = "file:///" + os.path.abspath(tmp).replace("\\", "/")
    try:
        dom = subprocess.run(base + ["--dump-dom", url], capture_output=True, text=True, encoding="utf-8", timeout=90).stdout
        if shot:
            os.makedirs(os.path.join(os.path.dirname(page), ".check"), exist_ok=True)
            png = os.path.join(os.path.dirname(page), ".check", os.path.splitext(os.path.basename(page))[0] + ".png")
            subprocess.run(base + [f"--screenshot={png}", url], capture_output=True, timeout=90)
    finally:
        os.remove(tmp)
        shutil.rmtree(prof, ignore_errors=True)
    m = re.search(r'<pre id="__check">(.*?)</pre>', dom, re.S)
    return (json.loads(html.unescape(m.group(1))), None) if m else (None, "the page never finished loading (no check result in the DOM)")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    pages = [os.path.abspath(a) for a in args] or [os.path.join(HERE, t) for t in TEMPLATES]
    exes, bad, kernels = browsers(), 0, {}
    for page in pages:
        name = os.path.basename(page)
        if not os.path.exists(page):
            print(f"FAIL {name}: no such file"); bad += 1; continue
        k = KERNEL.search(open(page, encoding="utf-8").read())
        if k:
            kernels[name] = k.group(0)
        for exe in exes:   # Edge 154 headless returned an empty DOM on 2026-10-05; an empty dump means try the next browser
            r, why = run(exe, page, "--shot" in sys.argv, "--no-walk" not in sys.argv)
            if r or why != "the page never finished loading (no check result in the DOM)":
                break
        errs = (r or {}).get("errors", []) + ([why] if why else []) + ([r["walk"]] if r and r["walk"] else [])
        if not k:
            errs.append("no kernel block (/* ==== kernel ... ==== end kernel ==== */)")
        print(("FAIL " if errs else "PASS ") + name + (f"  {len(r['steps'])} steps" if r else ""))
        for s in (r or {}).get("steps", []):
            print("   ok  " + s)
        for e in errs:
            print("   ERR " + e)
        bad += bool(errs)
    if len(set(kernels.values())) > 1:
        first = next(iter(kernels))
        print("FAIL kernel drift: " + ", ".join(n for n, v in kernels.items() if v != kernels[first]) + f" differ from {first}")
        bad += 1
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
