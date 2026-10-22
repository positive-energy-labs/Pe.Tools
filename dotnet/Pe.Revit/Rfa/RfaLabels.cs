using Pe.Revit.Global;

namespace Pe.Revit.Rfa;

/// <summary>Where a label sits relative to the file's own family.</summary>
public enum RfaLabelContainer {
    /// <summary>On the family itself; what Revit's collectors see.</summary>
    Host,

    /// <summary>In an <c>ElementGroupType</c> definition copy; invisible to Revit's collectors.</summary>
    GroupDefinition,

    /// <summary>In a nested family's definition.</summary>
    Nested
}

public enum RfaParamKind {
    /// <summary>Id -1: no parameter.</summary>
    None,

    /// <summary>Id &lt; -1: a <c>BuiltInParameter</c> value.</summary>
    BuiltIn,

    /// <summary>A <c>ParamElemExternal</c>: shared parameter, GUID and name.</summary>
    Shared,

    /// <summary>A <c>ParamElemFamily</c>: family parameter, name.</summary>
    Family,

    /// <summary>Another <c>ParamElem</c> subclass; <see cref="RfaParam.Name" /> is its caption.</summary>
    Other,

    /// <summary>A positive id with no parameter record in the file.</summary>
    Unresolved
}

/// <param name="Kind">How <paramref name="Id" /> resolved.</param>
/// <param name="Id">The stored element id: negative for built-ins, the parameter element otherwise.</param>
/// <param name="Name">Built-in: the ordinal-first enum name with this value (null without a name source). Shared, family, other: the caption.</param>
/// <param name="SharedGuid">Shared parameters only.</param>
/// <param name="Aliases">Built-in: every other enum name with the same value, ordinal order.</param>
public sealed record RfaParam(RfaParamKind Kind, long Id, string? Name, Guid? SharedGuid, IReadOnlyList<string> Aliases);

/// <summary>One parameter in a label, in label order (<c>TagNoteParamDataFormatting</c>).</summary>
/// <param name="Param">The parameter the segment shows.</param>
/// <param name="Prefix">Text before the value.</param>
/// <param name="Suffix">Text after the value.</param>
/// <param name="Sample">The sample value the family editor shows.</param>
/// <param name="LineBreak">The segment starts on a new line.</param>
/// <param name="Spaces">Raw <c>m_leadingSpaces</c>; 1 on most first segments, its relation to the UI Spaces column is unproven.</param>
/// <param name="Unit">The format unit type id (Revit 2024+) or display-units value (2023); null when the segment uses the default format.</param>
public sealed record RfaLabelSegment(
    RfaParam Param,
    string Prefix,
    string Suffix,
    string Sample,
    int Spaces,
    bool LineBreak,
    string? Unit);

/// <summary>
///     A label (<c>TagNote</c>): its element id, container, sample text, visibility parameter, and ordered segments. The id is unique
///     only within one family document: in a project, key by (family, id). <c>DeferredError</c> is set when one of the record's
///     deferred bodies did not parse; the segments are complete then, the visibility may not be.
/// </summary>
public sealed record RfaLabel(
    long Id,
    RfaLabelContainer Container,
    string Text,
    RfaParam? Visibility,
    IReadOnlyList<RfaLabelSegment> Segments,
    string? DeferredError = null);

/// <summary>A file's save identity from <c>BasicFileInfo</c>; compare with <c>Document.GetDocumentVersion</c>.</summary>
public sealed record RevitFileVersion(Guid VersionGuid, int Saves);

/// <summary>The labels of one family loaded in a project, nested families' labels included as <see cref="RfaLabelContainer.Nested" />.</summary>
/// <param name="Name">The project Family's name.</param>
/// <param name="FamilyId">The project's <c>Family</c> element id.</param>
/// <param name="ContentDocument">The loaded family document's GUID in the project file; null when read through EditFamily.</param>
/// <param name="Labels">Host labels in file order, then nested families' labels.</param>
public sealed record ProjectFamilyLabels(string Name, long FamilyId, Guid? ContentDocument, IReadOnlyList<RfaLabel> Labels);

