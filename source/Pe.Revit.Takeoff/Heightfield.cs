namespace Pe.Revit.Takeoff;

// Physics layer: per-cell floor / ceiling from the raw triangle soup (round-2 heightfield pod
// lineage). Role division is strict — see Detector: the FLOOR edge may shape room boundaries
// (subfloor data is dense and reliable; stair voids and double-height volumes end rooms exactly
// where the floor ends), the CEILING only GATES regions (headroom fraction kills open-to-sky
// courtyards/terraces). Ceiling data is too patchy at framing stage (joist gaps, tilted planes)
// to touch boundary geometry — letting it do so was the wavy-room-edge regression.
//
// Earned data-quality lessons (Chadds framing IFC): joist-only floors (no subfloor sheathing yet)
// need a small morphological gap-fill; roof planes near the level plane masquerade as floors ->
// constrain the floor window tightly around the level; site geometry (topo, planting) must be
// excluded or tree canopies read as ceilings and terraces as floors.
public sealed class Heightfield
{
    public int W, H;
    public double MinX, MinY, CellFt;
    public float[] FloorZ = null!;   // NaN = no floor found in window
    public float[] CeilZ = null!;    // NaN = open to sky

    private static readonly HashSet<ElementId> SiteCategories = new(new[] {
        BuiltInCategory.OST_Topography, BuiltInCategory.OST_Planting, BuiltInCategory.OST_Site,
        BuiltInCategory.OST_Entourage, BuiltInCategory.OST_Parking, BuiltInCategory.OST_Roads,
    }.Select(c => ((long)c).ToElementId()));

    public static Heightfield Build(
        Document doc, Level level, BoundingBoxXYZ crop, TakeoffOptions opt, Action<string> log)
    {
        double lvlZ = level.ProjectElevation; // NEVER Level.Elevation: survey datum put Chadds
                                              // levels +348 ft off the geometry (2026-07-06)
        var hf = new Heightfield {
            MinX = crop.Min.X, MinY = crop.Min.Y, CellFt = opt.CellFt,
            W = (int)Math.Ceiling((crop.Max.X - crop.Min.X) / opt.CellFt),
            H = (int)Math.Ceiling((crop.Max.Y - crop.Min.Y) / opt.CellFt),
        };
        int n = hf.W * hf.H;
        hf.FloorZ = new float[n]; hf.CeilZ = new float[n];
        for (int i = 0; i < n; i++) { hf.FloorZ[i] = float.NaN; hf.CeilZ[i] = float.NaN; }

        double zLo = lvlZ - opt.FloorTolFt - 1.0, zHi = lvlZ + 14.0;
        var geoOpt = new Options { DetailLevel = ViewDetailLevel.Medium, IncludeNonVisibleObjects = false };
        int nElems = 0, nTris = 0;
        foreach (var src in EnumerateSources(doc))
        {
            foreach (var e in new FilteredElementCollector(src.doc).WhereElementIsNotElementType())
            {
                // Site geometry must NOT feed the field: tree canopies read as ceilings and
                // sloped terraces as floors — a whole gatehouse YARD detected as a room on
                // Chadds until these were excluded. Room floors/ceilings are building geometry.
                var cid = e.Category?.Id;
                if (cid != null && SiteCategories.Contains(cid)) continue;
                var bb = e.get_BoundingBox(null);
                if (bb == null) continue;
                // bb is in LINK coords; the window test must happen in HOST coords. IFC link
                // transforms are non-identity (Chadds origin z -18.2) — round-1 pods silently
                // prefiltered the wrong slab of the building by skipping this.
                if (!BoxCrossesWindow(bb, src.xf, zLo, zHi, crop)) continue;
                var ge = e.get_Geometry(geoOpt);
                if (ge == null) continue;
                nElems++;
                nTris += WalkGeometry(ge, src.xf, hf, lvlZ, opt, 0);
            }
        }

        // joist-only floors (framing stage, no subfloor yet): close <= 0.75 ft gaps in the floor
        // mask by copying the nearest floor z — round-2 heightfield pod lesson.
        FillFloorGaps(hf, (int)Math.Ceiling(0.75 / opt.CellFt));

        int floorCells = 0;
        for (int i = 0; i < n; i++)
            if (!float.IsNaN(hf.FloorZ[i]) && Math.Abs(hf.FloorZ[i] - lvlZ) <= opt.FloorTolFt) floorCells++;
        log($"[heightfield] {hf.W}x{hf.H} elems={nElems} tris={nTris} floorCells={floorCells}");
        return hf;
    }

