namespace Pe.Shared.RevitData;

/// <summary>
///     Request for revit.apply.command.execute. Provide SearchText to discover commands
///     (no execution), or CommandId to post a command — the same discovery and PostCommand
///     machinery as the command palette.
/// </summary>
public record RibbonCommandExecuteRequest(
    string? CommandId = null,
    string? SearchText = null,
    int MaxMatches = 20
);

public record RibbonCommandInfo(
    string Id,
    string Name,
    string? Paths,
    string? Shortcut,
    bool CanExecute
);

public record RibbonCommandExecuteData(
    bool Posted,
    RibbonCommandInfo? Executed,
    List<RibbonCommandInfo> Matches,
    string? Message
);
