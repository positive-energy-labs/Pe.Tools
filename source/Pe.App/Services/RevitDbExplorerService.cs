using System.Diagnostics;
using Autodesk.Revit.UI;

namespace Pe.App.Services;

/// <summary>
///     Thin wrapper around the optional RevitDBExplorer.API package.
///     The full RevitDBExplorer add-in is expected to be installed separately.
/// </summary>
public static class RevitDbExplorerService {
    private const string ReleasesUrl = "https://github.com/NeVeSpl/RevitDBExplorer/releases/latest";

    public static bool TrySnoopObjects(
        Document? doc,
        IEnumerable<object?> objects,
        string? contextLabel = null
    ) {
        var objectList = objects
            ?.Where(static candidate => candidate != null)
            .Cast<object>()
            .ToArray() ?? [];

        if (objectList.Length == 0)
            return false;

        try {
            var controller = RevitExplorer.API.RevitExplorer.CreateController();
            controller.Snoop(doc, objectList);
            return true;
        } catch (Exception ex) when (IsKnownUnsupportedSnoopIssue(ex)) {
            ShowUnsupportedVersionDialog(contextLabel, ex.Message);
            return false;
        } catch (Exception ex) when (IsInstallOrUpgradeIssue(ex)) {
            ShowInstallDialog(contextLabel, ex.Message);
            return false;
        } catch (Exception ex) {
            ShowFailureDialog(contextLabel, ex.Message);
            return false;
        }
    }

    public static bool TrySnoopObject(
        Document? doc,
        object? obj,
        string? contextLabel = null
    ) {
        if (obj == null)
            return false;

        return TrySnoopObjects(doc, [obj], contextLabel);
    }

    private static bool IsInstallOrUpgradeIssue(Exception ex) {
        var message = ex.Message ?? string.Empty;
        return message.Contains("not available", StringComparison.OrdinalIgnoreCase)
               || message.Contains("old version", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsKnownUnsupportedSnoopIssue(Exception ex) {
        var message = ex.ToString();

        return message.Contains("APIUIDocumentProxy.cpp", StringComparison.OrdinalIgnoreCase)
               && message.Contains("Parameter name: document", StringComparison.OrdinalIgnoreCase)
               && message.Contains("RevitDBExplorer.APIAdapter.Snoop", StringComparison.OrdinalIgnoreCase);
    }

    private static void ShowInstallDialog(string? contextLabel, string details) {
        var dialog = new TaskDialog("RevitDBExplorer Required") {
            MainInstruction = "Install RevitDBExplorer to use Snoop.",
            MainContent = BuildDialogContent(
                contextLabel,
                "Pe.Tools can snoop exact objects through RevitDBExplorer when the add-in is installed separately.",
                details
            ),
            CommonButtons = TaskDialogCommonButtons.Close,
            DefaultButton = TaskDialogResult.Close,
            TitleAutoPrefix = false
        };
        dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Open RevitDBExplorer Releases");

        if (dialog.Show() == TaskDialogResult.CommandLink1)
            OpenReleasesPage();
    }

    private static void ShowFailureDialog(string? contextLabel, string details) {
        var dialog = new TaskDialog("RevitDBExplorer Error") {
            MainInstruction = "Pe.Tools could not open RevitDBExplorer.",
            MainContent = BuildDialogContent(
                contextLabel,
                "RevitDBExplorer is installed separately, but the handoff failed.",
                details
            ),
            CommonButtons = TaskDialogCommonButtons.Close,
            DefaultButton = TaskDialogResult.Close,
            TitleAutoPrefix = false
        };
        dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Open RevitDBExplorer Releases");

        if (dialog.Show() == TaskDialogResult.CommandLink1)
            OpenReleasesPage();
    }

    private static void ShowUnsupportedVersionDialog(string? contextLabel, string details) {
        var dialog = new TaskDialog("RevitDBExplorer Upgrade Required") {
            MainInstruction = "This RevitDBExplorer version does not support snooping from Pe.Tools.",
            MainContent = BuildDialogContent(
                contextLabel,
                "RevitDBExplorer 2.5.0 and below cannot snoop objects handed off from Pe.Tools. Please install a newer RevitDBExplorer release.",
                details
            ),
            CommonButtons = TaskDialogCommonButtons.Close,
            DefaultButton = TaskDialogResult.Close,
            TitleAutoPrefix = false
        };
        dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Open RevitDBExplorer Releases");

        if (dialog.Show() == TaskDialogResult.CommandLink1)
            OpenReleasesPage();
    }

    private static string BuildDialogContent(
        string? contextLabel,
        string summary,
        string details
    ) {
        var scopedContext = string.IsNullOrWhiteSpace(contextLabel)
            ? string.Empty
            : $"Requested item: {contextLabel}{Environment.NewLine}{Environment.NewLine}";

        return $"{summary}{Environment.NewLine}{Environment.NewLine}"
               + scopedContext
               + $"Details: {details}{Environment.NewLine}{Environment.NewLine}"
               + $"Latest release: {ReleasesUrl}";
    }

    private static void OpenReleasesPage() {
        try {
            _ = Process.Start(new ProcessStartInfo(ReleasesUrl) { UseShellExecute = true });
        } catch {
            // If the browser handoff fails, the TaskDialog already shows the release URL.
        }
    }
}
