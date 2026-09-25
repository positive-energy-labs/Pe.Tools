"""W1 rails falsifier: knee-ink coverage by rail rectangles, the largest uncovered ink, and a render.

usage: python eval/partition/rails.py <name> <partition-input.json[.gz]> <rails.json> <out-dir> [view-image-out.txt plan.png]

Ink is Solve's: every knee piece's convex hull buffered by Knobs.InkHalfWidthFt. Rail ink is each rail's
flat-capped rectangle buffered by the same half width, so a rail that sits exactly on its wall covers it.
"""
import gzip, json, re, sys, collections
from pathlib import Path
from PIL import Image, ImageDraw
from shapely.geometry import MultiPoint, LineString, Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

name, input_path, rails_path, out_dir = sys.argv[1:5]
reg_path, plan_path = (sys.argv[5], sys.argv[6]) if len(sys.argv) > 6 else (None, None)
out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
opener = gzip.open if input_path.endswith('.gz') else open
inp = json.load(opener(input_path, 'rt', encoding='utf-8'))
rails = json.load(open(rails_path, encoding='utf-8'))
half = inp['Knobs']['InkHalfWidthFt']

def label(h):
    return f"{h['Category'][:24]}:{h['Layer']}" if h['Layer'] else h['Category']

pieces, owners = [], []
for e in inp['Knee']['Elements']:
    for r in e['Pieces']:
        g = MultiPoint([(r[i], r[i + 1]) for i in range(0, len(r), 2)]).convex_hull
        if g.geom_type == 'Point':
            continue
        pieces.append(g.buffer(half, 2)); owners.append((label(e['Handle']), e['Handle']['ElementId']))
zone = unary_union([Polygon([(z[i], z[i + 1]) for i in range(0, len(z), 2)]) for z in inp['ZoneLoops']])
# The zone is the domain; 1 ft outside it keeps the exterior walls whose inner face is the zone edge.
domain = zone.buffer(1.0, join_style='mitre')
keep = [i for i, g in enumerate(pieces) if g.intersects(domain)]
pieces, owners = [pieces[i].intersection(domain) for i in keep], [owners[i] for i in keep]
ink = unary_union(pieces)
rects = [LineString([r['A'], r['B']]).buffer(r['ThicknessFt'] / 2, cap_style='flat') for r in rails]
rail_ink = unary_union([g.buffer(half, join_style='mitre') for g in rects]).intersection(domain)
covered = ink.intersection(rail_ink)
uncovered = ink.difference(rail_ink)

by_cat = collections.defaultdict(list)
for g, (cat, _) in zip(pieces, owners):
    by_cat[cat].append(g)
per_cat = {}
for cat, gs in sorted(by_cat.items()):
    u = unary_union(gs)
    per_cat[cat] = {'inkSqft': round(u.area, 2), 'covered': round(u.intersection(rail_ink).area / u.area, 4)}

tree = STRtree(pieces)
blobs = sorted((g for g in getattr(uncovered, 'geoms', [uncovered]) if not g.is_empty), key=lambda g: -g.area)[:10]
top = []
for g in blobs:
    share = collections.Counter()
    for i in tree.query(g):
        share[owners[i][0]] += pieces[i].intersection(g).area
    total = sum(share.values()) or 1
    c = g.representative_point()
    top.append({'sqft': round(g.area, 2), 'at': [round(c.x, 2), round(c.y, 2)],
                'categories': {k: round(v / total, 2) for k, v in share.most_common(3)}})

src = collections.Counter(r['Source'] for r in rails)
metrics = {
    'name': name, 'rails': len(rails), 'zoneSqft': round(zone.area, 1), 'bySource': dict(src),
    'railLengthFt': round(sum(LineString([r['A'], r['B']]).length for r in rails), 1),
    'inkSqft': round(ink.area, 2), 'coveredSqft': round(covered.area, 2),
    'coverage': round(covered.area / ink.area, 4),
    'railInkOffInkSqft': round(rail_ink.difference(ink).area, 2),
    'perCategory': per_cat, 'largestUncovered': top,
}
(out / f'{name}-metrics.json').write_text(json.dumps(metrics, indent=1))
print(json.dumps({k: v for k, v in metrics.items() if k not in ('perCategory', 'largestUncovered')}))
for k, v in per_cat.items(): print(' ', k, v)
for i, b in enumerate(top, 1): print(' ', i, b)

# ---------------------------------------------------------------- render
if reg_path:
    reg = json.loads(re.search(r'"registration":\s*(\{.*?\n    \})', open(reg_path, encoding='utf-8').read(), re.S).group(1))
    (x0, y1), (x1, _), (_, y0) = reg['topLeft'], reg['topRight'], reg['bottomLeft']
    W, H = reg['width'], reg['height']
    base = Image.open(plan_path).convert('RGBA')
    base = Image.blend(Image.new('RGBA', base.size, 'white'), base, 0.35)
else:
    x0, y0, x1, y1 = domain.bounds
    x0, y0, x1, y1 = x0 - 2, y0 - 2, x1 + 2, y1 + 2
    s = min(40, 6000 / max(x1 - x0, y1 - y0))
    W, H = int((x1 - x0) * s), int((y1 - y0) * s)
    base = Image.new('RGBA', (W, H), 'white')
sx, sy = W / (x1 - x0), H / (y1 - y0)
px = lambda x, y: ((x - x0) * sx, (y1 - y) * sy)

def fill(draw, g, color, outline=None, width=1):
    for p in getattr(g, 'geoms', [g]):
        if p.is_empty or p.geom_type != 'Polygon':
            continue
        draw.polygon([px(*c) for c in p.exterior.coords], fill=color, outline=outline, width=width)
        for h in p.interiors:
            draw.polygon([px(*c) for c in h.coords], fill=(255, 255, 255, 0))

layer = Image.new('RGBA', base.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
for z in inp['ZoneLoops']:
    d.line([px(z[i], z[i + 1]) for i in range(0, len(z), 2)] + [px(z[0], z[1])], fill=(0, 0, 0, 255), width=1)
fill(d, covered, (90, 90, 90, 150))
fill(d, uncovered, (230, 120, 0, 200))
img = Image.alpha_composite(base, layer)
layer = Image.new('RGBA', base.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
for g, r in zip(rects, rails):
    fill(d, g, (30, 90, 220, 70) if r['Source'] == 'wall' else (0, 150, 110, 70))
    d.line([px(*r['A']), px(*r['B'])], fill=(200, 0, 40, 255), width=2)
for i, b in enumerate(blobs, 1):
    fill(d, b, None, outline=(200, 0, 200, 255), width=3)
    c = b.representative_point(); d.text(px(c.x, c.y), str(i), fill=(120, 0, 120, 255))
Image.alpha_composite(img, layer).convert('RGB').save(out / f'{name}-rails.png')
