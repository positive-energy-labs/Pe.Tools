using Newtonsoft.Json;
using Pe.Revit.Global.Revit.Lib.Parameters;
using Pe.Revit.Global.Services.Aps.Models;

namespace Pe.Dev.RevitAutomation.Worker;

internal sealed class ParameterCollectionWorkloadHandler : IAutomationWorkloadHandler {
    public AutomationJobType JobType => AutomationJobType.ParameterCollection;

    public void Execute(AutomationWorkloadContext context) {
        var artifact = ParameterCollectionArtifactCollector.Collect(
            context.Document,
            context.Input.RunId,
            context.Input.Engine,
            context.Input.Region,
            context.Input.ProjectGuid,
            context.Input.ModelGuid,
            context.Input.ParameterCollection?.Filter,
            progress => context.WriteJobMarker("PROGRESS", new {
                jobType = context.Input.JobType,
                message = progress
            })
        );

        File.WriteAllText(context.ResultPath, JsonConvert.SerializeObject(artifact, Formatting.Indented));
        context.WriteJobMarker("ARTIFACT_WRITTEN", new {
            jobType = context.Input.JobType,
            localName = context.ResultPath,
            familyCount = artifact.LoadedFamiliesMatrix.Families.Count,
            bindingCount = artifact.ProjectParameterBindings.Entries.Count
        });
        context.WriteJobMarker("JOB_SUCCESS", new {
            jobType = context.Input.JobType,
            documentTitle = artifact.DocumentTitle
        });
    }
}
