using System.Security.Cryptography;
using System.Text;

namespace Pe.Dev.Cli;

internal static class RevitTestRuntimeFingerprint {
    public static string Compute(string outputDirectory) {
        var runtimeAssemblies = Directory.EnumerateFiles(outputDirectory, "*.dll", SearchOption.TopDirectoryOnly)
            .Where(path => ShouldIncludeRuntimeAssembly(Path.GetFileName(path)))
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (runtimeAssemblies.Length == 0) {
            throw new InvalidOperationException(
                $"Could not find any runtime assemblies to fingerprint under '{outputDirectory}'."
            );
        }

        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var assemblyPath in runtimeAssemblies) {
            var fileNameBytes = Encoding.UTF8.GetBytes(Path.GetFileName(assemblyPath));
            hash.AppendData(fileNameBytes);
            hash.AppendData([0]);

            using var stream = File.OpenRead(assemblyPath);
            stream.CopyTo(new CryptoHashWriteStream(hash));
            hash.AppendData([0]);
        }

        return Convert.ToHexString(hash.GetHashAndReset());
    }

    private static bool ShouldIncludeRuntimeAssembly(string fileName) {
        if (!fileName.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            return false;

        string[] excludedPrefixes = [
            "Pe.Revit.Tests",
            "Pe.Dev.Cli",
            "Pe.Dev.RevitAutomation",
            "Pe.Host"
        ];

        if (excludedPrefixes.Any(prefix => fileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)))
            return false;

        return fileName.StartsWith("Pe.", StringComparison.OrdinalIgnoreCase);
    }

    private sealed class CryptoHashWriteStream(IncrementalHash hash) : Stream {
        private readonly IncrementalHash _hash = hash;

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override void Flush() {
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => this._hash.AppendData(buffer, offset, count);

        public override void Write(ReadOnlySpan<byte> buffer) => this._hash.AppendData(buffer);
    }
}
