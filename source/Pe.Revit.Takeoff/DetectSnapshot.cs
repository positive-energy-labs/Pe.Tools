using System.IO.Compression;

namespace Pe.Revit.Takeoff;

// Persisted post-Revit intermediate state: exactly what Detector.Detect consumes and nothing
// else — the heightfield rasters, the composed seed ink, and the level identity. RoomTakeoff
// .Detect dumps one per live run (replay_<level>.bin, gzip); Replay() reruns region detection +
// polygonization offline with ARBITRARY TakeoffOptions, so detection changes iterate in seconds
// against real captured state (NoDocumentRuntime tests) instead of through live bridge runs.
//
// HONESTY BOUNDARY — what replay can and cannot prove. Everything downstream of the snapshot is
// exercised for real: obstruction morphology, door sealers, region growing, ceiling/compactness
// gates, partition propagation, loop tracing, TSV. Everything UPSTREAM is baked at capture time
// and CANNOT be re-tuned offline:
//   - heightfield build window: FloorTolFt, StoryCapFt, CeilingCloseFt (CeilZ above the capture
//     cap simply is not in the file; widening FloorTolFt offline cannot add floor cells)
//   - ink composition: band cut heights, BandPairSeparationFt, HeaderNearFt gating, SeedPixelSize
//   - CellFt: the rasters are fixed-resolution; Replay fail-fasts on a mismatch
// CaptureOptions records those baked knobs so an offline session knows what it is standing on.
// Changing any of them still needs a live re-capture (run-takeoff.py).
public sealed class DetectSnapshot
{
    private const uint Magic = 0x54414B53; // "SKAT"
    private const int Version = 1;

    public string LevelName = "";
    public double LevelElevation;
    public string CaptureOptions = "";   // capture-baked knobs, informational (see header)
    public Heightfield Field = null!;
    public bool[] SeedInk = null!;

    public TakeoffResult Replay(TakeoffOptions opt, Action<string> log)
    {
        if (Math.Abs(opt.CellFt - this.Field.CellFt) > 1e-9)
            throw new InvalidOperationException(
                $"snapshot was captured at CellFt={this.Field.CellFt} but options ask for {opt.CellFt} — " +
                "the rasters are fixed-resolution; re-capture live to change cell size");
        log($"[replay] level='{this.LevelName}' {this.Field.W}x{this.Field.H} capture[{this.CaptureOptions}]");
        return Detector.Detect(this.Field, this.SeedInk, this.LevelName, this.LevelElevation, opt, log);
    }

    public static void Save(string path, DetectSnapshot snap)
    {
        int n = snap.Field.W * snap.Field.H;
        if (snap.Field.FloorZ.Length != n || snap.Field.CeilZ.Length != n || snap.SeedInk.Length != n)
            throw new InvalidOperationException($"snapshot arrays disagree with {snap.Field.W}x{snap.Field.H}");
        using var gz = new GZipStream(File.Create(path), CompressionLevel.Optimal);
        using var w = new BinaryWriter(gz);
        w.Write(Magic); w.Write(Version);
        w.Write(snap.LevelName); w.Write(snap.LevelElevation); w.Write(snap.CaptureOptions);
        w.Write(snap.Field.W); w.Write(snap.Field.H);
        w.Write(snap.Field.MinX); w.Write(snap.Field.MinY); w.Write(snap.Field.CellFt);
        w.Write(FloatBytes(snap.Field.FloorZ));
        w.Write(FloatBytes(snap.Field.CeilZ));
        var bits = new byte[(n + 7) / 8];
        for (int i = 0; i < n; i++)
            if (snap.SeedInk[i]) bits[i >> 3] |= (byte)(1 << (i & 7));
        w.Write(bits);
    }

    public static DetectSnapshot Load(string path)
    {
        using var gz = new GZipStream(File.OpenRead(path), CompressionMode.Decompress);
        using var r = new BinaryReader(gz);
        if (r.ReadUInt32() != Magic) throw new InvalidOperationException($"{path} is not a detect snapshot");
        int version = r.ReadInt32();
        if (version != Version) throw new InvalidOperationException($"{path} is snapshot v{version}; this build reads v{Version}");
        var snap = new DetectSnapshot {
            LevelName = r.ReadString(), LevelElevation = r.ReadDouble(), CaptureOptions = r.ReadString(),
        };
        var hf = new Heightfield { W = r.ReadInt32(), H = r.ReadInt32() };
        hf.MinX = r.ReadDouble(); hf.MinY = r.ReadDouble(); hf.CellFt = r.ReadDouble();
        int n = hf.W * hf.H;
        hf.FloorZ = ReadFloats(r, n);
        hf.CeilZ = ReadFloats(r, n);
        snap.Field = hf;
        var bits = ReadExactly(r, (n + 7) / 8);
        snap.SeedInk = new bool[n];
        for (int i = 0; i < n; i++)
            snap.SeedInk[i] = (bits[i >> 3] & 1 << (i & 7)) != 0;
        return snap;
    }

    internal static string CaptureOptionsOf(TakeoffOptions opt)
    {
        var ic = CultureInfo.InvariantCulture;
        return string.Join(" ",
            $"CellFt={opt.CellFt.ToString(ic)}",
            $"FloorTolFt={opt.FloorTolFt.ToString(ic)}",
            $"StoryCapFt={opt.StoryCapFt.ToString(ic)}",
            $"CeilingCloseFt={opt.CeilingCloseFt.ToString(ic)}",
            $"KneeBandFt={opt.KneeBandFt.ToString(ic)}",
            $"HeaderBandFt={opt.HeaderBandFt.ToString(ic)}",
            $"BandPairSeparationFt={opt.BandPairSeparationFt.ToString(ic)}",
            $"HeaderNearFt={opt.HeaderNearFt.ToString(ic)}",
            $"SeedPixelSize={opt.SeedPixelSize.ToString(ic)}");
    }

    private static byte[] FloatBytes(float[] src)
    {
        var bytes = new byte[src.Length * 4];
        Buffer.BlockCopy(src, 0, bytes, 0, bytes.Length);
        return bytes;
    }

    private static float[] ReadFloats(BinaryReader r, int count)
    {
        var bytes = ReadExactly(r, count * 4);
        var floats = new float[count];
        Buffer.BlockCopy(bytes, 0, floats, 0, bytes.Length);
        return floats;
    }

    // BinaryReader.ReadBytes over a GZipStream may return short reads; loop until filled.
    private static byte[] ReadExactly(BinaryReader r, int count)
    {
        var bytes = new byte[count];
        int got = 0;
        while (got < count)
        {
            int read = r.Read(bytes, got, count - got);
            if (read <= 0) throw new EndOfStreamException($"snapshot truncated: wanted {count} bytes, got {got}");
            got += read;
        }
        return bytes;
    }
}
