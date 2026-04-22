using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.Exceptions;
using DesignAutomationFramework;
using Newtonsoft.Json;
using Pe.Revit.Global.Revit.Documents;
using Pe.Shared.Aps.Models;
using FileNotFoundException = System.IO.FileNotFoundException;
using InvalidOperationException = System.InvalidOperationException;

namespace Pe.Dev.RevitAutomation.Worker;

[Regeneration(RegenerationOption.Manual)]
[Transaction(TransactionMode.Manual)]
public sealed class RevitAutomationShellApp : IExternalDBApplication {
    private const string InputPath = "automation-input.json";
    private const string ResultPath = "automation-result.json";
    private const string JobPrefix = "PE_AUTOMATION_JOB ";
    private const string ProbePrefix = "PE_AUTOMATION_PROBE ";

    private static readonly IReadOnlyDictionary<AutomationJobType, IAutomationWorkloadHandler> WorkloadHandlers =
        new IAutomationWorkloadHandler[] {
            new ParameterCollectionWorkloadHandler(), new ScheduleCollectionWorkloadHandler()
        }.ToDictionary(handler => handler.JobType);

    public ExternalDBApplicationResult OnStartup(ControlledApplication application) {
        DesignAutomationBridge.DesignAutomationReadyEvent += this.HandleDesignAutomationReadyEvent;
        return ExternalDBApplicationResult.Succeeded;
    }

    public ExternalDBApplicationResult OnShutdown(ControlledApplication application) =>
        ExternalDBApplicationResult.Succeeded;

    private void HandleDesignAutomationReadyEvent(object sender, DesignAutomationReadyEventArgs args) {
        WriteJobMarker("START");
        try {
            var input = AutomationJobInput.LoadFromFile(InputPath);
            WriteJobMarker("INPUT",
                new {
                    jobType = input.JobType,
                    engine = input.Engine,
                    region = input.Region,
                    projectGuid = input.ProjectGuid,
                    modelGuid = input.ModelGuid,
                    runId = input.RunId,
                    expectedTitle = input.ExpectedTitle
                });

            var revitApplication = args.DesignAutomationData?.RevitApp
                                   ?? throw new InvalidOperationException(
                                       "Design automation Revit application was unavailable.");

            var modelPath = ModelPathUtils.ConvertCloudGUIDsToCloudPath(
                input.GetNormalizedRegion(),
                input.GetProjectGuid(),
                input.GetModelGuid()
            );

            Document? document = null;
            try {
                document = revitApplication.OpenDocumentFile(modelPath, new OpenOptions());
                WriteDocumentOpened(input, document);

                if (input.JobType == AutomationJobType.CloudOpenProbe) {
                    args.Succeeded = true;
                    WriteJobMarker("JOB_SUCCESS", new { jobType = input.JobType, documentTitle = document.Title });
                } else if (WorkloadHandlers.TryGetValue(input.JobType, out var handler)) {
                    handler.Execute(new AutomationWorkloadContext(input, document, ResultPath, WriteJobMarker));
                    args.Succeeded = true;
                } else
                    throw new InvalidOperationException($"Unsupported automation job type '{input.JobType}'.");
            } catch (Exception ex) {
                WriteFailure(input, ex);
                args.Succeeded = false;
            } finally {
                if (document is { IsValidObject: true })
                    document.Close(false);
            }
        } catch (Exception ex) {
            WriteJobMarker("JOB_FAIL_OTHER", new { exceptionType = ex.GetType().FullName, message = ex.Message });
            args.Succeeded = false;
        } finally {
            WriteJobMarker("END");
        }
    }

    private static void WriteDocumentOpened(AutomationJobInput input, Document document) {
        var payload = new {
            title = document.Title,
            isModelInCloud = document.IsModelInCloud,
            projectGuid = SafeRead(document.GetCloudProjectGuid),
            modelGuid = SafeRead(document.GetCloudModelGuid),
            cloudModelUrn = SafeRead(document.GetCloudModelUrn),
            expectedTitleMatched = string.IsNullOrWhiteSpace(input.ExpectedTitle) ||
                                   string.Equals(document.Title, input.ExpectedTitle,
                                       StringComparison.OrdinalIgnoreCase)
        };

        WriteJobMarker("DOCUMENT_OPENED", payload);
        if (input.JobType == AutomationJobType.CloudOpenProbe)
            WriteProbeMarker("OPEN_SUCCESS", payload);
    }

    private static void WriteFailure(AutomationJobInput input, Exception ex) {
        var marker = ClassifyFailureMarker(ex);
        var payload = new { jobType = input.JobType, exceptionType = ex.GetType().FullName, message = ex.Message };

        WriteJobMarker(marker, payload);
        if (input.JobType == AutomationJobType.CloudOpenProbe) {
            var probeMarker = marker switch {
                "JOB_FAIL_UNAUTHORIZED" => "OPEN_FAIL_UNAUTHORIZED",
                "JOB_FAIL_NOT_FOUND" => "OPEN_FAIL_NOT_FOUND",
                _ => "OPEN_FAIL_OTHER"
            };
            WriteProbeMarker(probeMarker, payload);
        }
    }

    private static string ClassifyFailureMarker(Exception exception) =>
        exception switch {
            RevitServerUnauthorizedException => "JOB_FAIL_UNAUTHORIZED",
            RevitServerUnauthenticatedUserException => "JOB_FAIL_UNAUTHORIZED",
            CentralModelAccessDeniedException => "JOB_FAIL_UNAUTHORIZED",
            AccessDeniedException => "JOB_FAIL_UNAUTHORIZED",
            FileNotFoundException fileNotFoundException when IsAssemblyLoadFailure(fileNotFoundException) =>
                "JOB_FAIL_ASSEMBLY_LOAD",
            FileNotFoundException => "JOB_FAIL_NOT_FOUND",
            CentralModelException centralModelException when ContainsNotFoundSignal(centralModelException.Message) =>
                "JOB_FAIL_NOT_FOUND",
            _ when ContainsUnauthorizedSignal(exception.Message) => "JOB_FAIL_UNAUTHORIZED",
            _ when ContainsNotFoundSignal(exception.Message) => "JOB_FAIL_NOT_FOUND",
            _ => "JOB_FAIL_OTHER"
        };

    private static bool IsAssemblyLoadFailure(FileNotFoundException exception) =>
        Contains(exception.Message, "Could not load file or assembly");

    private static bool ContainsUnauthorizedSignal(string? message) =>
        Contains(message, "unauthorized") ||
        Contains(message, "not authorized") ||
        Contains(message, "access denied") ||
        Contains(message, "permission");

    private static bool ContainsNotFoundSignal(string? message) =>
        Contains(message, "not found") ||
        Contains(message, "does not exist") ||
        Contains(message, "missing");

    private static bool Contains(string? message, string token) =>
        !string.IsNullOrWhiteSpace(message) &&
        message.Contains(token, StringComparison.OrdinalIgnoreCase);

    private static string? SafeRead(Func<string?> accessor) {
        try {
            return accessor();
        } catch {
            return null;
        }
    }

    private static void WriteJobMarker(string marker, object? payload = null) =>
        WriteMarker(JobPrefix, marker, payload);

    private static void WriteProbeMarker(string marker, object? payload = null) =>
        WriteMarker(ProbePrefix, marker, payload);

    private static void WriteMarker(string prefix, string marker, object? payload) {
        if (payload == null) {
            Console.WriteLine(prefix + marker);
            return;
        }

        Console.WriteLine($"{prefix}{marker} {JsonConvert.SerializeObject(payload)}");
    }
}