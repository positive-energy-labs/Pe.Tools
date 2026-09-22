using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.ProjectBrowser;

public interface IProjectBrowserIndexProvider {
    ProjectBrowserCollectedIndex GetProjectBrowserIndex(
        Document document,
        IReadOnlyCollection<ProjectBrowserSection> sections,
        int maxSamples,
        ProjectBrowserResultView view,
        ProjectBrowserFilter? filter,
        List<RevitDataIssue> issues
    );
}
