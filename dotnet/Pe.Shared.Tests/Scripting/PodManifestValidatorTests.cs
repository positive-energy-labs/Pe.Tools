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
    public void Entrypoint_permission_mode_is_declared_or_rejected() {
        static PodManifestValidationResult With(string mode) => PodManifestValidator.ValidateJson(
            $$"""{"schemaVersion":2,"id":"own","name":"Own","version":"1","entrypoints":[{"id":"run","sourcePath":"src/Run.cs"{{mode}}}]}""");

        Assert.That(With("").Manifest!.Entrypoints.Single().PermissionMode, Is.Null);
        Assert.That(With(",\"permissionMode\":\"NoTransaction\"").Manifest!.Entrypoints.Single().PermissionMode,
            Is.EqualTo(Pe.Shared.HostContracts.Scripting.ScriptPermissionMode.NoTransaction));
        foreach (var bad in new[] { "notransaction", "2", "Rollback" }) {
            var result = With($",\"permissionMode\":\"{bad}\"");
            Assert.That(result.Success, Is.False, bad);
            Assert.That(result.Diagnostics.Single().Message, Does.Contain("permissionMode"), bad);
        }
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
                  "id": "main",
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
    public void Manifest_identity_is_independent_of_its_local_folder() {
        var result = PodManifestValidator.ValidateJson(MinimalManifest("connector-audit", "src/Main.cs"));

        Assert.That(result.Success, Is.True);
        Assert.That(result.Manifest!.Id, Is.EqualTo("connector-audit"));
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
            """
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
            { "id": "main", "sourcePath": "{{sourcePath}}" }
          ]
        }
        """;
}
