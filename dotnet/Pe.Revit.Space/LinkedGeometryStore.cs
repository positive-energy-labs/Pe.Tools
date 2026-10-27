using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Pe.Shared.Product;
using Serilog;

namespace Pe.Revit.Space;

/// <summary>One operation's buffered geometry pack and derived offset index. No geometry or native object is retained.</summary>
internal sealed class LinkedGeometryStore(string directory) : IDisposable {
    private const int Schema = 1;
    private const int PackMagic = 0x314B5047; // GPK1.
    private const int RecordHeaderBytes = 32 + 4 + 32; // Key, payload length, checksum.
    private const long MaxEntryBytes = 32L * 1024 * 1024;
    private const long MaxStoreBytes = 1024L * 1024 * 1024;
    private const int MaxIndexEntries = 262144;
    private readonly Dictionary<string, (long Offset, int Length)> _index = new(StringComparer.Ordinal);
    private FileStream? _stream;
    private SHA256? _hash;
    private bool _operation;
    private bool _unavailable;
    internal sealed record Geometry(PrimRow[] Rows, Tri[] Triangles);
    private string PackPath => Path.Combine(directory, "geometry.pack");
    private static string Root => ProductRuntimeLayout.ForCurrentUser().Cache.ResolveModuleCachePath("space-linked-geometry");

    internal static LinkedGeometryStore? For(Document doc, long? linkId, Transform transform, string generation) {
        try {
            // Loaded links are immutable. Hosts additionally require a clean saved state with no active transaction;
            // their caller supplies the SDK open identity plus epoch, independently of link-manifest generations.
            if (doc.IsModified || (!doc.IsLinked && doc.IsModifiable)) return null;
            using var loaded = Document.GetDocumentVersion(doc);
            if (loaded.VersionGUID == Guid.Empty || loaded.NumberOfSaves < 1) return null;
            var placement = new[] { transform.Origin, transform.BasisX, transform.BasisY, transform.BasisZ }
                .SelectMany(p => new[] { p.X, p.Y, p.Z }).Select(v => v.ToString("R", CultureInfo.InvariantCulture));
            var identity = $"{Schema}|medium-fine-symbol-v3|{doc.Application.VersionNumber}|{doc.Application.VersionBuild}|{generation}|{linkId}|{doc.GetDocumentKey()}|{loaded.VersionGUID:D}|{loaded.NumberOfSaves}|{string.Join(",", placement)}";
            using var hash = SHA256.Create();
            return new LinkedGeometryStore(Path.Combine(Root, Key(hash.ComputeHash(Encoding.UTF8.GetBytes(identity)))));
        } catch (Exception ex) {
            Log.Debug(ex, "Linked geometry cache identity unavailable; extracting current geometry");
            return null;
        }
    }

    internal LinkedGeometryStore Open() {
        if (this._operation) return this;
        this._operation = true;
        try {
            Directory.CreateDirectory(directory);
            this._hash = SHA256.Create();
            this._stream = new FileStream(this.PackPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read, 65536);
            if (this._stream.Length > MaxStoreBytes) throw new InvalidDataException("Geometry pack exceeds its storage limit");
            using var reader = new BinaryReader(this._stream, Encoding.UTF8, true);
            if (this._stream.Length < 8 || reader.ReadInt32() != PackMagic || reader.ReadInt32() != Schema) {
                this._stream.SetLength(0);
                this._stream.Position = 0;
                using var writer = new BinaryWriter(this._stream, Encoding.UTF8, true);
                writer.Write(PackMagic); writer.Write(Schema); writer.Flush();
            }
            long complete = 8;
            this._stream.Position = complete;
            while (this._stream.Length - this._stream.Position >= RecordHeaderBytes) {
                var key = reader.ReadBytes(32);
                var length = reader.ReadInt32();
                this._stream.Position += 32; // Payload checksum is verified only when this entry is read.
                if (length < 1 || length + (long)RecordHeaderBytes > MaxEntryBytes || this._stream.Length - this._stream.Position < length) break;
                var name = Key(key);
                this.CheckIndexCapacity(name);
                this._index[name] = (this._stream.Position, length);
                this._stream.Position += length;
                complete = this._stream.Position;
            }
            // Only a complete structural prefix is authoritative after an interrupted append.
            if (complete != this._stream.Length) this._stream.SetLength(complete);
        } catch (Exception ex) {
            this._unavailable = true;
            this._index.Clear();
            Log.Debug(ex, "Linked geometry pack unavailable at {Path}; extracting current geometry", this.PackPath);
        }
        return this;
    }

