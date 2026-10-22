using System.IO.Compression;

namespace Pe.Revit.Rfa;

/// <summary>
///     The byte layer of a Revit file (.rfa, .rvt): an OLE compound file whose streams carry gzip members. Every stream
///     interleaves 353 foreign bytes after each 64,896-byte run; they are dropped before inflating, or any member spanning a run
///     boundary inflates garbage (.artifacts/tagparams/decoder/DECODER.md §1). Read-only, Revit-free, hand-rolled: no OLE package
///     ships into Revit's shared AppDomain beside other add-ins' copies. Streams are read in place from the seekable source, so
///     a 280 MB project never sits in memory whole.
/// </summary>
internal sealed class RfaStorage {
    internal const int Page = 64896;
    internal const int Gap = 353;
    private const uint EndOfChain = 0xFFFFFFFE;
    private static readonly byte[] GzipMagic = [0x1f, 0x8b, 0x08, 0x00];

    private readonly Stream _file;
    private readonly int _sectorShift;
    private readonly int _miniShift;
    private readonly uint _miniCutoff;
    private readonly uint[] _fat;
    private readonly uint[] _miniFat;
    private readonly byte[] _miniStream;
    private readonly Dictionary<string, (uint Start, long Size)> _streams = new(StringComparer.Ordinal);

    /// <param name="file">A seekable stream over the whole compound file. The caller owns it.</param>
    public RfaStorage(Stream file) {
        if (!file.CanSeek) throw new ArgumentException("the Revit file stream must be seekable", nameof(file));
        this._file = file;
        var header = this.ReadFile(0, 512);
        if (BitConverter.ToUInt64(header, 0) != 0xE11AB1A1E011CFD0) throw new InvalidDataException("not an OLE compound file");
        var major = BitConverter.ToUInt16(header, 26);
        this._sectorShift = BitConverter.ToUInt16(header, 30);
        this._miniShift = BitConverter.ToUInt16(header, 32);
        this._miniCutoff = BitConverter.ToUInt32(header, 56);
        this._fat = this.ReadFat(header, BitConverter.ToInt32(header, 44), BitConverter.ToUInt32(header, 68));

        var directory = this.ReadAll(this.Chain(BitConverter.ToUInt32(header, 48), this._fat), long.MaxValue);
        var entries = new List<(string Name, int Type, uint Left, uint Right, uint Child, uint Start, long Size)>();
        for (var o = 0; o + 128 <= directory.Length; o += 128) {
            var nameBytes = BitConverter.ToUInt16(directory, o + 64);
            var name = nameBytes >= 2 ? Encoding.Unicode.GetString(directory, o, nameBytes - 2) : "";
            var size = (long)BitConverter.ToUInt64(directory, o + 120);
            if (major == 3) size &= 0xFFFFFFFF;
            entries.Add((name, directory[o + 66], BitConverter.ToUInt32(directory, o + 68), BitConverter.ToUInt32(directory, o + 72),
                BitConverter.ToUInt32(directory, o + 76), BitConverter.ToUInt32(directory, o + 116), size));
        }
        var root = entries[0];
        this._miniStream = this.ReadAll(this.Chain(root.Start, this._fat), root.Size);
        this._miniFat = ToUInts(this.ReadAll(this.Chain(BitConverter.ToUInt32(header, 60), this._fat), long.MaxValue));

        var pending = new Stack<(uint Id, string Prefix)>();
        pending.Push((root.Child, ""));
        var seen = new HashSet<uint>();
        while (pending.Count > 0) {
            var (id, prefix) = pending.Pop();
            if (id >= entries.Count || !seen.Add(id)) continue;
            var entry = entries[(int)id];
            pending.Push((entry.Left, prefix));
            pending.Push((entry.Right, prefix));
            var path = prefix + entry.Name;
            if (entry.Type == 1) pending.Push((entry.Child, path + "/"));
            else if (entry.Type == 2) this._streams[path] = (entry.Start, entry.Size);
        }
    }

    public IEnumerable<string> StreamNames => this._streams.Keys;

