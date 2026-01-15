using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Operations;
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
            var storage = new Storage("FF Make AT Variants");
            var outputFolderPath = storage.OutputDir().DirectoryPath;

            static OperationQueue MakeQueue(DuctConnectorConfigurator settings) {
                return new OperationQueue().Add(new SetDuctConnectorSettings(settings));
            }

            var variants = new List<(string variant, OperationQueue queue)> {
                (" Supply", MakeQueue(DuctConnectorConfigurator.PresetATSupply)),
                (" Return", MakeQueue(DuctConnectorConfigurator.PresetATReturn)),
                (" Exhaust", MakeQueue(DuctConnectorConfigurator.PresetATExhaust)),
                (" Intake", MakeQueue(DuctConnectorConfigurator.PresetATIntake))
            };

            var processor = new OperationProcessor(doc, new ExecutionOptions());
            var outputs = processor.ProcessFamilyDocumentIntoVariants(variants, outputFolderPath);

            var balloon = new Ballogger();
            foreach (var ctx in outputs) {
                var (logs, error) = ctx.OperationLogs;
                if (error != null) {
                    _ = balloon.Add(LogEventLevel.Error, new StackFrame(),
                        $"Failed to process {ctx.FamilyName}: {error.Message}");
                } else {
                    _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                        $"Processed {ctx.FamilyName} with {variants.Count} variants in {ctx.TotalMs:F0}ms");
                    foreach (var log in logs) {
                        _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                            $"  {log.OperationName}: {log.Entries.Count} entries");
                    }
                }
            }

            balloon.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }
}