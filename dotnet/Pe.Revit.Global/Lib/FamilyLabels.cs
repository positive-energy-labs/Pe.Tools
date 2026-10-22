using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Rfa;
using Serilog;

namespace Pe.Revit.Global.Lib;

/// <summary>
///     Label parameter bindings of loaded families, read from bytes (<see cref="RfaLabels" />). Two sources of the same records:
///     the project file itself, when it is exactly the open document's last save (one pass over the project, about 19 s for 643
///     families in a 280 MB project); otherwise each family through EditFamily → SaveAs to a temp file → read (about 1 s each).
///     The Revit API has no in-memory serialization of a document, so there is no third way to the bytes.
/// </summary>
public static class FamilyLabels {
    private static readonly Lazy<Dictionary<long, string[]>> BuiltInNames = new(() =>
        Enum.GetNames(typeof(BuiltInParameter))
            .GroupBy(name => Convert.ToInt64(Enum.Parse(typeof(BuiltInParameter), name)))
            .ToDictionary(g => g.Key, g => g.OrderBy(name => name, StringComparer.Ordinal).ToArray()));

    /// <summary>
    ///     Every <c>BuiltInParameter</c> name with this value, from the running Revit's enum. Aliases (one value, several names, e.g.
    ///     <c>ALL_MODEL_TYPE_MARK</c> / <c>WINDOW_TYPE_ID</c>) are ordered ordinally, so the first name is deterministic across runs
    ///     where <c>Enum.GetName</c> is not. Empty for a value this Revit does not define.
    /// </summary>
    public static IReadOnlyList<string> BuiltInParameterNames(long id) =>
        BuiltInNames.Value.TryGetValue(id, out var names) ? names : [];

    /// <summary>
    ///     The labels of <paramref name="family" />, loaded in its owner document. Must run outside a transaction on that document
    ///     (EditFamily's rule). The file's own family (a family document's <c>OwnerFamily</c>) is refused: read its file instead.
    /// </summary>
    public static Result<IReadOnlyList<RfaLabel>> ReadLabels(this Family family) {
        var source = family.Document;
        if (source.IsFamilyDocument && source.OwnerFamily?.Id == family.Id)
            return new InvalidOperationException($"'{family.Name}' is this document's own family; read its .rfa with RfaLabels.Read.");
        if (!family.IsEditable)
            return new InvalidOperationException($"'{family.Name}' is not editable (in-place or system family).");

        var directory = Path.Combine(Path.GetTempPath(), "pe-rfa-labels", Guid.NewGuid().ToString("N"));
        var path = Path.Combine(directory, "family.rfa");
        var watch = Stopwatch.StartNew();
        try {
            _ = Directory.CreateDirectory(directory);
            var diagnostics = new List<(bool IsError, string Message)>();
            _ = source.ReadFamilyCopy(family, copy => {
                copy.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true, MaximumBackups = 1 });
                return true;
            }, diagnostics);
            var saved = watch.ElapsedMilliseconds;
            var result = RfaLabels.Read(path, BuiltInParameterNames);
            Log.Debug("FamilyLabels: {Family} edit+save {SaveMs} ms, read {ReadMs} ms", family.Name, saved, watch.ElapsedMilliseconds - saved);
            return result;
        } catch (Exception exception) {
            return new InvalidOperationException($"Reading the labels of '{family.Name}' failed: {exception.Message}", exception);
        } finally {
            try {
                if (Directory.Exists(directory)) Directory.Delete(directory, true);
            } catch (Exception exception) {
                Log.Warning(exception, "FamilyLabels: could not delete the temp copy {Directory}", directory);
            }
        }
    }

    /// <summary>
    ///     The labels of every family loaded in <paramref name="project" /> (or those <paramref name="family" /> selects, by name).
    ///     Reads the project file when the document is unmodified, local, and its <c>Document.GetDocumentVersion</c> equals the
    ///     file's BasicFileInfo identity; otherwise reads each family through <see cref="ReadLabels" />. A cloud model always takes
    ///     the per-family route: the API names its project and model GUIDs, not its local CollaborationCache file.
    ///     Must run outside a transaction (EditFamily's rule, for the fallback).
    /// </summary>
    public static Result<ProjectLabels> ReadFamilyLabels(this Document project, Func<string, bool>? family = null) {
        if (project.IsFamilyDocument) return new InvalidOperationException($"'{project.Title}' is a family document; read its families with Family.ReadLabels.");
        var include = family ?? (_ => true);
        var why = FileRouteRefusal(project);
        if (why == null) {
            var watch = Stopwatch.StartNew();
            var (labels, error) = RfaLabels.ReadProject(project.PathName, BuiltInParameterNames, include);
            if (error == null) {
                Log.Debug("FamilyLabels: {Project} read from its file in {Ms} ms ({Families} families)", project.Title, watch.ElapsedMilliseconds, labels!.Families.Count);
                return labels;
            }
            why = $"the project file did not read: {error.Message}";
        }
        Log.Information("FamilyLabels: {Project} read per family through EditFamily: {Why}", project.Title, why);

        var families = new List<ProjectFamilyLabels>();
        var diagnostics = new List<string> { $"per-family read: {why}" };
        foreach (var f in new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
                     .Where(f => !f.IsInPlace && f.IsEditable && include(f.Name)).OrderBy(f => f.Name, StringComparer.Ordinal)) {
            var (labels, error) = f.ReadLabels();
            if (error != null) diagnostics.Add($"Family '{f.Name}' ({f.Id.Value()}): {error.Message}");
            else families.Add(new ProjectFamilyLabels(f.Name, f.Id.Value(), null, labels!));
        }
        return new ProjectLabels(null, families, diagnostics);
    }

    /// <summary>Why the project file is not the open document's state, or null when it is.</summary>
    private static string? FileRouteRefusal(Document project) {
        if (project.IsModelInCloud) return "a cloud model (its local cache file is not reachable through the API)";
        if (project.IsModified) return "the document has unsaved changes";
        if (string.IsNullOrEmpty(project.PathName) || !File.Exists(project.PathName)) return "the document has no local file";
        var (file, error) = RfaLabels.ReadVersion(project.PathName);
        if (error != null) return $"the file's version does not read: {error.Message}";
        var open = Document.GetDocumentVersion(project);
        if (open == null) return "Revit reports no document version";
        if (open.VersionGUID != file!.VersionGuid || open.NumberOfSaves != file.Saves)
            return $"the file is version {file.VersionGuid}/{file.Saves}, the document {open.VersionGUID}/{open.NumberOfSaves}";
        return null;
    }
}
