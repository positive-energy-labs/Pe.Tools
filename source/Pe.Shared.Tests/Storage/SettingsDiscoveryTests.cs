using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class SettingsDiscoveryTests {
    [Test]
    public async Task Discovery_materializes_missing_root_directory() {
        var basePath = Path.Combine(Path.GetTempPath(), $"pe-settings-discovery-{Guid.NewGuid():N}");

        try {
            var storage = CreateStorage(basePath);
            var rootDirectory = SettingsStorageLocations.ResolveSettingsRootDirectory(
                basePath,
                "TestModule",
                "profiles"
            );

            var result = await storage.DiscoverAsync(
                new SettingsDiscoveryOptions(Recursive: true, IncludeFragments: false, IncludeSchemas: false)
            );

            Assert.Multiple(() => {
                Assert.That(rootDirectory, Is.EqualTo(Path.Combine(Path.GetFullPath(basePath), "TestModule", "profiles")));
                Assert.That(Directory.Exists(rootDirectory), Is.True);
                Assert.That(result.Files, Is.Empty);
                Assert.That(result.Root.Name, Is.EqualTo("profiles"));
            });
        } finally {
            if (Directory.Exists(basePath))
                Directory.Delete(basePath, true);
        }
    }

    [Test]
    public async Task Non_recursive_discovery_still_lists_child_directories_at_root() {
        var basePath = Path.Combine(Path.GetTempPath(), $"pe-settings-discovery-{Guid.NewGuid():N}");

        try {
            var moduleDirectory = Path.Combine(basePath, "Global", "fragments", "_mapping-data");
            Directory.CreateDirectory(moduleDirectory);
            await File.WriteAllTextAsync(
                Path.Combine(moduleDirectory, "mech-equip-mapping-data.json"),
                """
                {
                  "Items": []
                }
                """
            );

            var storage = new ModuleDocumentStorage(
                "Global",
                "fragments",
                SettingsStorageProfiles.SharedAuthoring,
                basePath: basePath
            );

            var result = await storage.DiscoverAsync(
                new SettingsDiscoveryOptions(Recursive: false, IncludeFragments: true, IncludeSchemas: false)
            );

            Assert.Multiple(() => {
                Assert.That(result.Files, Is.Empty);
                Assert.That(result.Root.Directories.Select(directory => directory.Name),
                    Contains.Item("_mapping-data"));
                Assert.That(result.Root.Files, Is.Empty);
            });
        } finally {
            if (Directory.Exists(basePath))
                Directory.Delete(basePath, true);
        }
    }

    private static ModuleDocumentStorage CreateStorage(string basePath) =>
        new(
            "TestModule",
            "profiles",
            SettingsStorageProfiles.SharedAuthoring,
            basePath: basePath
        );
}
