namespace Pe.Revit.Placement;

// Level-scoped, z-band-bounded bounding-box obstacle index over host elements AND link geometry.
// Ported from mep-solve, including the hard-won LocationCurve wall decomposition (fat diagonal-wall
// AABBs poison a lattice; decomposed 2-ft segments fixed routing globally).
// ponytail: bbox-only v1 (no solid accuracy); good enough for corridor routing + honest collision counts.
internal sealed class ObstacleBox
{
    public double X0, Y0, Z0, X1, Y1, Z1;
    public string Group = "";   // mep | walls | structure | equipment | terminals | keepout
    public string Label = "";
    public long Id;

    public bool OverlapsZ(double z0, double z1, double pad) => Z0 - pad < z1 && Z1 + pad > z0;
    public bool ContainsXY(double x, double y, double pad) => x > X0 - pad && x < X1 + pad && y > Y0 - pad && y < Y1 + pad;

    public double DistXY(double x0, double y0, double x1, double y1)
    {
        double dx = Math.Max(Math.Max(X0 - x1, x0 - X1), 0);
        double dy = Math.Max(Math.Max(Y0 - y1, y0 - Y1), 0);
        return Math.Sqrt(dx * dx + dy * dy);
    }
}

internal sealed class ObstacleIndex
{
    public List<ObstacleBox> Boxes = new List<ObstacleBox>();
    public string Summary = "";

