using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage;
using Serilog.Events;
using System.Diagnostics;
using System.IO;

namespace Pe.Tools.Commands.FamilyFoundry;

/// <summary>
///     Creates a snapshot profile from the current family state.
///     Output can be placed directly in the profiles folder and run with CmdFFManager.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdFFManagerSnapshot : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSetf
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var storage = new Storage("FF Manager");

            // Collect snapshot data from the family
            var snapshot = CollectFamilySnapshot(doc);
            if (snapshot == null) {
                new Ballogger()
                    .Add(LogEventLevel.Error, new StackFrame(), "Failed to collect family snapshot")
                    .Show();
                return Result.Cancelled;
            }

            // Convert snapshot to ProfileFamilyManager format
            var profile = ConvertSnapshotToProfile(snapshot);

            // Write profile to output folder
            var outputDir = storage.OutputDir().TimestampedSubDir();
            var profileName = $"{snapshot.FamilyName}-snapshot.json";
            var outputPath = outputDir.Json(profileName).Write(profile);

            new Ballogger()
                .Add(LogEventLevel.Information, new StackFrame(),
                    $"Created snapshot profile for {snapshot.FamilyName}")
                .Show();

            if (outputPath != null)
                FileUtils.OpenInDefaultApp(outputPath);

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    /// <summary>
    ///     Collects the family snapshot using the same collectors as CmdFFManager.
    /// </summary>
    private static FamilySnapshot CollectFamilySnapshot(Document doc) {
        if (!doc.IsFamilyDocument)
            return null;

        var famDoc = new FamilyDocument(doc);
        var familyName = Path.GetFileNameWithoutExtension(doc.PathName);
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = doc.Title ?? "Unnamed";

        var snapshot = new FamilySnapshot { FamilyName = familyName };

        // Collect parameters
        var paramCollector = new ParamSectionCollector();
        if (((IFamilyDocCollector)paramCollector).ShouldCollect(snapshot))
            ((IFamilyDocCollector)paramCollector).Collect(snapshot, famDoc);

        // Collect ref planes and dims
        var refPlaneCollector = new RefPlaneSectionCollector();
        if (refPlaneCollector.ShouldCollect(snapshot))
            refPlaneCollector.Collect(snapshot, famDoc);

        // Collect constrained extrusions
        var extrusionCollector = new ExtrusionSectionCollector();
        if (extrusionCollector.ShouldCollect(snapshot))
            extrusionCollector.Collect(snapshot, famDoc);

        return snapshot;
    }

    /// <summary>
    ///     Converts a FamilySnapshot to a ProfileFamilyManager that can be used by CmdFFManager.
    /// </summary>
    private static ProfileFamilyManager ConvertSnapshotToProfile(FamilySnapshot snapshot) {
        var (paramSettings, perTypeValuesTable) = ConvertParamsToSettings(snapshot.Parameters?.Data ?? []);
        var mirrorSpecs = snapshot.RefPlanesAndDims?.MirrorSpecs ?? [];
        var offsetSpecs = snapshot.RefPlanesAndDims?.OffsetSpecs ?? [];
        var rectangleExtrusions = snapshot.Extrusions?.Rectangles ?? [];
        var circleExtrusions = snapshot.Extrusions?.Circles ?? [];
        var hasRefPlaneSpecs = mirrorSpecs.Count > 0 || offsetSpecs.Count > 0;
        var hasConstrainedExtrusions = rectangleExtrusions.Count > 0 || circleExtrusions.Count > 0;

        return new ProfileFamilyManager {
            ExecutionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = true },
            FilterFamilies = new BaseProfileSettings.FilterFamiliesSettings {
                IncludeUnusedFamilies = true,
                IncludeCategoriesEqualing = [],
                IncludeNames = new IncludeFamilies { Equaling = [snapshot.FamilyName] },
                ExcludeNames = new ExcludeFamilies()
            },
            FilterApsParams = new BaseProfileSettings.FilterApsParamsSettings {
                // Empty - snapshot captures exact parameters, no APS filtering needed
                IncludeNames = new IncludeSharedParameter(),
                ExcludeNames = new ExcludeSharedParameter()
            },
            MakeRefPlaneAndDims =
                new MakeRefPlaneAndDimsSettings {
                    Enabled = hasRefPlaneSpecs,
                    MirrorSpecs = mirrorSpecs,
                    OffsetSpecs = offsetSpecs
                },
            AddAndSetParams = new AddAndSetParamsSettings {
                Enabled = paramSettings.Count > 0,
                CreateFamParamIfMissing = true,
                OverrideExistingValues = true,
                Parameters = paramSettings,
                PerTypeValuesTable = perTypeValuesTable
            },
            MakeConstrainedExtrusions = new MakeConstrainedExtrusionsSettings {
                Enabled = hasConstrainedExtrusions,
                Rectangles = rectangleExtrusions,
                Circles = circleExtrusions
            }
        };
    }

    /// <summary>
    ///     Converts ParamSnapshots to ParamSettingModels for the profile.
    ///     Returns both parameter models and a transposed per-type values table.
    /// </summary>
    private static (List<ParamSettingModel> Parameters, List<PerTypeValueRow> PerTypeValuesTable)
        ConvertParamsToSettings(List<ParamSnapshot> snapshots) {
        var parameters = new List<ParamSettingModel>();
        var perTypeValuesTable = new List<PerTypeValueRow>();

        foreach (var snap in snapshots) {
            // Skip built-in parameters (cannot be created/managed by profile)
            if (snap.IsBuiltIn) continue;
            if (snap.SharedGuid != null && string.IsNullOrWhiteSpace(snap.ValueOrFormula)) continue;

            // Skip project parameters (not family parameters)
            if (snap.IsProjectParameter) continue;

            parameters.Add(new ParamSettingModel {
                Name = snap.Name,
                IsInstance = snap.IsInstance,
                PropertiesGroup = snap.PropertiesGroup,
                DataType = snap.DataType,
                ValueOrFormula = snap.ValueOrFormula,
                SetAs = snap.SetAs
            });

            var row = snap.ToPerTypeValuesTableRow();
            if (row != null)
                perTypeValuesTable.Add(row);
        }

        return (parameters, perTypeValuesTable);
    }
}