namespace Pe.Shared.Product;

public sealed record ProductUserContentLayout(
    string RootPath,
    ScriptingWorkspaceLayout Scripting,
    ProductInlineScriptsContentLayout InlineScripts,
    ProductOutputContentLayout Output
) {
    public string PreferencesPath => Path.Combine(this.RootPath, ProductPathNames.PreferencesFileName);
    public string AgentInstructionsPath => Path.Combine(this.RootPath, ProductPathNames.AgentInstructionsFileName);
    public string ReadmePath => Path.Combine(this.RootPath, ProductPathNames.ReadmeFileName);

    public static ProductUserContentLayout ForCurrentUser(string? documentsPath = null) {
        var rootPath = Path.Combine(
            ProductPathing.ResolveDocuments(documentsPath),
            ProductIdentity.ProductName
        );

        return new ProductUserContentLayout(
            rootPath,
            new ScriptingWorkspaceLayout(Path.Combine(rootPath, ProductPathNames.PodsDirectoryName)),
            new ProductInlineScriptsContentLayout(Path.Combine(
                rootPath,
                ProductPathNames.PodsDirectoryName,
                ScriptingWorkspaceLayout.DefaultWorkspaceKey,
                ProductPathNames.OutputDirectoryName,
                "inline"
            )),
            new ProductOutputContentLayout(Path.Combine(
                rootPath,
                ProductPathNames.PodsDirectoryName,
                ScriptingWorkspaceLayout.DefaultWorkspaceKey,
                ProductPathNames.OutputDirectoryName
            ))
        );
    }
}

public sealed record ProductInlineScriptsContentLayout(string RootPath);

public sealed record ProductOutputContentLayout(string RootPath) {
    public string ResolveModuleOutputPath(string module) =>
        ProductPathing.ResolveSafeSubDirectoryPath(this.RootPath, module, nameof(module));
}
