using System.Diagnostics;

namespace Pe.Revit.Tests;

// Runs the real Pe.Rhvac.Tool process (its own Main, no TestRuntime): the tool must be told its owner,
// and `inspect` must reach SnapshotReader's scratch under that owner instead of "shell did not configure".
[TestFixture]
public sealed class RhvacToolOwnershipTests {
    private string _root = null!;

    [SetUp]
    public void SetUp() => _root = Path.Combine(Path.GetTempPath(), "pe-rhvac-owner-" + Guid.NewGuid().ToString("N"));

    [TearDown]
    public void TearDown() {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    [Test]
    public void Inspect_resolves_scratch_under_the_owner_it_was_told() {
        Directory.CreateDirectory(_root);
        var source = Path.Combine(_root, "not-really.rh10");
        File.WriteAllBytes(source, [1, 2, 3, 4]);
        var input = Path.Combine(_root, "request.json");
        File.WriteAllText(input, System.Text.Json.JsonSerializer.Serialize(new { filePath = source }));

        var (exit, error) = Run("--lane", "dev", "--root", _root, "inspect", "--input", input, "--output", Path.Combine(_root, "out.json"));

        // The bytes are not a Jet database, so the read fails after scratch was created under the dev owner.
        Assert.That(error, Does.Not.Contain("did not configure"));
        Assert.That(Directory.Exists(Path.Combine(_root, ".artifacts", "pe-tools", "scratch")), Is.True, error);
        Assert.That(exit, Is.EqualTo(1), error);
    }

    [Test]
    public void A_launch_that_names_no_owner_refuses() {
        var (exit, error) = Run("selftest");
        Assert.That(exit, Is.EqualTo(1));
        Assert.That(error, Does.Contain("--lane"));
    }

    private static (int Exit, string Error) Run(params string[] args) {
        var start = new ProcessStartInfo(Path.Combine(AppContext.BaseDirectory, "Pe.Rhvac.Tool.exe")) {
            UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = true, CreateNoWindow = true
        };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        // A home override would move dev state to <home>\.local-state; this test proves the told root itself.
        start.Environment["PE_TOOLS_PRODUCT_HOME"] = "";
        using var process = Process.Start(start)!;
        var error = process.StandardError.ReadToEnd();
        process.StandardOutput.ReadToEnd();
        if (!process.WaitForExit(120_000)) { process.Kill(true); Assert.Fail("Pe.Rhvac.Tool timed out."); }
        return (process.ExitCode, error);
    }
}
