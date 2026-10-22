using Pe.Revit.Parameters;

namespace Pe.Revit.Global.Lib;

/// <summary>
///     One hidden, non-user-modifiable shared Text parameter on Project Information that holds a model-owned JSON blob
///     (parameter-links profile, duct loss store). Identity is the GUID; the binding is created on first write.
/// </summary>
internal sealed record ProjectInfoText(Guid Guid, string Name, string Description) {
    public string? Read(Document document) =>
        document.ProjectInformation?.get_Parameter(this.Guid)?.AsString() is { } text && !string.IsNullOrWhiteSpace(text) ? text : null;

    /// <summary>Binds on first use and writes inside the caller's transaction. False when the value is already there.</summary>
    public bool Write(Document document, string value) {
        if (!document.IsModifiable)
            throw new InvalidOperationException($"'{this.Name}' writes require an open Revit transaction.");
        var parameter = this.Ensure(document);
        if (parameter.IsReadOnly)
            throw new InvalidOperationException($"'{this.Name}' is read-only.");
        if (string.Equals(parameter.AsString(), value, StringComparison.Ordinal))
            return false;
        if (!parameter.Set(value))
            throw new InvalidOperationException($"Revit rejected the '{this.Name}' value.");
        return true;
    }

    private Parameter Ensure(Document document) {
        if (document.ProjectInformation?.get_Parameter(this.Guid) is { } existing)
            return existing;
        _ = SharedParameterBinder.EnsureProjectBinding(
            document,
            new SharedDefinitionSpec(this.Name, SpecTypeId.String.Text, Description: this.Description, Guid: this.Guid,
                Visible: false, UserModifiable: false),
            [BuiltInCategory.OST_ProjectInformation]);
        document.Regenerate();
        return document.ProjectInformation?.get_Parameter(this.Guid)
               ?? throw new InvalidOperationException($"Bound '{this.Name}' was not available on Project Information.");
    }
}
