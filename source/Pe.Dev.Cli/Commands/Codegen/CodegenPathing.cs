namespace Pe.Dev.Cli.Codegen;

internal sealed record CodegenPaths(string RepoRoot) {
    public string PeDevCliProjectPath => Path.Combine(RepoRoot, "source", "Pe.Dev.Cli", "Pe.Dev.Cli.csproj");

    public string PeToolsDirectory => Path.Combine(RepoRoot, "source", "pe-tools");

    public string HostContractsPackageDirectory => Path.Combine(PeToolsDirectory, "packages", "host-contracts");

    public string HostContractsDirectory => Path.Combine(HostContractsPackageDirectory, "src", "contracts");

    public string HostEffectDirectory => Path.Combine(HostContractsPackageDirectory, "src", "effect");

    public IReadOnlyList<string> LegacyHostProjectionDirectories => [
        Path.Combine(HostContractsPackageDirectory, "src", "types"),
        Path.Combine(HostContractsPackageDirectory, "src", "json-schema"),
        Path.Combine(HostContractsPackageDirectory, "src", "zod")
    ];
}
