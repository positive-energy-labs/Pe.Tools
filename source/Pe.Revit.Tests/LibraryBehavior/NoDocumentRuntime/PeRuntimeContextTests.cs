using Pe.App.Host;
using Pe.Shared.Product;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PeRuntimeContextTests {
    [Test]
    public void Dev_runtime_resolves_source_host_from_loaded_addin_path() {
        var assemblyDirectory = Path.GetDirectoryName(typeof(PeRuntimeContext).Assembly.Location)!;
        var expected = Path.GetFullPath(
            Path.Combine(assemblyDirectory, "..", "..", "..", "..", "source", "pe-tools")
        );

        var runtime = PeRuntimeContext.Resolve();

        Assert.Multiple(() => {
            Assert.That(runtime.RuntimeLane, Is.EqualTo(ProductRuntimeLane.Dev));
            Assert.That(runtime.SourceHostWorkingDirectory, Is.EqualTo(expected));
        });
    }
}
