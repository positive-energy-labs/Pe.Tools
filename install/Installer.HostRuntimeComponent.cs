using WixSharp;

namespace Installer;

public sealed class HostRuntimeComponent : IInstallableComponent {
    public string Id => "host-runtime";
    public InstallerProductSlice ProductSlice => InstallerProductSlices.DesktopRuntime;
    public InstallerComponentKind ComponentKind => InstallerComponentKind.HostRuntime;
    public string DisplayName => "Shared Host Runtime";
    public string Description => "Install the shared external host used by connected Revit sessions.";
    public InstallerOwnershipPolicy OwnershipPolicy { get; } = new(
        InstallerOwnershipPolicyKind.NativeMsiWithCustomCleanup,
        "MSI owns installed host runtime files; custom cleanup replaces the product-owned host tree before upgrades."
    );

    public IReadOnlyCollection<Dir> BuildDirectories(InstallerContext context) {
        var feature = new Feature {
            Name = this.DisplayName,
            Description = this.Description
        };

        InstallerLog.WriteLine($"Harvesting runtime payload: {context.Payload.RuntimePublishDirectory}");
        InstallerComponentUtilities.LogFeatureFiles(context.Payload.RuntimePublishDirectory, "Runtime");

        return [
            new Dir(
                new Id("INSTALLHOST"),
                context.Configuration.GetSingleUserHostInstallDirectory(),
                new Files(feature, $@"{context.Payload.RuntimePublishDirectory}\*.*")
            )
        ];
    }

    public IReadOnlyCollection<ManagedAction> BuildInstallActions(InstallerContext context) =>
        [
            new ManagedAction(
                CustomActions.RemoveInstalledHostRuntime,
                Return.check,
                When.Before,
                Step.InstallFiles,
                Condition.NOT_Installed
            ) {
                Execute = Execute.deferred,
                UsesProperties = "INSTALLHOST=[INSTALLHOST]"
            }
        ];
}
