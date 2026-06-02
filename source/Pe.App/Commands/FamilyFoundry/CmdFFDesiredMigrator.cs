using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.App.Host;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.Global;
using Pe.Revit.Global.Lib;
using Pe.Revit.Global.Ui;
using Pe.Revit.SettingsRuntime.Modules;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;
using Serilog.Events;
using System.Diagnostics;
using System.IO;
using RuntimeStorageClient = Pe.Shared.StorageRuntime.StorageClient;

namespace Pe.App.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdFFDesiredMigrator : IExternalCommand {
    public const string AddinKey = nameof(CmdFFDesiredMigrator);
    public const string DisplayName = "FF Desired Migrator";
    private static readonly ISettingsRootBinding<DesiredFamilyMigrationProfile> SettingsRoot =
        DesiredFamilyMigrationSettingsRegistration.Root;

    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var window = new FoundryPaletteBuilder<DesiredFamilyMigrationProfile>(DisplayName, SettingsRoot, doc, uiDoc)
                .WithAction("Open Pe Tools", this.HandleOpenPeTools)
                .WithAction("Open Profile File", this.HandleOpenFile,
                    ctx => ctx.SelectedProfile != null)
                .WithAction("Process Families", this.HandleProcessFamilies,
                    ctx => ctx.PreviewData?.IsValid == true)
                .WithQueueBuilder((profile, apsParams) => DesiredFamilyMigrationQueueBuilder.Build(profile, apsParams).Queue)
                .Build();

            window.Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private void HandleOpenFile(FoundryContext<DesiredFamilyMigrationProfile> context) {
        if (context.SelectedProfile == null) return;
        var result = OpenProfileInDefaultApp(
            context.SelectedProfile.TextPrimary,
            SettingsRoot.RootKey
        );
        var level = result.Success ? LogEventLevel.Information : LogEventLevel.Warning;
        var message = result.Success
            ? $"Opened profile file: {result.FilePath}"
            : result.Error ?? "Profile file could not be opened.";
        new Ballogger().Add(level, new StackFrame(), message).Show();
    }

    private void HandleProcessFamilies(FoundryContext<DesiredFamilyMigrationProfile> ctx) {
        if (ctx.SelectedProfile == null) return;
        if (ctx.PreviewData?.IsValid != true) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot process families - profile has validation errors")
                .Show();
            return;
        }

        var profile = ReadProfile(
            ctx.SelectedProfile.TextPrimary,
            SettingsRoot.RootKey
        );
        var runOutput = RuntimeStorageClient.Default.Module(AddinKey).Output().TimestampedSubDir();
        var selectedFamilies = Pickers.GetSelectedFamilies(ctx.UiDoc);
        var runResult = ctx.UiDoc.Document.ApplyDesiredFamilyMigrationProfile(
            profile,
            ctx.SelectedProfile.TextPrimary,
            selectedFamilies,
            ctx.OnFinishSettings,
            runOutput
        );
        var level = runResult.Success ? LogEventLevel.Information : LogEventLevel.Error;
        var message = runResult.Success
            ? $"Processed {runResult.FamilyCount} families in {runResult.TotalMs:F0}ms."
            : runResult.Error ?? "Processing failed.";
        if (!string.IsNullOrWhiteSpace(runResult.OutputFolderPath))
            message += $"\nOutput: {runResult.OutputFolderPath}";
        new Ballogger().Add(level, new StackFrame(), message).Show();
    }

    private void HandleOpenPeTools(FoundryContext<DesiredFamilyMigrationProfile> context) {
        var selectedProfileName = context.SelectedProfile?.TextPrimary;
        var launched = PeToolsBrowser.TryLaunch(
            SettingsRoot.Module.ModuleKey,
            SettingsRoot.RootKey,
            selectedProfileName
        );
        if (launched) {
            new Ballogger()
                .Add(
                    LogEventLevel.Information,
                    new StackFrame(),
                    "Opened FF Desired Migrator external Pe Tools route in your default browser."
                )
                .Show();
            return;
        }

        new Ballogger()
            .Add(
                LogEventLevel.Warning,
                new StackFrame(),
                $"Could not open external Pe Tools route. Check {HostProcessIdentity.FrontendBaseUrlVariable}."
            )
            .Show();
    }

    internal static string ResolveProfileFilePath(string relativePath, string? subDirectory = null) =>
        ResolveStorage().Documents().ResolveDocumentPath(relativePath, ResolveRootKey(subDirectory));

    internal static DesiredFamilyMigrationProfile ReadProfile(
        string relativePath,
        string? subDirectory = null
    ) => ResolveStorage().Settings().ReadRequired(relativePath, ResolveRootKey(subDirectory));

    internal static FFMigratorOpenProfileFileActionResult OpenProfileInDefaultApp(
        string relativePath,
        string? subDirectory = null
    ) {
        try {
            var filePath = ResolveProfileFilePath(relativePath, subDirectory);
            if (!File.Exists(filePath)) {
                return new FFMigratorOpenProfileFileActionResult(
                    false,
                    $"Profile file not found: {Path.GetFileName(filePath)}",
                    filePath,
                    false
                );
            }

            _ = FileUtils.OpenInDefaultApp(filePath);
            return new FFMigratorOpenProfileFileActionResult(true, null, filePath, true);
        } catch (Exception ex) {
            return new FFMigratorOpenProfileFileActionResult(false, ex.Message, null, false);
        }
    }

    private static ModuleStorage<DesiredFamilyMigrationProfile> ResolveStorage() =>
        RuntimeStorageClient.Default.Root(SettingsRoot);

    private static string ResolveRootKey(string? subDirectory) =>
        string.IsNullOrWhiteSpace(subDirectory)
            ? SettingsRoot.RootKey
            : subDirectory;
}