/// <param name="Version">The file's save identity; null when read through EditFamily.</param>
/// <param name="Families">One entry per project Family that has a family document, ordered by name.</param>
/// <param name="Diagnostics">Families the reader could not link to their family document, by name and id.</param>
public sealed record ProjectLabels(RevitFileVersion? Version, IReadOnlyList<ProjectFamilyLabels> Families, IReadOnlyList<string> Diagnostics);

/// <summary>
///     Reads label parameter bindings straight from Revit file bytes, with no Revit (.artifacts/tagparams/decoder/DECODER.md, RVT.md).
///     <c>Read</c> reads one family file; <c>ReadProject</c> reads every family loaded in a project in one pass, which costs the
///     project's host data whatever the number of families. Built-in ids stay ids unless the caller supplies <c>builtInNames</c>
///     (Revit-side: <c>FamilyLabels</c> supplies the <c>BuiltInParameter</c> enum's names).
/// </summary>
public static class RfaLabels {
    private const long IsVisibleParam = -1006205;
    private static readonly IReadOnlyList<string> NoNames = [];

    public static Result<IReadOnlyList<RfaLabel>> Read(string path, Func<long, IReadOnlyList<string>>? builtInNames = null) {
        try {
            using var stream = OpenShared(path);
            var (labels, error) = Read(stream, builtInNames);
            if (error == null) return labels!.ToList();
            return new InvalidDataException($"{path}: {error.Message}", error);
        } catch (Exception exception) {
            return new InvalidDataException($"{path}: {exception.Message}", exception);
        }
    }

    /// <param name="rfa">A seekable stream over the family file; the caller owns it.</param>
    /// <param name="builtInNames">Names for a built-in parameter id, primary first.</param>
    public static Result<IReadOnlyList<RfaLabel>> Read(Stream rfa, Func<long, IReadOnlyList<string>>? builtInNames = null) {
        try {
            var storage = new RfaStorage(rfa);
            var schema = RfaSchema.Of(storage);
            var parts = Partitions(storage)
                .Select(s => Concat(RfaPartitions.Walk(schema, s).Select(segment => RfaPartitions.Inflate(s, segment))))
                .ToList();
            var owner = OwnerFamily(schema, storage.Inflate("Global/Latest"));
            return Decode(schema, parts, owner, null, false, builtInNames ?? (_ => NoNames));
        } catch (Exception exception) {
            return exception;
        }
    }

    public static Result<ProjectLabels> ReadProject(string path, Func<long, IReadOnlyList<string>>? builtInNames = null, Func<string, bool>? family = null) {
        try {
            using var stream = OpenShared(path);
            var (labels, error) = ReadProject(stream, builtInNames, family);
            if (error == null) return labels!;
            return new InvalidDataException($"{path}: {error.Message}", error);
        } catch (Exception exception) {
            return new InvalidDataException($"{path}: {exception.Message}", exception);
        }
    }

    /// <param name="rvt">A seekable stream over the project file; the caller owns it.</param>
    /// <param name="builtInNames">Names for a built-in parameter id, primary first.</param>
    /// <param name="family">Which families to decode, by name; all when null. The project scan costs the same either way.</param>
    public static Result<ProjectLabels> ReadProject(Stream rvt, Func<long, IReadOnlyList<string>>? builtInNames = null, Func<string, bool>? family = null) {
        try {
            return Project(new RfaStorage(rvt), builtInNames ?? (_ => NoNames), family ?? (_ => true));
        } catch (Exception exception) {
            return exception;
        }
    }

    /// <summary>The file's save identity alone: <c>BasicFileInfo</c>, no partition read.</summary>
    public static Result<RevitFileVersion> ReadVersion(string path) {
        try {
            using var stream = OpenShared(path);
            return Version(new RfaStorage(stream));
        } catch (Exception exception) {
            return new InvalidDataException($"{path}: {exception.Message}", exception);
        }
    }

    // Revit keeps an open document's file open; reading beside it needs shared access.
    private static FileStream OpenShared(string path) =>
        new(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16, FileOptions.RandomAccess);

