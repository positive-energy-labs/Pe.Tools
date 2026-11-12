namespace Pe.Shared.Product;

/// <summary>
///     The user home: authored content only (ADR 0037 rule 6). Run output, inline traces and the agent's
///     <c>AGENTS.md</c> live under <see cref="ProductRuntimeStateLayout" />, never here. It holds no preferences
///     file: the firm ids come from the firm home's <c>Settings\preferences.json</c>.
/// </summary>
public sealed record ProductUserContentLayout(string RootPath, ScriptingWorkspaceLayout Scripting) {
    public static ProductUserContentLayout ForCurrentUser(string? productHomePath = null) {
        var rootPath = ProductPathing.UserRoot(productHomePath);
        return new ProductUserContentLayout(
            rootPath, new ScriptingWorkspaceLayout(Path.Combine(rootPath, ProductPathNames.PodsDirectoryName)));
    }
}
