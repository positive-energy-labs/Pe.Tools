using Pe.Revit.Extensions.ProjDocument;
using Newtonsoft.Json.Linq;
using Pe.Shared.Product;
using Pe.Shared.RevitData.Serialization;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Parameters;

/// <summary>
///     The one mechanism for a Pe blob stored inside a model (ADR 0032 storage amendment): one hidden,
///     non-user-modifiable shared Text parameter per owner, holding the <see cref="OwnerBlob" /> envelope. Two anchors:
///     Project Information for a project-level owner (bound on first write), and an element for a per-element owner
///     (the owner binds its parameter to the element's category first). Extensible Storage is banned; the duct
///     per-fitting results entity is the one exception, because Revit's pressure-drop server API requires it.
///     <para>
///         Every write is inside the caller's transaction, keeps unreadable bytes locally and posts a notice before
///         replacing them, and reads the written value back exactly.
///     </para>
/// </summary>
public static class OwnerBlobStore {
    internal static readonly AsyncLocal<string?> RecoveryStateOverride = new();

    public static SharedDefinitionSpec Spec(OwnerDescriptor owner) =>
        new(owner.Name, SpecTypeId.String.Text, Description: owner.Description, Guid: owner.Guid, Visible: false, UserModifiable: false);

    /// <summary>The project anchor. A document with no Project Information reads as absent.</summary>
    public static OwnerBlobRead Read(Document document, OwnerDescriptor owner) =>
        OwnerBlob.Decode(owner, document.ProjectInformation?.get_Parameter(owner.Guid)?.AsString());

    /// <summary>The element anchor.</summary>
    public static OwnerBlobRead Read(Element element, OwnerDescriptor owner) =>
        OwnerBlob.Decode(owner, element.get_Parameter(owner.Guid)?.AsString());

    /// <summary>Binds on first use. False when the value is already there.</summary>
    public static bool Write(Document document, OwnerDescriptor owner, JObject data) {
        RequireTransaction(document, owner);
        return Write(EnsureOnProjectInformation(document, owner), document, owner, data);
    }

    /// <summary>Replaces a sealed record. A missing or changed parameter refuses before binding or recovery.</summary>
    public static bool Write(Document document, OwnerDescriptor owner, JObject data, OwnerBlobReplacement replacing) {
        if (replacing is null) throw new ArgumentNullException(nameof(replacing));
        RequireTransaction(document, owner);
        var parameter = document.ProjectInformation?.get_Parameter(owner.Guid)
            ?? throw new InvalidOperationException($"The stored '{owner.Name}' disappeared since replacement was planned.");
        return Write(parameter, document, owner, data, replacing);
    }

    private static void RequireTransaction(Document document, OwnerDescriptor owner) {
        if (!document.IsModifiable)
            throw new InvalidOperationException($"'{owner.Name}' writes require an open Revit transaction.");
    }

    /// <summary>False when the value is already there. Throws when the owner's parameter is not bound on the element.</summary>
    public static bool Write(Element element, OwnerDescriptor owner, JObject data) =>
        Write(element.get_Parameter(owner.Guid)
              ?? throw new InvalidOperationException($"'{owner.Name}' is not bound on element {element.Id}; initialize its carrier first."),
            element.Document, owner, data);

    private static bool Write(Parameter parameter, Document document, OwnerDescriptor owner, JObject data,
        OwnerBlobReplacement? replacing = null) {
        var raw = parameter.AsString();
        var stored = OwnerBlob.Decode(owner, raw);
        if (OwnerBlob.Replace(stored, data, (replacement, replacedRaw) => {
            if (parameter.IsReadOnly)
                throw new InvalidOperationException($"'{owner.Name}' is read-only.");
            StoredFile.KeepModelRecord(RecoveryStateOverride.Value ?? ProductRuntimeLayout.Current.State.RootPath,
                replacement.Owner, document.GetDocumentKey(), replacedRaw, replacement.Reason);
        }, replacing) is not { } text) return false;
        if (parameter.IsReadOnly)
            throw new InvalidOperationException($"'{owner.Name}' is read-only.");
        if (!string.Equals(parameter.AsString(), raw, StringComparison.Ordinal))
            throw new InvalidOperationException($"'{owner.Name}' changed before replacement.");
        if (!parameter.Set(text))
            throw new InvalidOperationException($"Revit rejected the '{owner.Name}' value.");
        if (!string.Equals(parameter.AsString(), text, StringComparison.Ordinal))
            throw new InvalidOperationException($"'{owner.Name}' did not read back exactly as written.");
        return true;
    }

    private static Parameter EnsureOnProjectInformation(Document document, OwnerDescriptor owner) {
        if (document.ProjectInformation?.get_Parameter(owner.Guid) is { } existing)
            return existing;
        _ = SharedParameterBinder.EnsureProjectBinding(document, Spec(owner), [BuiltInCategory.OST_ProjectInformation]);
        document.Regenerate();
        return document.ProjectInformation?.get_Parameter(owner.Guid)
               ?? throw new InvalidOperationException($"Bound '{owner.Name}' was not available on Project Information.");
    }
}