    private static IEnumerable<RevitStream> Partitions(RfaStorage storage) =>
        storage.StreamNames.Where(n => n.StartsWith("Partitions/", StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal).Select(storage.Open);

    private static ProjectLabels Project(RfaStorage storage, Func<long, IReadOnlyList<string>> builtInNames, Func<string, bool> include) {
        var schema = RfaSchema.Of(storage);
        var familyClasses = schema.Derived("FamilyBase");
        var paramClasses = schema.Derived("ParamElem");

        // 1. Framing walk, no inflate: host segments per stream, and each loaded family document's segments.
        var host = new List<(RevitStream Stream, List<RfaSegment> Segments)>();
        var documents = new Dictionary<(string Stream, Guid Key), List<RfaSegment>>();
        var where = new Dictionary<Guid, RevitStream>();
        foreach (var stream in Partitions(storage)) {
            var hostSegments = new List<RfaSegment>();
            foreach (var segment in RfaPartitions.Walk(schema, stream)) {
                if (segment.Key is not { } key) {
                    hostSegments.Add(segment);
                    continue;
                }
                if (!documents.TryGetValue((stream.Name, key), out var list)) documents[(stream.Name, key)] = list = [];
                list.Add(segment);
                where[key] = stream;
            }
            host.Add((stream, hostSegments));
        }

        // 2. Project Family and ParamElem elements, from the host data of every stream: a loaded family's shared parameters
        //    are project elements and can sit in a stream that holds no family document. Streamed: 3.8 GB inflated here.
        var projectParams = new Dictionary<long, RfaRecordReader.Record>();
        var families = new Dictionary<Guid, (string Name, long Id, RevitStream Stream)>();
        var diagnostics = new List<string>();
        var scanned = new HashSet<int>(familyClasses.Concat(paramClasses));
        foreach (var (stream, segments) in host)
        foreach (var record in RfaPartitions.Scan(schema, segments.Select(s => RfaPartitions.Inflate(stream, s)), scanned)) {
            if (paramClasses.Contains(record.ClassId)) {
                projectParams[record.Id] = record;
                continue;
            }
            var familyBase = record.Object.As("FamilyBase")!;
            var guid = DocumentGuid(familyBase);
            if (guid is { } key && where.ContainsKey(key)) families[key] = ((string)familyBase["m_name"]!, record.Id, stream);
            else if (guid == null && record.DeferredError != null)
                diagnostics.Add($"Family '{familyBase["m_name"]}' ({record.Id}) is not linked to a family document: {record.DeferredError}");
        }

        // 3. Each family document's own Family element: its labels' m_famId.
        var owners = Owners(schema, storage.Inflate("Global/ContentDocuments"));

        // 4. Decode the selected family documents with the .rfa decoder; nested families are family documents of their own.
        byte[] Document(RevitStream stream, Guid doc) => Concat(documents[(stream.Name, doc)].Select(s => RfaPartitions.Inflate(stream, s)));
        var result = new List<ProjectFamilyLabels>();
        foreach (var entry in families.Where(f => include(f.Value.Name)).OrderBy(f => f.Value.Name, StringComparer.Ordinal).ThenBy(f => f.Key)) {
            var (key, f) = (entry.Key, entry.Value);
            var buffer = Document(f.Stream, key);
            var labels = Decode(schema, [buffer], owners.TryGetValue(key, out var owner) ? owner : null, projectParams, false, builtInNames);
            var seen = new HashSet<Guid> { key };
            var todo = new Queue<byte[]>();
            todo.Enqueue(buffer);
            while (todo.Count > 0)
                foreach (var nested in NestedDocuments(schema, todo.Dequeue(), familyClasses).Where(g => where.ContainsKey(g) && seen.Add(g))) {
                    var nestedBuffer = Document(where[nested], nested);
                    labels.AddRange(Decode(schema, [nestedBuffer], null, projectParams, true, builtInNames));
                    todo.Enqueue(nestedBuffer);
                }
            result.Add(new ProjectFamilyLabels(f.Name, f.Id, key, labels));
        }
        return new ProjectLabels(Version(storage), result, diagnostics);
    }

    private static Guid? DocumentGuid(RfaObject familyBase) =>
        (familyBase["m_oFamDoc"] as RfaObject)?["m_contentDocGUID"] is RfaObject g && g["m_guid"] is byte[] bytes ? new Guid(bytes) : null;

    private static List<Guid> NestedDocuments(RfaSchema schema, byte[] document, HashSet<int> familyClasses) =>
        new RfaRecordReader(schema, document).Find(familyClasses).Values.OrderBy(r => r.Offset)
            .Select(r => r.Object.As("FamilyBase") is { } fb ? DocumentGuid(fb) : null)
            .Where(g => g != null).Select(g => g!.Value).ToList();

    /// <summary>
    ///     <c>Global/ContentDocuments</c>: per loaded family document, <c>ContentMarker(key)</c>, <c>u32 L</c>, a block of L bytes
    ///     (<c>u16</c>, then an <c>ADocument</c> whose <c>m_ownerFamilyId</c> is the document's own Family), <c>u32 L</c>; a null key ends it.
    /// </summary>
    private static Dictionary<Guid, object?> Owners(RfaSchema schema, byte[] contentDocuments) {
        var marker = schema.ClassId("ContentMarker");
        var document = schema.ClassId("ADocument");
        var reader = new RfaRecordReader(schema, contentDocuments);
        var owners = new Dictionary<Guid, object?>();
        var pos = 0;
        while (pos + 2 <= contentDocuments.Length) {
            if (reader.U16At(pos) != marker) throw new InvalidDataException($"Global/ContentDocuments: expected a ContentMarker at {pos}");
            var (entry, end) = reader.ReadObject(marker, pos + 2);
            var length = (int)reader.U32At(end);
            var block = end + 4;
            if (RfaPartitions.ContentKey(entry["m_oContentKey"]) is not { } key) break;
            owners[key] = reader.TryObject(document, block + 2)?["m_ownerFamilyId"];
            pos = block + length;
            if (reader.U32At(pos) != length) throw new InvalidDataException($"Global/ContentDocuments: trailing length mismatch at {pos}");
            pos += 4;
        }
        return owners;
    }

    private static RevitFileVersion Version(RfaStorage storage) {
        var info = storage.Open("BasicFileInfo").ReadAll();
        foreach (var shift in new[] { 0, 1 }) {
            var text = Encoding.Unicode.GetString(info, shift, info.Length - shift);
            var project = System.Text.RegularExpressions.Regex.Match(text, @"version identifier is ([0-9a-fA-F-]{36}) for (\d+) saves");
            if (project.Success) return new RevitFileVersion(new Guid(project.Groups[1].Value), int.Parse(project.Groups[2].Value));
            var guid = System.Text.RegularExpressions.Regex.Match(text, @"Unique Document GUID: ([0-9a-fA-F-]{36})");
            var increments = System.Text.RegularExpressions.Regex.Match(text, @"Unique Document Increments: (\d+)");
            if (guid.Success && increments.Success) return new RevitFileVersion(new Guid(guid.Groups[1].Value), int.Parse(increments.Groups[1].Value));
        }
        throw new InvalidDataException("BasicFileInfo carries no document version identity");
    }

    private static byte[] Concat(IEnumerable<byte[]> parts) {
        using var output = new MemoryStream();
        foreach (var part in parts) output.Write(part, 0, part.Length);
        return output.ToArray();
    }

    /// <summary>The labels of one family document. <paramref name="outer" />: the project's parameter elements, under the document's own.</summary>
    private static List<RfaLabel> Decode(RfaSchema schema, IReadOnlyList<byte[]> parts, object? owner,
        IReadOnlyDictionary<long, RfaRecordReader.Record>? outer, bool nested, Func<long, IReadOnlyList<string>> builtInNames) {
        var tagNotes = schema.Derived("TagNote");
        var paramElems = schema.Derived("ParamElem");
        var views = schema.Derived("DBView");
        var readers = parts.Select(p => new RfaRecordReader(schema, p)).ToList();
        var parameters = new Dictionary<long, RfaRecordReader.Record>();
        var notes = new List<RfaRecordReader.Record>();
        var both = new HashSet<int>(tagNotes.Concat(paramElems));
        foreach (var reader in readers) {
            var found = reader.Find(both).Values;
            foreach (var p in found.Where(r => paramElems.Contains(r.ClassId))) parameters[p.Id] = p;
            notes.AddRange(found.Where(r => tagNotes.Contains(r.ClassId)).OrderBy(r => r.Offset));
        }

        var viewCache = new Dictionary<long, RfaObject?>();
        RfaObject? View(long id) {
            if (viewCache.TryGetValue(id, out var cached)) return cached;
            return viewCache[id] = id <= 0 ? null : readers.Select(r => r.FindById(id, views)?.Object.Root()).FirstOrDefault(v => v != null);
        }

        RfaParam Resolve(long id) {
            if (id == -1) return new RfaParam(RfaParamKind.None, id, null, null, []);
            if (id < 0) {
                var names = builtInNames(id);
                return new RfaParam(RfaParamKind.BuiltIn, id, names.FirstOrDefault(), null, names.Skip(1).ToList());
            }
            if (!parameters.TryGetValue(id, out var record) && (outer == null || !outer.TryGetValue(id, out record)))
                return new RfaParam(RfaParamKind.Unresolved, id, null, null, []);
            var cls = schema.ById[record.ClassId].Name;
            var caption = ((record.Object.As("ParamElem")?["m_pParamDef"] as RfaObject)?.As("ParamDef")?["m_caption"]) as string;
            return cls switch {
                "ParamElemExternal" => new RfaParam(RfaParamKind.Shared, id, caption, SharedGuid(record.Object), []),
                "ParamElemFamily" => new RfaParam(RfaParamKind.Family, id, caption, null, []),
                _ => new RfaParam(RfaParamKind.Other, id, caption, null, [])
            };
        }

        return notes.Select(note => {
            var element = note.Object.Root();
            var text = note.Object.As("TextElement")!;
            var tag = note.Object.As("TagNote")!;
            RfaParam? visibility = null;
            foreach (var cell in Items((element["m_cellList"] as RfaObject)?["m_cells"]))
            foreach (var pair in Items((cell as RfaObject)?.As("ParametrizedElemParamsCellBase")?["m_paramDrivenData"]))
                if (pair is RfaObject p && Equals(p["m_elemPropId"], IsVisibleParam))
                    visibility = Resolve(Long(p["m_famParamId"]));

            var segments = Items(tag["m_paramDataFormattingArr"]).Cast<RfaObject>().Select(f => {
                var format = (RfaObject)f["m_formatOptions"]!;
                var unit = (format["m_unitTypeId"] as RfaObject)?["m_typeId"] as string;
                if (string.IsNullOrEmpty(unit) && format["m_displayUnits"] is long display && display != 0) unit = display.ToString();
                if (Long(format["m_bUseDefault"]) != 0) unit = null;
                return new RfaLabelSegment(Resolve(Long(f["m_paramId"])), (string)f["m_prefix"]!, (string)f["m_suffix"]!,
                    (string)f["m_sampleText"]!, (int)Long(f["m_leadingSpaces"]), Long(f["m_bLeadingLineBreak"]) != 0,
                    string.IsNullOrEmpty(unit) ? null : unit);
            }).ToList();

            var view = element["m_ownerDBViewId"] is long viewId ? View(viewId) : null;
            var container = nested || !Equals(element["m_famId"], owner) ? RfaLabelContainer.Nested
                : Unplaced(element) || (view != null && Unplaced(view)) ? RfaLabelContainer.GroupDefinition
                : RfaLabelContainer.Host;
            var sample = string.Concat(Items(text["m_arrTextFragments"]).Cast<RfaObject>().Select(x => (string)x["m_text"]!));
            return new RfaLabel(note.Id, container, sample, visibility, segments, note.DeferredError);
        }).ToList();
    }

    /// <summary><c>Global/Latest</c> opens with the <c>ADocument</c> object; its <c>m_ownerFamilyId</c> is the file's own family.</summary>
    private static object? OwnerFamily(RfaSchema schema, byte[] global) {
        var document = schema.ClassId("ADocument");
        var reader = new RfaRecordReader(schema, global);
        foreach (var offset in new[] { 2, 0, 4, 8, 10 })
            if (reader.TryObject(document, offset) is { } adocument)
                return adocument["m_ownerFamilyId"];
        throw new InvalidDataException("Global/Latest: the ADocument object does not parse");
    }

    private static Guid SharedGuid(RfaObject parameter) =>
        new((byte[])((RfaObject)((RfaObject)parameter["m_externalParamKey"]!)["m_guidValue"]!)["m_guid"]!);

    private static bool Unplaced(RfaObject element) => element.Has("m_unplacedOwnerId") && !Equals(element["m_unplacedOwnerId"], -1L);

    private static IEnumerable<object?> Items(object? value) => value as List<object?> ?? [];

    private static long Long(object? value) => value as long? ?? throw new InvalidDataException($"expected an integer, read {value ?? "null"}");
}