    internal Geometry Read(string uniqueId, Func<Geometry> capture) {
        // Standalone callers get a one-read operation; partition builds explicitly share one open stream.
        var ownsOperation = !this._operation;
        if (ownsOperation) this.Open();
        try {
            var key = this._hash?.ComputeHash(Encoding.UTF8.GetBytes(uniqueId));
            var name = key is null ? "" : Key(key);
            if (!this._unavailable && this._stream is { } stream && this._index.TryGetValue(name, out var entry)) {
                try {
                    stream.Position = entry.Offset - 32;
                    using var reader = new BinaryReader(stream, Encoding.UTF8, true);
                    var checksum = reader.ReadBytes(32);
                    var bytes = reader.ReadBytes(entry.Length);
                    if (bytes.Length != entry.Length || !this.Digest(key!, bytes).SequenceEqual(checksum))
                        throw new InvalidDataException("Geometry pack checksum mismatch");
                    return Decode(bytes);
                } catch (Exception ex) {
                    this._index.Remove(name);
                    Log.Debug(ex, "Linked geometry pack entry miss at {Path}", this.PackPath);
                }
            }
            var geometry = capture();
            if (this._unavailable || this._stream is null || key is null) return geometry;
            try {
                this.CheckIndexCapacity(name);
                var triangleBytes = geometry.Triangles.LongLength * 40;
                if (triangleBytes + RecordHeaderBytes > MaxEntryBytes) return geometry;
                var rows = JsonConvert.SerializeObject(geometry.Rows);
                if (triangleBytes + Encoding.UTF8.GetByteCount(rows) + 16 + RecordHeaderBytes > MaxEntryBytes) return geometry;
                using var payload = new MemoryStream();
                using (var writer = new BinaryWriter(payload, Encoding.UTF8, true)) {
                    writer.Write(Schema); writer.Write(rows); writer.Write(geometry.Triangles.Length);
                    foreach (var triangle in geometry.Triangles) {
                        Write(triangle.A); Write(triangle.B); Write(triangle.C); writer.Write(triangle.Prim);
                    }
                    void Write(Vector3 point) { writer.Write(point.X); writer.Write(point.Y); writer.Write(point.Z); }
                }
                var bytes = payload.ToArray();
                var append = this._stream.Length;
                if (append + RecordHeaderBytes + bytes.Length > MaxStoreBytes) return geometry;
                this._stream.Position = append;
                try {
                    using var writer = new BinaryWriter(this._stream, Encoding.UTF8, true);
                    writer.Write(key); writer.Write(bytes.Length); writer.Write(this.Digest(key, bytes)); writer.Write(bytes);
                    this._index[name] = (append + RecordHeaderBytes, bytes.Length);
                } catch {
                    this._stream.SetLength(append);
                    throw;
                }
            } catch (Exception ex) {
                this._unavailable = true;
                this._index.Clear();
                Log.Debug(ex, "Linked geometry pack append ignored at {Path}", this.PackPath);
            }
            return geometry;
        } finally { if (ownsOperation) this.Dispose(); }
    }

    private void CheckIndexCapacity(string name) {
        if (this._index.Count >= MaxIndexEntries && !this._index.ContainsKey(name))
            throw new InvalidDataException("Geometry pack exceeds its distinct-key index limit");
    }

    private byte[] Digest(byte[] key, byte[] payload) {
        var hash = this._hash!;
        hash.Initialize();
        hash.TransformBlock(key, 0, key.Length, null, 0);
        var length = BitConverter.GetBytes(payload.Length);
        hash.TransformBlock(length, 0, length.Length, null, 0);
        hash.TransformFinalBlock(payload, 0, payload.Length);
        return hash.Hash!;
    }

    private static Geometry Decode(byte[] bytes) {
        using var reader = new BinaryReader(new MemoryStream(bytes));
        if (reader.ReadInt32() != Schema) throw new InvalidDataException("Geometry schema mismatch");
        var rows = JsonConvert.DeserializeObject<PrimRow[]>(reader.ReadString()) ?? throw new InvalidDataException("Missing geometry rows");
        var count = reader.ReadInt32();
        if (count < 0 || count > MaxEntryBytes / 40 || rows.Any(r => r.Triangles < 0)
            || rows.Sum(r => (long)r.Triangles) != count || reader.BaseStream.Length - reader.BaseStream.Position != count * 40L)
            throw new InvalidDataException("Invalid geometry length");
        var triangles = new Tri[count];
        for (var i = 0; i < count; i++) triangles[i] = new Tri {
            A = new Vector3(reader.ReadSingle(), reader.ReadSingle(), reader.ReadSingle()),
            B = new Vector3(reader.ReadSingle(), reader.ReadSingle(), reader.ReadSingle()),
            C = new Vector3(reader.ReadSingle(), reader.ReadSingle(), reader.ReadSingle()), Prim = reader.ReadInt32()
        };
        return new Geometry(rows, triangles);
    }

    public void Dispose() {
        try { this._stream?.Dispose(); }
        catch (Exception ex) { Log.Debug(ex, "Linked geometry pack close ignored"); }
        finally {
            if (this._stream is not null) {
                try { File.SetLastWriteTimeUtc(this.PackPath, DateTime.UtcNow); }
                catch (Exception ex) { Log.Debug(ex, "Linked geometry pack touch ignored"); }
            }
            this._stream = null;
            this._hash?.Dispose(); this._hash = null;
            this._index.Clear(); this._operation = false; this._unavailable = false;
        }
    }

    internal static void Prune() {
        try {
            if (!Directory.Exists(Root)) return;
            var files = new DirectoryInfo(Root).EnumerateFiles("*", SearchOption.AllDirectories)
                .OrderByDescending(f => f.LastWriteTimeUtc).ToList();
            long kept = 0;
            foreach (var file in files) {
                if (file.LastWriteTimeUtc < DateTime.UtcNow.AddDays(-30) || kept + file.Length > MaxStoreBytes) file.Delete();
                else kept += file.Length;
            }
            foreach (var child in Directory.EnumerateDirectories(Root))
                if (!Directory.EnumerateFileSystemEntries(child).Any()) Directory.Delete(child);
        } catch (Exception ex) { Log.Debug(ex, "Linked geometry cache cleanup ignored"); }
    }

    private static string Key(byte[] bytes) => BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
}
