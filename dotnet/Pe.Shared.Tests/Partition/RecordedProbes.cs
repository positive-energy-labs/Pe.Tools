using System.IO.Compression;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     Real probe answers recorded in a session (<c>probes.json.gz</c> beside a fixture: a list of
///     <c>{ x, y, answer }</c>, taken by running the bench's own input through the live Space probe), replayed by
///     exact point. A point the recording never saw falls back to the stub (floor at the level, ceiling 9 ft over
///     it) and is counted, so a solver change that moves label points shows up as misses rather than silent stubs.
/// </summary>
public sealed class RecordedProbes {
    private static readonly Handle Stub = new("stub", 0, "", null, "Detail Items", PrimKind.Solid, null, null);
    private readonly Dictionary<(double, double), ProbeAnswer> byPoint;

    private RecordedProbes(Dictionary<(double, double), ProbeAnswer> byPoint) => this.byPoint = byPoint;

    public int Hits { get; private set; }
    public int Misses { get; private set; }
    public bool Recorded => this.byPoint.Count > 0;

    /// <summary>The recording beside a fixture directory (relative to the private fixture root), or none.</summary>
    public static RecordedProbes For(string? fixture) {
        var byPoint = new Dictionary<(double, double), ProbeAnswer>();
        var path = fixture == null ? null : Path.Combine(PrivateFixtures.Dir(fixture), "probes.json.gz");
        if (path == null || !File.Exists(path)) return new RecordedProbes(byPoint);
        using var file = File.OpenRead(path);
        using var reader = new StreamReader(new GZipStream(file, CompressionMode.Decompress));
        foreach (var row in JArray.Parse(reader.ReadToEnd()))
            byPoint[Key((double)row["x"]!, (double)row["y"]!)] = row["answer"]!.ToObject<ProbeAnswer>()!;
        return new RecordedProbes(byPoint);
    }

    public Func<double, double, ProbeAnswer> For(PartitionInput input) => (x, y) => {
        if (this.byPoint.TryGetValue(Key(x, y), out var answer)) {
            this.Hits++;
            return answer;
        }
        this.Misses++;
        return new ProbeAnswer(input.Knee.Stamp, input.Knee.Searched,
            new ProbeHit(Stub, 0.0, input.LevelZ), new ProbeHit(Stub, 9.0, input.LevelZ + 9.0), 200.0, 0.0);
    };

    private static (double, double) Key(double x, double y) => (Math.Round(x, 6), Math.Round(y, 6));
}
