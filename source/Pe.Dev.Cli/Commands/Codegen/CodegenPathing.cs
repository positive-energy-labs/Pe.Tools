namespace Pe.Dev.Cli.Codegen;

internal sealed record CodegenPaths(string RepoRoot) {
    public string BuildProjectPath => Path.Combine(RepoRoot, "build", "Build.csproj");

    public string PeDevCliProjectPath => Path.Combine(RepoRoot, "source", "Pe.Dev.Cli", "Pe.Dev.Cli.csproj");

    public string PeToolsDirectory => Path.Combine(RepoRoot, "source", "pe-tools");

    public string HostGeneratedPackageDirectory => Path.Combine(PeToolsDirectory, "packages", "host-generated");

    public string HostTypeGenDirectory => Path.Combine(HostGeneratedPackageDirectory, "src", "types");

    public string HostContractsDirectory => Path.Combine(HostGeneratedPackageDirectory, "src", "contracts");

    public string HostZodDirectory => Path.Combine(HostGeneratedPackageDirectory, "src", "zod");
}
