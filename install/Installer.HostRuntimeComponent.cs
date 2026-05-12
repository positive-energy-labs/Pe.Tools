using WixSharp;

namespace Installer;

public sealed class HostRuntimeComponent : IInstallableComponent {
    public string Id => "host-runtime";
    public InstallerProductSlice ProductSlice => InstallerProductSlices.DesktopRuntime;
    public InstallerComponentKind ComponentKind => InstallerComponentKind.HostRuntime;
    public string DisplayName => "Shared Host Runtime";
    public string Description => "Install the shared external host used by connected Revit sessions.";
    public InstallerOwnershipPolicy OwnershipPolicy { get; } = new(
        InstallerOwnershipPolicyKind.NativeMsi,
        "MSI owns and removes installed host runtime files."
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
                context.Configuration.GetSingleUserHostInstallDirectory(),
                new Files(feature, $@"{context.Payload.RuntimePublishDirectory}\*.*")
            )
        ];
    }
}
