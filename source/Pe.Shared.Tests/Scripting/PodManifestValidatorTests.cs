using Pe.Shared.Scripting.Execution;
using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodManifestValidatorTests {
    [Test]
    public void Valid_manifest_loads_entrypoints() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 1,
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
    public void Origin_path_accepts_local_absolute_paths() {
        var originPath = Path.GetTempPath().Replace("\\", "/").TrimEnd('/');
        var result = PodManifestValidator.ValidateJson(
            $$"""
            {
              "schemaVersion": 1,
              "id": "connector-audit",
              "name": "Connector Audit",
              "version": "1.0.0",
              "origin": {
                "path": "{{originPath}}"
              },
              "entrypoints": [
                { "id": "main", "sourcePath": "src/Main.cs" }
              ]
            }
            """,
            "connector-audit"
        );

        Assert.That(result.Success, Is.True);
        Assert.That(result.Manifest!.Origin!.Path, Is.EqualTo(originPath));
    }

    [Test]
    public void Version_and_local_origin_path_are_validated() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 1,
              "id": "connector-audit",
              "name": "Connector Audit",
              "origin": {
                "path": "https://example.com/pods/connector-audit",
                "extra": true
              },
              "entrypoints": [
                { "id": "main", "sourcePath": "src/Main.cs" }
              ]
            }
            """,
            "connector-audit"
        );

        Assert.That(result.Success, Is.False);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("missing required field 'version'"));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("origin.path must be an absolute local path"));
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("Unknown field 'extra'"));
    }

    [Test]
    public void Unknown_manifest_fields_are_rejected() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 1,
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
              "schemaVersion": 1,
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
    public void Entrypoints_are_required() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 1,
              "id": "connector-audit",
              "name": "Connector Audit",
              "version": "1.0.0",
              "entrypoints": []
            }
            """,
            "connector-audit"
        );

        Assert.That(result.Success, Is.False);
        Assert.That(result.Diagnostics.Select(diagnostic => diagnostic.Message), Has.Some.Contain("must contain at least one entrypoint"));
    }

    private static string MinimalManifest(string id, string sourcePath) => $$"""
        {
          "schemaVersion": 1,
          "id": "{{id}}",
          "name": "Connector Audit",
          "version": "1.0.0",
          "entrypoints": [
            { "id": "main", "sourcePath": "{{sourcePath}}" }
          ]
        }
        """;
}
