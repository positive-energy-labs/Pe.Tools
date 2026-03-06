namespace Pe.Tools.Tests;

public sealed class CorpusProfileTests : RevitTestBase
{
    private static readonly string[] CorpusPaths = [
        @"C:\Users\kaitp\OneDrive\Documents\Pe.App\FF Migrator\settings\profiles\MechEquip\MechEquip.json",
        @"C:\Users\kaitp\OneDrive\Documents\Pe.App\FF Manager\settings\profiles\TEST-WaterFurnace-500R11-AirHandler-OldParams.json"
    ];

    [Test]
    public async Task CorpusProfiles_RoundtripStable()
    {
        foreach (var path in CorpusPaths)
        {
            await Assert.That(File.Exists(path)).IsTrue();

            var json = File.ReadAllText(path);
            var toon = ToonTranspiler.EncodeJson(json);
            var decoded = ToonTranspiler.DecodeToJson(toon);

            await Assert.That(JsonSemanticComparer.AreEquivalent(json, decoded)).IsTrue();
        }
    }
}