    // Region + z-window clipped build. Marker-tagged (mine) elements are always excluded.
    public static ObstacleIndex Build(Document doc, double x0, double y0, double x1, double y1, double zLo, double zHi)
    {
        var ix = new ObstacleIndex();

        // Host: MEP curves/fittings, equipment, terminals
        AddHost(ix, doc, new[] { BuiltInCategory.OST_DuctCurves, BuiltInCategory.OST_DuctFitting,
            BuiltInCategory.OST_FlexDuctCurves, BuiltInCategory.OST_DuctAccessory,
            BuiltInCategory.OST_PipeCurves, BuiltInCategory.OST_PipeFitting }, "mep", x0, y0, x1, y1, zLo, zHi);
        AddHost(ix, doc, new[] { BuiltInCategory.OST_MechanicalEquipment }, "equipment", x0, y0, x1, y1, zLo, zHi);
        AddHost(ix, doc, new[] { BuiltInCategory.OST_DuctTerminal }, "terminals", x0, y0, x1, y1, zLo, zHi);

        // Links by discipline
        foreach (var li in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
        {
            var ld = li.GetLinkDocument();
            if (ld == null) continue;
            var tf = li.GetTotalTransform();
            var n = li.Name.ToLowerInvariant();
            if (n.Contains("architectural"))
            {
                AddLink(ix, ld, tf, new[] { BuiltInCategory.OST_Walls }, "walls", x0, y0, x1, y1, zLo, zHi);
                AddLink(ix, ld, tf, new[] { BuiltInCategory.OST_Columns }, "structure", x0, y0, x1, y1, zLo, zHi);
            }
            else if (n.Contains("structural"))
                AddLink(ix, ld, tf, new[] { BuiltInCategory.OST_StructuralFraming, BuiltInCategory.OST_StructuralColumns },
                    "structure", x0, y0, x1, y1, zLo, zHi);
            else if (n.Contains("plumbing"))
                AddLink(ix, ld, tf, new[] { BuiltInCategory.OST_PipeCurves, BuiltInCategory.OST_PipeFitting }, "mep",
                    x0, y0, x1, y1, zLo, zHi);
            else if (n.Contains("electrical"))
                AddLink(ix, ld, tf, new[] { BuiltInCategory.OST_CableTray, BuiltInCategory.OST_Conduit }, "mep",
                    x0, y0, x1, y1, zLo, zHi);
        }

        var byGroup = ix.Boxes.GroupBy(b => b.Group).OrderBy(g => g.Key)
            .Select(g => $"{g.Key} {g.Count()}");
        ix.Summary = $"{ix.Boxes.Count} boxes in band [{zLo:F1},{zHi:F1}] ({string.Join(", ", byGroup)})";
        return ix;
    }

    public void AddKeepOut(double x0, double y0, double x1, double y1, double zLo, double zHi, string name)
    {
        Boxes.Add(new ObstacleBox
        {
            X0 = Math.Min(x0, x1), Y0 = Math.Min(y0, y1), Z0 = zLo,
            X1 = Math.Max(x0, x1), Y1 = Math.Max(y0, y1), Z1 = zHi,
            Group = "keepout", Label = name, Id = 0,
        });
    }

    static void AddHost(ObstacleIndex ix, Document doc, BuiltInCategory[] cats, string group,
        double x0, double y0, double x1, double y1, double zLo, double zHi)
    {
        var col = new FilteredElementCollector(doc)
            .WherePasses(new ElementMulticategoryFilter(cats.ToList()))
            .WhereElementIsNotElementType();
        foreach (var e in col)
        {
            if (TK.IsMine(e)) continue;
            var bb = e.get_BoundingBox(null);
            if (bb == null) continue;
            Clip(ix, bb.Min, bb.Max, null, group, e.Id.Value, e.Category?.Name ?? "?", x0, y0, x1, y1, zLo, zHi);
        }
    }

    static void AddLink(ObstacleIndex ix, Document ld, Transform tf, BuiltInCategory[] cats, string group,
        double x0, double y0, double x1, double y1, double zLo, double zHi)
    {
        var col = new FilteredElementCollector(ld)
            .WherePasses(new ElementMulticategoryFilter(cats.ToList()))
            .WhereElementIsNotElementType();
        foreach (var e in col)
        {
            var bb = e.get_BoundingBox(null);
            if (bb == null) continue;
            // Diagonal walls have fat AABBs that poison the lattice — decompose along the location curve.
            if (group == "walls" && e is Wall w && (bb.Max.X - bb.Min.X) > 3 && (bb.Max.Y - bb.Min.Y) > 3
                && w.Location is LocationCurve lc && lc.Curve != null && lc.Curve.IsBound)
            {
                double wz0 = double.MaxValue, wz1 = double.MinValue;
                for (int i = 0; i < 8; i++)
                {
                    var pz = tf.OfPoint(new XYZ((i & 1) == 0 ? bb.Min.X : bb.Max.X, (i & 2) == 0 ? bb.Min.Y : bb.Max.Y, (i & 4) == 0 ? bb.Min.Z : bb.Max.Z)).Z;
                    wz0 = Math.Min(wz0, pz); wz1 = Math.Max(wz1, pz);
                }
                if (wz1 < zLo || wz0 > zHi) continue;
                double half = w.Width / 2 + 0.1;
                var pts = lc.Curve.Tessellate().Select(p => tf.OfPoint(p)).ToList();
                for (int i = 1; i < pts.Count; i++)
                {
                    double segLen = pts[i].DistanceTo(pts[i - 1]);
                    int nSeg = Math.Max(1, (int)Math.Ceiling(segLen / 2.0));
                    for (int s = 0; s < nSeg; s++)
                    {
                        var a = pts[i - 1] + (pts[i] - pts[i - 1]).Multiply((double)s / nSeg);
                        var b = pts[i - 1] + (pts[i] - pts[i - 1]).Multiply((double)(s + 1) / nSeg);
                        double sx0 = Math.Min(a.X, b.X) - half, sx1 = Math.Max(a.X, b.X) + half;
                        double sy0 = Math.Min(a.Y, b.Y) - half, sy1 = Math.Max(a.Y, b.Y) + half;
                        if (sx1 < x0 || sx0 > x1 || sy1 < y0 || sy0 > y1) continue;
                        ix.Boxes.Add(new ObstacleBox { X0 = sx0, Y0 = sy0, Z0 = wz0, X1 = sx1, Y1 = sy1, Z1 = wz1, Group = group, Id = e.Id.Value, Label = "link:WallSeg" });
                    }
                }
                continue;
            }
            Clip(ix, bb.Min, bb.Max, tf, group, e.Id.Value, $"link:{e.Category?.Name ?? "?"}", x0, y0, x1, y1, zLo, zHi);
        }
    }

    static void Clip(ObstacleIndex ix, XYZ mn, XYZ mx, Transform tf, string group, long id, string label,
        double x0, double y0, double x1, double y1, double zLo, double zHi)
    {
        double bx0 = mn.X, by0 = mn.Y, bz0 = mn.Z, bx1 = mx.X, by1 = mx.Y, bz1 = mx.Z;
        if (tf != null && !tf.IsIdentity)
        {
            bx0 = by0 = bz0 = double.MaxValue; bx1 = by1 = bz1 = double.MinValue;
            for (int i = 0; i < 8; i++)
            {
                var p = tf.OfPoint(new XYZ((i & 1) == 0 ? mn.X : mx.X, (i & 2) == 0 ? mn.Y : mx.Y, (i & 4) == 0 ? mn.Z : mx.Z));
                bx0 = Math.Min(bx0, p.X); by0 = Math.Min(by0, p.Y); bz0 = Math.Min(bz0, p.Z);
                bx1 = Math.Max(bx1, p.X); by1 = Math.Max(by1, p.Y); bz1 = Math.Max(bz1, p.Z);
            }
        }
        if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1 || bz1 < zLo || bz0 > zHi) return;
        ix.Boxes.Add(new ObstacleBox { X0 = bx0, Y0 = by0, Z0 = bz0, X1 = bx1, Y1 = by1, Z1 = bz1, Group = group, Id = id, Label = label });
    }

