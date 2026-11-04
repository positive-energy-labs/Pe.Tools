"""Historical numeric-admission experiment report; not the current cost estimator.
Offline report over an admission.py run directory.

    python tools/space-proof/admission_report.py <runDir>             timing/memory table per process, scene artifact census
    python tools/space-proof/admission_report.py compare <runA> <runB>  answers of A against B (verbs.py's semantic comparison)

The scene census decodes each scene's PSC1 artifact from the product cache and counts what the read walked by representation:
mesh elements are tessellated (weight 1), oriented boxes and runs are only loaded (historical load weight 0.125), so the cost
column is the budget's own arithmetic over the artifact, to set beside the measured private-bytes delta.
"""
import json, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run as R  # noqa: E402
import verbs as V  # noqa: E402

LOAD_WEIGHT = 0.125


def load(d):
    d = Path(d)
    return d, json.loads((d / "results.json").read_text(encoding="utf8"))


def response(d, proc, read):
    path = next((d / "ev" / proc["model"] / proc["variant"]).glob(f"*-{read['id']}.stdout"), None)
    if not path:
        return None
    text = path.read_text(encoding="utf8")
    try:
        return json.loads(text[text.index("{"):])
    except Exception:
        return None


def scene_census(artifact_id):
    path = R.cache() / f"{artifact_id}.bin"
    if not path.exists():
        return None
    meta = R.decode_psc1(path.read_bytes())
    focus, context = Counter(), Counter()
    for e in meta["elements"]:
        side = focus if e["focus"] else context
        side[(e["representation"], e["handle"]["category"])] += 1
    def split(c):
        mesh = sum(n for (rep, _), n in c.items() if rep == "mesh")
        light = sum(n for (rep, _), n in c.items() if rep != "mesh")
        return {"mesh": mesh, "light": light, "cost": round(mesh + LOAD_WEIGHT * light, 1),
                "byRepresentationCategory": [[f"{rep}|{cat}", n] for (rep, cat), n in c.most_common(14)]}
    sources = [{"name": s["name"], "state": s["state"], "read": s.get("read") and {k: s["read"][k] for k in ("counted", "kept", "excluded", "rejectedAfterLoad", "cutByBound", "milliseconds")}} for s in meta["sources"]]
    return {"focus": split(focus), "context": split(context), "sources": sources, "unavailable": len(meta["unavailableElements"]), "completeness": meta["completeness"]}


def cmd_report(d):
    d, res = load(d)
    lines = [f'# admission run {res["run"]["head"][:8]} base {res["run"]["base"]} {res["run"]["utc"]}', ""]
    for p in res["processes"]:
        lines.append(f'## {p["model"]} {p["variant"]} pid {p.get("pid")} build {p.get("buildStamp")}; private at open {p.get("privateAtOpen", 0) / R.MIB:.0f} MiB, after settle {p.get("privateAfterSettle", 0) / R.MIB:.0f} MiB; free before open {p.get("availableGiBBeforeOpen")} GiB')
        lines += ["", "| read | host s | wall s | query ms | delta MiB | peak GiB | result |", "|---|--:|--:|--:|--:|--:|---|"]
        for r in p["reads"]:
            err = r.get("error")
            lines.append(f'| {r["id"]} | {(r.get("elapsedMs") or 0) / 1000:.2f} | {r["wallS"]} | {r.get("queryMs")} | {r["deltaMiB"]} | {r["privatePeak"] / 2**30:.2f} | {("REFUSED/ERROR " + err[:160]) if err else "ok"} |')
            for b in r.get("budget", []):
                lines.append(f"|  | budget | {b[b.index('Space budget'):][:260]} |||||")
            art = None
            if r.get("key") == "revit.detail.space-scene" and not err:
                resp = response(d, p, r)
                art = (resp or {}).get("response", {}).get("id")
                if art:
                    c = scene_census(art)
                    if c:
                        lines.append(f'|  | scene census | focus {json.dumps(c["focus"]["byRepresentationCategory"][:6])} | context mesh {c["context"]["mesh"]}, light {c["context"]["light"]}, cost {c["context"]["cost"]} | sources {json.dumps(c["sources"])[:400]} |||')
        lines.append("")
    print("\n".join(lines))


def cmd_compare(a, b):
    da, ra = load(a)
    db, rb = load(b)
    def answers(d, res, model, variant):
        out = {}
        for p in res["processes"]:
            if p["model"] != model or p["variant"] != variant:
                continue
            for r in p["reads"]:
                if r.get("pass") == 1 and r.get("verb"):
                    resp = response(d, p, r)
                    out[r["reqId"]] = (r["verb"], None if r.get("error") else resp["response"], r.get("error"), r)
        return out
    models = sorted({p["model"] for p in ra["processes"]} & {p["model"] for p in rb["processes"]})
    for model in models:
        x, y = answers(da, ra, model, "A"), answers(db, rb, model, "B")
        for rid in sorted(set(x) & set(y)):
            verb, ax, ex, rx = x[rid]
            _, by, ey, ry = y[rid]
            if ex or ey:
                print(f"{model} {rid}: A {'REFUSED' if ex else 'ok'}  B {'REFUSED' if ey else 'ok'}")
                continue
            same, detail = V.compare_answers(verb, ax, by)
            print(f"{model} {rid}: {'SAME' if same else ('SUBSET-OF-A' if V.dominated(verb, detail) else 'DIFFERENT')}  A {rx['wallS']}s {rx['deltaMiB']} MiB  B {ry['wallS']}s {ry['deltaMiB']} MiB")
            if not same:
                print("   ", json.dumps(detail)[:900])


if __name__ == "__main__":
    if sys.argv[1] == "compare":
        cmd_compare(sys.argv[2], sys.argv[3])
    else:
        cmd_report(sys.argv[1])
