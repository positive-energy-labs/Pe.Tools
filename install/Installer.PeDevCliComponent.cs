using WixSharp;

namespace Installer;

public sealed class PeDevCliComponent : IInstallableComponent {
    public string Id => "pe-dev-cli";
    public InstallerProductSlice ProductSlice => InstallerProductSlices.PeDevCliBootstrap;
    public InstallerComponentKind ComponentKind => InstallerComponentKind.PeDevCli;
    public string DisplayName => "pe-dev CLI";
    public string Description => "Install pe-dev for local development and Revit operator workflows.";
    public InstallerOwnershipPolicy OwnershipPolicy { get; } = new(
        InstallerOwnershipPolicyKind.NativeMsi,
        "MSI owns and removes installed pe-dev files and PATH registration."
    );

    public IReadOnlyCollection<Dir> BuildDirectories(InstallerContext context) {
        var feature = new Feature(this.DisplayName, this.Description, false);

        InstallerLog.WriteLine($"Harvesting pe-dev payload: {context.Payload.PeDevPublishDirectory}");
        InstallerComponentUtilities.LogFeatureFiles(context.Payload.PeDevPublishDirectory, "pe-dev");

        return [
            new Dir(
                new Id("INSTALLPEDEV"),
                context.Configuration.GetSingleUserPeDevInstallDirectory(),
                InstallerComponentUtilities.BuildDirectoryEntities(
                        feature,
                        context.Payload.PeDevPublishDirectory,
                        new HarvestProgress("pe-dev")
                    )
                    .Append(new EnvironmentVariable(feature, "PATH", "[INSTALLPEDEV]") {
                        Part = EnvVarPart.last,
                        Action = EnvVarAction.set
                    })
                    .ToArray()
            )
        ];
    }
}
