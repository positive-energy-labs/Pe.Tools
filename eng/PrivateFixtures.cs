using NUnit.Framework;

/// <summary>
/// Private fixtures: machine-local data that is never committed or bundled (client models, takeoffs,
/// partition captures). Root is <c>PE_PRIVATE_FIXTURES</c>, else <c>&lt;repo&gt;/.private/fixtures</c>.
/// A test that needs one calls <see cref="Dir"/> and is ignored, not failed, when the data is absent.
/// Layout and provenance: <c>.private/README.md</c>. Linked into each test project that needs it.
/// </summary>
internal static class PrivateFixtures
{
    public static string Root =>
        Environment.GetEnvironmentVariable("PE_PRIVATE_FIXTURES")
        ?? Path.Combine(RepoRoot(), ".private", "fixtures");

    /// <summary>Absolute path of <paramref name="relative"/> under the root, or <c>Assert.Ignore</c>.</summary>
    public static string Dir(string relative)
    {
        var path = Path.Combine(Root, relative.Replace('/', Path.DirectorySeparatorChar));
        if (!Directory.Exists(path))
            Assert.Ignore($"private fixture '{relative}' is absent at {path}; see .private/README.md");
        return path;
    }

    private static string RepoRoot([System.Runtime.CompilerServices.CallerFilePath] string sourcePath = "")
    {
        // Not AppContext.BaseDirectory: the R25 harness bases that on the Revit install dir and copies
        // the test payload to temp. Walk up from the assembly dir and cwd, then from this file's
        // compile-time path, which points into the repo on the machine that built the tests.
        foreach (var anchor in new[] {
            Path.GetDirectoryName(typeof(PrivateFixtures).Assembly.Location),
            Directory.GetCurrentDirectory(),
            Path.GetDirectoryName(sourcePath),
        })
        {
            var dir = string.IsNullOrWhiteSpace(anchor) ? null : new DirectoryInfo(anchor);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Pe.Tools.slnx")))
                dir = dir.Parent;
            if (dir is not null) return dir.FullName;
        }
        throw new InvalidOperationException("Pe.Tools.slnx not found above the test assembly, cwd, or source path.");
    }
}
