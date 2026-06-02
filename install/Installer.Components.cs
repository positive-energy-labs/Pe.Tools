using Pe.Shared.Product;
using WixSharp;

namespace Installer;

public enum InstallerProductSliceKind {
    DesktopRuntime,
    PeaCliBootstrap
}

public enum InstallerComponentKind {
    RevitAddin,
    HostRuntime,
    PeaCli
}

public enum InstallerOwnershipPolicyKind {
    NativeMsi,
    NativeMsiWithCustomCleanup,
    ProductOwnedTreeCleanup,
    LeaveUserData
}

public sealed record InstallerProductSlice(
    InstallerProductSliceKind Kind,
    string Id,
    string DisplayName,
    string Description
);

public sealed record InstallerOwnershipPolicy(
    InstallerOwnershipPolicyKind Kind,
    string Description
);

public static class InstallerProductSlices {
    public static readonly InstallerProductSlice DesktopRuntime = new(
        InstallerProductSliceKind.DesktopRuntime,
        "desktop-runtime",
        "Desktop Runtime",
        "Installed Revit add-in plus the shared host runtime it launches."
    );

    public static readonly InstallerProductSlice PeaCliBootstrap = new(
        InstallerProductSliceKind.PeaCliBootstrap,
        "pea-cli-bootstrap",
        "pea CLI Bootstrap",
        "PATH-visible pea launcher and active payload selection state."
    );
}

public sealed record InstallerContext(
    InstallerPayloadManifest Payload,
    ResolvedInstallerConfiguration Configuration,
    ResolveVersioningResult Versioning
);

public interface IInstallableComponent {
    string Id { get; }
    InstallerProductSlice ProductSlice { get; }
    InstallerComponentKind ComponentKind { get; }
    string DisplayName { get; }
    string Description { get; }
    InstallerOwnershipPolicy OwnershipPolicy { get; }

    IReadOnlyCollection<Dir> BuildDirectories(InstallerContext context);

    IReadOnlyCollection<ManagedAction> BuildInstallActions(InstallerContext context) =>
        [];

    IReadOnlyCollection<ManagedAction> BuildUninstallActions(InstallerContext context) =>
        [];
}

public static class InstallerComponentCatalog {
    public static IReadOnlyList<IInstallableComponent> CreateDefault() =>
        [
            new RevitAddinComponent(),
            new HostRuntimeComponent(),
            new PeaCliComponent()
        ];
}
