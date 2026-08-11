using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Pe.Revit.Takeoff;

return ReviewCli.Run(args);

internal static class ReviewCli
{
    private static readonly JsonSerializerOptions JsonOptions = new() {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public static int Run(string[] args)
    {
        try
        {
            var options = ParseArgs(args);
            if (Directory.Exists(options.OutputDirectory))
                throw new ArgumentException($"Output directory already exists: {options.OutputDirectory}");

            var staging = options.OutputDirectory + $".staging-{Guid.NewGuid():N}";
            try
            {
                Directory.CreateDirectory(staging);
                var levels = options.Mode == "audit"
                    ? AuditDirectory(options.Input, staging)
                    : ReplayManifest(options.Input, staging);
                if (levels.Count != options.ExpectedLevelCount)
                    throw new InvalidDataException(
                        $"Expected {options.ExpectedLevelCount} levels but reviewed {levels.Count}.");
                var summary = new ReviewSummary(
                    options.Mode,
                    Path.GetFullPath(options.Input),
                    options.Mode == "replay" ? FileHash(options.Input) : null,
                    levels.All(level => level.Audit.IsStrictlyEditable),
                    levels.Sum(level => level.Audit.Rooms.Count),
                    levels.Sum(level => level.Audit.StrictlyEditableRooms),
                    levels.Select(level => new LevelSummary(
                        level.Audit.LevelName,
                        level.Audit.IsStrictlyEditable,
                        level.Audit.Rooms.Count,
                        level.Audit.StrictlyEditableRooms,
                        level.Audit.Rooms.Sum(room => room.Violations.Count),
                        level.TsvFile,
                        FileHash(Path.Combine(staging, level.TsvFile)),
                        level.AuditFile,
                        level.LogFile)).ToList());
                WriteJson(Path.Combine(staging, "summary.json"), summary);
                Directory.Move(staging, options.OutputDirectory);
                Console.WriteLine($"{summary.StrictlyEditableRooms}/{summary.Rooms} rooms intrinsically " +
                                  $"strictly editable across {levels.Count} level(s)");
                return summary.IsStrictlyEditable ? 0 : 2;
            }
            finally
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, recursive: true);
            }
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.Message);
            return 1;
        }
    }

    private static List<LevelRun> AuditDirectory(string input, string output)
    {
        if (!Directory.Exists(input))
            throw new DirectoryNotFoundException($"TSV directory does not exist: {input}");
        var files = Directory.GetFiles(input, "rooms_*.tsv")
            .Where(path => !path.EndsWith(".native.tsv", StringComparison.OrdinalIgnoreCase))
            .OrderBy(path => path, StringComparer.Ordinal)
            .ToList();
        if (files.Count == 0)
            throw new InvalidDataException($"No rooms_*.tsv files found in {input}");
        return files.Select(path => AuditTsv(File.ReadAllText(path), output,
            $"[audit] source={Path.GetFullPath(path)}")).ToList();
    }

    private static List<LevelRun> ReplayManifest(string manifestPath, string output)
    {
        if (!File.Exists(manifestPath))
            throw new FileNotFoundException("Snapshot manifest does not exist", manifestPath);
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        if (!document.RootElement.TryGetProperty("replaySnapshots", out var snapshots)
            || snapshots.ValueKind != JsonValueKind.Array || snapshots.GetArrayLength() == 0)
            throw new InvalidDataException("Manifest has no replaySnapshots array.");

        var manifestDirectory = Path.GetDirectoryName(Path.GetFullPath(manifestPath))!;
        var runs = new List<LevelRun>();
        foreach (var entry in snapshots.EnumerateArray())
        {
            var path = entry.GetProperty("path").GetString()
                ?? throw new InvalidDataException("Replay snapshot path is empty.");
            if (!Path.IsPathRooted(path)) path = Path.Combine(manifestDirectory, path);
            if (!File.Exists(path)) throw new FileNotFoundException("Replay snapshot does not exist", path);
            if (!entry.TryGetProperty("sha256", out var hash))
                throw new InvalidDataException($"Snapshot has no sha256: {path}");
            VerifyHash(path, hash.GetString());

            var lines = new List<string>();
            var snapshot = DetectSnapshot.Load(path);
            var result = snapshot.ReplayInferred(lines.Add);
            lines.Insert(0, $"[input] {Path.GetFullPath(path)}");
            runs.Add(AuditTsv(result.ToTsv(), output, lines));
        }
        return runs;
    }

    private static LevelRun AuditTsv(string tsv, string output, params string[] log) =>
        AuditTsv(tsv, output, (IReadOnlyList<string>)log);

    private static LevelRun AuditTsv(string tsv, string output, IReadOnlyList<string> log)
    {
        var level = TakeoffTsv.ParseTsv(tsv);
        var audit = TakeoffEditability.Evaluate(level);
        var stem = Sanitize(level.LevelName);
        var tsvFile = $"rooms_{stem}.tsv";
        var auditFile = $"audit_{stem}.json";
        var logFile = $"log_{stem}.txt";
        File.WriteAllText(Path.Combine(output, tsvFile), tsv);
        WriteJson(Path.Combine(output, auditFile), audit);
        File.WriteAllLines(Path.Combine(output, logFile), log.Append(
            $"[audit] {level.LevelName}: {audit.StrictlyEditableRooms}/{audit.Rooms.Count} rooms " +
            "intrinsically strictly editable"));
        Console.WriteLine($"{level.LevelName}: {audit.StrictlyEditableRooms}/{audit.Rooms.Count} " +
                          "intrinsically strictly editable");
        return new LevelRun(audit, tsvFile, auditFile, logFile);
    }

    private static void VerifyHash(string path, string? expected)
    {
        if (string.IsNullOrWhiteSpace(expected))
            throw new InvalidDataException($"Snapshot has no sha256: {path}");
        using var stream = File.OpenRead(path);
        var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException($"Snapshot hash mismatch: {path}\nexpected {expected}\nactual   {actual}");
    }

    private static string FileHash(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private static Options ParseArgs(string[] args)
    {
        if (args.Length == 1 && args[0] is "-h" or "--help")
            throw new ArgumentException(Usage);
        string? mode = null, input = null, output = null;
        int? expectedLevelCount = null;
        for (var index = 0; index < args.Length; index++)
        {
            string Value() => index + 1 < args.Length
                ? args[++index]
                : throw new ArgumentException($"Missing value after {args[index]}");
            switch (args[index])
            {
                case "--tsv-dir": mode = SetMode(mode, "audit"); input = Value(); break;
                case "--manifest": mode = SetMode(mode, "replay"); input = Value(); break;
                case "--out": output = Value(); break;
                case "--expected-level-count":
                    if (!int.TryParse(Value(), out var count) || count <= 0)
                        throw new ArgumentException("--expected-level-count must be a positive integer.");
                    expectedLevelCount = count;
                    break;
                default: throw new ArgumentException($"Unknown argument: {args[index]}\n{Usage}");
            }
        }
        if (mode is null || input is null || output is null || expectedLevelCount is null)
            throw new ArgumentException(Usage);
        return new Options(mode, input, Path.GetFullPath(output), expectedLevelCount.Value);
    }

    private static string SetMode(string? current, string next) => current is null || current == next
        ? next
        : throw new ArgumentException("Use exactly one of --tsv-dir or --manifest.");

    private static string Sanitize(string value) =>
        string.Concat(value.Select(character => char.IsLetterOrDigit(character) ? character : '_'));

    private static void WriteJson<T>(string path, T value) =>
        File.WriteAllText(path, JsonSerializer.Serialize(value, JsonOptions));

    private const string Usage = """
Usage:
  dotnet run --project eval/rhvac/review -- --tsv-dir <directory> --out <new-directory> --expected-level-count <n>
  dotnet run --project eval/rhvac/review -- --manifest <manifest.json> --out <new-directory> --expected-level-count <n>
""";

    private sealed record Options(
        string Mode, string Input, string OutputDirectory, int ExpectedLevelCount);
    private sealed record LevelRun(LevelEditabilityAudit Audit, string TsvFile, string AuditFile, string LogFile);
    private sealed record ReviewSummary(
        string Mode, string Input, string? InputSha256, bool IsStrictlyEditable,
        int Rooms, int StrictlyEditableRooms,
        IReadOnlyList<LevelSummary> Levels);
    private sealed record LevelSummary(
        string LevelName, bool IsStrictlyEditable, int Rooms, int StrictlyEditableRooms, int Violations,
        string Tsv, string TsvSha256, string Audit, string Log);
}
