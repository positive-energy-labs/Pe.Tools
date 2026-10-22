namespace Pe.Revit.Rfa;

/// <summary>A read past the end of the bytes at hand: in a sliding window, more bytes may still come.</summary>
internal sealed class RfaTruncatedException(string message) : IOException(message);

/// <summary>A raw (non-owning) pointer, serialized as a bare u32.</summary>
internal readonly record struct RfaRef(uint Value);

/// <summary>
///     Element records in inflated partition bytes: <c>Id(4|8) u8[8] u16 classId Object [deferred bodies, FIFO]</c> (DECODER.md §3).
///     Records are located by class id and accepted only when they fully parse and <c>Element.m_id</c> equals the header id. Reads
///     never pass <c>length</c>, so one buffer can be reused as a sliding window.
/// </summary>
internal sealed class RfaRecordReader(RfaSchema schema, byte[] d, int length) {
    private byte[] _d = d;
    private int _len = length;
    private int _i;
    private readonly Queue<(int Class, RfaObject Body)> _deferred = new();

    public RfaRecordReader(RfaSchema schema, byte[] d) : this(schema, d, d.Length) { }

    // DeferredError: a deferred body did not parse (seen: ESEntityCell, extensible storage). The main object and the deferred
    // bodies before it are complete; later bodies are empty placeholders.
    public sealed record Record(long Id, int ClassId, RfaObject Object, long Offset, string? DeferredError);

    public void Reset(byte[] d, int length) {
        this._d = d;
        this._len = length;
    }

    /// <summary>Every record of the given classes, keyed by element id; a later offset wins a repeated id.</summary>
    public Dictionary<long, Record> Find(HashSet<int> classIds) {
        var found = new Dictionary<long, Record>();
        foreach (var record in this.Scan(Mask(classIds), 0, this._len, 0)) found[record.Id] = record;
        return found;
    }

    /// <summary>A lookup over all 65536 class ids, built once per scan rather than per window.</summary>
    public static bool[] Mask(IEnumerable<int> classIds) {
        var wanted = new bool[65536];
        foreach (var id in classIds) wanted[id] = true;
        return wanted;
    }

    /// <summary>
    ///     Records whose class id sits at a position in [<paramref name="from" />, <paramref name="limit" />). A candidate that
    ///     reads past the bytes at hand goes to <paramref name="truncated" /> (its start) when given, for <see cref="Retry" />.
    /// </summary>
    public IEnumerable<Record> Scan(bool[] wanted, int from, int limit, long baseOffset, List<int>? truncated = null) {
        var header = schema.IdWidth + 8;
        var end = Math.Min(limit, this._len - 1);
        for (var i = Math.Max(from, header); i < end; i++) {
            if (!wanted[this._d[i] | (this._d[i + 1] << 8)]) continue;
            var start = i - header;
            var id = this.ReadId(start);
            if (id is <= 0 or >= 1L << 40) continue;
            var record = this.TryRecord(start, true, baseOffset, out var cut);
            if (cut && truncated != null) truncated.Add(start);
            else if (record != null && Equals(record.Object.Root()["m_id"], id)) yield return record;
        }
    }

    /// <summary>A truncated candidate again, with more bytes at hand. <paramref name="cut" />: still truncated.</summary>
    public Record? Retry(int start, long baseOffset, out bool cut) {
        var record = this.TryRecord(start, true, baseOffset, out cut);
        return record != null && !cut && Equals(record.Object.Root()["m_id"], this.ReadId(start)) ? record : null;
    }

    /// <summary>The record whose header id is <paramref name="id" /> and whose class is one of <paramref name="classIds" />.</summary>
    public Record? FindById(long id, HashSet<int> classIds) {
        var w = schema.IdWidth;
        var pattern = new byte[w];
        Array.Copy(BitConverter.GetBytes(id), pattern, w);
        for (var i = RfaStorage.IndexOf(this._d, pattern, 0); i >= 0 && i < this._len; i = RfaStorage.IndexOf(this._d, pattern, i + 1)) {
            if (i + w + 10 > this._len) continue;
            var cid = BitConverter.ToUInt16(this._d, i + w + 8);
            if (!schema.ById.ContainsKey(cid) || !classIds.Contains(cid)) continue;
            var record = this.TryRecord(i, false, 0, out _);
            if (record != null && Equals(record.Object.Root()["m_id"], id)) return record;
        }
        return null;
    }

