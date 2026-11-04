using Pe.Shared.Product;

// Attached rung: Pe.App's Startup already configured the runtime from the SDK; keep it. Fresh rung: no
// AppCore.Startup ran in this Revit, so the test assembly is the shell and names its own checkout as the
// dev owner. The checkout is the one this test build sits in (test harness, not a product owner rule).
[SetUpFixture]
public sealed class TestRuntime {
    [OneTimeSetUp]
    public void Configure() {
        if (ProductRuntimeLayout.IsConfigured) return;
        var directory = Path.GetDirectoryName(typeof(TestRuntime).Assembly.Location);
        while (directory is not null && !File.Exists(Path.Combine(directory, "Pe.Tools.slnx")))
            directory = Path.GetDirectoryName(directory);
        ProductRuntimeLayout.Configure(ProductLane.Dev,
            directory ?? throw new InvalidOperationException("Pe.Revit.Tests runs from a Pe.Tools checkout build."));
    }
}