    // Occupancy grid for A*: 0 free, 1 near-obstacle (soft cost), 2 blocked.
    // Cell centers at (ox + i*cell, oy + j*cell). Obstacles inflated by halfXY + clearance.
    public byte[,] Occupancy(double ox, double oy, int nx, int ny, double cell,
        double halfXY, double z0, double z1, double clearance, Func<string, bool> avoid)
    {
        var g = new byte[nx, ny];
        foreach (var b in Boxes)
        {
            if (!avoid(b.Group) && b.Group != "keepout") continue;
            if (!b.OverlapsZ(z0, z1, clearance)) continue;
            Mark(g, b, ox, oy, nx, ny, cell, halfXY + clearance + cell, 1);
        }
        foreach (var b in Boxes)
        {
            if (!avoid(b.Group) && b.Group != "keepout") continue;
            if (!b.OverlapsZ(z0, z1, clearance)) continue;
            Mark(g, b, ox, oy, nx, ny, cell, halfXY + clearance, 2);
        }
        return g;
    }

    static void Mark(byte[,] g, ObstacleBox b, double ox, double oy, int nx, int ny, double cell, double pad, byte v)
    {
        int i0 = Math.Max(0, (int)Math.Floor((b.X0 - pad - ox) / cell));
        int i1 = Math.Min(nx - 1, (int)Math.Ceiling((b.X1 + pad - ox) / cell));
        int j0 = Math.Max(0, (int)Math.Floor((b.Y0 - pad - oy) / cell));
        int j1 = Math.Min(ny - 1, (int)Math.Ceiling((b.Y1 + pad - oy) / cell));
        for (int i = i0; i <= i1; i++)
            for (int j = j0; j <= j1; j++)
                if (g[i, j] < v && b.ContainsXY(ox + i * cell, oy + j * cell, pad))
                    g[i, j] = v;
    }

    // Boxes (from avoided groups) covering a point at a z-range — used to NAME blockers.
    // padXY matches the router's inflation; clearZ matches its z filter.
    public List<ObstacleBox> At(double x, double y, double z0, double z1, double padXY, double clearZ, Func<string, bool> avoid)
        => Boxes.Where(b => (avoid(b.Group) || b.Group == "keepout") && b.OverlapsZ(z0, z1, clearZ) && b.ContainsXY(x, y, padXY)).ToList();

    // Hard hits (zero clearance) of an axis-aligned box vs the full index.
    public List<ObstacleBox> HardHits(double sx0, double sy0, double sz0, double sx1, double sy1, double sz1)
        => Boxes.Where(b => b.X0 < sx1 && b.X1 > sx0 && b.Y0 < sy1 && b.Y1 > sy0 && b.Z0 < sz1 && b.Z1 > sz0).ToList();

    // Min XY distance from a segment box to any z-overlapping obstacle, capped at 12 in. Returns (inches, label).
    public (double, string) MinClearIn(double sx0, double sy0, double sz0, double sx1, double sy1, double sz1)
    {
        double best = 1.0; string label = "";
        foreach (var b in Boxes)
        {
            if (!b.OverlapsZ(sz0, sz1, 0)) continue;
            var d = b.DistXY(sx0, sy0, sx1, sy1);
            if (d < best) { best = d; label = $"{b.Group} {b.Label} {b.Id} @({(b.X0 + b.X1) / 2:F1},{(b.Y0 + b.Y1) / 2:F1})"; }
        }
        return (best * 12.0, label);
    }
}
