using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Shared.Scripting.Pods;

namespace Pe.Shared.Tests.Scripting;

[TestFixture]
public sealed class ContributionIdentityTests {
    [Test]
    public void Manifest_source_identity_uses_the_shared_golden_path_vectors() {
        var directory = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Pe.Tools.slnx")))
            directory = directory.Parent;
        Assert.That(directory, Is.Not.Null, "Run the checked-in vectors from this checkout.");
        var vectors = JObject.Parse(File.ReadAllText(Path.Combine(directory!.FullName,
            "ts", "packages", "agent-contracts", "tests", "contribution-vectors.json")));
        foreach (var path in vectors["sourcePaths"]!["accepted"]!.Values<string>())
            Assert.That(Validate(path!).Success, Is.True, path);
        foreach (var path in vectors["sourcePaths"]!["rejected"]!.Values<string>())
            Assert.That(Validate(path!).Success, Is.False, path);
    }

    [Test]
    public void Source_path_is_the_only_entrypoint_identity() {
        var result = Validate("src/Census.cs");
        Assert.That(result.Success, Is.True);
        Assert.That(result.Manifest!.Entrypoints.Single().SourcePath, Is.EqualTo("src/Census.cs"));
        foreach (var id in new[] { "pages", "skills", "product", "Snowdon", " snowdon-ducts" })
            Assert.That(Validate("src/Census.cs", id).Success, Is.False, id);
        var duplicate = Manifest("snowdon-ducts", new { sourcePath = "src/Census.cs" }, new { sourcePath = "src/census.cs" });
        Assert.That(PodManifestValidator.ValidateJson(duplicate).Success, Is.False);
        var oldIdentity = Manifest("snowdon-ducts", new { id = "census", sourcePath = "src/Census.cs" });
        Assert.That(PodManifestValidator.ValidateJson(oldIdentity).Success, Is.False);
    }

    private static PodManifestValidationResult Validate(string sourcePath, string id = "snowdon-ducts") =>
        PodManifestValidator.ValidateJson(Manifest(id, new { sourcePath }));

    private static string Manifest(string id, params object[] entrypoints) => JsonConvert.SerializeObject(new {
        schemaVersion = 2, id, name = "Snowdon ducts", version = "1.0.0", entrypoints
    });
}
