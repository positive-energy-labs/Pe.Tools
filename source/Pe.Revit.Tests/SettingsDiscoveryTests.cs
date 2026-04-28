using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class SettingsDiscoveryTests {
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

            var backend = new LocalDiskSettingsStorageBackend(
                basePath,
                SettingsRuntimeMode.HostOnly,
                new Dictionary<string, SettingsStorageModuleRuntimeDefinition>(StringComparer.OrdinalIgnoreCase) {
                    ["Global"] = SettingsStorageModuleRuntimeDefinition.CreateSingleRoot(
                        "fragments",
                        SettingsStorageProfiles.SharedAuthoring
                    )
                }
            );

            var result = await backend.DiscoverAsync(
                "Global",
                "fragments",
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
}
