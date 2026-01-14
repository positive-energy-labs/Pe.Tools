using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;
using Pe.Global.Services.Storage;
using Pe.Library.Revit.Ui;
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

        return snapshot;
    }

    /// <summary>
    ///     Converts a FamilySnapshot to a ProfileFamilyManager that can be used by CmdFFManager.
    /// </summary>
    private static ProfileFamilyManager ConvertSnapshotToProfile(FamilySnapshot snapshot) {
        var paramSettings = ConvertParamsToSettings(snapshot.Parameters?.Data ?? []);
        var refPlaneSpecs = snapshot.RefPlanesAndDims?.Data ?? [];

        return new ProfileFamilyManager {
            ExecutionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = true },
            FilterFamilies = new BaseProfileSettings.FilterFamiliesSettings {
                IncludeUnusedFamilies = true,
                IncludeCategoriesEqualing = [],
                IncludeNames = new IncludeFamilies {
                    Equaling = [snapshot.FamilyName]
                },
                ExcludeNames = new ExcludeFamilies()
            },
            FilterApsParams = new BaseProfileSettings.FilterApsParamsSettings {
                // Empty - snapshot captures exact parameters, no APS filtering needed
                IncludeNames = new IncludeSharedParameter(),
                ExcludeNames = new ExcludeSharedParameter()
            },
            MakeRefPlaneAndDims = new MakeRefPlaneAndDimsSettings {
                Enabled = refPlaneSpecs.Count > 0,
                Specs = refPlaneSpecs
            },
            AddAndSetParams = new AddAndSetParamsSettings {
                Enabled = paramSettings.Count > 0,
                CreateFamParamIfMissing = true,
                OverrideExistingValues = true,
                DisablePerTypeFallback = false,
                Parameters = paramSettings
            }
        };
    }

    /// <summary>
    ///     Converts ParamSnapshots to ParamSettingModels for the profile.
    ///     Handles the mutual exclusivity of ValueOrFormula vs ValuesPerType.
    /// </summary>
    private static List<ParamSettingModel> ConvertParamsToSettings(List<ParamSnapshot> snapshots) {
        var result = new List<ParamSettingModel>();

        foreach (var snap in snapshots) {
            // Skip built-in parameters (cannot be created/managed by profile)
            if (snap.IsBuiltIn) continue;

            // Skip project parameters (not family parameters)
            if (snap.IsProjectParameter) continue;

            var setting = ConvertSingleParam(snap);
            if (setting != null)
                result.Add(setting);
        }

        return result;
    }

    /// <summary>
    ///     Converts a single ParamSnapshot to a ParamSettingModel.
    ///     Priority: Formula > Uniform Value > Per-Type Values
    /// </summary>
    private static ParamSettingModel ConvertSingleParam(ParamSnapshot snap) {
        // Case 1: Has formula - use ValueOrFormula with SetAsFormula=true
        if (!string.IsNullOrWhiteSpace(snap.Formula)) {
            return new ParamSettingModel {
                Name = snap.Name,
                IsInstance = snap.IsInstance,
                PropertiesGroup = snap.PropertiesGroup,
                DataType = snap.DataType,
                ValueOrFormula = snap.Formula,
                SetAsFormula = true,
                ValuesPerType = null
            };
        }

        // Get non-null values
        var nonNullValues = snap.ValuesPerType
            .Where(kv => kv.Value != null)
            .ToDictionary(kv => kv.Key, kv => kv.Value, StringComparer.Ordinal);

        // Skip if no values at all
        if (nonNullValues.Count == 0)
            return null;

        // Case 2: All values are the same - use ValueOrFormula with SetAsFormula=false
        var distinctValues = nonNullValues.Values.Distinct().ToList();
        if (distinctValues.Count == 1) {
            return new ParamSettingModel {
                Name = snap.Name,
                IsInstance = snap.IsInstance,
                PropertiesGroup = snap.PropertiesGroup,
                DataType = snap.DataType,
                ValueOrFormula = distinctValues[0],
                SetAsFormula = false,
                ValuesPerType = null
            };
        }

        // Case 3: Different values per type - use ValuesPerType
        return new ParamSettingModel {
            Name = snap.Name,
            IsInstance = snap.IsInstance,
            PropertiesGroup = snap.PropertiesGroup,
            DataType = snap.DataType,
            ValueOrFormula = null,
            SetAsFormula = true, // default, ignored when ValueOrFormula is null
            ValuesPerType = nonNullValues
        };
    }
}