    /// <summary>One object of class <paramref name="classId" /> at <paramref name="offset" />, no header, no deferred bodies; null if it does not parse.</summary>
    public RfaObject? TryObject(int classId, int offset) {
        this._i = offset;
        this._deferred.Clear();
        try {
            return this.Obj(classId) as RfaObject;
        } catch (Exception exception) when (IsParseFailure(exception)) {
            return null;
        }
    }

    /// <summary>One object with its deferred bodies, and the offset just past them. Throws when it does not parse.</summary>
    public (RfaObject Object, int End) ReadObject(int classId, int offset) {
        this._i = offset;
        this._deferred.Clear();
        if (this.Obj(classId) is not RfaObject main) throw new InvalidDataException($"class {classId} flattens to a scalar");
        this.Drain();
        return (main, this._i);
    }

    public int U16At(int offset) {
        this._i = offset;
        return this.U16();
    }

    public int Position => this._i;

    public uint U32At(int offset) {
        this._i = offset;
        return this.U32();
    }

    private static bool IsParseFailure(Exception e) =>
        e is InvalidDataException or RfaTruncatedException or ArgumentException or IndexOutOfRangeException or OverflowException;

    private long ReadId(int at) => schema.IdWidth == 8 ? BitConverter.ToInt64(this._d, at) : BitConverter.ToInt32(this._d, at);

    // A candidate offset is a guess until its main object parses: those failures reject the guess, not the file.
    private Record? TryRecord(int start, bool deferred, long baseOffset, out bool cut) {
        cut = false;
        this._i = start;
        this._deferred.Clear();
        RfaObject main;
        int cid;
        long id;
        try {
            this.Need(schema.IdWidth + 10);
            id = this.ReadId(start);
            this._i += schema.IdWidth + 8;
            cid = this.U16();
            if (this.Obj(cid) is not RfaObject parsed) return null;
            main = parsed;
        } catch (Exception exception) when (IsParseFailure(exception)) {
            cut = exception is RfaTruncatedException;
            return null;
        }
        string? deferredError = null;
        if (deferred)
            try {
                this.Drain();
            } catch (Exception exception) when (IsParseFailure(exception)) {
                cut = exception.InnerException is RfaTruncatedException;
                deferredError = exception.Message;
            }
        return new Record(id, cid, main, baseOffset + start, deferredError);
    }

    private void Drain() {
        while (this._deferred.Count > 0) {
            var (c, body) = this._deferred.Dequeue();
            try {
                if (this.Obj(c) is not RfaObject parsed) throw new InvalidDataException("a deferred body flattened to a scalar");
                body.Fill(parsed);
            } catch (Exception exception) when (IsParseFailure(exception)) {
                this._deferred.Clear();
                throw new InvalidDataException($"{exception.Message} in deferred {body.Class} at 0x{this._i:x}", exception);
            }
        }
    }

    private object? Obj(int cid) {
        if (!schema.ById.TryGetValue(cid, out var c)) throw new InvalidDataException($"unknown class {cid} at 0x{this._i:x}");
        if (c.Name is "ElementId" or "Identifier" && c.Fields.Count == 1) return this.Value(c.Fields[0]);
        var o = new RfaObject(c.Name);
        if (c.Parent != 0) o.SetBase(this.Obj(c.Parent));
        foreach (var f in c.Fields) o.Fields[f.Name] = this.Value(f);
        return o;
    }

    private object? Value(RfaField f) {
        var high = f.Flags & 0xf0;
        var low = f.Flags & 0x0f;
        if (high == 0x10) {
            var items = new List<object?>((int)Math.Min(f.Count, 4096));
            for (var k = 0; k < f.Count; k++) items.Add(this.Element(f, low));
            return items;
        }
        if (f.Base == 0x0e && low == 3) return new RfaRef(this.U32());
        if (high == 0x50) {
            var n = this.U32();
            if (n > 1000000) throw new InvalidDataException($"bad vector count {n}");
            var items = new List<object?>((int)Math.Min(n, 4096));
            for (var k = 0; k < n; k++) items.Add(this.Element(f, low));
            return items;
        }
        return this.Element(f, low);
    }

