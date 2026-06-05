using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class PodManifestValidatorTests {
    [Test]
    public void Valid_manifest_loads_entrypoints_and_requirements() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 1,
              "id": "connector-audit",
              "name": "Connector Audit",
              "description": "Checks connector data.",
              "requirements": {
                "notes": "Requires the model to be open.",
                "revitYears": ["2025"],
                "packageReferences": ["CsvHelper"]
              },
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
        Assert.That(result.Manifest.Entrypoints.Single().SourcePath, Is.EqualTo("src/Main.cs"));
        Assert.That(result.Manifest.Requirements!.RevitYears.Single(), Is.EqualTo("2025"));
    }

    [Test]
    public void Unknown_manifest_fields_are_rejected() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 1,
              "id": "connector-audit",
              "name": "Connector Audit",
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
    public void Entrypoints_are_required() {
        var result = PodManifestValidator.ValidateJson(
            """
            {
              "schemaVersion": 1,
              "id": "connector-audit",
              "name": "Connector Audit",
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
          "entrypoints": [
            { "id": "main", "sourcePath": "{{sourcePath}}" }
          ]
        }
        """;
}
