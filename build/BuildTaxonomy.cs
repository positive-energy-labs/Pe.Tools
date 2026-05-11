namespace Build;

public sealed record BuildTaxonomy(
    IReadOnlyList<BuildProjectIdentity> Projects
) {
    public BuildProjectIdentity RequireProject(string projectName) =>
        this.Projects.FirstOrDefault(project =>
            string.Equals(project.ProjectName, projectName, StringComparison.Ordinal))
        ?? throw new InvalidOperationException(
            $"Project '{projectName}' was not found in {BuildAuthoredPaths.TaxonomyFilePath}.");

    public void RequireProductClass(string projectName, ProductClass expectedProductClass) {
        var project = this.RequireProject(projectName);
        if (project.ProductClass != expectedProductClass) {
            throw new InvalidOperationException(
                $"Project '{projectName}' is registered as product class '{project.ProductClass}', not '{expectedProductClass}'.");
        }
    }
}
