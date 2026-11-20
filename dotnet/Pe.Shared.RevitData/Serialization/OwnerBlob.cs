using System.Security.Cryptography;
using System.Text;
using Pe.Shared.StorageRuntime;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Pe.Shared.RevitData.Serialization;

/// <summary>
///     One owner of one Pe blob stored inside a Revit model (ADR 0032 storage amendment, rule 8). It lives beside the
///     owner's DTO. <see cref="Guid" /> and <see cref="Name" /> are the hidden shared Text parameter that holds the
///     blob (or, for the duct results entity, the schema Revit's API requires). Changing the GUID orphans every model
///     that holds the blob. Owner data never holds secrets: a hidden parameter can leak through IFC or DWG export.
/// </summary>
public sealed record OwnerDescriptor(string Owner, int Version, Guid Guid, string Name, string Description) {
    public Func<OwnerBlobRead, string?>? ValidateData { get; init; }
}

[JsonConverter(typeof(Newtonsoft.Json.Converters.StringEnumConverter))]
public enum OwnerBlobStatus {
    /// <summary>
    ///     No envelope is stored: the parameter is empty, or it holds an old un-enveloped shape (valid JSON with no
    ///     <c>owner</c> key). The owner starts from its defaults and the next write replaces what is there.
    /// </summary>
    Absent,
    Ok,
    /// <summary>An envelope that is broken or another owner's, or text that is not JSON. Replacement requires preview evidence.</summary>
    Invalid,
    /// <summary>This owner's envelope at a version this build does not read. Replacement requires preview evidence.</summary>
    UnknownVersion
}

public sealed record OwnerBlobReplacement(string Owner, OwnerBlobStatus Status, string Reason, string RawUtf8Sha256);

/// <summary>A strict read of one stored blob. <see cref="Raw" /> is the stored text, unchanged; it is null only when nothing is stored.</summary>
public sealed record OwnerBlobRead(OwnerDescriptor Owner, OwnerBlobStatus Status, JObject? Data, string? Raw, string? Error) {
    public OwnerBlobReplacement? Replacement => this.Status is OwnerBlobStatus.Invalid or OwnerBlobStatus.UnknownVersion
        ? new OwnerBlobReplacement(this.Owner.Owner, this.Status, this.Error!, OwnerBlob.HashRaw(this.Raw!))
        : null;
}

/// <summary>
///     The one codec for every Pe blob stored in a model: <c>{"owner":"…","version":N,"data":{…}}</c>. There is no
///     migration. Unknown versions, broken envelopes and unreadable owner data require sealed replacement.
///     An old un-enveloped shape reads as absent
///     (kaitpw, 2026-11-11: no client model carries one).
/// </summary>
public static class OwnerBlob {
    /// <summary>ADR 0032 storage amendment, rule 3. Provisional until it is measured on real models.</summary>
    public const int MaxBytes = 256 * 1024;

    public const int MaxDepth = 32;

