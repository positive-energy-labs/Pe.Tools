using WixSharp;

namespace Installer;

public sealed class RevitAddinComponent : IInstallableComponent {
    public string Id => "revit-addin";
    public InstallerProductSlice ProductSlice => InstallerProductSlices.DesktopRuntime;
    public InstallerComponentKind ComponentKind => InstallerComponentKind.RevitAddin;
    public string DisplayName => "Revit Add-in";
    public string Description => "Revit add-in installation files.";
    public InstallerOwnershipPolicy OwnershipPolicy { get; } = new(
        InstallerOwnershipPolicyKind.ProductOwnedTreeCleanup,
        "MSI owns installed add-in files; uninstall also removes product-owned Pe.App add-in paths while leaving Revit year folders."
    );

    public IReadOnlyCollection<Dir> BuildDirectories(InstallerContext context) {
        var versionStorages = new Dictionary<string, List<WixEntity>>();
        var revitFeature = new Feature {
            Name = this.DisplayName,
            Description = this.Description,
            Display = FeatureDisplay.expand
        };

        foreach (var directory in context.Payload.RevitPublishDirectories) {
            var directoryInfo = new DirectoryInfo(directory);
            InstallerLog.WriteLine($"Harvesting Revit payload: {directoryInfo.FullName}");
            if (!InstallerComponentUtilities.TryParseRevitYear(directoryInfo.FullName, out var revitYear))
                throw new InvalidOperationException($"Could not parse Revit year from directory name: {directoryInfo.FullName}");

            var feature = new Feature {
                Name = revitYear,
                Description = $"Install add-in for Revit {revitYear}",
                ConfigurableDir = $"INSTALL{revitYear}"
            };

            revitFeature.Add(feature);

            var files = new Files(feature, $@"{directory}\*.*");
            if (versionStorages.TryGetValue(revitYear, out var storage))
                storage.Add(files);
            else
                versionStorages.Add(revitYear, [files]);

            InstallerComponentUtilities.LogFeatureFiles(directory, revitYear);
        }

        return [
            new InstallDir(
                context.Configuration.GetSingleUserRevitAddinsInstallDirectory(),
                versionStorages
                    .Select(storage => new Dir(new Id($"INSTALL{storage.Key}"), storage.Key, storage.Value.ToArray()))
                    .Cast<WixEntity>()
                    .ToArray()
            )
        ];
    }

    public IReadOnlyCollection<ManagedAction> BuildInstallActions(InstallerContext context) =>
        [
            new ManagedAction(
                CustomActions.RemoveLegacyBetaInstallPaths,
                Return.check,
                When.Before,
                Step.InstallFiles,
                Condition.NOT_Installed
            ) {
                Execute = Execute.deferred
            }
        ];

    public IReadOnlyCollection<ManagedAction> BuildUninstallActions(InstallerContext context) =>
        [
            new ManagedAction(
                CustomActions.RemoveInstalledRevitAddinPaths,
                Return.check,
                When.After,
                Step.RemoveFiles,
                Condition.BeingUninstalled
            ) {
                Execute = Execute.deferred
            }
        ];
}
