using Pe.Global.Services.Storage.Core;

namespace Pe.Tools.Tests;

public sealed class SettingsPathingSchemaTests : RevitTestBase
{
    [Test]
    public async Task ResolveCentralizedProfileSchemaPath_UsesAddinScopedGlobalSchemaDirectory()
    {
        var profilesRoot = Path.Combine("C:\\tmp", "CmdFFMigrator", "settings", "profiles");

        var schemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(
            profilesRoot,
            typeof(ProfileSchemaType)
        );

        await Assert.That(schemaPath)
            .StartsWith(Path.Combine("C:\\tmp", "Global", "schemas", "cmdffmigrator", "profiles"))
            .WithComparison(StringComparison.OrdinalIgnoreCase);
        await Assert.That(schemaPath)
            .EndsWith("profileschematype.schema.json")
            .WithComparison(StringComparison.OrdinalIgnoreCase);
    }

    [Test]
    public async Task ResolveCentralizedProfileSchemaPath_UsesReadableKey_ForClosedGenericTypes()
    {
        var profilesRoot = Path.Combine("C:\\tmp", "CmdFFMigrator", "settings", "profiles");

        var schemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(
            profilesRoot,
            typeof(GenericProfileSchemaType<NestedProfileType>)
        );

        await Assert.That(schemaPath)
            .StartsWith(Path.Combine("C:\\tmp", "Global", "schemas", "cmdffmigrator", "profiles"))
            .WithComparison(StringComparison.OrdinalIgnoreCase);
        await Assert.That(schemaPath).Contains("genericprofileschematype").WithComparison(StringComparison.OrdinalIgnoreCase);
        await Assert.That(schemaPath).Contains("nestedprofiletype").WithComparison(StringComparison.OrdinalIgnoreCase);
        await Assert.That(schemaPath).DoesNotContain("version=").WithComparison(StringComparison.OrdinalIgnoreCase);
        await Assert.That(schemaPath).DoesNotContain("publickeytoken").WithComparison(StringComparison.OrdinalIgnoreCase);
    }

    [Test]
    public async Task ResolveCentralizedFragmentSchemaPath_UsesDeterministicNestedKey_ForLocalDirectives()
    {
        var profilesRoot = Path.Combine("C:\\tmp", "CmdFFMigrator", "settings", "profiles");

        var schemaPath = SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            profilesRoot,
            SettingsPathing.DirectiveScope.Local,
            isPresetDirective: false,
            rootSegment: "_mapping-data"
        );

        await Assert.That(schemaPath).IsEqualTo(
            Path.Combine(
                "C:\\tmp",
                "Global",
                "schemas",
                "cmdffmigrator",
                "fragments",
                "include",
                "_mapping-data",
                "_mapping-data.schema.json"));
    }

    [Test]
    public async Task ResolveCentralizedFragmentSchemaPath_UsesGlobalNamespace_ForGlobalDirectives()
    {
        var profilesRoot = Path.Combine("C:\\tmp", "CmdFFMigrator", "settings", "profiles");

        var schemaPath = SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            profilesRoot,
            SettingsPathing.DirectiveScope.Global,
            isPresetDirective: true,
            rootSegment: "_mapping-data"
        );

        await Assert.That(schemaPath).IsEqualTo(
            Path.Combine(
                "C:\\tmp",
                "Global",
                "schemas",
                "global",
                "fragments",
                "preset",
                "_mapping-data",
                "_mapping-data.schema.json"));
    }

    private sealed class ProfileSchemaType
    {
    }

    private sealed class GenericProfileSchemaType<TValue>
    {
    }

    private sealed class NestedProfileType
    {
    }
}
