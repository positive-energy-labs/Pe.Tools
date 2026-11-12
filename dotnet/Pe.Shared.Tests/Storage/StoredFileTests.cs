using Newtonsoft.Json.Linq;
using Pe.Shared.StorageRuntime;
using System.Text;

namespace Pe.Shared.Tests.Storage;

[TestFixture]
public class StoredFileTests {
    private string _folder = null!;
    [SetUp] public void SetUp() => Directory.CreateDirectory(_folder = Path.Combine(Path.GetTempPath(), "pe-stored-" + Guid.NewGuid().ToString("N")));
    [TearDown] public void TearDown() => Directory.Delete(_folder, true);

    [Test]
    public void Notice_is_TS_compatible_and_deduplicated_by_path_and_hash() {
        var path = Path.Combine(_folder, "colors.json");
        var notices = Path.Combine(_folder, "notices.jsonl");
        File.WriteAllText(path, "bad");
        for (var i = 0; i < 2; i++) StoredFile.Note(path, StoredPolicy.Keep, "Document colors", new InvalidDataException("bad\nshape"), notices);
        var rows = File.ReadAllLines(notices);
        Assert.That(rows.Length, Is.EqualTo(1));
        var row = JObject.Parse(rows[0]);
        Assert.That(row.Properties().Select(p => p.Name), Is.EquivalentTo(new[] { "class", "place", "path", "sha256", "reason", "at" }));
        Assert.That(row.Value<string>("reason"), Is.EqualTo("bad shape"));
        Assert.That(row.Value<string>("sha256"), Has.Length.EqualTo(64));
    }

    [TestCase(StoredPolicy.Keep, true)]
    [TestCase(StoredPolicy.Discard, false)]
    public void Corrupt_file_obeys_its_class(StoredPolicy policy, bool remains) {
        var path = Path.Combine(_folder, "state.json");
        File.WriteAllText(path, "bad");
        var notices = Path.Combine(_folder, "notices.jsonl");
        Assert.That(StoredFile.Read(path, policy, "Fixture", text => JObject.Parse(text), notices), Is.Null);
        Assert.That(StoredFile.Read(path, policy, "Fixture", text => JObject.Parse(text), notices), Is.Null);
        Assert.That(File.ReadAllLines(notices).Length, Is.EqualTo(1));
        Assert.That(File.Exists(path), Is.EqualTo(remains));
        if (remains) Assert.That(File.ReadAllText(path), Is.EqualTo("bad"));
    }

    [Test]
    public void Atomic_publish_refuses_duplicate_and_cleans_temporary_files() {
        var path = Path.Combine(_folder, "receipt.json");
        StoredFile.WriteAtomic(path, Encoding.UTF8.GetBytes("first"));
        using (var reader = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)) {
            Assert.Throws<IOException>(() => StoredFile.WriteAtomic(path, Encoding.UTF8.GetBytes("second")));
            Assert.That(reader.Length, Is.EqualTo(5));
        }
        Assert.That(File.ReadAllText(path), Is.EqualTo("first"));
        Assert.That(Directory.GetFiles(_folder), Is.EqualTo(new[] { path }));
        StoredFile.WriteAtomic(path, Encoding.UTF8.GetBytes("replacement"), overwrite: true);
        Assert.That(File.ReadAllText(path), Is.EqualTo("replacement"));
    }

    public class Usage { public int Count { get; set; } }
    [Test]
    public void Atomic_replace_never_exposes_a_partial_file_to_a_concurrent_reader() {
        var path = Path.Combine(_folder, "output.json");
        var first = new string('a', 65536);
        var second = new string('b', 131072);
        StoredFile.WriteAtomic(path, Encoding.UTF8.GetBytes(first));
        using var started = new ManualResetEventSlim();
        var reads = 0;
        var writer = Task.Run(() => {
            started.Wait();
            for (var i = 0; i < 30; i++) {
                try { StoredFile.WriteAtomic(path, Encoding.UTF8.GetBytes(i % 2 == 0 ? second : first), overwrite: true); }
                catch (IOException) { } // Windows may refuse replacing a held file; the published bytes must survive.
            }
        });
        try {
            do {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream);
                var text = reader.ReadToEnd();
                started.Set();
                Assert.That(text == first || text == second, Is.True, "A reader sees one complete published value");
                reads++;
            } while (!writer.IsCompleted);
        } finally { started.Set(); writer.GetAwaiter().GetResult(); }
        Assert.That(reads, Is.GreaterThan(0));
        StoredFile.WriteAtomic(path, Encoding.UTF8.GetBytes(second), overwrite: true);
        Assert.That(File.ReadAllText(path), Is.EqualTo(second));
    }

    [Test]
    public void Malformed_palette_value_discards_the_file_instead_of_returning_partial_rows() {
        var path = Path.Combine(_folder, "usage.csv");
        File.WriteAllText(path, "Key,Count\nvalid,1\nbroken,not-a-number\n");
        Assert.That(new Csv<Usage>(path).Read(), Is.Empty);
        Assert.That(File.Exists(path), Is.False);
    }
}
