namespace Pe.Shared.Product;

/// <summary>
///     The user home: authored content only (ADR 0037 rule 6). Run output, inline traces and the agent's
///     <c>AGENTS.md</c> live under <see cref="ProductRuntimeStateLayout" />, never here.
/// </summary>
public sealed record ProductUserContentLayout(string RootPath, ScriptingWorkspaceLayout Scripting) {
    // Homes freeze shape 2 folds this into Settings\preferences.json. Not folded yet: the homes purger's census
    // decides whether the user file still has a writer, and a file with none is deleted, not moved.
    public string PreferencesPath => Path.Combine(this.RootPath, ProductPathNames.PreferencesFileName);

    public static ProductUserContentLayout ForCurrentUser(string? productHomePath = null) {
        var rootPath = ProductPathing.UserRoot(productHomePath);
        return new ProductUserContentLayout(
            rootPath, new ScriptingWorkspaceLayout(Path.Combine(rootPath, ProductPathNames.PodsDirectoryName)));
    }
}
