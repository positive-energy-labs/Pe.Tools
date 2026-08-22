using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace HistoricalF970;

internal sealed class Heightfield
{
    internal int W, H;
    internal double MinX, MinY, CellFt;
    internal float[] FloorZ = [];
    internal float[] CeilZ = [];
}

internal sealed class TakeoffOptions
{
    public double CellFt = 0.25;
    public double MinSqft = 20;
    public double MinHeadroomFt = 6.0;
    public double FloorTolFt = 1.5;
    public double GapSealFt = 1.5;
    public double MinCeilingFrac = 0.30;
    public double MinCompactness = 0.09;
    public double PartitionFillFt = 1.0;
    public double MaxEnclosedResidualSqft = 25;
}

internal sealed class RoomResult
{
    internal string Id = "";
    internal double RawSqft;
    internal double PerimeterFt;
    internal double LabelX, LabelY;
    internal double MeanCeilingFt;
    internal List<double[]> Polygon = [];
    internal List<List<double[]>> Holes = [];
}

internal sealed class TakeoffResult
{
    internal string LevelName = "";
    internal double LevelElevation;
    internal List<RoomResult> Rooms = [];
    internal double TotalSqft;
}

internal sealed record Detection(TakeoffResult Result, bool[] ClosedObstruction);
internal sealed record Replay(string LevelName, double LevelElevation, Heightfield Field, bool[] SeedInk);
internal sealed record ZoneRecord(string View, double[][][] Loops);
internal sealed record Zone(string Name, string Level, List<List<double[]>> Loops);

internal static class Program
{
    private const uint ReplayMagic = 0x54414B53;
    private const uint InkMagic = 0x504B4E49;
    private static readonly JsonSerializerOptions Json = new() {
        IncludeFields = true,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };
    private static readonly (string Level, string Token)[] Levels = [
        ("Lower Level", "Level_0_Lower_Level"),
        ("Main Level", "Level_1_Main_Level"),
        ("Upper Level", "Level_2_Upper_Level"),
        ("Attic Level", "Level_3_Attic"),
    ];

    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-check") return SelfCheck();
        string input = Required(args, "--input");
        string zonesPath = Required(args, "--zones");
        string pool = Required(args, "--pool");
        Directory.CreateDirectory(pool);

        var options = new TakeoffOptions();
        string optionsHash = Hash("f970088|" + JsonSerializer.Serialize(options, Json))[..12];
        var stamp = DateTimeOffset.UtcNow;
        string runId = $"{stamp:yyyyMMdd-HHmmss}-{optionsHash}";
        string runDir = Path.Combine(pool, runId);
        Directory.CreateDirectory(Path.Combine(runDir, "input"));
        Directory.CreateDirectory(Path.Combine(runDir, "zones"));

