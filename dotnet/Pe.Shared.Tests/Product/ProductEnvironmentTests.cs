using System.Reflection;
using Pe.Shared.Product;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ProductEnvironmentTests {
    [Test, NonParallelizable]
    public void Every_resolver_output_follows_one_locally_selected_product_environment() {
        var home = Path.Combine(Path.GetTempPath(), "pe-environment-" + Guid.NewGuid().ToString("N"));
        var previous = Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable);
        Directory.CreateDirectory(home);
        Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, home);
        try {
            var paths = Paths(ProductRuntimeLayout.ForCurrentUser())
                .Concat(Paths(ProductUserContentLayout.ForCurrentUser()));
            foreach (var path in paths) {
                var child = Path.GetRelativePath(home, path);
                Assert.That(Path.IsPathRooted(child) || child == ".." || child.StartsWith(".." + Path.DirectorySeparatorChar),
                    Is.False, path);
            }
        } finally {
            Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, previous);
            Directory.Delete(home, true);
        }
    }

    // Walk every public layout property and Resolve method so a new output joins the same contract.
    private static IEnumerable<string> Paths(object layout) {
        foreach (var property in layout.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            var value = property.GetValue(layout);
            if (value is string path) yield return path;
            else if (value != null && value.GetType().Namespace == typeof(ProductRuntimeLayout).Namespace)
                foreach (var nested in Paths(value)) yield return nested;
        }
        foreach (var method in layout.GetType().GetMethods(BindingFlags.Public | BindingFlags.Instance)
                     .Where(method => method.Name.StartsWith("Resolve") && method.ReturnType == typeof(string))) {
            Assert.That(method.GetParameters().All(parameter => parameter.ParameterType == typeof(string)), Is.True,
                $"Supply a valid environment-proof input for {method.Name}");
            yield return (string)method.Invoke(layout, method.GetParameters().Select(_ => (object)"census").ToArray())!;
        }
    }
}
