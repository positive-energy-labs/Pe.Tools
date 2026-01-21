using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.FamilyFoundry;
using Pe.FamilyFoundry.OperationGroups;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.Tools.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdFFMakeATVariants : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        var doc = commandData.Application.ActiveUIDocument.Document;

        try {
            var storage = new Storage("FF AT Variants");
            var settings = storage.SettingsDir().Json<ATVariantSettings>().Read();
            var outputFolderPath = storage.OutputDir().DirectoryPath;

            // Define variants declaratively
            var variantDescriptors = new[] {
                new ATVariantDescriptor("Supply", "S", DuctConnectorConfigurator.PresetATSupply),
                new ATVariantDescriptor("Return", "R", DuctConnectorConfigurator.PresetATReturn),
                new ATVariantDescriptor("Exhaust", "E", DuctConnectorConfigurator.PresetATExhaust),
                new ATVariantDescriptor("Intake", "I", DuctConnectorConfigurator.PresetATIntake)
            };

            // Factory builds queue + profile from descriptor
            var factory = new ATVariantQueueFactory(settings);
            var variants = variantDescriptors.Select(factory.CreateVariant).ToList();

            // Request parameter snapshots
            var collectorQueue = new CollectorQueue()
                .Add(new ParamSectionCollector());

            var processor = new OperationProcessor(doc, new ExecutionOptions());
            var outputs = processor.ProcessFamilyDocumentIntoVariants(variants, collectorQueue, outputFolderPath);

            // Setup single result builder that will be reused
            var resultBuilder = new ProcessingResultBuilder(storage);

            var balloon = new Ballogger();
            foreach (var ctx in outputs) {
                var (logs, error) = ctx.OperationLogs;

                // Get variant spec from context tag
                if (ctx.Tag is VariantSpec variantSpec) {
                    // Create variant-specific settings object for serialization
                    var variantSettings = new {
                        VariantName = variantSpec.Name.Trim(),
                        BaseATSettings = new { settings.SecondLetterDict },
                        SyntheticAddAndSetParamsSettings = ((ATVariantSettings)variantSpec.Profile).SyntheticTag
                    };

                    // Update builder with variant-specific settings and metadata
                    _ = resultBuilder
                        .WithCustomProfile(variantSettings, variantSpec.Name.Trim())
                        .WithOperationMetadata(variantSpec.Queue);

                    // Write output for this variant (adds to tracked contexts)
                    resultBuilder.WriteSingleFamilyOutput(ctx);
                }

                if (error != null) {
                    _ = balloon.Add(LogEventLevel.Error, new StackFrame(),
                        $"Failed to process {ctx.FamilyName}: {error.Message}");
                } else if (logs != null) {
                    _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                        $"Processed {ctx.FamilyName} in {ctx.TotalMs:F0}ms");
                    foreach (var log in logs) {
                        _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                            $"  {log.OperationName}: {log.Entries.Count} entries");
                    }
                }
            }

            // Calculate total processing time
            var totalMs = outputs.Sum(ctx => ctx.TotalMs);

            // Update builder with summary settings and write summary file
            _ = resultBuilder.WithCustomProfile(
                new {
                    Command = "AT Variants",
                    BaseSettings = settings.SecondLetterDict,
                    VariantsProcessed = variantDescriptors.Length
                }, "AT Variants");

            resultBuilder.WriteMultiFamilySummary(totalMs);

            balloon.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }
}

/// <summary>
///     Descriptor for an Air Terminal variant.
///     Separates variant metadata from queue construction logic.
/// </summary>
public record ATVariantDescriptor(
    string Name,
    string SystemLetter,
    DuctConnectorConfigurator ConnectorConfig
);

/// <summary>
///     Factory that creates VariantSpecs with queues and profiles for AT variants.
///     Encapsulates the logic of building queues from descriptors.
/// </summary>
public class ATVariantQueueFactory {
    private readonly ATVariantSettings _baseSettings;

    public ATVariantQueueFactory(ATVariantSettings baseSettings) => this._baseSettings = baseSettings;

    public VariantSpec CreateVariant(ATVariantDescriptor descriptor) {
        // Create the parameter settings for PE_G___TagInstance
        var paramSettings = new ParamSettingModel {
            Name = "PE_G___TagInstance",
            ValuesPerType = this._baseSettings.SecondLetterDict
                .ToDictionary(kv => kv.Key, kv => descriptor.SystemLetter + kv.Value + "X-#"),
            SetAsFormula = false
        };

        // Build synthetic settings that will be logged
        var syntheticSettings = new AddAndSetParamsSettings { Parameters = [paramSettings] };

        // Build operation queue
        var queue = new OperationQueue()
            .Add(new SetDuctConnectorSettings(descriptor.ConnectorConfig))
            .Add(new AddAndSetParams(syntheticSettings));

        // Create profile with synthetic settings
        var profile = this._baseSettings.WithSynthesizedTag(syntheticSettings);

        // Return variant spec with queue and profile
        return new VariantSpec($" {descriptor.Name}", queue).WithProfile(profile);
    }
}

public class ATVariantSettings : BaseProfileSettings {
    public Dictionary<string, char> SecondLetterDict { get; init; } = new() {
        { "Bar", 'B' },
        { "Slot", 'S' },
        { "CVD", 'C' },
        { "Grille", 'G' },
        { "Vent", 'V' },
        { "Louver", 'L' },
        { "Nozzle", 'N' }
    };

    public AddAndSetParamsSettings? SyntheticTag { get; set; }

    public ATVariantSettings WithSynthesizedTag(AddAndSetParamsSettings settings) {
        this.SyntheticTag = settings;
        return this;
    }
}