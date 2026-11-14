using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodManifestValidatorTests {
    [Test]
    public void Model_identity_is_optional_but_present_probes_must_be_valid() {
        const string prefix = """{"schemaVersion":2,"id":"tour","name":"Tour","version":"1","for": """;
        var valid = PodManifestValidator.ValidateJson(prefix + """{"title":"Chadds","probes":[{"elementId":42,"uniqueId":"stable"}]}}""");
        Assert.That(valid.Success, Is.True);
        Assert.That(valid.Manifest!.For!.Probes.Single(), Is.EqualTo(new PodModelProbe(42, "stable")));
        foreach (var model in new[] { "null", "{}", """{"title":"Chadds","probes":[]}""", """{"title":"Chadds","probes":[{"elementId":0,"uniqueId":"x"}]}""", """{"title":"Chadds","probes":[{"elementId":1,"uniqueId":""}]}""" })
            Assert.That(PodManifestValidator.ValidateJson(prefix + model + "}").Success, Is.False, model);
    }

    [Test]
    public void Duplicate_manifest_identity_is_rejected_instead_of_silently_replaced() {
        var result = PodManifestValidator.ValidateJson("""{"schemaVersion":2,"id":"alice","id":"bob","name":"Example","version":"1"}""");
        Assert.That(result.Success, Is.False);
        Assert.That(result.Manifest, Is.Null);
        Assert.That(result.Diagnostics.Single().Message, Does.Contain("already exists"));
    }

    [Test]
    public void Valid_manifest_loads_entrypoints() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 2,
              "id": "connector-audit",
              "name": "Connector Audit",
              "version": "1.0.0",
              "description": "Checks connector data.",
              "routes": [{ "sourcePath": "routes/audit/index.js", "name": "Audit", "description": "Inspect connectors" }],
              "entrypoints": [
                {
                  "sourcePath": "src/Main.cs",
                  "name": "Main"
                }
              ]
            }
            """
        );

        Assert.That(result.Success, Is.True);
        Assert.That(result.Manifest, Is.Not.Null);
        Assert.That(result.Manifest!.Id, Is.EqualTo("connector-audit"));
        Assert.That(result.Manifest.Version, Is.EqualTo("1.0.0"));
        Assert.That(result.Manifest.Entrypoints.Single().SourcePath, Is.EqualTo("src/Main.cs"));
    }

    [Test]
    public void Unknown_manifest_fields_are_rejected() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 2,
              "id": "connector-audit",
              "name": "Connector Audit",
              "version": "1.0.0",
              "requirements": {},
              "surprise": true,
              "entrypoints": [
                {
                  "sourcePath": "src/Main.cs",
                  "extra": "nope"
                }
              ]
            }
            """
        );

        Assert.That(result.Success, Is.False);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Unknown field 'requirements'"));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Unknown field 'surprise'"));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Unknown field 'extra'"));
    }

    [Test]
    public void Entrypoints_must_have_unique_source_paths() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 2,
              "id": "connector-audit",
              "name": "Connector Audit",
              "version": "1.0.0",
              "entrypoints": [
                { "sourcePath": "src/Main.cs" },
                { "sourcePath": "src/main.cs" }
              ]
            }
            """
        );

        Assert.That(result.Success, Is.False);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Duplicate pod entrypoint sourcePath 'src/main.cs'"));
    }

    [Test]
    public void Entrypoint_source_paths_must_stay_under_src_and_be_cs_files() {
        foreach (var sourcePath in new[] {
            "src/../Main.cs",
            "src/Main.txt",
            "C:/temp/Main.cs"
        }) {
            var result = PodManifestValidator.ValidateJson(MinimalManifest("connector-audit", sourcePath));

            Assert.That(result.Success, Is.False, sourcePath);
        }
    }

    [Test]
    public void Neutral_source_path_normalization_preserves_current_workspace_rules() {
        Assert.That(
            ScriptingSourcePath.NormalizeWorkspaceSourcePath("src\\Nested\\Main.cs"),
            Is.EqualTo("src/Nested/Main.cs")
        );

        foreach (var sourcePath in new[] {
            "src/../Main.cs",
            "src/Main.txt",
            "C:/temp/Main.cs"
        })
            Assert.Throws<ArgumentException>(() => ScriptingSourcePath.NormalizeWorkspaceSourcePath(sourcePath));
    }

    // Contract C1. Mutants, each run red once: restore the `src/` segment check in
    // `ScriptingSourcePath.NormalizeWorkspaceSourcePath` (the first assertion fails); drop "mode" from
    // `EntrypointFields` (the same); accept any string as a mode (the last assertion fails).
    [Test]
    public void An_entrypoint_is_any_script_of_the_pod_and_may_declare_its_mode() {
        var result = PodManifestValidator.ValidateJson(MinimalManifest("connector-audit", "pages/tour/checks/census.csx")
            .Replace("\"sourcePath\": \"pages/tour/checks/census.csx\"", "\"sourcePath\": \"pages/tour/checks/census.csx\", \"mode\": \"ReadOnly\""));

        Assert.That(result.Success, Is.True, string.Join("; ", result.Diagnostics.Select(d => d.Message)));
        Assert.That(result.Manifest!.Entrypoints.Single().Mode, Is.EqualTo(Pe.Shared.HostContracts.Scripting.ScriptPermissionMode.ReadOnly));
        Assert.That(PodManifestValidator.ValidateJson(MinimalManifest("connector-audit", "Run.cs")).Manifest!.Entrypoints.Single().Mode, Is.Null);
        foreach (var mode in new[] { "readonly", "Write", "1" })
            Assert.That(PodManifestValidator.ValidateJson(MinimalManifest("connector-audit", "src/Main.cs")
                .Replace("\"sourcePath\": \"src/Main.cs\"", $"\"sourcePath\": \"src/Main.cs\", \"mode\": \"{mode}\"")).Success, Is.False, mode);
    }

    [Test]
    public void Settings_only_pod_is_valid() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 2,
              "id": "connector-audit",
              "name": "Connector Audit",
              "version": "1.0.0",
              "entrypoints": []
            }
            """
        );

        Assert.That(result.Success, Is.True);
        Assert.That(result.Manifest!.Entrypoints, Is.Empty);
    }

    private static string MinimalManifest(string id, string sourcePath) => $$"""
        {
          "schemaVersion": 2,
          "id": "{{id}}",
          "name": "Connector Audit",
          "version": "1.0.0",
          "entrypoints": [
            { "sourcePath": "{{sourcePath}}" }
          ]
        }
        """;
}