    private object? Element(RfaField f, int pointer) {
        switch (f.Base) {
            case 0x0e:
                return pointer == 0 ? this.Obj(f.Ref) : this.Pointer();
            case 0x08:
                return this.String();
            case 0x0d:
                return f.Inner!.Select(this.Value).ToList();
            case 0x09:
                var guid = new byte[16];
                Array.Copy(this._d, this.Need(16), guid, 0, 16);
                this._i += 16;
                return guid;
            case 0x07:
                var dbl = BitConverter.ToDouble(this._d, this.Need(8));
                this._i += 8;
                return dbl;
        }
        var size = f.Base switch { 0x01 or 0x02 => 1, 0x03 => 2, 0x04 or 0x05 or 0x06 => 4, 0x0a or 0x0b => 8, _ => 0 };
        if (size == 0) throw new InvalidDataException($"unknown scalar 0x{f.Base:x2} in {f.Name}");
        var at = this.Need(size);
        this._i += size;
        return size switch {
            1 => (long)(sbyte)this._d[at],
            2 => BitConverter.ToInt16(this._d, at),
            4 => BitConverter.ToInt32(this._d, at),
            _ => BitConverter.ToInt64(this._d, at)
        };
    }

    // Any non-zero marker carries a class id and a deferred body: 0xffffffff on most pointers, small counts (3) on
    // FamilyBase.m_oFamDoc (DECODER.md note 2026-10-21).
    private object? Pointer() {
        var m = this.U32();
        if (m == 0) return null;
        var cid = this.U16();
        if (!schema.ById.TryGetValue(cid, out var c)) throw new InvalidDataException($"unknown deferred class {cid}");
        var body = new RfaObject(c.Name);
        this._deferred.Enqueue((cid, body));
        return body;
    }

    private string String() {
        var n = this.U32();
        if (n > 100000) throw new InvalidDataException($"bad string length {n}");
        var at = this.Need((int)(2 * n));
        this._i += (int)(2 * n);
        return Encoding.Unicode.GetString(this._d, at, (int)(2 * n));
    }

    private int Need(int n) {
        if (this._i + n > this._len) throw new RfaTruncatedException($"read past the end at 0x{this._i:x}");
        return this._i;
    }

    private ushort U16() {
        var v = BitConverter.ToUInt16(this._d, this.Need(2));
        this._i += 2;
        return v;
    }

    private uint U32() {
        var v = BitConverter.ToUInt32(this._d, this.Need(4));
        this._i += 4;
        return v;
    }
}

/// <summary>One gzip member of a partition stream and the content document whose elements it holds (null: the host document).</summary>
internal sealed record RfaSegment(Guid? Key, long Start, long End);

/// <summary>
///     Partition streams are framed by schema objects (DECODER.md note 3, RVT.md §1):
///     <c>u64, (ContentMarker (SegmentMarker u64 gzip SegmentCheckback?)* SegmentMarker(0) SignatureMarker ContentMarker(null,-1))+</c>.
///     <c>SegmentMarker.m_segmentSize</c> is the 8-byte tail plus the gzip member, so a stream is walked without inflating it.
/// </summary>
internal static class RfaPartitions {
    private static readonly byte[] GzipMagic = [0x1f, 0x8b, 0x08, 0x00];

    public static IEnumerable<RfaSegment> Walk(RfaSchema schema, RevitStream stream) {
        var contentMarker = schema.ClassId("ContentMarker");
        var segmentMarker = schema.ClassId("SegmentMarker");
        long pos = 8;
        Guid? key = null;
        long segmentEnd = -1;
        while (pos + 2 <= stream.Length) {
            var head = stream.Read(pos, (int)Math.Min(4, stream.Length - pos));
            if (head.Length == 4 && head.SequenceEqual(GzipMagic)) {
                if (segmentEnd <= pos) throw new InvalidDataException($"{stream.Name}: gzip member at {pos} has no SegmentMarker size");
                yield return new RfaSegment(key, pos, segmentEnd);
                pos = segmentEnd;
                continue;
            }
            var (cid, o, length) = ReadFrame(schema, stream, pos);
            if (cid == segmentMarker && Long(o["m_segmentSize"]) is var size && size != 0) {
                segmentEnd = pos + length + size;
                length += 8;
            }
            pos += length;
            if (cid != contentMarker) continue;
            key = ContentKey(o["m_oContentKey"]);
            if (key == null && Long(o["m_nElementCount"]) == -1
                && (pos + 2 > stream.Length || BitConverter.ToUInt16(stream.Read(pos, 2), 0) != contentMarker))
                yield break;
        }
    }

