# Mine Bluebeam takeoff markups (area polygons, length lines, polylength polylines) out of the
# engineer's plan PDFs into per-sheet JSON, in PDF points AND real-world feet.
#
#   python eval/rhvac/mine-bluebeam.py                # mine every PDF in project-a/bluebeam (+ archive/)
#   python eval/rhvac/mine-bluebeam.py --project eval/rhvac/projectB
#   python eval/rhvac/mine-bluebeam.py --pdf <path>   # mine one PDF
#
# Facts this encodes (probed 2026-08, see project-a/manual-takeoff-mining.md):
# - Measurements are standard PDF annots with Bluebeam extensions: /Polygon + /IT /PolygonDimension
#   (area), /Line + /LineDimension (length), /PolyLine + /PolyLineDimension (polylength).
# - The calibration lives PER ANNOTATION in /Measure; pages also carry a /VP viewport measure but
#   annots on one page can differ (seen: 1/4" and 3/32" on the same page), so trust the annot.
# - /Measure/X[0]/C is the pt->ft factor (0.0555… = 1/18 for 1/4"=1'). Shoelace * C^2 reproduces
#   Bluebeam's displayed sf to 1e-3, so vertices+scale are the ground truth, not the label.
# - /Contents holds only the computed value ("349.07 sf", "15'-6 1/2\""); /Label and /Subj carry no
#   room identity. Room names come from the PLAN TEXT LAYER (Revit room tags), matched by locating
#   room-number tokens inside each polygon (pdfplumber word positions).
# - /Square annots authored by "AutoCAD SHX Text" are CAD-export artifacts, not takeoff counts.
import argparse, json, math, os, re
from collections import Counter

import pikepdf

HERE = os.path.dirname(os.path.abspath(__file__))

MEASURE_ITS = {"/PolygonDimension": "area", "/LineDimension": "length", "/PolyLineDimension": "polylength"}


def pt_to_ft_factor(annot):
    """Per-annotation pt->ft conversion from /Measure/X[0]/C (fall back to parsing /Measure/R)."""
    m = annot.get("/Measure")
    if m is not None and "/X" in m:
        try:
            return float(m.X[0].C)
        except Exception:
            pass
    if m is not None and "/R" in m:
        # e.g. "0.25 in = 1 ft' in\""
        r = str(m.R)
        g = re.match(r"([\d.]+)\s*in\s*=\s*([\d.]+)\s*ft", r)
        if g:
            return float(g.group(2)) / (float(g.group(1)) * 72.0)
    return None


def shoelace(pts):
    return 0.5 * abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1])))


def polyline_len(pts, closed=False):
    seq = pts + [pts[0]] if closed else pts
    return sum(math.dist(a, b) for a, b in zip(seq, seq[1:]))


def parse_sf(text):
    g = re.search(r"([\d,]+(?:\.\d+)?)\s*sf", text)
    return float(g.group(1).replace(",", "")) if g else None


def extract_words(pdf_path, page_index):
    """Positioned words from the plan text layer (returns [] if pdfplumber unavailable)."""
    try:
        import pdfplumber
    except ImportError:
        return []
    with pdfplumber.open(pdf_path) as pl:
        page = pl.pages[page_index]
        words = page.extract_words()
        h = float(page.height)
        # pdfplumber y is top-down; annots are bottom-up PDF coords.
        return [
            {"text": w["text"], "x": (w["x0"] + w["x1"]) / 2, "y": h - (w["top"] + w["bottom"]) / 2}
            for w in words
        ]


def point_in_poly(x, y, pts):
    inside = False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


ROOM_NUM = re.compile(r"^\d{3}(?:\.\d+)?$")


