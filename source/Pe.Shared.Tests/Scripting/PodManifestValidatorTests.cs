using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodManifestValidatorTests {
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
              "entrypoints": [
                {
                  "id": "main",
                  "sourcePath": "src\\Main.cs",
                  "name": "Main"
                }
              ]
            }
            """,
            "connector-audit"
        );

        Assert.That(result.Success, Is.True);
        Assert.That(result.Manifest, Is.Not.Null);
        Assert.That(result.Manifest!.Id, Is.EqualTo("connector-audit"));
        Assert.That(result.Manifest.Version, Is.EqualTo("1.0.0"));
        Assert.That(result.Manifest.Entrypoints.Single().SourcePath, Is.EqualTo("src/Main.cs"));
    }

    [Test]
    public void Origin_and_parent_are_distinct_from_content_identity() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 2,
              "id": "connector-audit",
              "name": "Connector Audit",
              "version": "1.0.0",
              "entrypoints": [
                { "id": "main", "sourcePath": "src/Main.cs" }
              ],
              "origin": { "locator": "archive:connector-audit.pepod" },
              "parent": { "id": "connector-audit", "releaseHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "version": "0.9.0" }
            }
            """,
            "connector-audit"
        );

        Assert.That(result.Success, Is.True);
        Assert.That(result.Manifest!.Origin!.Locator, Is.EqualTo("archive:connector-audit.pepod"));
        Assert.That(result.Manifest.Parent!.Version, Is.EqualTo("0.9.0"));
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
                  "id": "main",
                  "sourcePath": "src/Main.cs",
                  "extra": "nope"
                }
              ]
            }
            """,
            "connector-audit"
        );

        Assert.That(result.Success, Is.False);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Unknown field 'requirements'"));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Unknown field 'surprise'"));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Unknown field 'extra'"));
    }

    [Test]
    public void Manifest_id_must_match_workspace_slug() {
        var result = PodManifestValidator.ValidateJson(MinimalManifest("connector-audit", "src/Main.cs"), "panel-audit");

        Assert.That(result.Success, Is.False);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("must match workspace key 'panel-audit'"));
    }

    [Test]
    public void Entrypoints_must_have_unique_slug_ids_and_source_paths() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 2,
              "id": "connector-audit",
              "name": "Connector Audit",
              "version": "1.0.0",
              "entrypoints": [
                { "id": "main", "sourcePath": "src/Main.cs" },
                { "id": "main", "sourcePath": "src/main.cs" }
              ]
            }
            """,
            "connector-audit"
        );

        Assert.That(result.Success, Is.False);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Duplicate pod entrypoint id 'main'"));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Duplicate pod entrypoint sourcePath 'src/main.cs'"));
    }

    [Test]
    public void Entrypoint_source_paths_must_stay_under_src_and_be_cs_files() {
        foreach (var sourcePath in new[] {
            "Main.cs",
            "src/../Main.cs",
            "src/Main.txt",
            "C:/temp/Main.cs"
        }) {
            var result = PodManifestValidator.ValidateJson(MinimalManifest("connector-audit", sourcePath), "connector-audit");

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
            "Main.cs",
            "src/../Main.cs",
            "src/Main.txt",
            "C:/temp/Main.cs"
        })
            Assert.Throws<ArgumentException>(() => ScriptingSourcePath.NormalizeWorkspaceSourcePath(sourcePath));
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
            """,
            "connector-audit"
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
            { "id": "main", "sourcePath": "{{sourcePath}}" }
          ]
        }
        """;
}
