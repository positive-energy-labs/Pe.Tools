using Newtonsoft.Json;

namespace Pe.Revit.Space;

/// <summary>
///     A <see cref="SliceAnswer" /> on disk, so a solver can be proven without Revit. This is the
///     whole deterministic lane: a zone fixture is a file, and a test is a solve.
///     <para>
///         Doubles round-trip bit-exact. Newtonsoft writes a double with the round-trip format, which
///         on this runtime is the shortest string that parses back to the same bits, and reads it
///         back through <c>double.Parse</c>. No format string is set here; setting one is how the
///         last digit gets lost.
///     </para>
///     <para>
///         FOOTGUN: this is Newtonsoft and not System.Text.Json because analyzer PE1011 forbids STJ
///         in a Revit-hosted project. Round 1 of the partition close asked for STJ; the repo rule won.
///     </para>
/// </summary>
public static class SliceJson {
    private static readonly JsonSerializer Serializer = JsonSerializer.Create(new JsonSerializerSettings {
        Formatting = Formatting.None,
        FloatParseHandling = FloatParseHandling.Double,
        DateParseHandling = DateParseHandling.DateTime,
        DateTimeZoneHandling = DateTimeZoneHandling.Utc,
    });

    public static void Write(SliceAnswer answer, Stream stream) {
        using var w = new StreamWriter(stream, System.Text.Encoding.UTF8, 1 << 16, true);
        using var j = new JsonTextWriter(w) { CloseOutput = false };
        Serializer.Serialize(j, answer);
        j.Flush();
    }

    public static SliceAnswer Read(Stream stream) {
        using var r = new StreamReader(stream, System.Text.Encoding.UTF8, true, 1 << 16, true);
        using var j = new JsonTextReader(r) { CloseInput = false };
        return Serializer.Deserialize<SliceAnswer>(j)
            ?? throw new InvalidDataException("slice json deserialized to null");
    }
}