def mine_pdf(pdf_path, tag_words=True):
    pdf = pikepdf.open(pdf_path)
    sheets = []
    for pi, page in enumerate(pdf.pages):
        annots = page.get("/Annots", [])
        marks = []
        for a in annots:
            it = str(a.get("/IT", ""))
            kind = MEASURE_ITS.get(it)
            if kind is None:
                continue
            factor = pt_to_ft_factor(a)
            if kind == "length":
                l = [float(x) for x in a.get("/L", [])]
                pts = [(l[0], l[1]), (l[2], l[3])] if len(l) == 4 else []
            else:
                v = [float(x) for x in a.get("/Vertices", [])]
                pts = list(zip(v[::2], v[1::2]))
            rec = {
                "kind": kind,
                "subject": str(a.get("/Subj", "")),
                "contents": str(a.get("/Contents", "")),
                "label": str(a.get("/Label", "")),
                "author": str(a.get("/T", "")),
                "created": str(a.get("/CreationDate", "")),
                "modified": str(a.get("/M", "")),
                "color": [float(c) for c in a.get("/C", [])],
                "layer": str(a.get("/OC", {}).get("/Name", "")) if "/OC" in a else "",
                "nm": str(a.get("/NM", "")),
                "scale": str(a.get("/Measure", {}).get("/R", "")) if "/Measure" in a else "",
                "ptToFt": factor,
                "verticesPt": [[round(x, 2), round(y, 2)] for x, y in pts],
            }
            if factor:
                rec["verticesFt"] = [[round(x * factor, 3), round(y * factor, 3)] for x, y in pts]
                if kind == "area":
                    rec["areaSf"] = round(shoelace(pts) * factor * factor, 2)
                    rec["perimeterFt"] = round(polyline_len(pts, closed=True) * factor, 2)
                    rec["areaSfLabel"] = parse_sf(rec["contents"])
                else:
                    rec["lengthFt"] = round(polyline_len(pts) * factor, 2)
            marks.append(rec)
        if not marks:
            continue
        sheet = {"pdf": os.path.basename(pdf_path), "page": pi, "markups": marks}
        # Name area polygons from Revit room-number tags in the plan text layer.
        if tag_words and any(m["kind"] == "area" for m in marks):
            words = extract_words(pdf_path, pi)
            for m in marks:
                if m["kind"] != "area" or not m["verticesPt"]:
                    continue
                pts = [tuple(p) for p in m["verticesPt"]]
                inside = [w for w in words if point_in_poly(w["x"], w["y"], pts)]
                nums = [w["text"] for w in inside if ROOM_NUM.match(w["text"])]
                # room-name-ish words: uppercase alpha runs near the numbers
                names = [w["text"] for w in inside if re.match(r"^[A-Z][A-Z&/'.-]*$", w["text"]) and len(w["text"]) > 1]
                m["roomNumbers"] = sorted(set(nums))
                m["roomWords"] = names[:12]
        summary = {
            "counts": dict(Counter(m["kind"] for m in marks)),
            "areaTotalSf": round(sum(m.get("areaSf", 0) for m in marks), 1),
            "lengthTotalFt": round(sum(m.get("lengthFt", 0) for m in marks), 1),
            "authors": sorted({m["author"] for m in marks}),
            "scales": sorted({m["scale"] for m in marks}),
        }
        sheet["summary"] = summary
        sheets.append(sheet)
    return sheets


def slugify(name):
    return re.sub(r"[^A-Za-z0-9]+", "_", os.path.splitext(name)[0]).strip("_")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=os.path.join(HERE, "project-a"),
                    help="project directory containing bluebeam/ (default: eval/rhvac/projectA)")
    ap.add_argument("--pdf", default=None, help="mine a single PDF (default: all PDFs under PROJECT/bluebeam)")
    ap.add_argument("--no-tags", action="store_true", help="skip text-layer room tagging (faster)")
    a = ap.parse_args()
    if a.pdf:
        paths = [a.pdf]
    else:
        bluebeam = os.path.join(a.project, "bluebeam")
        paths = sorted(
            os.path.join(d, f)
            for d in (bluebeam, os.path.join(bluebeam, "archive"))
            if os.path.isdir(d)
            for f in os.listdir(d)
            if f.lower().endswith(".pdf")
        )
    for path in paths:
        sheets = mine_pdf(path, tag_words=not a.no_tags)
        out_dir = os.path.dirname(path)
        out = os.path.join(out_dir, slugify(os.path.basename(path)) + ".markups.json")
        doc = {
            "source": os.path.basename(path),
            "sheets": sheets,
            "totals": dict(sum((Counter(s["summary"]["counts"]) for s in sheets), Counter())),
        }
        json.dump(doc, open(out, "w"), indent=1)
        print(f"{os.path.basename(out)}: {doc['totals']} across {len(sheets)} sheets")


if __name__ == "__main__":
    main()
