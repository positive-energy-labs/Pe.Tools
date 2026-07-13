using Newtonsoft.Json;
using Pe.Revit.Global.Utils.Files;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Serialization;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.ParameterLinks;

internal sealed class ParameterLinksProfileStorage {
    internal static readonly Guid ProfileParameterGuid = new("ceb230bf-9e1b-485a-a05e-0cda66558efd");
    internal const string ProfileParameterName = "_PE_ParameterLinksProfile";

    public ProfileReadResult Read(RevitDocument document) {
        var parameter = document.ProjectInformation?.get_Parameter(ProfileParameterGuid);
        var json = parameter?.AsString();
        if (string.IsNullOrWhiteSpace(json))
            return new ProfileReadResult(null, false, null);

        try {
            var profile = JsonConvert.DeserializeObject<ParameterLinkProfile>(
                json!,
                CreateProfileSerializerSettings());
            return profile == null
                ? new ProfileReadResult(null, true, "Stored parameter-links profile is empty.")
                : new ProfileReadResult(profile, true, null);
        } catch (Exception ex) {
            return new ProfileReadResult(null, true, $"Stored parameter-links profile is invalid: {ex.Message}");
        }
    }

    public bool Write(RevitDocument document, ParameterLinkProfile profile) {
        if (!document.IsModifiable)
            throw new InvalidOperationException("Parameter-links profile writes require an open Revit transaction.");

        var parameter = EnsureParameter(document);
        if (parameter.IsReadOnly)
            throw new InvalidOperationException($"Profile parameter '{ProfileParameterName}' is read-only.");

        var json = JsonConvert.SerializeObject(profile, Formatting.None, CreateProfileSerializerSettings());
        if (string.Equals(parameter.AsString(), json, StringComparison.Ordinal))
            return false;
        if (!parameter.Set(json))
            throw new InvalidOperationException($"Revit rejected the '{ProfileParameterName}' profile value.");
        return true;
    }

    private static Parameter EnsureParameter(RevitDocument document) {
        var existing = document.ProjectInformation?.get_Parameter(ProfileParameterGuid);
        if (existing != null)
            return existing;

        var sharedParameter = SharedParameterElement.Lookup(document, ProfileParameterGuid);
        using var tempFile = sharedParameter == null ? new TempSharedParamFile(document) : null;
        Definition definition = sharedParameter?.GetDefinition()
            ?? tempFile!.TempGroup.Definitions.Create(new ExternalDefinitionCreationOptions(
                ProfileParameterName,
                SpecTypeId.String.Text) {
                GUID = ProfileParameterGuid,
                Visible = false,
                UserModifiable = false,
                Description = "Versioned Pe.Tools parameter-link profile."
            });

        var categories = document.Application.Create.NewCategorySet();
        var projectInformation = Category.GetCategory(document, BuiltInCategory.OST_ProjectInformation)
            ?? throw new InvalidOperationException("Project Information category is unavailable.");
        _ = categories.Insert(projectInformation);
        var binding = document.Application.Create.NewInstanceBinding(categories);
        var bindings = document.ParameterBindings;
        var bound = bindings.Contains(definition)
            ? bindings.ReInsert(definition, binding, GroupTypeId.Data)
            : bindings.Insert(definition, binding, GroupTypeId.Data);
        if (!bound)
            throw new InvalidOperationException($"Could not bind '{ProfileParameterName}' to Project Information.");

        document.Regenerate();
        return document.ProjectInformation?.get_Parameter(ProfileParameterGuid)
            ?? throw new InvalidOperationException($"Bound '{ProfileParameterName}' was not available on Project Information.");
    }

    private static JsonSerializerSettings CreateProfileSerializerSettings() {
        var settings = RevitDataJson.CreateSerializerSettings();
        settings.DefaultValueHandling = DefaultValueHandling.Include;
        settings.NullValueHandling = NullValueHandling.Include;
        return settings;
    }
}

internal sealed record ProfileReadResult(
    ParameterLinkProfile? Profile,
    bool HasStoredProfile,
    string? Error
);
