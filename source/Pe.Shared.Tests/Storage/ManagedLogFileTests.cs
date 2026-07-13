using Pe.Shared.StorageRuntime;
using System.Runtime.ExceptionServices;

namespace Pe.Shared.Tests.Storage;

[TestFixture]
public sealed class ManagedLogFileTests {
    [Test]
    public void Append_does_not_throw_internally_while_another_writer_has_the_log_open() {
        var root = Path.Combine(Path.GetTempPath(), $"pe-log-{Guid.NewGuid():N}");
        var path = Path.Combine(root, "revit.log.txt");
        var firstChanceIo = 0;
        EventHandler<FirstChanceExceptionEventArgs> countFileIo = (_, args) => {
            if (args.Exception is IOException exception
                && exception.Message.Contains(path, StringComparison.OrdinalIgnoreCase)) {
                _ = Interlocked.Increment(ref firstChanceIo);
            }
        };

        try {
            _ = Directory.CreateDirectory(root);
            File.WriteAllLines(path, ["one", "two", "three"]);
            var log = new ManagedLogFile(path, 2, 1);
            AppDomain.CurrentDomain.FirstChanceException += countFileIo;
            using (File.Open(path, FileMode.Open, FileAccess.Write, FileShare.Read))
                log.Append($"dropped-while-old-writer-owns-file{Environment.NewLine}");
            log.Append($"after{Environment.NewLine}");
            var text = string.Join(Environment.NewLine, log.ReadAllLines());
            AppDomain.CurrentDomain.FirstChanceException -= countFileIo;

            Assert.That(firstChanceIo, Is.Zero);
            Assert.That(text, Does.Contain("after"));
            Assert.That(text, Does.Not.Contain("dropped-while-old-writer-owns-file"));
        } finally {
            AppDomain.CurrentDomain.FirstChanceException -= countFileIo;
            if (Directory.Exists(root))
                Directory.Delete(root, true);
        }
    }
}
