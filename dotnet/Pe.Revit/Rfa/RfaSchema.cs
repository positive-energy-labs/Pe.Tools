namespace Pe.Revit.Rfa;

internal sealed class RfaClass(int id, string name) {
    public int Id { get; } = id;
    public string Name { get; } = name;
    public int Parent { get; set; }
    public List<RfaField> Fields { get; } = [];
}

/// <summary>One schema field type: <c>u8 base, u8 flags, u16 hint</c>, plus a fixed count, a by-value class, or nested element types.</summary>
internal sealed class RfaField(string name, uint type) {
    public string Name { get; } = name;
    public uint Type { get; } = type;
    public int Base => (int)(this.Type & 0xff);
    public int Flags => (int)((this.Type >> 8) & 0xff);
    public uint Count { get; set; }
    public int Ref { get; set; }
    public List<RfaField>? Inner { get; set; }
}

/// <summary>
///     <c>Formats/Latest</c>: the class schema every element record is read against. Grammar in DECODER.md §2. Class ids are
///     implicit, sequential from 12 in definition order; inline class references take their own id. Builds differ in field
///     sets and order, so nothing below names a field except the label projection in <see cref="RfaLabels" />.
/// </summary>
internal sealed class RfaSchema {
    private readonly byte[] _d;
    private int _i;
    private int _nextId = 12;

    public Dictionary<int, RfaClass> ById { get; } = new();
    public int IdWidth { get; }

    private RfaSchema(byte[] d) {
        this._d = d;
        this._i = 2;
        while (this._i < d.Length - 2) {
            var start = this._i;
            try {
                this.Top();
            } catch (Exception) when (IsZeroPadding(d, start)) {
                break;
            } catch (Exception exception) {
                throw new InvalidDataException($"Formats/Latest: class definition at 0x{start:x} does not parse ({exception.Message})", exception);
            }
        }
        foreach (var c in this.ById.Values)
        foreach (var f in c.Fields)
            Validate(c, f);
        var identifier = this.ById.Values.FirstOrDefault(c => c.Name == "Identifier" && c.Fields.Count == 1);
        this.IdWidth = identifier?.Fields[0].Base == 0x0b || identifier == null ? 8 : 4;
    }

    public static RfaSchema Parse(byte[] formats) => new(formats);

    // Every file one Revit build saves carries the same Formats/Latest; parsing it is about half a small file's read.
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, RfaSchema> ByBuild = new(StringComparer.Ordinal);

    /// <summary>The schema of <paramref name="storage" />, parsed once per distinct compressed <c>Formats/Latest</c>.</summary>
    public static RfaSchema Of(RfaStorage storage) {
        var raw = storage.Raw("Formats/Latest");
        using var sha = System.Security.Cryptography.SHA256.Create();
        var key = Convert.ToBase64String(sha.ComputeHash(raw));
        return ByBuild.TryGetValue(key, out var schema)
            ? schema
            : ByBuild.GetOrAdd(key, Parse(RfaStorage.InflateMembers(raw, "Formats/Latest")));
    }

    /// <summary>The first class named <paramref name="name" />, in definition order.</summary>
    public int ClassId(string name) =>
        this.ById.Values.FirstOrDefault(c => c.Name == name)?.Id ?? throw new InvalidDataException($"Formats/Latest has no class {name}");

    /// <summary>Every class that is <paramref name="root" /> or derives from it.</summary>
    public HashSet<int> Derived(string root) {
        var ids = new HashSet<int>();
        foreach (var c in this.ById.Values)
            for (var x = c; x != null; x = x.Parent != 0 && this.ById.TryGetValue(x.Parent, out var p) ? p : null)
                if (x.Name == root) {
                    _ = ids.Add(c.Id);
                    break;
                }
        return ids;
    }

    /// <summary>
    ///     The reader has a rule for exactly these shapes. Anything else is a new Revit build's type, and reading on would misparse
    ///     every record that holds one, so the schema refuses by class and field instead.
    /// </summary>
    private static void Validate(RfaClass c, RfaField f) {
        var b = f.Base;
        var high = f.Flags & 0xf0;
        var low = f.Flags & 0x0f;
        var known = b is >= 0x01 and <= 0x0b or 0x0d or 0x0e
                    && high is 0x00 or 0x10 or 0x50 or 0x60
                    && (high != 0x60 || b == 0x08)
                    && (low == 0 || (b == 0x0e && low <= 4));
        if (!known)
            throw new InvalidDataException($"Formats/Latest: {c.Name}.{f.Name} has an unknown field type 0x{f.Type & 0xffff:x4}");
        foreach (var inner in f.Inner ?? []) Validate(c, inner);
    }

