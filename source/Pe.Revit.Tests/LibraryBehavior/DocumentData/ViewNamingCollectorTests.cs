using Pe.Revit.DocumentData.AgentContext;
using Pe.Revit.DocumentData.ProjectIndex;

namespace Pe.Revit.Tests.LibraryBehavior.DocumentData;

[TestFixture]
public sealed class ViewNamingCollectorTests {
    [Test]
    public void Generic_view_contracts_separate_raw_name_from_display_title(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var view = new FilteredElementCollector(document)
                .OfClass(typeof(View))
                .Cast<View>()
                .First(candidate => !candidate.IsTemplate && candidate is not ViewSheet and not ViewSchedule && candidate.Name != candidate.Title);
            var projectIndex = ProjectIndexCollector.Collect(document, new ProjectIndexRequest {
                Sections = [ProjectIndexSection.Views],
                IncludeUnplacedViews = true,
                Projection = new RevitDataProjectionRequest { View = RevitDataResultView.Rows },
                Budget = new RevitDataOutputBudget { MaxEntries = 10_000 }
            });
            var indexed = projectIndex.Views.Single(candidate => candidate.Handle.ElementId == view.Id.Value());
            var observed = RevitAgentContextCollector.CollectViewRenderingState(
                document,
                view,
                new RevitAgentViewRenderingStateRequest()
            ).ObservedState.Single();

            Assert.Multiple(() => {
                Assert.That(indexed.Name, Is.EqualTo(view.Name));
                Assert.That(indexed.Handle.Label, Is.EqualTo(view.Title));
                Assert.That(observed.Title, Is.EqualTo(view.Title));
                Assert.That(observed.Handle.Label, Is.EqualTo(view.Title));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }
}
