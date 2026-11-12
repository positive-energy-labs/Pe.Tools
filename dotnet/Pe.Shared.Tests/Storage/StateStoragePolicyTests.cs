using Pe.Shared.StorageRuntime;

namespace Pe.Shared.Tests.Storage;

[TestFixture]
public class StateStoragePolicyTests {
    [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, SetLastError = true)]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool CreateHardLink(string link, string existing, IntPtr reserved);
    public sealed class Value { public string Text { get; set; } = "default"; }

    [Test]
    public void Torn_keep_read_refuses_write_and_preserves_bytes() {
        var folder = Path.Combine(Path.GetTempPath(), "pe-state-" + Guid.NewGuid().ToString("N"));
        try {
            var file = StateStorage.ExactDir(folder).Json<Value>("value", StoredPolicy.Keep, "Fixture state");
            var path = Path.Combine(folder, "value.json");
            var torn = new byte[] { 0x7b, 0x22, 0x54, 0x65, 0x78, 0x74, 0x22, 0x3a };
            File.WriteAllBytes(path, torn);
            var data = file.Read();
            data.Text = "replacement";
            var exception = Assert.Throws<InvalidOperationException>(() => file.Write(data));
            Assert.That(exception!.Message, Is.EqualTo("kept: Fixture state could not be read; not overwriting"));
            Assert.That(File.ReadAllBytes(path), Is.EqualTo(torn));
        } finally { Directory.Delete(folder, true); }
    }

    [TestCase(StoredPolicy.Keep)]
    [TestCase(StoredPolicy.Discard)]
    public void Missing_read_creates_no_file_and_allows_write(StoredPolicy policy) {
        var folder = Path.Combine(Path.GetTempPath(), "pe-state-" + Guid.NewGuid().ToString("N"));
        try {
            var file = StateStorage.ExactDir(folder).Json<Value>("value", policy, "Fixture state");
            var path = Path.Combine(folder, "value.json");
            var data = file.Read();
            Assert.That(File.Exists(path), Is.False, "Read must not publish defaults");
            data.Text = "created";
            file.Write(data);
            Assert.That(file.Read().Text, Is.EqualTo("created"));
        } finally { Directory.Delete(folder, true); }
    }

    [Test]
    public void Torn_discard_read_allows_write() {
        var folder = Path.Combine(Path.GetTempPath(), "pe-state-" + Guid.NewGuid().ToString("N"));
        try {
            var file = StateStorage.ExactDir(folder).Json<Value>("value", StoredPolicy.Discard, "Fixture state");
            File.WriteAllText(Path.Combine(folder, "value.json"), "{bad");
            var data = file.Read();
            data.Text = "replacement";
            file.Write(data);
            Assert.That(file.Read().Text, Is.EqualTo("replacement"));
        } finally { Directory.Delete(folder, true); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Failed_keep_read_refuses_write_until_successful_read(bool ioFailure) {
        var folder = Path.Combine(Path.GetTempPath(), "pe-state-" + Guid.NewGuid().ToString("N"));
        try {
            var file = StateStorage.ExactDir(folder).Json<Value>("value", StoredPolicy.Keep, "Fixture state");
            var path = Path.Combine(folder, "value.json");
            File.WriteAllText(path, ioFailure ? "{\"Text\":\"original\"}" : "{bad");
            var original = File.ReadAllBytes(path);
            if (ioFailure) {
                using var held = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
                Assert.That(file.Read().Text, Is.EqualTo("default"));
            } else Assert.That(file.Read().Text, Is.EqualTo("default"));
            Assert.Throws<InvalidOperationException>(() => file.Write(new Value()));
            Assert.That(File.ReadAllBytes(path), Is.EqualTo(original));
            File.Delete(path);
            Assert.That(file.Read().Text, Is.EqualTo("default"));
            Assert.Throws<InvalidOperationException>(() => file.Write(new Value()));
            File.WriteAllText(path, "{\"Text\":\"repaired\"}");
            Assert.That(file.Read().Text, Is.EqualTo("repaired"));
            file.Write(new Value { Text = "saved" });
            Assert.That(file.Read().Text, Is.EqualTo("saved"));
        } finally { Directory.Delete(folder, true); }
    }

    [TestCase(StoredPolicy.Keep, true)]
    [TestCase(StoredPolicy.Discard, false)]
    public void Corrupt_state_returns_defaults_and_obeys_policy(StoredPolicy policy, bool remains) {
        var folder = Path.Combine(Path.GetTempPath(), "pe-state-" + Guid.NewGuid().ToString("N"));
        try {
            var file = StateStorage.ExactDir(folder).Json<Value>("value", policy, "Fixture state");
            var path = Path.Combine(folder, "value.json");
            File.WriteAllText(path, "{bad");
            Assert.That(file.Read().Text, Is.EqualTo("default"));
            Assert.That(File.Exists(path), Is.EqualTo(remains));
            if (remains) Assert.That(File.ReadAllText(path), Is.EqualTo("{bad"));
        } finally { Directory.Delete(folder, true); }
    }

    [Test]
    public void Replacing_state_preserves_the_previous_publication_bytes() {
        var folder = Path.Combine(Path.GetTempPath(), "pe-state-" + Guid.NewGuid().ToString("N"));
        try {
            var file = StateStorage.ExactDir(folder).Json<Value>("value", StoredPolicy.Discard, "Fixture state");
            file.Write(new Value { Text = "first" });
            var previous = Path.Combine(folder, "previous.json");
            Assert.That(CreateHardLink(previous, Path.Combine(folder, "value.json"), IntPtr.Zero), Is.True);
            file.Write(new Value { Text = "second" });
            Assert.That(File.ReadAllText(previous), Does.Contain("first"));
            Assert.That(file.Read().Text, Is.EqualTo("second"));
            Assert.That(Directory.GetFiles(folder, "*.tmp"), Is.Empty);
        } finally { Directory.Delete(folder, true); }
    }
}
