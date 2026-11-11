using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Tests;

// ADR 0035 rule 11: a firm-level preference id is the user's own value, else the shared
// preferences.json, else a refusal naming why. The shared root is never written.
[TestFixture, NonParallelizable]
public sealed class FirmPreferencesTests {
    [Test]
    public void Firm_id_resolves_user_then_shared_then_refuses() {
        var user = Path.Combine(Path.GetTempPath(), $"pe-user-{Guid.NewGuid():N}");
        var shared = Path.Combine(Path.GetTempPath(), $"pe-shared-{Guid.NewGuid():N}");
        var previousHome = Environment.GetEnvironmentVariable(ProductPathNames.ProductHomeVariable);
        var previousShared = Environment.GetEnvironmentVariable(ProductPathNames.SharedRootVariable);
        string Account() => ProductPreferences.FirmId(p => p.Bim360AccountId, nameof(ProductPreferences.Bim360AccountId));
        try {
            Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, user);
            Environment.SetEnvironmentVariable(ProductPathNames.SharedRootVariable, null);
            Assert.That(Account, Throws.InvalidOperationException.With.Message.Contains("no shared root"));

            Directory.CreateDirectory(shared);
            Environment.SetEnvironmentVariable(ProductPathNames.SharedRootVariable, shared);
            Assert.That(Account, Throws.InvalidOperationException.With.Message.Contains("or the shared"));
            Assert.That(File.Exists(Path.Combine(shared, "preferences.json")), Is.False);

            File.WriteAllText(Path.Combine(shared, "preferences.json"), "{ \"Bim360AccountId\": \"firm-hub\" }");
            Assert.That(Account(), Is.EqualTo("firm-hub"));

            File.WriteAllText(Path.Combine(user, "preferences.json"), "{ \"Bim360AccountId\": \"my-hub\" }");
            Assert.That(Account(), Is.EqualTo("my-hub"));
        } finally {
            Environment.SetEnvironmentVariable(ProductPathNames.ProductHomeVariable, previousHome);
            Environment.SetEnvironmentVariable(ProductPathNames.SharedRootVariable, previousShared);
            foreach (var dir in new[] { user, shared })
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
        }
    }
}
