namespace Pe.Shared.Product;

public sealed record ProductUserContentLayout(
    string RootPath,
    ProductSettingsContentLayout Settings,
    ScriptingWorkspaceLayout Scripting,
    ProductInlineScriptsContentLayout InlineScripts,
    ProductOutputContentLayout Output
) {
    public string AgentInstructionsPath => Path.Combine(this.RootPath, ProductPathNames.AgentInstructionsFileName);
    public string ReadmePath => Path.Combine(this.RootPath, ProductPathNames.ReadmeFileName);

    public static ProductUserContentLayout ForCurrentUser(string? documentsPath = null) {
        var rootPath = Path.Combine(
            ProductPathing.ResolveDocuments(documentsPath),
            ProductIdentity.ProductName
        );

        return new ProductUserContentLayout(
            rootPath,
            new ProductSettingsContentLayout(Path.Combine(rootPath, ProductPathNames.SettingsDirectoryName)),
            new ScriptingWorkspaceLayout(Path.Combine(rootPath, ProductPathNames.WorkspacesDirectoryName)),
            new ProductInlineScriptsContentLayout(Path.Combine(rootPath, ProductPathNames.InlineScriptsDirectoryName)),
            new ProductOutputContentLayout(Path.Combine(rootPath, ProductPathNames.OutputDirectoryName))
        );
    }
}

public sealed record ProductSettingsContentLayout(string RootPath) {
    public string GlobalSettingsDirectoryPath => Path.Combine(this.RootPath, ProductPathNames.GlobalDirectoryName);
    public string GlobalSettingsPath => Path.Combine(this.GlobalSettingsDirectoryPath, "settings.json");
    public string GlobalFragmentsDirectoryPath => Path.Combine(this.GlobalSettingsDirectoryPath, "fragments");

    public string ResolveModuleDirectoryPath(string moduleKey) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, moduleKey, nameof(moduleKey));

    public string ResolveModuleSettingsDirectoryPath(string moduleKey) =>
        this.ResolveModuleDirectoryPath(moduleKey);
}

public sealed record ProductInlineScriptsContentLayout(string RootPath);

public sealed record ProductOutputContentLayout(string RootPath) {
    public string GlobalOutputPath => Path.Combine(this.RootPath, ProductPathNames.GlobalDirectoryName);

    public string ResolveModuleOutputPath(string moduleKey) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, moduleKey, nameof(moduleKey));
}