    /// <summary>A stream with the 353-byte runs removed, still compressed, read on demand.</summary>
    public RevitStream Open(string name) {
        if (!this._streams.TryGetValue(name, out var stream)) throw new InvalidDataException($"stream '{name}' is absent");
        if (stream.Size < this._miniCutoff) {
            var bytes = new byte[stream.Size];
            var at = 0;
            foreach (var id in this.Chain(stream.Start, this._miniFat)) {
                if (at >= bytes.Length) break;
                var n = Math.Min(1 << this._miniShift, bytes.Length - at);
                Array.Copy(this._miniStream, (int)(id << this._miniShift), bytes, at, n);
                at += n;
            }
            return new RevitStream(name, (o, buffer, offset, count) => Array.Copy(bytes, o, buffer, offset, count), stream.Size);
        }
        var sectors = this.Chain(stream.Start, this._fat).ToArray();
        var size = 1 << this._sectorShift;
        return new RevitStream(name, (o, buffer, offset, count) => {
            while (count > 0) {
                var index = (int)(o >> this._sectorShift);
                var within = (int)(o & (size - 1));
                var n = Math.Min(count, size - within);
                this.ReadFile(this.SectorOffset(sectors[index]) + within, buffer, offset, n);
                o += n;
                offset += n;
                count -= n;
            }
        }, stream.Size);
    }

    /// <summary>The whole de-interleaved stream, still compressed. For the small Global and Formats streams.</summary>
    public byte[] Raw(string name) => this.Open(name).ReadAll();

    /// <summary>A gzip-member stream (Formats, Global), inflated and concatenated.</summary>
    public byte[] Inflate(string name) => InflateMembers(this.Raw(name), name);

    /// <summary>Gzip members found by their magic, each ending at its own crc32/isize trailer. For streams with no framing.</summary>
    internal static byte[] InflateMembers(byte[] d, string name) {
        using var output = new MemoryStream();
        var pos = IndexOf(d, GzipMagic, 0);
        while (pos >= 0) {
            byte[] member;
            try {
                member = Deflate(d, pos + 10, d.Length - pos - 10);
            } catch (InvalidDataException) {
                pos = IndexOf(d, GzipMagic, pos + 1);
                continue;
            }
            // DeflateStream does not report how much input it consumed; the member ends at its own trailer.
            var trailer = new byte[8];
            Array.Copy(BitConverter.GetBytes(Crc32.Of(member)), 0, trailer, 0, 4);
            Array.Copy(BitConverter.GetBytes((uint)member.Length), 0, trailer, 4, 4);
            var end = IndexOf(d, trailer, pos + 10);
            if (end < 0) throw new InvalidDataException($"{name}: the gzip member at 0x{pos:x} has no matching crc32/isize trailer");
            output.Write(member, 0, member.Length);
            pos = IndexOf(d, GzipMagic, end + 8);
        }
        return output.ToArray();
    }

    /// <summary>One whole gzip member (header to trailer, as framed by a SegmentMarker), inflated and checked.</summary>
    internal static byte[] InflateMember(byte[] member, string where) {
        if (member.Length < 18 || member[0] != 0x1f || member[1] != 0x8b) throw new InvalidDataException($"{where}: not a gzip member");
        var data = Deflate(member, 10, member.Length - 18);
        if (BitConverter.ToUInt32(member, member.Length - 4) != (uint)data.Length || BitConverter.ToUInt32(member, member.Length - 8) != Crc32.Of(data))
            throw new InvalidDataException($"{where}: gzip member fails its crc32/isize check");
        return data;
    }

    private static byte[] Deflate(byte[] d, int offset, int count) {
        using var inflate = new DeflateStream(new MemoryStream(d, offset, count, false), CompressionMode.Decompress);
        using var buffer = new MemoryStream();
        inflate.CopyTo(buffer);
        return buffer.ToArray();
    }

    private uint[] ReadFat(byte[] header, int fatSectors, uint firstDifat) {
        var ids = new List<uint>();
        for (var k = 0; k < 109 && ids.Count < fatSectors; k++) ids.Add(BitConverter.ToUInt32(header, 76 + 4 * k));
        var per = (1 << this._sectorShift) / 4;
        for (var difat = firstDifat; ids.Count < fatSectors && difat < EndOfChain;) {
            var sector = this.ReadFile(this.SectorOffset(difat), per * 4);
            for (var k = 0; k < per - 1 && ids.Count < fatSectors; k++) ids.Add(BitConverter.ToUInt32(sector, 4 * k));
            difat = BitConverter.ToUInt32(sector, 4 * (per - 1));
        }
        var fat = new uint[ids.Count * per];
        for (var k = 0; k < ids.Count; k++) Buffer.BlockCopy(this.ReadFile(this.SectorOffset(ids[k]), per * 4), 0, fat, k * per * 4, per * 4);
        return fat;
    }

    private IEnumerable<uint> Chain(uint start, uint[] table) {
        var guard = 0;
        for (var id = start; id < EndOfChain; id = table[id]) {
            if (id >= table.Length || ++guard > table.Length) throw new InvalidDataException($"broken sector chain at {id}");
            yield return id;
        }
    }

