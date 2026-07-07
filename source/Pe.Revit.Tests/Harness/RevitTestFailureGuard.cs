using Autodesk.Revit.DB.Events;
using Pe.Revit.Utils;

namespace Pe.Revit.Tests;

/// <summary>
///     Process-wide default failure silencing for Revit tests. ricaun.RevitTest only cancels two startup dialogs
///     (its DialogBoxResolver detaches at ApplicationInitialized), so a warning raised by a committing transaction
///     would otherwise pop a modal failures dialog and hang the test run. Installed once per test process from the
///     fixture-harness document entry points; suppressed failures are echoed to the test console.
/// </summary>
internal static class RevitTestFailureGuard {
    private static bool _installed;

    public static void EnsureInstalled(Application application) {
        if (_installed)
            return;

        _installed = true;
        application.FailuresProcessing += OnFailuresProcessing;
    }

    private static void OnFailuresProcessing(object? _, FailuresProcessingEventArgs args) {
        var accessor = args.GetFailuresAccessor();
        if (accessor == null)
            return;

        var diagnostics = new List<(bool IsError, string Message)>();
        var result = RevitFailureHandling.ResolveFailures(accessor, diagnostics);
        foreach (var (_, message) in diagnostics)
            Console.WriteLine($"[{nameof(RevitTestFailureGuard)}] {message}");

        args.SetProcessingResult(result);
    }
}