    public static OwnerBlobRead Decode(OwnerDescriptor owner, string? raw) {
        if (string.IsNullOrWhiteSpace(raw))
            return new OwnerBlobRead(owner, OwnerBlobStatus.Absent, null, null, null);

        OwnerBlobRead Refused(OwnerBlobStatus status, string why) =>
            new(owner, status, null, raw, $"the stored {owner.Name} blob is unreadable ({why})");

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

        // No envelope at all: an old shape. Unparseable text is not provably old, so it was refused above.
        if (root is not JObject candidate || !candidate.ContainsKey("owner"))
            return new OwnerBlobRead(owner, OwnerBlobStatus.Absent, null, raw, null);

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
        var read = new OwnerBlobRead(owner, OwnerBlobStatus.Ok, data, raw, null);
        return owner.ValidateData?.Invoke(read) is { } error
            ? read with { Status = OwnerBlobStatus.Invalid, Data = null, Error = error }
            : read;
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

    /// <summary>Seals an envelope whose data the owner refused without changing the read or the model.</summary>
    public static OwnerBlobReplacement DataRefused(this OwnerBlobRead read, string reason) {
        if (read.Status != OwnerBlobStatus.Ok || read.Raw is null)
            throw new InvalidOperationException("A data refusal requires a readable envelope.");
        return new OwnerBlobReplacement(read.Owner.Owner, OwnerBlobStatus.Invalid, reason, HashRaw(read.Raw));
    }

    internal static string HashRaw(string raw) {
        using var sha = SHA256.Create();
        return BitConverter.ToString(sha.ComputeHash(StoredFile.ModelRecordBytes(raw))).Replace("-", "").ToLowerInvariant();
    }

    /// <summary>Validates the next envelope and completes recovery before returning replacement text.</summary>
    public static string? Replace(OwnerBlobRead stored, JObject data, Action<OwnerBlobReplacement, string> recover,
        OwnerBlobReplacement? replacing = null) {
        if (replacing is not null && (stored.Raw is null || replacing.Owner != stored.Owner.Owner ||
            !string.Equals(HashRaw(stored.Raw), replacing.RawUtf8Sha256, StringComparison.Ordinal)))
            throw new InvalidOperationException($"The stored '{stored.Owner.Name}' changed since replacement was planned.");
        if (replacing is not null && stored.Status is OwnerBlobStatus.Ok or OwnerBlobStatus.Absent)
            throw new InvalidOperationException($"The stored '{stored.Owner.Name}' is readable; replacement evidence cannot authorize recovery.");
        if (replacing is null && stored.Replacement is { } unreadable)
            throw new InvalidOperationException($"Preview before replacing '{stored.Owner.Name}': {unreadable.Reason}.");
        var text = Encode(stored.Owner, data);
        if (replacing is null && string.Equals(stored.Raw, text, StringComparison.Ordinal)) return null;
        if (replacing is not null) recover(replacing, stored.Raw!);
        return text;
    }

    /// <summary>
    ///     The keep policy for a read (ADR 0039): an owner's value, or the reason it cannot be read. A refused envelope
    ///     and data the owner cannot parse both come back as a refusal value, never an exception, so one bad blob
    ///     cannot stop a listing, a read or the host. The stored bytes are untouched either way.
    /// </summary>
    public static OwnerValue<T> Parse<T>(this OwnerBlobRead read, Func<JObject, T?> parse) where T : class {
        if (read.Status == OwnerBlobStatus.Absent) return new OwnerValue<T>(null, null);
        if (read.Status != OwnerBlobStatus.Ok) return new OwnerValue<T>(null, read.Error);
        try {
            return parse(read.Data!) is { } value
                ? new OwnerValue<T>(value, null)
                : new OwnerValue<T>(null, $"the stored {read.Owner.Name} data is unreadable: it is empty");
        } catch (Exception ex) when (ex is InvalidOperationException or JsonException) {
            return new OwnerValue<T>(null, $"the stored {read.Owner.Name} data is unreadable ({ex.Message})");
        }
    }
}

/// <summary>
///     What an owner read gives back. Both null: nothing is stored. <see cref="Refusal" /> set: the stored blob is
///     "can't read, kept" for this reason, and defaults stay in force until a replacement is written.
/// </summary>
public sealed record OwnerValue<T>(T? Value, string? Refusal) where T : class {
    /// <summary>Require readable data when the caller needs it to compute a change.</summary>
    public T? OrThrow() => this.Refusal is null ? this.Value : throw new InvalidOperationException(this.Refusal);
}

/// <summary>
///     The project pointer (homes freeze shape 4): the model names its project home as a forward-slash path relative
///     to the shared drive root, with no drive letter. Pe's files sit in <c>&lt;path&gt;/Pe.Tools</c>. Nothing writes it yet.
/// </summary>
public sealed record ProjectHomePointer {
    public static readonly OwnerDescriptor Owner = new("project-home", 1,
        new Guid("3c1f6f0e-7d0b-4a53-9a55-6f2f0f1c7a11"), "_PE_ProjectHome", "Pe.Tools project home pointer.") { ValidateData = read => Read(read).Refusal };

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

    public static OwnerValue<ProjectHomePointer> Read(OwnerBlobRead read) =>
        read.Parse(data => FromData(data) is { Pointer: { } pointer } ? pointer : throw new InvalidOperationException(FromData(data).Error));

    public static (ProjectHomePointer? Pointer, string? Error) FromData(JObject data) =>
        data.Count == 1 && data["path"] is JValue { Type: JTokenType.String } path
            ? Create((string?)path)
            : (null, "the project home data is not exactly { path: string }");
}
