using Newtonsoft.Json;
using Pe.Revit.Parameters;
using Pe.Revit.Space;

namespace Pe.Revit.Partition;

/// <summary>
///     Enclosure is declared per document, never inferred (ledger ruling 3). One text shared
///     parameter on Project Information carries the JSON; when it is unset or unparseable the
///     default applies and the answer says which and why. No UI: the first configuration surface is
///     the parameter in Revit properties, and a second project has to prove the list changes before
///     anything else is built.
///     <para>
///         The carrier lives beside <c>Pe.Revit.Takeoff.TakeoffCarriers</c>'s registry blob and uses
///         the same <see cref="SharedParameterBinder" />; Partition cannot reference Takeoff, so the
///         spec is declared here against the same helper rather than a second parameter home.
///     </para>
/// </summary>
public static class EnclosureDeclaration {
    /// <summary>Stable carrier identity. Changing it orphans deployed models — never reuse.</summary>
    internal static readonly Guid EnclosureGuid = new("b7e0c1d4-51aa-4a01-9f4e-2f6f1a0c9006");

    public static readonly SharedDefinitionSpec Spec = new(
        "_PE_PartitionEnclosure", SpecTypeId.String.Text,
        Description: "Pe partition enclosure declaration (JSON: which categories and DWG layers draw enclosure).",
        Guid: EnclosureGuid, Visible: false, UserModifiable: false);

    /// <summary>Idempotent; the caller owns the transaction.</summary>
    public static void EnsureBound(Document document) =>
        SharedParameterBinder.EnsureProjectBinding(document, Spec, [BuiltInCategory.OST_ProjectInformation]);

    public static bool IsBound(Document document) {
        var element = SharedParameterElement.Lookup(document, EnclosureGuid);
        return element is not null && document.ParameterBindings.Contains(element.GetDefinition());
    }

    /// <summary>The declaration and the one-line reason a reader is owed about where it came from.</summary>
    public static (Enclosure Enclosure, string Source) Read(Document document) {
        string? json = null;
        try {
            json = document.ProjectInformation?.get_Parameter(EnclosureGuid)?.AsString();
        } catch (Autodesk.Revit.Exceptions.ApplicationException) {
            return (Enclosure.Default, "default: enclosure parameter unreadable on this document");
        }

        if (string.IsNullOrWhiteSpace(json))
            return (Enclosure.Default, IsBound(document)
                ? "default: enclosure parameter is bound but unset"
                : "default: enclosure parameter is not bound on this document");

        try {
            var d = JsonConvert.DeserializeObject<Declared>(json!);
            if (d is null || (d.SolidCategories is null && d.RibbonLayers is null))
                return (Enclosure.Default, "default: enclosure declaration parsed to nothing");
            return (d.ToEnclosure(), "declared: _PE_PartitionEnclosure on Project Information");
        } catch (JsonException e) {
            return (Enclosure.Default, "default: enclosure declaration is not valid JSON (" + e.Message + ")");
        }
    }

    /// <summary>Writes a declaration. Caller owns the transaction; the parameter must already be bound.</summary>
    public static void Write(Document document, Enclosure enclosure) {
        var p = document.ProjectInformation?.get_Parameter(EnclosureGuid)
            ?? throw new InvalidOperationException(
                "enclosure parameter is not bound — call EnclosureDeclaration.EnsureBound first.");
        var json = JsonConvert.SerializeObject(Declared.From(enclosure));
        if (string.Equals(p.AsString(), json, StringComparison.Ordinal)) return;
        if (!p.Set(json)) throw new InvalidOperationException("Revit rejected the enclosure declaration blob.");
    }

    /// <summary>The on-disk shape. Flat on purpose: a human edits this in a Revit properties box.</summary>
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
