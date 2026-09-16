using Autodesk.Revit.UI;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Revit.Ui.Core;
using Pe.Revit.Ui.Core.Services;
using Pe.Shared.RevitData.Families;
using System.IO;
using RuntimeStorageClient = Pe.Shared.StorageRuntime.StorageClient;
using Pe.App.Pods;

namespace Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;

/// <summary>
///     The foundry palette: lists every `*.family.json` and `*.patch.json` in the FamilyFoundry module, parses
///     the selection for the preview, and hands the command its actions. Commands decide what to do with a
///     model or a patch; the palette only reads.
/// </summary>
public sealed class FoundryPaletteBuilder(string displayName, Document doc, UIDocument uiDoc) {
    private readonly List<(string Name, Action<FoundryContext> Handler, Func<FoundryContext, bool>? CanExecute)> _actions = [];

    public FoundryPaletteBuilder WithAction(string name, Action<FoundryContext> handler, Func<FoundryContext, bool>? canExecute = null) {
        this._actions.Add((name, handler, canExecute));
        return this;
    }

    public EphemeralWindow Build() {
        var storage = RuntimeStorageClient.Default.Module(FamilyModelSettingsRegistration.ModuleKey);
        var documents = RuntimeStorageClient.Default.Root(FamilyModelSettingsRegistration.Root).Documents();
        var files = ProfileListItem.Discover(documents)
            .Concat(PreparedPodSettingsCatalog.List(".family.json", ".patch.json").Select(setting =>
                new ProfileListItem(setting, setting.SourcePath.EndsWith(".patch.json", StringComparison.OrdinalIgnoreCase)
                    ? FoundryFileKind.Patch
                    : FoundryFileKind.FamilyModel)))
            .OrderByDescending(item => item.LastModified)
            .ToList();
        if (files.Count == 0)
            throw new InvalidOperationException($"No *.family.json or *.patch.json under {documents.ResolveRootDirectory()}.");

        var context = new FoundryContext { Doc = doc, UiDoc = uiDoc, Storage = storage, Documents = documents };
        var previewPanel = new ProfilePreviewPanel(async (item, ct) => {
            if (item == null) return null;
            var data = await BuildPreview(item, context, ct);
            context.SelectedProfile = item;
            context.PreviewData = data;
            return data;
        });

        var paletteActions = this._actions.Select(a => new PaletteAction<ProfileListItem> {
            Name = a.Name,
            Execute = _ => a.Handler(context),
            CanExecute = _ => a.CanExecute?.Invoke(context) ?? true
        }).ToList();

        return PaletteFactory.Create($"{displayName} - Select family.json or patch", new PaletteOptions<ProfileListItem> {
            Persistence = (storage, item => item.RelativePath),
            SearchConfig = SearchConfig.PrimaryAndSecondary(),
            SidebarPanel = previewPanel,
            Tabs = [
                new TabDefinition<ProfileListItem>("Models", () => files.Where(f => f.Kind == FoundryFileKind.FamilyModel).ToList(), paletteActions) { FilterKeySelector = _ => "Models" },
                new TabDefinition<ProfileListItem>("Patches", () => files.Where(f => f.Kind == FoundryFileKind.Patch).ToList(), paletteActions) { FilterKeySelector = _ => "Patches" }
            ]
        });
    }

    private static async Task<PreviewData> BuildPreview(ProfileListItem item, FoundryContext context, CancellationToken ct) {
        var json = item.Prepared?.RawContent ?? File.ReadAllText(item.FilePath);
        var data = new PreviewData { ProfileName = item.TextPrimary, FilePath = item.FilePath, LineCount = item.LineCount, ModifiedDate = item.LastModified, ProfileJson = json };
        try {
            if (item.Kind == FoundryFileKind.Patch) {
                var patch = item.Prepared is null
                    ? new ModuleSettingsStorage<FamilyPatch>(context.Documents).ReadRequired(item.RelativePath, FamilyModelSettingsRegistration.PatchRootKey)
                    : ModuleSettingsStorage<FamilyPatch>.ReadPrepared(item.Prepared.RawContent, item.Prepared.ComposedContent, $"{item.Prepared.PodId}:{item.Prepared.SourcePath}");
                var families = await PaletteThreading.RunRevitAsync<List<FamilyInfo>>(() => context.Doc.IsFamilyDocument
                    ? []
                    : context.Doc.FamiliesMatching(patch.Select).Select(f => new FamilyInfo(f.Name, f.FamilyCategory?.Name ?? "?")).ToList(), ct);
                return data with { Patch = patch, IsValid = true, Families = families, Sections = ((Newtonsoft.Json.Linq.JObject)patch.Patch).Properties().Select(p => $"{p.Name}: {p.Value.Type}").ToList() };
            }
            var composed = item.Prepared is null
                ? new ModuleSettingsStorage<FamilyModel>(context.Documents).ReadRequired(item.RelativePath, FamilyModelSettingsRegistration.RootKey)
                : ModuleSettingsStorage<FamilyModel>.ReadPrepared(item.Prepared.RawContent, item.Prepared.ComposedContent, $"{item.Prepared.PodId}:{item.Prepared.SourcePath}");
            var parsed = FamilyModelJson.Parse(FamilyModelJson.Serialize(composed));
            if (parsed.Value is null || parsed.Diagnostics.Count > 0)
                return data with { IsValid = false, RemainingErrors = parsed.Diagnostics.Select(d => $"{d.Path}: {d.Code} {d.Message}").ToList() };
            var m = parsed.Value;
            return data with {
                Model = m, IsValid = true,
                Sections = [
                    $"parameters: {m.Parameters.Count}", $"types: {m.Types.Count}", $"datums: {m.Datums.Count}", $"refPlanes: {m.RefPlanes.Count}", $"refLines: {m.RefLines.Count}",
                    $"dimensions: {m.Dimensions.Count}", $"forms: {m.Forms.Count}", $"nested: {m.Nested.Count}", $"arrays: {m.Arrays.Count}", $"connectors: {m.Connectors.Count}", $"details: {m.Details.Count}"
                ]
            };
        } catch (Exception ex) {
            return data with { IsValid = false, RemainingErrors = [$"{ex.GetType().Name}: {ex.Message}"] };
        }
    }
}
