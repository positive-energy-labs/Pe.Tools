using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.FamilyFoundry.Aggregators;
using Pe.FamilyFoundry.Snapshots;
using Pe.Global.PolyFill;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using Pe.Global.Revit.Lib;
using Pe.Global.Revit.Ui;
using Serilog.Events;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics;

namespace Pe.Tools.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdFFParamAggregator : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var storage = new Storage("FF Param Aggregator");
            var settingsManager = storage.SettingsDir();

            // Load settings (creates default file if missing)
            var settings = settingsManager.Json<ParamAggregatorSettings>("settings.json").Read();

            // Get families - either selected or ALL families (or filtered by category)
            var selectedFamilies = Pickers.GetSelectedFamilies(uiDoc);
            var familiesQuery = selectedFamilies.Any()
                ? selectedFamilies
                : new FilteredElementCollector(doc)
                    .OfClass(typeof(Family))
                    .OfType<Family>();

            // Apply category filter if specified
            var families = settings.CategoryFilter.Any()
                ? familiesQuery.Where(f =>
                        f.FamilyCategory != null &&
                        settings.CategoryFilter.Any(cat => cat.ToBuiltInCategory() == f.FamilyCategory.ToBuiltInCategory()))
                    .ToList()
                : familiesQuery.ToList();

            if (!families.Any()) {
                var filterMsg = settings.CategoryFilter.Any()
                    ? $"No families found for categories: {string.Join(", ", settings.CategoryFilter.Select(c => c.Name))}"
                    : "No families found in the document.";
                new Ballogger()
                    .Add(LogEventLevel.Warning, new StackFrame(), filterMsg)
                    .Show();
                return Result.Cancelled;
            }

            var collectorQueue = new CollectorQueue()
                .Add(new ParamSectionCollector());


            // Aggregate parameters
            var balloon = new Ballogger();
            var filterInfo = settings.CategoryFilter.Any()
                ? $" (filtered to {string.Join(", ", settings.CategoryFilter.Select(c => c.Name))})"
                : " (all categories)";
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Analyzing {families.Count} families{filterInfo}...");

            var aggregatedData = FamilyParamAggregator.Aggregate(doc, collectorQueue, families);
            var aggregatedParamDatas = aggregatedData as AggregatedParamData[] ?? aggregatedData.ToArray();

            // Enrich with schedule data (with same category filter)
            FamilyParamAggregator.EnrichWithScheduleData(doc, aggregatedParamDatas, settings.CategoryFilter);

            var csvPath = FamilyParamAggregator.WriteToCsv(aggregatedParamDatas, storage);

            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Aggregated {aggregatedParamDatas.Count()} unique parameters from {families.Count} families.");

            if (settings.OpenOutputFileOnFinish) FileUtils.OpenInDefaultApp(csvPath);

            balloon.Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }
}

/// <summary>
///     Settings for parameter aggregation across families and schedules.
/// </summary>
public class ParamAggregatorSettings {
    [Description(
        "Optional list of categories to filter families and schedules. " +
        "When empty, ALL families and schedules in the document will be analyzed.")]
    [SchemaExamples(typeof(CategoryNamesProvider))]
    [Required]
    public List<Category> CategoryFilter { get; init; } = [];

    [Description("Automatically open the generated CSV file when the command completes")]
    public bool OpenOutputFileOnFinish { get; init; } = true;
}