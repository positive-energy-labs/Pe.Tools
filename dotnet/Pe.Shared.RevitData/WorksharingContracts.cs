namespace Pe.Shared.RevitData;

/// <summary>
///     What a model write will borrow on a workshared central. Present only on workshared documents. A commit borrows
///     every element it changes that the user does not already own, and they stay borrowed until the user syncs with
///     central or relinquishes; a write never syncs. Creates names model-wide definitions the write adds (new elements
///     the user owns until sync).
/// </summary>
public sealed record WorksharingDisclosure(bool Cloud, IReadOnlyList<WorksharedElement> Elements, IReadOnlyList<string> Creates);

/// <summary>Status: borrows (free now; the commit borrows it), owned (already yours), blocked (Owner holds it; the write is refused by Revit).</summary>
public sealed record WorksharedElement(long Id, string Name, string Status, string? Owner);
