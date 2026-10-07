using Autodesk.Revit.DB;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData;
using System.Text.RegularExpressions;
using RevitDocument = Pe.Revit.Operations.RevitDocument;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Read-only ops over the two records Revit keeps of what went wrong or what the person did: the session
///     journal and the document's review warnings. Static, so <see cref="OpRegistry.RegisterFromLoadedPeAssemblies" />
///     finds them without a handler instance.
/// </summary>
internal static class RevitJournalOps {
    private const int DefaultMaxLines = 200;
    private const int MaxLinesCap = 2000;

    // Journal timestamps look like `' C 05-Oct-2026 12:14:41.123;` and sit on comment lines or ahead of a Jrn.* call.
    private static readonly Regex JournalStamp = new(@"\b\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2}\.\d{3}\b", RegexOptions.Compiled);

    // Kind by line shape, first match wins; a line that fits none is `other`.
    private static readonly (string Kind, Func<string, bool> Matches)[] JournalKinds = [
        ("error", line => line.Contains("Error dialog", StringComparison.Ordinal)),
        ("command", line => line.StartsWith("Jrn.Command", StringComparison.Ordinal)),
        ("dialog", line => line.StartsWith("Jrn.Data \"TaskDialogResult\"", StringComparison.Ordinal)
                           || line.StartsWith("Jrn.PushButton", StringComparison.Ordinal)
                           || line.Contains("'CommonButtons", StringComparison.Ordinal)),
        ("transaction", line => line.StartsWith("Jrn.Data \"Transaction", StringComparison.Ordinal)),
    ];

    private static readonly string[] KnownKinds = [.. JournalKinds.Select(k => k.Kind), "other"];

    [Op("revit.context.journal", Does = "Read the tail of the journal Revit is recording for this session: the only record of what the person did in the UI (ribbon commands, dialog answers, error dialogs, transactions). Each row carries its line index, timestamp when present, and kind. Pass afterLine to poll for lines past the last one seen; pass kinds to keep only commands, dialogs, errors or transactions.", Title = "Journal Tail", Finds = ["journal", "tail", "log", "history", "commands", "dialogs", "errors", "what-happened", "user-did"], Cost = OpCost.Bounded, Actor = OpActor.Any, Tier = OpTier.Default, Thread = OpThread.Revit, Example = "{ \"maxLines\": 100, \"kinds\": [\"command\", \"error\"] }")]
    private static RevitJournalTailData JournalTail(RevitJournalTailRequest request) {
        var maxLines = Math.Max(1, Math.Min(request.MaxLines ?? DefaultMaxLines, MaxLinesCap));
        var kinds = (request.Kinds ?? []).Select(k => k.Trim().ToLowerInvariant()).Distinct().ToList();
        var unknown = kinds.Except(KnownKinds).ToList();
        if (unknown.Count != 0)
            throw BridgeOperationExceptions.BadRequest("Unknown journal kind.",
                [BridgeOperationExceptions.Issue("$.kinds", "UnknownKind",
                    $"No such kind: {string.Join(", ", unknown)}.",
                    $"Use any of {string.Join(", ", KnownKinds)}.")]);

        var path = RevitUiSession.CurrentUIApplication.Application.RecordingJournalFilename;
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            throw BridgeOperationExceptions.Conflict("Revit is not recording a journal.",
                [BridgeOperationExceptions.Issue("$", "JournalMissing",
                    $"RecordingJournalFilename is '{path}', which does not exist.",
                    "Revit normally records a journal under %LOCALAPPDATA%\\Autodesk\\Revit\\<version>\\Journals; check the session.")]);

        var lines = ReadSharedLines(path);
        var rows = lines
            .Select((text, index) => (Index: index, Text: text.Trim()))
            .Where(line => line.Text.Length != 0)
            .Where(line => request.AfterLine is not { } after || line.Index > after)
            .Select(line => new RevitJournalRow(line.Index, JournalStamp.Match(line.Text) is { Success: true } m ? m.Value : null, Classify(line.Text), line.Text))
            .Where(row => kinds.Count == 0 || kinds.Contains(row.Kind));
        var page = request.AfterLine is null ? rows.TakeLast(maxLines) : rows.Take(maxLines);
        return new RevitJournalTailData(path, lines.Count, page.ToList());
    }

    private static string Classify(string line) =>
        JournalKinds.FirstOrDefault(kind => kind.Matches(line)).Kind ?? "other";

    // Revit holds the journal open for writing; share both ways or the open fails.
    private static List<string> ReadSharedLines(string path) {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var reader = new StreamReader(stream);
        var lines = new List<string>();
        while (reader.ReadLine() is { } line)
            lines.Add(line);
        return lines;
    }

    [Op("revit.catalog.warnings", Does = "List the document's review warnings as Revit's Review Warnings dialog shows them: severity, text, the elements each is about, and the elements listed alongside. Read-only.", Title = "List Warnings", Finds = ["warnings", "review", "errors", "failures", "overlap", "join", "health"], Cost = OpCost.Bounded, Actor = OpActor.Any, Tier = OpTier.Default, Example = "{}")]
    private static RevitWarningsListData WarningsList(NoRequest request, RevitDocument activeDocument) {
        var rows = activeDocument.Value.GetWarnings()
            .Select(warning => new RevitWarningRow(
                warning.GetSeverity().ToString(),
                warning.GetDescriptionText(),
                warning.GetFailingElements().Select(id => id.Value()).ToList(),
                warning.GetAdditionalElements().Select(id => id.Value()).ToList()))
            .ToList();
        return new RevitWarningsListData(rows.Count, rows);
    }
}
