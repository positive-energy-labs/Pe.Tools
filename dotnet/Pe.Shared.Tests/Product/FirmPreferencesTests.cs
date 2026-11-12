using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;

namespace Pe.Revit.Tests;

// ADR 0037: a firm-level preference id is read from the firm home's Settings\preferences.json, else a refusal
// naming why. The firm home is found by its marker, with no environment variable, and is never written. The
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
        // The probe shape of freeze shape 3: <drive>\Shared drives\<name>\04 PE Software Files\Pe.Tools.
        var drive = Path.Combine(root, "drive") + Path.DirectorySeparatorChar;
        var firm = Path.Combine(drive, "Shared drives", "PE Team Folder", "04 PE Software Files", "Pe.Tools");
        var second = Path.Combine(drive, "04 PE Software Files", "Pe.Tools");
        Directory.CreateDirectory(user);
        // No environment variable is read: the homes come from the probe over an injected drive list.
        ProductHomes Homes() => ProductPathing.Homes(user, null, [drive],
            directory => Directory.Exists(directory) ? Directory.GetDirectories(directory).Select(path => Path.GetFileName(path)!) : [],
            home => File.Exists(Path.Combine(home, "pe-home.json")) ? File.ReadAllText(Path.Combine(home, "pe-home.json")) : null,
            null);
        string Account() => ProductPreferences.FirmId(p => p.Bim360AccountId, nameof(ProductPreferences.Bim360AccountId), Homes());
        try {
            Assert.That(Account, Throws.InvalidOperationException.With.Message.Contains("found no firm home"));

            // A folder at the firm path is not a home until its marker reads firm.
            Directory.CreateDirectory(Path.Combine(firm, "Settings"));
            File.WriteAllText(Path.Combine(firm, "Settings", "preferences.json"), "{ \"Bim360AccountId\": \"firm-hub\" }");
            Assert.That(Account, Throws.InvalidOperationException.With.Message.Contains("found no firm home"));

            File.WriteAllText(Path.Combine(firm, "pe-home.json"), "{\"tier\":\"firm\"}");
            Assert.That(Account(), Is.EqualTo("firm-hub"));

            // The folded path is the only one read: a preferences.json at the firm home's root supplies nothing.
            File.Delete(Path.Combine(firm, "Settings", "preferences.json"));
            File.WriteAllText(Path.Combine(firm, "preferences.json"), "{ \"Bim360AccountId\": \"root-hub\" }");
            Assert.That(Account, Throws.InvalidOperationException.With.Message.Contains("none in the firm's"));
            Assert.That(File.Exists(Path.Combine(firm, "Settings", "preferences.json")), Is.False, "the firm home is never written");
            File.WriteAllText(Path.Combine(firm, "Settings", "preferences.json"), "{ \"Bim360AccountId\": \"firm-hub\" }");

            // Two firm markers are a conflict: neither is used, and the refusal names both.
            Directory.CreateDirectory(second);
            File.WriteAllText(Path.Combine(second, "pe-home.json"), "{\"tier\":\"firm\"}");
            Assert.That(Account, Throws.InvalidOperationException.With.Message.Contains(firm).And.Message.Contains(second));
            File.Delete(Path.Combine(second, "pe-home.json"));

            // Five reads so far, four of them refusals: none left a file in the user home (census C3, finding F8).
            Assert.That(Directory.EnumerateFileSystemEntries(user), Is.Empty, "a read writes nothing into a home");

            // A preferences.json left in the user home by an older build is not read: the firm's value stands.
            File.WriteAllText(Path.Combine(user, "preferences.json"), "{ \"Bim360AccountId\": \"my-hub\" }");
            Assert.That(Account(), Is.EqualTo("firm-hub"));
        } finally {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }
    }
}
