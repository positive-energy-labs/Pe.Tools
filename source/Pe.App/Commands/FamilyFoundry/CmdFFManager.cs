using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.Revit;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.Global;
using Pe.Revit.Global.Ui;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.App.Commands.FamilyFoundry;
// support add, delete, remap, sort, rename

[Transaction(TransactionMode.Manual)]
public class CmdFFManager : IExternalCommand {
    public const string AddinKey = nameof(CmdFFManager);
    public const string DisplayName = "FF Manager";
    private static readonly ISettingsRootBinding<FFManagerProfile> SettingsRoot = FFManagerSettingsRegistration.Root;

    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSetf
    ) => this.Run(commandData.Application);

    /// <summary> Opens the FF Manager palette. Shared by the ribbon command and the switcher. </summary>
    internal Result Run(UIApplication uiapp) {
        var uiDoc = uiapp.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var window = new FoundryPaletteBuilder<FFManagerProfile>(DisplayName, SettingsRoot, doc, uiDoc)
                .WithAction("Apply Profile", this.HandleApplyProfile,
                    ctx => ctx.PreviewData?.IsValid == true)
                .WithQueueBuilder(BuildQueue)
                .Build();

            window.Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private void HandleApplyProfile(FoundryContext<FFManagerProfile> ctx) {
        if (ctx.PreviewData?.IsValid != true || ctx.SelectedProfile == null) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot apply profile - profile has validation errors")
                .Show();
            return;
        }

        // Load profile fresh for execution
        var profile = ctx.Settings.ReadRequired(ctx.SelectedProfile.TextPrimary);

        var runOutput = OutputStorage.ExactDir(ctx.Storage.Output().DirectoryPath);
        var applyResult = ctx.Doc.ApplyFamilyProfile(
            profile,
            ctx.SelectedProfile.TextPrimary,
            ctx.OnFinishSettings,
            runOutput);

        if (!applyResult.Success)
            throw new InvalidOperationException(applyResult.Error ?? "FF Manager processing failed.");

        var balloon = new Ballogger();
        foreach (var logCtx in applyResult.Contexts) {
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Processed {logCtx.FamilyName} in {logCtx.TotalMs}ms");
        }

        balloon.Show();

        // No post-processing for Manager - it's for family documents only
    }

    /// <summary>
    ///     Builds the operation queue from the declarative Manager profile.
    /// </summary>
    private static OperationQueue BuildQueue(
        FFManagerProfile profile,
        List<SharedParameterDefinition> apsParamData
    ) => FFManagerQueueBuilder.Build(profile, apsParamData);
}
