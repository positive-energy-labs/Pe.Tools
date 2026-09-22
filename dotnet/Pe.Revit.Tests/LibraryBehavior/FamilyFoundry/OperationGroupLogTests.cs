using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class OperationGroupLogTests {
    [TestCase(false, false)]
    [TestCase(true, false)]
    [TestCase(false, true)]
    public void Queue_judges_terminal_group_work_without_erasing_history(bool unresolved, bool error) {
        var group = new Attempts(unresolved, error);
        var queue = new OperationQueue().Add(group);
        var logs = queue.ToFuncs(singleTransaction: false).SelectMany(callback => callback(default, new FamilyProcessingContext())).ToList();
        Assert.That(logs.First().Entries.Single().Status, Is.EqualTo(LogStatus.Pending), "Historical defer remains visible.");
        Assert.That(logs.Sum(l => l.PendingCount) > 0, Is.EqualTo(unresolved));
        Assert.That(logs.Sum(l => l.ErrorCount) > 0, Is.EqualTo(error));
        queue.ResetAllGroupContexts();
        Assert.That(group.GroupContext.All.Single().Status, Is.EqualTo(LogStatus.Pending));
    }

    private sealed class Attempts(bool unresolved, bool error) : OperationGroup<DefaultOperationSettings>(
        "Terminal logging", [new Attempt(null, false, false), new Attempt("A", false, false), new Attempt("B", unresolved, error)], ["P"]);

    private sealed class Attempt(string? type, bool unresolved, bool error) : DocOperation<DefaultOperationSettings>(new()) {
        public override string Description => "Exercise group ownership without a Revit mutation";
        public override OperationLog Execute(FamilyDocument document, FamilyProcessingContext context, OperationContext group) {
            var entry = group.GetAllInComplete()["P"];
            if (error) entry.Error("Actual failure");
            else if (type is null || unresolved) entry.Defer("Deferred work");
            else entry.SuccessForType("Wrote this type");
            var entries = group.TakeSnapshot();
            foreach (var snapshot in entries) snapshot.SetFamilyType(type ?? "");
            return new OperationLog(this.Name, entries);
        }
    }
}

