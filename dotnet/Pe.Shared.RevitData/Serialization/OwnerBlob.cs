using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Pe.Shared.RevitData.Serialization;

/// <summary>
///     One owner of one Pe blob stored inside a Revit model (ADR 0032 storage amendment, rule 8). It lives beside the
///     owner's DTO. <see cref="Guid" /> and <see cref="Name" /> are the hidden shared Text parameter that holds the
///     blob (or, for the duct results entity, the schema Revit's API requires). Changing the GUID orphans every model
///     that holds the blob. Owner data never holds secrets: a hidden parameter can leak through IFC or DWG export.
/// </summary>
public sealed record OwnerDescriptor(string Owner, int Version, Guid Guid, string Name, string Description);

public enum OwnerBlobStatus {
    /// <summary>No blob is stored. A write may create one.</summary>
    Absent,
    Ok,
    /// <summary>Stored text that is not this owner's envelope. It is refused and its bytes are kept.</summary>
    Invalid,
    /// <summary>This owner's envelope at a version this build does not read. It is refused and its bytes are kept.</summary>
    UnknownVersion
}

/// <summary>A strict read of one stored blob. <see cref="Raw" /> is the stored text, unchanged, for every status but Absent.</summary>
public sealed record OwnerBlobRead(OwnerBlobStatus Status, JObject? Data, string? Raw, string? Error) {
    /// <summary>ADR 0026 D4: only an absent blob or one this build read may be written over.</summary>
    public bool MayOverwrite => this.Status is OwnerBlobStatus.Absent or OwnerBlobStatus.Ok;
}

/// <summary>
///     The one codec for every Pe blob stored in a model: <c>{"owner":"…","version":N,"data":{…}}</c>. There is no
///     migration: any other shape, owner or version is refused, and the caller keeps the stored bytes.
/// </summary>
public static class OwnerBlob {
    /// <summary>ADR 0032 storage amendment, rule 3. Provisional until it is measured on real models.</summary>
    public const int MaxBytes = 256 * 1024;

    public const int MaxDepth = 32;

    public static OwnerBlobRead Decode(OwnerDescriptor owner, string? raw) {
        if (string.IsNullOrWhiteSpace(raw))
            return new OwnerBlobRead(OwnerBlobStatus.Absent, null, null, null);

        OwnerBlobRead Refused(OwnerBlobStatus status, string why) =>
            new(status, null, raw, $"the stored {owner.Name} blob {why}; it is refused and kept as it is");

        JToken root;
        try {
            // Dates stay strings so a decode followed by an encode returns the same text.
            using var reader = new JsonTextReader(new StringReader(raw!)) { MaxDepth = MaxDepth, DateParseHandling = DateParseHandling.None };
            root = JToken.Load(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
            while (reader.Read())
                if (reader.TokenType != JsonToken.Comment)
                    return Refused(OwnerBlobStatus.Invalid, "has text after its JSON value");
        } catch (JsonException ex) {
            return Refused(OwnerBlobStatus.Invalid, $"is not strict JSON ({ex.Message})");
        }

        if (root is not JObject envelope
            || envelope.Count != 3
            || envelope["owner"] is not JValue { Type: JTokenType.String } storedOwner
            || envelope["version"] is not JValue { Type: JTokenType.Integer } storedVersion
            || envelope["data"] is not JObject data)
            return Refused(OwnerBlobStatus.Invalid, "is not an {owner, version, data} envelope");
        if (!string.Equals((string?)storedOwner, owner.Owner, StringComparison.Ordinal))
            return Refused(OwnerBlobStatus.Invalid, $"belongs to owner '{(string?)storedOwner}', not '{owner.Owner}'");
        if (storedVersion.Value is not long version || version != owner.Version)
            return Refused(OwnerBlobStatus.UnknownVersion, $"is version {storedVersion}; this build reads version {owner.Version}");
        return new OwnerBlobRead(OwnerBlobStatus.Ok, data, raw, null);
    }

    /// <summary>The stored text for the data. Throws when it is over the cap or would not decode back to the same data.</summary>
    public static string Encode(OwnerDescriptor owner, JObject data) {
        var text = new JObject { ["owner"] = owner.Owner, ["version"] = owner.Version, ["data"] = data }.ToString(Formatting.None);
        var bytes = Encoding.UTF8.GetByteCount(text);
        if (bytes > MaxBytes)
            throw new InvalidOperationException($"the {owner.Name} blob is {bytes} bytes; the cap is {MaxBytes} bytes");
        var back = Decode(owner, text);
        if (back.Status != OwnerBlobStatus.Ok || back.Data!.ToString(Formatting.None) != data.ToString(Formatting.None))
            throw new InvalidOperationException($"the {owner.Name} blob does not read back exactly ({back.Error ?? "the data changed"})");
        return text;
    }

    /// <summary>The data of a stored blob, for an owner that fails closed. Null when absent; throws when refused.</summary>
    public static JObject? DataOrThrow(this OwnerBlobRead read) =>
        read.Status is OwnerBlobStatus.Absent or OwnerBlobStatus.Ok ? read.Data : throw new InvalidOperationException(read.Error);
}

/// <summary>
///     The project pointer (homes freeze shape 4): the model names its project home as a forward-slash path relative
///     to the shared drive root, with no drive letter. Pe's files sit in <c>&lt;path&gt;/Pe.Tools</c>. Nothing writes it yet.
/// </summary>
public sealed record ProjectHomePointer {
    public static readonly OwnerDescriptor Owner = new("project-home", 1,
        new Guid("3c1f6f0e-7d0b-4a53-9a55-6f2f0f1c7a11"), "_PE_ProjectHome", "Pe.Tools project home pointer.");

    private static readonly char[] Forbidden = ['\\', ':', '<', '>', '"', '|', '?', '*'];

    private ProjectHomePointer(string path) => this.Path = path;

    public string Path { get; }

    public JObject ToData() => new() { ["path"] = this.Path };

    /// <summary>Null with the reason when the path is not a relative forward-slash path.</summary>
    public static (ProjectHomePointer? Pointer, string? Error) Create(string? path) {
        if (string.IsNullOrEmpty(path)) return (null, "the project home path is empty");
        if (path!.IndexOfAny(Forbidden) >= 0 || path.Any(char.IsControl))
            return (null, $"the project home path '{path}' holds a drive letter, a backslash or a character a folder name cannot hold");
        foreach (var segment in path.Split('/')) {
            if (segment.Length == 0) return (null, $"the project home path '{path}' is rooted or has an empty folder name");
            if (segment is "." or ".." || segment != segment.Trim() || segment.EndsWith(".", StringComparison.Ordinal))
                return (null, $"the project home path '{path}' has the folder name '{segment}', which is relative or not a stable name");
        }
        return (new ProjectHomePointer(path), null);
    }

    public static (ProjectHomePointer? Pointer, string? Error) FromData(JObject data) =>
        data.Count == 1 && data["path"] is JValue { Type: JTokenType.String } path
            ? Create((string?)path)
            : (null, "the project home data is not exactly { path: string }");
}