    /// <summary>A gzip segment, inflated and crc-checked.</summary>
    public static byte[] Inflate(RevitStream stream, RfaSegment segment) =>
        RfaStorage.InflateMember(stream.Read(segment.Start, checked((int)(segment.End - segment.Start))), $"{stream.Name}@{segment.Start}");

    /// <summary>
    ///     Records over a sequence of inflated segments without holding them all: records may span segment boundaries, so
    ///     the last <paramref name="keep" /> bytes stay in the window. A candidate that runs past the bytes at hand waits for more,
    ///     up to <paramref name="span" /> bytes (a large Family's FamilyTypeTable outruns a 1 MB window).
    /// </summary>
    public static IEnumerable<RfaRecordReader.Record> Scan(RfaSchema schema, IEnumerable<byte[]> segments, HashSet<int> classIds,
        int keep = 1 << 20, int margin = 1 << 16, int span = 32 << 20) {
        var header = schema.IdWidth + 8;
        var buffer = new byte[8 << 20];
        var length = 0;
        long baseOffset = 0;
        var done = 0;
        var reader = new RfaRecordReader(schema, buffer, 0);
        var wanted = RfaRecordReader.Mask(classIds);
        var pending = new List<int>();
        using var e = segments.GetEnumerator();
        var more = e.MoveNext();
        while (more) {
            var chunk = e.Current;
            more = e.MoveNext();
            if (length + chunk.Length > buffer.Length && length > keep + margin) {
                // keep the window, and every truncated candidate still waiting for its bytes, up to a record of `span` bytes
                pending.RemoveAll(start => start < length - span);
                var cut = Math.Min(length - keep - margin, pending.Count > 0 ? pending.Min() : int.MaxValue);
                Buffer.BlockCopy(buffer, cut, buffer, 0, length - cut);
                length -= cut;
                baseOffset += cut;
                done -= cut;
                for (var k = 0; k < pending.Count; k++) pending[k] -= cut;
            }
            if (length + chunk.Length > buffer.Length) Array.Resize(ref buffer, Math.Max(buffer.Length * 2, length + chunk.Length));
            Buffer.BlockCopy(chunk, 0, buffer, length, chunk.Length);
            length += chunk.Length;
            var limit = more ? length - margin : length;
            reader.Reset(buffer, length);
            var waiting = pending.ToList();
            pending.Clear();
            foreach (var start in waiting) {
                var record = reader.Retry(start, baseOffset, out var stillCut);
                if (stillCut && more) pending.Add(start);
                else if (record != null) yield return record;
            }
            foreach (var record in reader.Scan(wanted, Math.Max(done, header), limit, baseOffset, more ? pending : null)) yield return record;
            done = Math.Max(done, limit);
        }
    }

    public static Guid? ContentKey(object? key) =>
        key is RfaObject k && k["m_guidKey"] is RfaObject g && g["m_guid"] is byte[] bytes ? new Guid(bytes) : null;

    private static (int ClassId, RfaObject Object, int Length) ReadFrame(RfaSchema schema, RevitStream stream, long pos) {
        for (var window = 4096;; window *= 4) {
            var count = (int)Math.Min(window, stream.Length - pos);
            var bytes = stream.Read(pos, count);
            var reader = new RfaRecordReader(schema, bytes);
            var cid = reader.U16At(0);
            if (!schema.ById.ContainsKey(cid)) throw new InvalidDataException($"{stream.Name}: unknown framing token {cid} at {pos}");
            try {
                var (o, end) = reader.ReadObject(cid, 2);
                return (cid, o, end);
            } catch (Exception exception) when (exception is RfaTruncatedException or InvalidDataException { InnerException: RfaTruncatedException } && count == window && window < 1 << 24) {
                // the frame may run past this window; read a larger one
            } catch (Exception exception) when (exception is InvalidDataException or RfaTruncatedException) {
                throw new InvalidDataException($"{stream.Name}: framing object {schema.ById[cid].Name} at {pos} does not parse ({exception.Message})", exception);
            }
        }
    }

    private static long Long(object? value) => value as long? ?? throw new InvalidDataException($"expected an integer, read {value ?? "null"}");
}
