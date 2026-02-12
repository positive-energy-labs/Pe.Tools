using Xunit;

namespace Toon.Tests;

public class CorpusProfileTests
{
    private static readonly string[] CorpusPaths = [
        @"C:\Users\kaitp\OneDrive\Documents\Pe.App\FF Migrator\settings\profiles\MechEquip\MechEquip.json",
        @"C:\Users\kaitp\OneDrive\Documents\Pe.App\FF Manager\settings\profiles\TEST-WaterFurnace-500R11-AirHandler-OldParams.json"
    ];

    [Fact]
    public void CorpusProfiles_RoundtripStable()
    {
        foreach (var path in CorpusPaths)
        {
            Assert.True(File.Exists(path), $"Corpus file is required but missing: {path}");
            var json = File.ReadAllText(path);
            var toon = ToonTranspiler.EncodeJson(json);
            var decoded = ToonTranspiler.DecodeToJson(toon);
            Assert.True(
                JsonSemanticComparer.AreEquivalent(json, decoded),
                $"Corpus roundtrip mismatch for {path}");
        }
    }
}
