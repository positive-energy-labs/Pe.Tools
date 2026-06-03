using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.Tests;

[TestFixture]
public sealed class SettingsDiscoveryTests {
    [Test]
    public async Task Discovery_materializes_missing_root_directory() {
        var basePath = Path.Combine(Path.GetTempPath(), $"pe-settings-discovery-{Guid.NewGuid():N}");

        try {
            var backend = CreateBackend(basePath);
            var rootDirectory = SettingsStorageLocations.ResolveSettingsRootDirectory(
                basePath,
                "TestModule",
                "profiles"
            );

            var result = await backend.DiscoverAsync(
                "TestModule",
                "profiles",
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
    public async Task Discovery_bootstraps_configured_default_document() {
        var basePath = Path.Combine(Path.GetTempPath(), $"pe-settings-discovery-{Guid.NewGuid():N}");

        try {
            var backend = CreateBackend(
                basePath,
                SettingsRootBootstrapDocument.Create<DefaultSettings>()
            );

            var result = await backend.DiscoverAsync(
                "TestModule",
                "profiles",
                new SettingsDiscoveryOptions(Recursive: true, IncludeFragments: false, IncludeSchemas: false)
            );

            var defaultPath = SettingsPathing.ResolveSafeRelativeJsonPath(
                SettingsStorageLocations.ResolveSettingsRootDirectory(basePath, "TestModule", "profiles"),
                "default",
                "relativePath"
            );
            var content = await File.ReadAllTextAsync(defaultPath);

            Assert.Multiple(() => {
                Assert.That(File.Exists(defaultPath), Is.True);
                Assert.That(result.Files.Select(file => file.RelativePath), Contains.Item("default.json"));
                Assert.That(content, Does.Contain("\"Name\": \"Default Name\""));
                Assert.That(content, Does.Contain("\"Items\""));
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

    private static LocalDiskSettingsStorageBackend CreateBackend(
        string basePath,
        SettingsRootBootstrapDocument? bootstrapDocument = null
    ) =>
        new(
            basePath,
            SettingsRuntimeMode.HostOnly,
            new Dictionary<string, SettingsStorageModuleRuntimeDefinition>(StringComparer.OrdinalIgnoreCase) {
                ["TestModule"] = SettingsStorageModuleRuntimeDefinition.CreateSingleRoot(
                    "profiles",
                    SettingsStorageProfiles.SharedAuthoring,
                    bootstrapDocument: bootstrapDocument
                )
            }
        );

    private sealed class DefaultSettings {
        public string Name { get; init; } = "Default Name";
        public List<string> Items { get; init; } = ["One"];
    }
}
