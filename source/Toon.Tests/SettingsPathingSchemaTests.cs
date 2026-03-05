using Pe.Global.Services.Storage.Core;
using Xunit;

namespace Toon.Tests;

public class SettingsPathingSchemaTests {
    [Fact]
    public void ResolveCentralizedProfileSchemaPath_UsesAddinScopedGlobalSchemaDirectory() {
        var profilesRoot = Path.Combine("C:\\tmp", "CmdFFMigrator", "settings", "profiles");

        var schemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(
            profilesRoot,
            typeof(ProfileSchemaType)
        );

        Assert.StartsWith(
            Path.Combine("C:\\tmp", "Global", "schemas", "cmdffmigrator", "profiles"),
            schemaPath,
            StringComparison.OrdinalIgnoreCase
        );
        Assert.EndsWith("profileschematype.schema.json", schemaPath, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResolveCentralizedProfileSchemaPath_UsesReadableKey_ForClosedGenericTypes() {
        var profilesRoot = Path.Combine("C:\\tmp", "CmdFFMigrator", "settings", "profiles");

        var schemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(
            profilesRoot,
            typeof(GenericProfileSchemaType<NestedProfileType>)
        );

        Assert.StartsWith(
            Path.Combine("C:\\tmp", "Global", "schemas", "cmdffmigrator", "profiles"),
            schemaPath,
            StringComparison.OrdinalIgnoreCase
        );
        Assert.Contains("genericprofileschematype", schemaPath, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("nestedprofiletype", schemaPath, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("version=", schemaPath, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("publickeytoken", schemaPath, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResolveCentralizedFragmentSchemaPath_UsesDeterministicNestedKey_ForLocalDirectives() {
        var profilesRoot = Path.Combine("C:\\tmp", "CmdFFMigrator", "settings", "profiles");

        var schemaPath = SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            profilesRoot,
            SettingsPathing.DirectiveScope.Local,
            isPresetDirective: false,
            rootSegment: "_mapping-data"
        );

        Assert.Equal(
            Path.Combine(
                "C:\\tmp",
                "Global",
                "schemas",
                "cmdffmigrator",
                "fragments",
                "include",
                "_mapping-data",
                "_mapping-data.schema.json"),
            schemaPath
        );
    }

    [Fact]
    public void ResolveCentralizedFragmentSchemaPath_UsesGlobalNamespace_ForGlobalDirectives() {
        var profilesRoot = Path.Combine("C:\\tmp", "CmdFFMigrator", "settings", "profiles");

        var schemaPath = SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            profilesRoot,
            SettingsPathing.DirectiveScope.Global,
            isPresetDirective: true,
            rootSegment: "_mapping-data"
        );

        Assert.Equal(
            Path.Combine(
                "C:\\tmp",
                "Global",
                "schemas",
                "global",
                "fragments",
                "preset",
                "_mapping-data",
                "_mapping-data.schema.json"),
            schemaPath
        );
    }

    private sealed class ProfileSchemaType {
    }

    private sealed class GenericProfileSchemaType<TValue> {
    }

    private sealed class NestedProfileType {
    }
}
