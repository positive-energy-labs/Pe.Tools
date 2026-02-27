using Pe.Global.Services.Storage.Core.Json;
using Xunit;

namespace Toon.Tests;

public class ComposableJsonContractTests {
    [Fact]
    public void Write_ReturnsFilePath() {
        using var sandbox = new TempDir();
        var filePath = Path.Combine(sandbox.Path, "output.json");
        var json = new ComposableJson<TestData>(filePath, sandbox.Path, JsonBehavior.Output);

        var result = json.Write(new TestData { Name = "ok" });

        Assert.Equal(filePath, result);
        Assert.True(File.Exists(filePath));
    }

    private sealed class TestData {
        public string Name { get; set; } = string.Empty;
    }

    private sealed class TempDir : IDisposable {
        public TempDir() {
            this.Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"composable-json-contract-{Guid.NewGuid():N}");
            _ = Directory.CreateDirectory(this.Path);
        }

        public string Path { get; }

        public void Dispose() {
            try {
                Directory.Delete(this.Path, recursive: true);
            } catch {
                // ignore cleanup failures in tests
            }
        }
    }
}
