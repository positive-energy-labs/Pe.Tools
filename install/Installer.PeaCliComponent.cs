using Pe.Shared.Product;
using WixSharp;

namespace Installer;

public sealed class PeaCliComponent : IInstallableComponent {
    public string Id => "pea-cli";
    public InstallerProductSlice ProductSlice => InstallerProductSlices.PeaCliBootstrap;
    public InstallerComponentKind ComponentKind => InstallerComponentKind.PeaCli;
    public string DisplayName => "pea CLI";
    public string Description => "Install the pea command-line agent entrypoint.";
    public InstallerOwnershipPolicy OwnershipPolicy { get; } = new(
        InstallerOwnershipPolicyKind.NativeMsiWithCustomCleanup,
        "MSI owns launcher/package files; custom actions expand payload versions and remove generated payload state."
    );

    public IReadOnlyCollection<Dir> BuildDirectories(InstallerContext context) {
        var feature = new Feature {
            Name = this.DisplayName,
            Description = this.Description
        };

        InstallerLog.WriteLine($"Harvesting pea payload: {context.Payload.PeaBootstrapDirectory}");
        InstallerComponentUtilities.LogFeatureFiles(context.Payload.PeaBootstrapDirectory, "pea");
        InstallerLog.WriteLine($"Installer pea payload archive: {context.Payload.PeaPayloadArchivePath}");
        InstallerLog.WriteLine($"Installer pea payload manifest: {context.Payload.PeaPayloadManifestPath}");

        return [
            new Dir(
                new Id("INSTALLPEA"),
                context.Configuration.GetSingleUserPeaInstallDirectory(),
                BuildPeaEntities(feature, context).ToArray()
            )
        ];
    }

    public IReadOnlyCollection<ManagedAction> BuildInstallActions(InstallerContext context) =>
        [
            new ManagedAction(
                CustomActions.InstallPeaPayload,
                Return.check,
                When.After,
                Step.InstallFiles,
                Condition.NOT_Installed
            ) {
                Execute = Execute.deferred,
                UsesProperties = "INSTALLPEA=[INSTALLPEA]"
            }
        ];

    public IReadOnlyCollection<ManagedAction> BuildUninstallActions(InstallerContext context) =>
        [
            new ManagedAction(
                CustomActions.RemovePeaPayloadVersions,
                Return.check,
                When.After,
                Step.RemoveFiles,
                Condition.BeingUninstalled
            ) {
                Execute = Execute.deferred,
                UsesProperties = "INSTALLPEA=[INSTALLPEA]"
            }
        ];

    private static IEnumerable<WixEntity> BuildPeaEntities(Feature feature, InstallerContext context) =>
        InstallerComponentUtilities.BuildDirectoryEntities(
                feature,
                context.Payload.PeaBootstrapDirectory,
                new HarvestProgress("pea")
            )
            .Append(new Dir(
                new Id("INSTALLPEAPACKAGES"),
                PeaCliIdentity.PackagesDirectoryName,
                new WixSharp.File(feature, context.Payload.PeaPayloadArchivePath),
                new WixSharp.File(feature, context.Payload.PeaPayloadManifestPath)
            ))
            .Append(new EnvironmentVariable(feature, "PATH", "[INSTALLPEA]") {
                Part = EnvVarPart.last,
                Action = EnvVarAction.set
            });
}
