namespace Pe.Shared.RevitData;

/// <summary>Request for revit.context.journal: read the tail of the journal Revit is recording for this session.</summary>
/// <param name="MaxLines">Most rows to answer. Default 200, capped at 2000.</param>
/// <param name="AfterLine">0-based index of the last line already seen; answers the rows after it, oldest first, so a page can poll. Omit for the newest rows.</param>
/// <param name="Kinds">Keep only these kinds: command, dialog, error, transaction, other. Omit for every kind.</param>
public record RevitJournalTailRequest(
    int? MaxLines = null,
    int? AfterLine = null,
    List<string>? Kinds = null
);

/// <summary>One journal line Revit wrote.</summary>
/// <param name="Line">0-based index of the line in the journal file; pass as afterLine to read past it.</param>
/// <param name="At">The journal timestamp on this line (its `dd-MMM-yyyy HH:mm:ss.fff` text) when it has one, else null.</param>
/// <param name="Kind">command, dialog, error, transaction, or other, by the line's prefix.</param>
/// <param name="Text">The line, trimmed.</param>
public record RevitJournalRow(
    int Line,
    string? At,
    string Kind,
    string Text
);

/// <summary>What revit.context.journal read.</summary>
/// <param name="Path">The journal file Revit is recording to.</param>
/// <param name="TotalLines">Lines in the file at read time; the newest index is TotalLines - 1.</param>
/// <param name="Rows">The matching lines, oldest first, blank lines dropped.</param>
public record RevitJournalTailData(
    string Path,
    int TotalLines,
    List<RevitJournalRow> Rows
);

/// <summary>One warning the document holds, as Revit's Review Warnings dialog lists it.</summary>
/// <param name="Severity">Revit's severity name: Warning, Error, or DocumentCorruption.</param>
/// <param name="Description">The warning text.</param>
/// <param name="ElementIds">Ids of the elements the warning is about.</param>
/// <param name="AdditionalElementIds">Ids of elements Revit lists alongside, such as the other side of a join or overlap.</param>
public record RevitWarningRow(
    string Severity,
    string Description,
    List<long> ElementIds,
    List<long> AdditionalElementIds
);

/// <summary>What revit.catalog.warnings read.</summary>
/// <param name="Count">How many warnings the document holds.</param>
/// <param name="Rows">Every warning, in the order Revit reports them.</param>
public record RevitWarningsListData(
    int Count,
    List<RevitWarningRow> Rows
);
