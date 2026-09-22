using Pe.Revit.Failures;
using Pe.Revit.Tasks;

namespace Pe.Revit.Tests;

/// <summary>
///     Proves the shared non-modal failure ladder: a commit that raises a warning-severity failure
///     (overlapping walls) completes without a modal dialog — in a FreshRevitProcess run a dialog would
///     hang the test — and the warning text is captured as a diagnostic. This is the exact wiring the
///     scripting harness uses for host-owned WriteTransaction commits.
/// </summary>
[TestFixture]
public sealed class RevitFailureHandlingTests {
    [Test]
    public void Commit_with_warning_suppresses_dialog_and_captures_description(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(application);

        try {
            var level = new FilteredElementCollector(document)
                .OfClass(typeof(Level))
                .Cast<Level>()
                .First();
            var diagnostics = new List<(bool IsError, string Message)>();

            using (var transaction = new Transaction(document, "Create overlapping walls")) {
                var failureOptions = transaction.GetFailureHandlingOptions();
                _ = failureOptions.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor(diagnostics));
                _ = failureOptions.SetForcedModalHandling(false);
                transaction.SetFailureHandlingOptions(failureOptions);

                _ = transaction.Start();
                var line = Line.CreateBound(XYZ.Zero, new XYZ(10, 0, 0));
                _ = Wall.Create(document, line, level.Id, false);
                _ = Wall.Create(document, line, level.Id, false);
                var status = transaction.Commit();

                Assert.That(status, Is.EqualTo(TransactionStatus.Committed));
            }

            Assert.That(diagnostics, Is.Not.Empty);
            Assert.That(diagnostics.All(entry => !entry.IsError), Is.True);
            Assert.That(diagnostics.Any(entry => entry.Message.StartsWith("Suppressed warning:", StringComparison.Ordinal)),
                Is.True);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }
}