    private static bool IsZeroPadding(byte[] d, int start) {
        for (var k = start; k < d.Length; k++)
            if (d[k] != 0) return false;
        return true;
    }

    private void Top() {
        var c = new RfaClass(this._nextId, this.Name16());
        this.ById[c.Id] = c;
        this._nextId++;
        this.Body(c);
        if (this.U16() != 0) throw new InvalidDataException($"nonzero class trailer after {c.Name}");
    }

    private int ClassRef() {
        var r = this.U16();
        if ((r & 0x8000) == 0) return r;
        var id = r & 0x7fff;
        _ = this.U16();
        var c = new RfaClass(id, this.Name16());
        this._nextId = Math.Max(this._nextId, id + 1);
        this.ById[id] = c;
        this.Body(c);
        return id;
    }

    private void Body(RfaClass c) {
        c.Parent = this.ClassRef();
        _ = this.U32();
        var n = this.U32();
        if (n > 600) throw new InvalidDataException($"bad field count {n}");
        for (var k = 0; k < n; k++) {
            var len = this.U32();
            if (len is 0 or > 200) throw new InvalidDataException($"bad field name length {len}");
            c.Fields.Add(this.FieldType(this.Latin1((int)len), 1));
        }
        var guids = this.U32();
        if (guids > 100000) throw new InvalidDataException($"bad guid count {guids}");
        this._i += 16 * (int)guids;
    }

    private RfaField FieldType(string name, int refs) {
        var f = new RfaField(name, this.U32());
        if (f.Type >> 16 > 64) throw new InvalidDataException($"bad type 0x{f.Type:x}");
        if ((f.Flags & 0xf0) == 0x10) f.Count = this.U32();
        if (f.Base == 0x0e && (f.Flags & 0x0f) == 0) {
            f.Ref = this.ClassRef();
            // A class element type nested in 0x0d carries two class refs (observed in 3 builds, not understood).
            for (var k = 1; k < refs; k++) _ = this.ClassRef();
        }
        if (f.Base == 0x0d) {
            var k = this.U32();
            if (k > 8) throw new InvalidDataException($"bad nested arity {k}");
            f.Inner = [];
            for (var j = 0; j < k; j++) {
                this._i++;
                f.Inner.Add(this.FieldType(name, 2));
            }
        }
        return f;
    }

    private string Name16() {
        var n = this.U16();
        if (n is 0 or > 300) throw new InvalidDataException($"bad class name length {n}");
        return this.Latin1(n);
    }

    private string Latin1(int n) {
        if (this._i + n > this._d.Length) throw new InvalidDataException("name past end");
        var chars = new char[n];
        for (var k = 0; k < n; k++) chars[k] = (char)this._d[this._i + k];
        this._i += n;
        return new string(chars);
    }

    private ushort U16() {
        var v = BitConverter.ToUInt16(this._d, this._i);
        this._i += 2;
        return v;
    }

    private uint U32() {
        var v = BitConverter.ToUInt32(this._d, this._i);
        this._i += 4;
        return v;
    }
}

/// <summary>A parsed object: its class, its parent part, and its own fields in schema order.</summary>
internal sealed class RfaObject(string @class) {
    public string Class { get; private set; } = @class;
    public object? Base { get; private set; }
    public Dictionary<string, object?> Fields { get; private set; } = new(StringComparer.Ordinal);

    public object? this[string field] => this.Fields.TryGetValue(field, out var v) ? v : null;
    public bool Has(string field) => this.Fields.ContainsKey(field);

    /// <summary>This object's part of class <paramref name="cls" />, walking up the parents.</summary>
    public RfaObject? As(string cls) {
        for (var o = this; o != null; o = o.Base as RfaObject)
            if (o.Class == cls) return o;
        return null;
    }

    /// <summary>The root of the parent chain (Element for an element record).</summary>
    public RfaObject Root() {
        var o = this;
        while (o.Base is RfaObject b) o = b;
        return o;
    }

    public void Fill(RfaObject body) {
        this.Class = body.Class;
        this.Base = body.Base;
        this.Fields = body.Fields;
    }

    public void SetBase(object? b) => this.Base = b;
}