    private byte[] ReadAll(IEnumerable<uint> chain, long size) {
        var sector = 1 << this._sectorShift;
        using var output = new MemoryStream();
        foreach (var id in chain) {
            if (output.Length >= size) break;
            var bytes = this.ReadFile(this.SectorOffset(id), (int)Math.Min(sector, size - output.Length));
            output.Write(bytes, 0, bytes.Length);
        }
        return output.ToArray();
    }

    private long SectorOffset(uint id) => (long)(id + 1) << this._sectorShift;

    private byte[] ReadFile(long at, int count) {
        var bytes = new byte[count];
        this.ReadFile(at, bytes, 0, count);
        return bytes;
    }

    private void ReadFile(long at, byte[] buffer, int offset, int count) {
        this._file.Position = at;
        while (count > 0) {
            var n = this._file.Read(buffer, offset, count);
            if (n <= 0) throw new InvalidDataException($"file ends before offset {at + count}");
            offset += n;
            count -= n;
        }
    }

    private static uint[] ToUInts(byte[] bytes) {
        var values = new uint[bytes.Length / 4];
        Buffer.BlockCopy(bytes, 0, values, 0, values.Length * 4);
        return values;
    }

    internal static int IndexOf(byte[] d, byte[] pattern, int from) {
        var first = pattern[0];
        for (var i = Array.IndexOf(d, first, Math.Max(from, 0)); i >= 0 && i <= d.Length - pattern.Length; i = Array.IndexOf(d, first, i + 1)) {
            var k = 1;
            while (k < pattern.Length && d[i + k] == pattern[k]) k++;
            if (k == pattern.Length) return i;
        }
        return -1;
    }
}

/// <summary>One OLE stream with the interleaved runs removed: logical offset o sits at physical o + (o / 64896) * 353.</summary>
internal sealed class RevitStream {
    private readonly Action<long, byte[], int, int> _readPhysical;

    public RevitStream(string name, Action<long, byte[], int, int> readPhysical, long physicalLength) {
        this.Name = name;
        this._readPhysical = readPhysical;
        // Python: d[i:i+Page] for i in range(0, len, Page+Gap); a stream no longer than one page is not interleaved.
        var full = physicalLength / (RfaStorage.Page + RfaStorage.Gap);
        var rest = physicalLength - full * (RfaStorage.Page + RfaStorage.Gap);
        this.Length = physicalLength <= RfaStorage.Page ? physicalLength : full * RfaStorage.Page + Math.Min(rest, RfaStorage.Page);
    }

    public string Name { get; }
    public long Length { get; }

    public byte[] Read(long at, int count) {
        if (at < 0 || count < 0 || at + count > this.Length) throw new InvalidDataException($"{this.Name}: read [{at}, {at + count}) is past its end {this.Length}");
        var buffer = new byte[count];
        var offset = 0;
        while (count > 0) {
            var within = (int)(at % RfaStorage.Page);
            var n = Math.Min(count, RfaStorage.Page - within);
            this._readPhysical(at / RfaStorage.Page * (RfaStorage.Page + RfaStorage.Gap) + within, buffer, offset, n);
            at += n;
            offset += n;
            count -= n;
        }
        return buffer;
    }

    public byte[] ReadAll() => this.Read(0, checked((int)this.Length));
}

/// <summary>CRC-32 (IEEE), slicing by 8: the integrity check on every gzip member, 3.8 GB of them in a large project.</summary>
internal static class Crc32 {
    private static readonly uint[] Table = Build();

    private static uint[] Build() {
        var t = new uint[8 * 256];
        for (uint n = 0; n < 256; n++) {
            var c = n;
            for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1;
            t[n] = c;
        }
        for (var n = 0; n < 256; n++)
        for (var s = 1; s < 8; s++)
            t[s * 256 + n] = (t[(s - 1) * 256 + n] >> 8) ^ t[t[(s - 1) * 256 + n] & 0xff];
        return t;
    }

    public static uint Of(byte[] data) {
        var crc = 0xFFFFFFFF;
        var i = 0;
        for (; i + 8 <= data.Length; i += 8) {
            var a = crc ^ BitConverter.ToUInt32(data, i);
            var b = BitConverter.ToUInt32(data, i + 4);
            crc = Table[7 * 256 + (a & 0xff)] ^ Table[6 * 256 + ((a >> 8) & 0xff)] ^ Table[5 * 256 + ((a >> 16) & 0xff)] ^ Table[4 * 256 + (a >> 24)]
                  ^ Table[3 * 256 + (b & 0xff)] ^ Table[2 * 256 + ((b >> 8) & 0xff)] ^ Table[256 + ((b >> 16) & 0xff)] ^ Table[b >> 24];
        }
        for (; i < data.Length; i++) crc = Table[(crc ^ data[i]) & 0xff] ^ (crc >> 8);
        return ~crc;
    }
}
