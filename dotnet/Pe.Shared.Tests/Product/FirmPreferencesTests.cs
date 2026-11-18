using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Tests;

// ADR 0037: a firm-level preference id is read from the firm home's Settings\preferences.json, else a refusal
// naming why. The firm folder is selected explicitly, and is never written. The
// user home holds no preferences file: none is read there and none is created there.
[TestFixture]
public sealed class FirmPreferencesTests {
    // Mutants, each run red once. Read the firm file from the home root again (`FirmPreferencesPath` built from
    // `this.Firm` instead of `FirmSettingsDir`): fails the "firm-hub" read. Read a user-root preferences.json
    // first, through `LocalDiskJsonFile.Read()`, which writes a skeleton when the file is missing: fails the
    // "a read writes nothing" assert, and the last assert when the file is there.
    [Test]
    public void Firm_id_comes_from_the_firm_home_or_refuses_and_a_read_writes_nothing() {
        var root = Path.Combine(Path.GetTempPath(), $"pe-firm-prefs-{Guid.NewGuid():N}");
        var user = Path.Combine(root, "user");
        // A firm folder under <drive>\Shared drives\<name>\04 PE Software Files\Pe.Tools.
        var drive = Path.Combine(root, "drive") + Path.DirectorySeparatorChar;
        var firm = Path.Combine(drive, "Shared drives", "PE Team Folder", "04 PE Software Files", "Pe.Tools");
        Directory.CreateDirectory(user);
        // The selected folder exists or the resolver returns no firm home.
        ProductHomes Homes() => ProductPathing.Homes(user, firm, Directory.Exists,
            _ => throw new InvalidOperationException("Firm resolution read a marker"),
            null);
        string Account() => ProductPreferences.FirmId(p => p.Bim360AccountId, nameof(ProductPreferences.Bim360AccountId), Homes());
        try {
            Assert.That(Account, Throws.InvalidOperationException.With.Message.Contains("Set your firm home in Settings"));

            // An existing configured folder is a firm home without a marker.
            Directory.CreateDirectory(Path.Combine(firm, "Settings"));
            File.WriteAllText(Path.Combine(firm, "Settings", "preferences.json"), "{ \"Bim360AccountId\": \"firm-hub\" }");
            Assert.That(Account(), Is.EqualTo("firm-hub"));

            // The folded path is the only one read: a preferences.json at the firm home's root supplies nothing.
            File.Delete(Path.Combine(firm, "Settings", "preferences.json"));
            File.WriteAllText(Path.Combine(firm, "preferences.json"), "{ \"Bim360AccountId\": \"root-hub\" }");
            Assert.That(Account, Throws.InvalidOperationException.With.Message.Contains("none in the firm's"));
            Assert.That(File.Exists(Path.Combine(firm, "Settings", "preferences.json")), Is.False, "the firm home is never written");
            File.WriteAllText(Path.Combine(firm, "Settings", "preferences.json"), "{ \"Bim360AccountId\": \"firm-hub\" }");

            // A read writes nothing into a home.
            Assert.That(Directory.EnumerateFileSystemEntries(user), Is.Empty, "a read writes nothing into a home");

            // A preferences.json left in the user home by an older build is not read: the firm's value stands.
            File.WriteAllText(Path.Combine(user, "preferences.json"), "{ \"Bim360AccountId\": \"my-hub\" }");
            Assert.That(Account(), Is.EqualTo("firm-hub"));
        } finally {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
