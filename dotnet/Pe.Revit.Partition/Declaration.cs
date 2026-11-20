using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.Parameters;
using Pe.Revit.Space;
using Pe.Shared.RevitData.Serialization;

namespace Pe.Revit.Partition;

/// <summary>
///     Enclosure is declared per document, never inferred (ledger ruling 3). One owner blob on Project Information
///     carries it through <see cref="OwnerBlobStore" />; when it is absent or refused the default applies and the
///     answer says which and why.
/// </summary>
public static class EnclosureDeclaration {
    /// <summary>Stable carrier identity. Changing the GUID orphans deployed models — never reuse.</summary>
    [Pe.Shared.Product.NativeHome("partitionEnclosure")]
    public static readonly OwnerDescriptor Owner = new("partition-enclosure", 1,
        new Guid("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9006"), "_PE_PartitionEnclosure",
        "Pe partition enclosure declaration (which categories and DWG layers draw enclosure).",
        static read => Parse(read).Refusal);

    // An unknown key is a read error, not a key to drop on the next write (ADR 0032 storage amendment, rule 2).
    private static readonly JsonSerializer Json = JsonSerializer.Create(new JsonSerializerSettings {
        ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver(),
        NullValueHandling = NullValueHandling.Ignore,
        MissingMemberHandling = MissingMemberHandling.Error
    });

    public static bool IsBound(Document document) {
        var element = SharedParameterElement.Lookup(document, Owner.Guid);
        return element is not null && document.ParameterBindings.Contains(element.GetDefinition());
    }

    /// <summary>The declaration and the one-line reason a reader is owed about where it came from.</summary>
    public static (Enclosure Enclosure, string Source) Read(Document document) {
        OwnerBlobRead read;
        try {
            read = OwnerBlobStore.Read(document, Owner);
        } catch (Autodesk.Revit.Exceptions.ApplicationException) {
            return (Enclosure.Default, "default: enclosure parameter unreadable on this document");
        }

        if (read.Status == OwnerBlobStatus.Absent)
            return (Enclosure.Default, IsBound(document)
                ? "default: enclosure parameter is bound but unset"
                : "default: enclosure parameter is not bound on this document");
        var parsed = Parse(read);
        return parsed.Value is { } declared
            ? (declared.ToEnclosure(), $"declared: {Owner.Name} on Project Information")
            : (Enclosure.Default, "default: " + parsed.Refusal);
    }

    /// <summary>Records the default for adoption while preserving existing declarations and unreadable records.</summary>
    public static void WriteDefaultIfAbsent(Document document) {
        if (string.IsNullOrWhiteSpace(OwnerBlobStore.Read(document, Owner).Raw))
            _ = OwnerBlobStore.Write(document, Owner, Encode(Enclosure.Default));
    }

    /// <summary>Writes a declaration. The caller owns the transaction.</summary>
    public static void Write(Document document, Enclosure enclosure, OwnerBlobNotices notices) {
        _ = OwnerBlobStore.WriteWithoutPreview(document, Owner, Encode(enclosure), notices);
    }

    private static JObject Encode(Enclosure enclosure) => JObject.FromObject(Declared.From(enclosure), Json);

    /// <summary>The declaration, or the reason it is "can't read, kept" (the default then applies).</summary>
    internal static OwnerValue<Declared> Parse(OwnerBlobRead read) =>
        read.Parse(data => data.ToObject<Declared>(Json) is { } d && (d.SolidCategories is not null || d.RibbonLayers is not null)
            ? d
            : throw new InvalidOperationException("the enclosure declaration names no categories and no layers"));

    /// <summary>The stored data shape. Flat on purpose.</summary>
    internal sealed class Declared {
        public string[]? SolidSources { get; set; }
        public string[]? SolidCategories { get; set; }
        public string[]? RibbonLayers { get; set; }

        public static Declared From(Enclosure e) => new() {
            SolidSources = e.Solids.Sources?.Select(s => s.ToString()).ToArray(),
            SolidCategories = e.Solids.Categories?.ToArray(),
            RibbonLayers = e.Ribbons.Layers?.ToArray(),
        };

        public Enclosure ToEnclosure() {
            var sources = this.SolidSources is null
                ? Enclosure.Default.Solids.Sources
                : this.SolidSources.Select(s => Enum.TryParse<SourceKind>(s, true, out var k) ? k : SourceKind.IfcLink)
                    .Distinct().ToArray();
            return new Enclosure(
                new Filter(sources, this.SolidCategories ?? Enclosure.Default.Solids.Categories,
                    [PrimKind.Solid, PrimKind.Mesh]),
                new Filter(null, null, [PrimKind.Curve2D],
                    this.RibbonLayers ?? Enclosure.Default.Ribbons.Layers));
        }
    }
}