    // The envelope can span multiple links (Snowdon needed Facades+Structural to close "outside")
    // and host-modeled geometry counts too — merge host + every loaded link.
    private static IEnumerable<(Document doc, Transform xf)> EnumerateSources(Document host)
    {
        yield return (host, Transform.Identity);
        foreach (var li in new FilteredElementCollector(host).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
        {
            var ld = li.GetLinkDocument();
            if (ld != null) yield return (ld, li.GetTotalTransform());
        }
    }

    private static bool BoxCrossesWindow(BoundingBoxXYZ bb, Transform xf, double zLo, double zHi, BoundingBoxXYZ crop)
    {
        double x0 = double.MaxValue, y0 = double.MaxValue, z0 = double.MaxValue;
        double x1 = double.MinValue, y1 = double.MinValue, z1 = double.MinValue;
        foreach (var cx in new[] { bb.Min.X, bb.Max.X })
            foreach (var cy in new[] { bb.Min.Y, bb.Max.Y })
                foreach (var cz in new[] { bb.Min.Z, bb.Max.Z })
                {
                    var p = xf.OfPoint(new XYZ(cx, cy, cz));
                    x0 = Math.Min(x0, p.X); x1 = Math.Max(x1, p.X);
                    y0 = Math.Min(y0, p.Y); y1 = Math.Max(y1, p.Y);
                    z0 = Math.Min(z0, p.Z); z1 = Math.Max(z1, p.Z);
                }
        return z0 <= zHi && z1 >= zLo && x0 <= crop.Max.X && x1 >= crop.Min.X && y0 <= crop.Max.Y && y1 >= crop.Min.Y;
    }

    private static int WalkGeometry(GeometryElement ge, Transform xf, Heightfield hf, double lvlZ, TakeoffOptions opt, int depth)
    {
        if (depth > 4) return 0;
        int n = 0;
        foreach (var go in ge)
        {
            if (go is Solid s && s.Faces.Size > 0)
            {
                foreach (Face f in s.Faces)
                {
                    Mesh? m; try { m = f.Triangulate(); } catch { continue; }
                    if (m != null) n += StampMesh(m, xf, hf, lvlZ, opt);
                }
            }
            else if (go is Mesh mm) n += StampMesh(mm, xf, hf, lvlZ, opt);
            else if (go is GeometryInstance gi)
            {
                GeometryElement? ig; try { ig = gi.GetInstanceGeometry(); } catch { continue; }
                if (ig != null) n += WalkGeometry(ig, xf, hf, lvlZ, opt, depth + 1);
            }
        }
        return n;
    }

    private static int StampMesh(Mesh m, Transform xf, Heightfield hf, double lvlZ, TakeoffOptions opt)
    {
        int added = 0;
        double floorLo = lvlZ - opt.FloorTolFt, floorHi = lvlZ + opt.FloorTolFt;
        for (int i = 0; i < m.NumTriangles; i++)
        {
            var t = m.get_Triangle(i);
            var a = xf.OfPoint(t.get_Vertex(0)); var b = xf.OfPoint(t.get_Vertex(1)); var c = xf.OfPoint(t.get_Vertex(2));
            added++;
            double ux = b.X - a.X, uy = b.Y - a.Y, uz = b.Z - a.Z;
            double vx = c.X - a.X, vy = c.Y - a.Y, vz = c.Z - a.Z;
            double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            double nl = Math.Sqrt(nx * nx + ny * ny + nz * nz);
            if (nl < 1e-12) continue;
            double vert = Math.Abs(nz) / nl; // 1 = horizontal surface, 0 = vertical surface
            if (vert < 0.5) continue;        // vertical geometry is ink's job (walls are drawn)
            double tz0 = Math.Min(a.Z, Math.Min(b.Z, c.Z)), tz1 = Math.Max(a.Z, Math.Max(b.Z, c.Z));

            // horizontal-ish: candidate floor (in the level window) and/or ceiling (above it)
            bool asFloor = tz1 >= floorLo && tz0 <= floorHi;
            bool asCeil = tz1 > floorHi; // anything overhead counts toward the ceiling probe
            if (asFloor || asCeil)
                RasterizeTri(a, b, c, hf, (idx, z) => {
                    if (asFloor && z >= floorLo && z <= floorHi)
                        if (float.IsNaN(hf.FloorZ[idx]) || z > hf.FloorZ[idx]) hf.FloorZ[idx] = (float)z;
                    if (asCeil && z > floorHi)
                        if (float.IsNaN(hf.CeilZ[idx]) || z < hf.CeilZ[idx]) hf.CeilZ[idx] = (float)z;
                });
        }
        return added;
    }

    // Scanline-free triangle footprint rasterization: bbox walk + barycentric inside test.
    // Cells are 0.25 ft; framing triangles are small, so the bbox walk is near-optimal.
    private static void RasterizeTri(XYZ a, XYZ b, XYZ c, Heightfield hf, Action<int, double> visit)
    {
        double minx = Math.Min(a.X, Math.Min(b.X, c.X)), maxx = Math.Max(a.X, Math.Max(b.X, c.X));
        double miny = Math.Min(a.Y, Math.Min(b.Y, c.Y)), maxy = Math.Max(a.Y, Math.Max(b.Y, c.Y));
        int gx0 = Math.Max(0, (int)((minx - hf.MinX) / hf.CellFt)), gx1 = Math.Min(hf.W - 1, (int)((maxx - hf.MinX) / hf.CellFt));
        int gy0 = Math.Max(0, (int)((miny - hf.MinY) / hf.CellFt)), gy1 = Math.Min(hf.H - 1, (int)((maxy - hf.MinY) / hf.CellFt));
        if (gx1 < gx0 || gy1 < gy0) return;
        double d = (b.Y - c.Y) * (a.X - c.X) + (c.X - b.X) * (a.Y - c.Y);
        bool degenerate = Math.Abs(d) < 1e-12;
        for (int gy = gy0; gy <= gy1; gy++)
        {
            for (int gx = gx0; gx <= gx1; gx++)
            {
                double px = hf.MinX + (gx + 0.5) * hf.CellFt, py = hf.MinY + (gy + 0.5) * hf.CellFt;
                double z;
                if (degenerate) z = (a.Z + b.Z + c.Z) / 3;
                else
                {
                    double w1 = ((b.Y - c.Y) * (px - c.X) + (c.X - b.X) * (py - c.Y)) / d;
                    double w2 = ((c.Y - a.Y) * (px - c.X) + (a.X - c.X) * (py - c.Y)) / d;
                    double w3 = 1 - w1 - w2;
                    const double eps = -0.15; // slight slack: a cell whose center grazes the edge still counts
                    if (w1 < eps || w2 < eps || w3 < eps) continue;
                    z = w1 * a.Z + w2 * b.Z + w3 * c.Z;
                }
                visit(gy * hf.W + gx, z);
            }
        }
    }

    private static void FillFloorGaps(Heightfield hf, int radius)
    {
        if (radius <= 0) return;
        var src = (float[])hf.FloorZ.Clone();
        for (int y = 0; y < hf.H; y++)
            for (int x = 0; x < hf.W; x++)
            {
                int i = y * hf.W + x;
                if (!float.IsNaN(src[i])) continue;
                for (int dy = -radius; dy <= radius && float.IsNaN(hf.FloorZ[i]); dy++)
                    for (int dx = -radius; dx <= radius; dx++)
                    {
                        int nx2 = x + dx, ny2 = y + dy;
                        if (nx2 < 0 || ny2 < 0 || nx2 >= hf.W || ny2 >= hf.H) continue;
                        if (!float.IsNaN(src[ny2 * hf.W + nx2])) { hf.FloorZ[i] = src[ny2 * hf.W + nx2]; break; }
                    }
            }
    }
}
