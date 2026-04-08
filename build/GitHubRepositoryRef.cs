using ModularPipelines.Context;
using ModularPipelines.GitHub.Extensions;

namespace Build;

internal sealed record GitHubRepositoryRef(string Owner, string Name) {
    public string Identifier => $"{this.Owner}/{this.Name}";

    public static GitHubRepositoryRef Resolve(IModuleContext context) {
        var repository = Environment.GetEnvironmentVariable("GITHUB_REPOSITORY");

        if (!string.IsNullOrWhiteSpace(repository)) {
            var split = repository.Split('/', 2, StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

            if (split.Length == 2) return new GitHubRepositoryRef(split[0], split[1]);
        }

        var repositoryInfo = context.GitHub().RepositoryInfo;
        return new GitHubRepositoryRef(repositoryInfo.Owner, repositoryInfo.RepositoryName);
    }
}
