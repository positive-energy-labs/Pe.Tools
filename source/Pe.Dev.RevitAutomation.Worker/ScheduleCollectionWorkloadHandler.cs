using Pe.Shared.RevitAutomation;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Revit.DocumentData.Artifacts;

namespace Pe.Dev.RevitAutomation.Worker;

internal sealed class ScheduleCollectionWorkloadHandler : IAutomationWorkloadHandler {
    public AutomationJobType JobType => AutomationJobType.ScheduleCollection;

    public void Execute(AutomationWorkloadContext context) {
        var artifact = ScheduleCollectionArtifactCollector.Collect(
            context.Document,
            context.Input.RunId,
            context.Input.Engine,
            context.Input.Region,
            context.Input.ProjectGuid,
            context.Input.ModelGuid,
            context.Input.ScheduleCollection,
            progress => context.WriteJobMarker("PROGRESS", new { jobType = context.Input.JobType, message = progress })
        );

        File.WriteAllText(context.ResultPath, JsonConvert.SerializeObject(
            artifact,
            Formatting.None,
            new JsonSerializerSettings {
                NullValueHandling = NullValueHandling.Ignore,
                DefaultValueHandling = DefaultValueHandling.Ignore,
                ContractResolver = new DefaultContractResolver {
                    NamingStrategy = new CamelCaseNamingStrategy {
                        ProcessDictionaryKeys = false, OverrideSpecifiedNames = false
                    }
                },
                Converters = [new StringEnumConverter()]
            }
        ));
        context.WriteJobMarker("ARTIFACT_WRITTEN",
            new {
                jobType = context.Input.JobType,
                localName = context.ResultPath,
                scheduleCount = artifact.Query.Entries.Count,
                resolvedViaFallback = artifact.ResolvedViaFallback
            });
        context.WriteJobMarker("JOB_SUCCESS",
            new { jobType = context.Input.JobType, documentTitle = artifact.DocumentTitle });
    }
}
