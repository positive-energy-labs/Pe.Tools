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
///         Every write is inside the caller's transaction and reads the written value back exactly.
///         Recovery keeps unreadable bytes before replacement and queues a notice for the caller to publish after commit.
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
    public static bool Write(Document document, OwnerDescriptor owner, JObject data, OwnerBlobReplacement replacing, OwnerBlobNotices notices) {
        if (replacing is null) throw new ArgumentNullException(nameof(replacing));
        RequireTransaction(document, owner);
        var parameter = document.ProjectInformation?.get_Parameter(owner.Guid)
            ?? throw new InvalidOperationException($"The stored '{owner.Name}' disappeared since replacement was planned.");
        return Write(parameter, document, owner, data, replacing, notices);
    }

    /// <summary>Saves an owner that has no preview. The caller's transaction owns the read and the write.</summary>
    public static bool WriteWithoutPreview(Document document, OwnerDescriptor owner, JObject data, OwnerBlobNotices notices) {
        RequireTransaction(document, owner);
        return Read(document, owner).Replacement is { } replacing
            ? Write(document, owner, data, replacing, notices)
            : Write(document, owner, data);
    }

    private static void RequireTransaction(Document document, OwnerDescriptor owner) {
        if (!document.IsModifiable)
            throw new InvalidOperationException($"'{owner.Name}' writes require an open Revit transaction.");
    }

    /// <summary>False when the value is already there. Throws when the owner's parameter is not bound on the element.</summary>
    public static bool Write(Element element, OwnerDescriptor owner, JObject data) =>
        Write(RequireParameter(element, owner), element.Document, owner, data);

    /// <summary>Replaces a sealed unreadable record on an already bound element.</summary>
    public static bool Write(Element element, OwnerDescriptor owner, JObject data, OwnerBlobReplacement replacing, OwnerBlobNotices notices) {
        if (replacing is null) throw new ArgumentNullException(nameof(replacing));
        RequireTransaction(element.Document, owner);
        return Write(RequireParameter(element, owner), element.Document, owner, data, replacing, notices);
    }

    private static Parameter RequireParameter(Element element, OwnerDescriptor owner) =>
        element.get_Parameter(owner.Guid)
        ?? throw new InvalidOperationException($"'{owner.Name}' is not bound on element {element.Id}.");

    private static bool Write(Parameter parameter, Document document, OwnerDescriptor owner, JObject data,
        OwnerBlobReplacement? replacing = null, OwnerBlobNotices? notices = null) {
        var raw = parameter.AsString();
        var stored = OwnerBlob.Decode(owner, raw);
        Action? publish = null;
        if (OwnerBlob.Replace(stored, data, (replacement, replacedRaw) => {
            if (parameter.IsReadOnly)
                throw new InvalidOperationException($"'{owner.Name}' is read-only.");
            if (notices is null) throw new ArgumentNullException(nameof(notices));
            publish = StoredFile.PrepareModelRecovery(RecoveryStateOverride.Value ?? ProductRuntimeLayout.Current.State.RootPath,
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
        if (publish is not null) notices!.Add(publish);
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

/// <summary>Collects recovery notices for a single transaction or group. Publish only after it commits.</summary>
public sealed class OwnerBlobNotices {
    private readonly List<Action> _pending = [];
    internal void Add(Action publish) => this._pending.Add(publish);

    public void Publish() {
        foreach (var publish in this._pending) {
            try { publish(); }
            catch (Exception ex) { Serilog.Log.Error(ex, "Could not publish recovery notice for a committed model replacement"); }
        }
        this._pending.Clear();
    }
}
