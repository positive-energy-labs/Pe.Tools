namespace Pe.Revit.Takeoff;

// Persisted raw seed-ink raster (pre-gap-seal) and its "is there wall evidence near this point"
// oracle. INK DEFINES SHAPE: the boundary network uses this to tell real curved walls (ink under
// the curve) from raster equidistance seams at openings (no ink), which no geometric test can.
internal static class InkSupport
{
    private const uint Magic = 0x504B4E49; // "INKP"

    internal static void Save(string path, int w, int h, double minX, double minY, double cellFt, bool[] ink)
    {
        using var writer = new BinaryWriter(File.Create(path));
        writer.Write(Magic);
        writer.Write(w); writer.Write(h);
        writer.Write(minX); writer.Write(minY); writer.Write(cellFt);
        var bits = new byte[(w * h + 7) / 8];
        for (int i = 0; i < w * h; i++)
            if (ink[i]) bits[i >> 3] |= (byte)(1 << (i & 7));
        writer.Write(bits);
    }

    // Returns an oracle answering "is any raw ink within radiusFt of (x, y)", or null if the file
    // is absent (older artifacts): callers must degrade to geometry-only behavior.
    internal static Func<double, double, bool>? LoadOracle(string path, double radiusFt)
    {
        if (!File.Exists(path)) return null;
        using var reader = new BinaryReader(File.OpenRead(path));
        if (reader.ReadUInt32() != Magic) throw new InvalidOperationException($"{path} is not an ink raster");
        int w = reader.ReadInt32(), h = reader.ReadInt32();
        double minX = reader.ReadDouble(), minY = reader.ReadDouble(), cellFt = reader.ReadDouble();
        var bits = reader.ReadBytes((w * h + 7) / 8);
        var ink = new bool[w * h];
        for (int i = 0; i < w * h; i++)
            ink[i] = (bits[i >> 3] & 1 << (i & 7)) != 0;

        // separable square dilation by the support radius (box, not disk — close enough here)
        int radius = Math.Max(1, (int)Math.Round(radiusFt / cellFt));
        var pass = new bool[w * h];
        for (int y = 0; y < h; y++)
        {
            int run = -1;
            for (int x = 0; x < w; x++)
            {
                if (ink[y * w + x]) run = radius;
                pass[y * w + x] = run >= 0;
                if (run >= 0) run--;
            }
            run = -1;
            for (int x = w - 1; x >= 0; x--)
            {
                if (ink[y * w + x]) run = radius;
                if (run >= 0) { pass[y * w + x] = true; run--; }
            }
        }
        var dilated = new bool[w * h];
        for (int x = 0; x < w; x++)
        {
            int run = -1;
            for (int y = 0; y < h; y++)
            {
                if (pass[y * w + x]) run = radius;
                dilated[y * w + x] = run >= 0;
                if (run >= 0) run--;
            }
            run = -1;
            for (int y = h - 1; y >= 0; y--)
            {
                if (pass[y * w + x]) run = radius;
                if (run >= 0) { dilated[y * w + x] = true; run--; }
            }
        }

        return (x, y) => {
            int cx = (int)Math.Floor((x - minX) / cellFt), cy = (int)Math.Floor((y - minY) / cellFt);
            return cx >= 0 && cy >= 0 && cx < w && cy < h && dilated[cy * w + cx];
        };
    }
}
