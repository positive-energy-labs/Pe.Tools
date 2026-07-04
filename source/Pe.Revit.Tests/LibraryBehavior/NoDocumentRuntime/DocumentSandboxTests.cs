using Pe.Revit.Utils;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class DocumentSandboxTests {
    [Test]
    public void IsSandboxTransaction_true_when_all_names_carry_prefix() {
        var names = new[] {
            DocumentSandbox.TransactionNamePrefix + "Collect Loaded Family Parameter Values",
            DocumentSandbox.TransactionNamePrefix + "Snapshot Collection"
        };

        Assert.That(DocumentSandbox.IsSandboxTransaction(names), Is.True);
    }

    [Test]
    public void IsSandboxTransaction_false_when_any_name_is_unprefixed() {
        var names = new[] {
            DocumentSandbox.TransactionNamePrefix + "Temp Filter Evaluation",
            "Modify type parameters"
        };

        Assert.That(DocumentSandbox.IsSandboxTransaction(names), Is.False);
    }

    [Test]
    public void IsSandboxTransaction_false_for_empty_names() =>
        Assert.That(DocumentSandbox.IsSandboxTransaction([]), Is.False);

    [Test]
    public void IsSandboxTransaction_false_for_plain_user_transaction() =>
        Assert.That(DocumentSandbox.IsSandboxTransaction(["Pe Script Execution"]), Is.False);

    [Test]
    public void RollbackScope_is_inactive_by_default() =>
        Assert.That(DocumentSandbox.RollbackScopeActive, Is.False);
}
