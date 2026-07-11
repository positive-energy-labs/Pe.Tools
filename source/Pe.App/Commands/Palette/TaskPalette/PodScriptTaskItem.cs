using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Scripting;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette.TaskPalette;

/// <summary>
///     A pod entrypoint surfaced as a palette item. Unlike compiled <see cref="ITask" />s,
///     these come from user-authored scripting workspaces (pod.json) and run through the
///     scripting pipeline: policy analysis, compilation, and a host-owned transaction/rollback guard.
/// </summary>
public sealed class PodScriptTaskItem : IPaletteListItem {
    public required string WorkspaceKey { get; init; }
    public required string PodName { get; init; }
    public required ScriptPodEntrypointData Entrypoint { get; init; }

    public string Id => $"pod:{this.WorkspaceKey}:{this.Entrypoint.Id}";

    public string TextPrimary => this.Entrypoint.Name ?? this.Entrypoint.Id;
    public string TextSecondary => this.Entrypoint.Description ?? this.Entrypoint.SourcePath;
    public string? TextPill => this.PodName;
    public Func<string> GetTextInfo => () =>
        $"Pod: {this.PodName} ({this.WorkspaceKey})\nSource: {this.Entrypoint.SourcePath}" +
        (string.IsNullOrWhiteSpace(this.Entrypoint.Description)
            ? string.Empty
            : $"\n\n{this.Entrypoint.Description}");
    public BitmapImage? Icon => null;
    public Color? ItemColor => null;
}