        var sourceZones = JsonSerializer.Deserialize<List<ZoneRecord>>(File.ReadAllText(zonesPath), Json)
            ?? throw new InvalidDataException($"unreadable zones: {zonesPath}");
        var reportZones = new List<object>();
        var unassigned = new List<string>();
        int levelIndex = 0;
        foreach (var (level, token) in Levels)
        {
            levelIndex++;
            string replayPath = Path.Combine(input, $"replay_{token}.bin");
            if (!File.Exists(replayPath)) throw new FileNotFoundException("missing replay", replayPath);
            var replay = LoadReplay(replayPath);
            if (!replay.LevelName.Contains(level.Split(' ')[0], StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException($"{replayPath}: replay level '{replay.LevelName}' disagrees with {level}");

            var detection = Detector.Detect(replay.Field, replay.SeedInk, replay.LevelName,
                replay.LevelElevation, options, Console.WriteLine);
            var zones = sourceZones
                .Where(record => record.View.Contains(level, StringComparison.Ordinal))
                .Select((record, index) => new Zone($"{level}#{index:D2}", level,
                    record.Loops.Select(loop => loop.Select(point => new[] { point[0], point[1] }).ToList()).ToList()))
                .ToList();

            string replayTarget = Path.Combine(runDir, "input", $"replay_{token}.bin");
            File.Copy(replayPath, replayTarget, true);
            SaveInk(Path.Combine(runDir, "input", $"ink_{token}.bin"), replay.Field, replay.SeedInk);
            SaveInk(Path.Combine(runDir, "input", $"seals_{token}.bin"), replay.Field, new bool[replay.SeedInk.Length]);
            SaveInk(Path.Combine(runDir, "input", $"close_{token}.bin"), replay.Field,
                detection.ClosedObstruction.Select((value, index) => value && !replay.SeedInk[index]).ToArray());

            var assignments = zones.ToDictionary(zone => zone.Name, _ => new List<RoomResult>());
            foreach (var room in detection.Result.Rooms)
            {
                var zone = zones.FirstOrDefault(candidate => ContainsEvenOdd(candidate.Loops, room.LabelX, room.LabelY));
                if (zone == null) unassigned.Add($"{level}/{room.Id}");
                else assignments[zone.Name].Add(room);
            }

            int zoneIndex = 0;
            foreach (var zone in zones)
            {
                zoneIndex++;
                var rooms = assignments[zone.Name];
                string slug = $"{levelIndex:D2}_{zoneIndex:D2}_{Slug(zone.Name)}";
                string tsvRel = $"zones/rooms_{slug}.tsv";
                File.WriteAllText(Path.Combine(runDir, tsvRel.Replace('/', Path.DirectorySeparatorChar)),
                    ToTsv(detection.Result, rooms));
                var points = zone.Loops.SelectMany(loop => loop).ToList();
                double minX = points.Min(point => point[0]);
                double minY = points.Min(point => point[1]);
                double maxX = points.Max(point => point[0]);
                double maxY = points.Max(point => point[1]);
                double acceptedSqft = rooms.Sum(room => room.RawSqft);
                bool contained = rooms.All(room => room.Polygon.Concat(room.Holes.SelectMany(hole => hole))
                    .All(point => ContainsOrBoundary(zone.Loops, point[0], point[1])));
                reportZones.Add(new {
                    Level = level,
                    Zone = zone.Name,
                    MinX = minX,
                    MinY = minY,
                    MaxX = maxX,
                    MaxY = maxY,
                    ZoneLoops = zone.Loops,
                    Tsv = tsvRel,
                    Ink = $"input/ink_{token}.bin",
                    Seals = $"input/seals_{token}.bin",
                    Close = $"input/close_{token}.bin",
                    OracleRooms = 0,
                    RawRooms = rooms.Count,
                    AcceptedRooms = rooms.Count,
                    HeldRooms = 0,
                    PartitionSqft = acceptedSqft,
                    AcceptedSqft = acceptedSqft,
                    HeldSqft = 0.0,
                    VoidSqft = 0.0,
                    ExcludedSqft = 0.0,
                    ZoneSqft = Math.Abs(zone.Loops.Sum(SignedArea)),
                    InkBackedEdgeFraction = 0.0,
                    StrictlyEditable = rooms.All(IsOrthogonal),
                    Contained = contained,
                    Rejections = new Dictionary<string, int>(),
                    RejectionDetails = new Dictionary<string, string>(),
                    adaptedKnobs = new Dictionary<string, string>(),
                    census = new { zoneSqft = Math.Abs(zone.Loops.Sum(SignedArea)), inkSqft = 0.0, inkRatio = 0.0, edgeBandInkFraction = 0.0 },
                    triage = new {
                        verdict = rooms.Count > 0 && contained ? "solve" : "hold",
                        reason = rooms.Count == 0 ? "no f970 detector room label in zone"
                            : contained ? "f970 detector rooms fit current zone"
                            : "f970 whole-level rooms cross current zone; geometry shown unchanged",
                    },
                    closure = new {
                        doorHeadSqft = 0.0,
                        wallRunGapSqft = 0.0,
                        gapCloseSqft = CountInZone(detection.ClosedObstruction, replay.SeedInk,
                            replay.Field, zone.Loops) * replay.Field.CellFt * replay.Field.CellFt,
                    },
                    zoneKey = ZoneKey(level, minX, minY, maxX, maxY),
                });
            }
            Console.WriteLine($"{level}: historical rooms={detection.Result.Rooms.Count} assigned={assignments.Values.Sum(value => value.Count)}");
        }

        var report = new {
            SchemaVersion = 4,
            GeneratedUtc = stamp,
            optionsHash,
            options = new {
                sourceCommit = "f970088315d470d8ef5a49d3cc05088253f488ff",
                baseCommit = "f67611f609f244f545c21f0f36e8bd7359015863",
                reviewRange = "97497ee2c9c4732b69afbee4a80b13c585553329..f970088315d470d8ef5a49d3cc05088253f488ff",
                acceptance = "f970 detector acceptance; current promotion gates were not applied",
                assignment = "whole-level room label point into current designer zone; geometry unchanged",
                options,
                unassignedRooms = unassigned,
            },
            zoneFilter = (string?)null,
            Zones = reportZones,
            RejectionHistogram = new Dictionary<string, int>(),
        };
        File.WriteAllText(Path.Combine(runDir, "report.json"), JsonSerializer.Serialize(report, Json) + Environment.NewLine);
        File.WriteAllText(Path.Combine(runDir, "meta.json"), JsonSerializer.Serialize(new {
            runId,
            generatedUtc = stamp,
            optionsHash,
            label = "historical f970088",
            zoneFilter = (string?)null,
        }, Json) + Environment.NewLine);
        Console.WriteLine($"runId={runId}");
        Console.WriteLine($"optionsHash={optionsHash}");
        Console.WriteLine($"unassigned={string.Join(',', unassigned)}");
        Console.WriteLine($"runDir={runDir}");
        return 0;
    }

    private static int SelfCheck()
    {
        const int width = 14, height = 12;
        var field = new Heightfield {
            W = width, H = height, CellFt = 1, MinX = 0, MinY = 0,
            FloorZ = Enumerable.Repeat(0f, width * height).ToArray(),
            CeilZ = Enumerable.Repeat(8f, width * height).ToArray(),
        };
        var ink = new bool[width * height];
        void Set(int x, int y) => ink[y * width + x] = true;
        for (int x = 2; x <= 11; x++) { Set(x, 2); Set(x, 9); }
        for (int y = 2; y <= 9; y++) { Set(2, y); Set(11, y); Set(7, y); }
        var options = new TakeoffOptions { CellFt = 1, MinSqft = 1, GapSealFt = 1.5, MinCompactness = 0 };
        var first = Detector.Detect(field, ink, "Test", 0, options, _ => { }).Result;
        var second = Detector.Detect(field, ink, "Test", 0, options, _ => { }).Result;
        if (first.Rooms.Count != 2 || ToTsv(first, first.Rooms) != ToTsv(second, second.Rooms))
            throw new InvalidOperationException("historical detector self-check failed");
        Console.WriteLine("self-check passed: 2 deterministic rooms");
        return 0;
    }

    private static Replay LoadReplay(string path)
    {
        using var gzip = new GZipStream(File.OpenRead(path), CompressionMode.Decompress);
        using var reader = new BinaryReader(gzip);
        if (reader.ReadUInt32() != ReplayMagic) throw new InvalidDataException($"{path}: not SKAT");
        int version = reader.ReadInt32();
        if (version != 1) throw new InvalidDataException($"{path}: unsupported replay v{version}");
        string level = reader.ReadString();
        double elevation = reader.ReadDouble();
        _ = reader.ReadString();
        var field = new Heightfield { W = reader.ReadInt32(), H = reader.ReadInt32() };
        field.MinX = reader.ReadDouble(); field.MinY = reader.ReadDouble(); field.CellFt = reader.ReadDouble();
        int count = checked(field.W * field.H);
        field.FloorZ = ReadFloats(reader, count);
        field.CeilZ = ReadFloats(reader, count);
        var packed = ReadExactly(reader, (count + 7) / 8);
        var ink = new bool[count];
        for (int i = 0; i < count; i++) ink[i] = (packed[i >> 3] & 1 << (i & 7)) != 0;
        return new Replay(level, elevation, field, ink);
    }

    private static float[] ReadFloats(BinaryReader reader, int count)
    {
        var bytes = ReadExactly(reader, checked(count * 4));
        var values = new float[count];
        Buffer.BlockCopy(bytes, 0, values, 0, bytes.Length);
        return values;
    }

    private static byte[] ReadExactly(BinaryReader reader, int count)
    {
        var bytes = new byte[count];
        int offset = 0;
        while (offset < count)
        {
            int read = reader.Read(bytes, offset, count - offset);
            if (read == 0) throw new EndOfStreamException($"wanted {count} bytes, got {offset}");
            offset += read;
        }
        return bytes;
    }

    private static void SaveInk(string path, Heightfield field, bool[] values)
    {
        if (values.Length != field.W * field.H) throw new ArgumentException("raster dimensions disagree");
        using var writer = new BinaryWriter(File.Create(path));
        writer.Write(InkMagic); writer.Write(field.W); writer.Write(field.H);
        writer.Write(field.MinX); writer.Write(field.MinY); writer.Write(field.CellFt);
        var packed = new byte[(values.Length + 7) / 8];
        for (int i = 0; i < values.Length; i++) if (values[i]) packed[i >> 3] |= (byte)(1 << (i & 7));
        writer.Write(packed);
    }

    private static string ToTsv(TakeoffResult result, IReadOnlyCollection<RoomResult> rooms)
    {
        var culture = CultureInfo.InvariantCulture;
        var output = new StringBuilder();
        output.AppendLine($"META\tlevel\t{result.LevelName}");
        output.AppendLine($"META\telev\t{result.LevelElevation.ToString("F6", culture)}");
        output.AppendLine($"META\trooms\t{rooms.Count}");
        output.AppendLine($"META\ttotalSqft\t{rooms.Sum(room => room.RawSqft).ToString("F1", culture)}");
        foreach (var room in rooms)
        {
            output.AppendLine($"ROOM\t{room.Id}\t{room.RawSqft.ToString("F1", culture)}\t{room.PerimeterFt.ToString("F1", culture)}\t{room.LabelX.ToString("F6", culture)}\t{room.LabelY.ToString("F6", culture)}\t{room.MeanCeilingFt.ToString("F2", culture)}\taccepted");
            output.AppendLine($"POLY\t{room.Id}\touter\t{Poly(room.Polygon)}");
            foreach (var hole in room.Holes) output.AppendLine($"POLY\t{room.Id}\thole\t{Poly(hole)}");
        }
        return output.ToString();
    }

    private static string Poly(IEnumerable<double[]> points) => string.Join('|', points.Select(point =>
        point[0].ToString("F6", CultureInfo.InvariantCulture) + ";" +
        point[1].ToString("F6", CultureInfo.InvariantCulture)));

    private static bool ContainsEvenOdd(List<List<double[]>> loops, double x, double y)
    {
        bool inside = false;
        foreach (var loop in loops)
            for (int current = 0, previous = loop.Count - 1; current < loop.Count; previous = current++)
            {
                var a = loop[current]; var b = loop[previous];
                if ((a[1] > y) != (b[1] > y)
                    && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
            }
        return inside;
    }

    private static bool ContainsOrBoundary(List<List<double[]>> loops, double x, double y)
    {
        if (ContainsEvenOdd(loops, x, y)) return true;
        const double epsilon = 1e-7;
        foreach (var loop in loops)
            for (int index = 0; index < loop.Count; index++)
            {
                var from = loop[index]; var to = loop[(index + 1) % loop.Count];
                double dx = to[0] - from[0], dy = to[1] - from[1];
                double lengthSquared = dx * dx + dy * dy;
                double t = lengthSquared <= epsilon ? 0 : Math.Clamp(((x - from[0]) * dx + (y - from[1]) * dy) / lengthSquared, 0, 1);
                double px = from[0] + t * dx, py = from[1] + t * dy;
                if ((x - px) * (x - px) + (y - py) * (y - py) <= epsilon * epsilon) return true;
            }
        return false;
    }

    private static bool IsOrthogonal(RoomResult room) => new[] { room.Polygon }.Concat(room.Holes)
        .All(loop => loop.Select((point, index) => (Point: point, Next: loop[(index + 1) % loop.Count]))
            .All(edge => Math.Abs(edge.Point[0] - edge.Next[0]) < 1e-7
                || Math.Abs(edge.Point[1] - edge.Next[1]) < 1e-7));

    private static double SignedArea(List<double[]> loop)
    {
        double area = 0;
        for (int index = 0; index < loop.Count; index++)
        {
            var a = loop[index]; var b = loop[(index + 1) % loop.Count];
            area += a[0] * b[1] - b[0] * a[1];
        }
        return area / 2;
    }

    private static int CountInZone(bool[] closed, bool[] seed, Heightfield field, List<List<double[]>> loops)
    {
        int count = 0;
        for (int index = 0; index < closed.Length; index++)
        {
            if (!closed[index] || seed[index]) continue;
            double x = field.MinX + (index % field.W + 0.5) * field.CellFt;
            double y = field.MinY + (index / field.W + 0.5) * field.CellFt;
            if (ContainsEvenOdd(loops, x, y)) count++;
        }
        return count;
    }
    private static string Slug(string value) => new(value.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string ZoneKey(string level, double minX, double minY, double maxX, double maxY)
    {
        static double Q(double value) => Math.Round(value * 2, MidpointRounding.AwayFromZero) / 2;
        return Hash(FormattableString.Invariant($"{level}|{Q(minX):F1}|{Q(minY):F1}|{Q(maxX):F1}|{Q(maxY):F1}"))[..12];
    }

    private static string Required(string[] args, string name)
    {
        int index = Array.IndexOf(args, name);
        if (index < 0 || index + 1 >= args.Length) throw new ArgumentException($"required: {name} <path>");
        return Path.GetFullPath(args[index + 1]);
    }
}
