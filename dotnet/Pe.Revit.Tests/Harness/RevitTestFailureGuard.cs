using Autodesk.Revit.DB.Events;
using Pe.Revit.Failures;

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

    private static bool _suspended;

    /// <summary>Lets a test see what product failure handling does alone: while suspended, this guard does not touch failures.</summary>
    public static IDisposable Suspend() {
        _suspended = true;
        return new Resume();
    }

    private sealed class Resume : IDisposable {
        public void Dispose() => _suspended = false;
    }

    private static void OnFailuresProcessing(object? _, FailuresProcessingEventArgs args) {
        if (_suspended)
            return;
        var accessor = args.GetFailuresAccessor();
        if (accessor == null)
            return;

        var diagnostics = new List<(bool IsError, string Message)>();
        var result = PeToolsFailureHandling.RejectErrors(accessor, diagnostics);
        foreach (var (_, message) in diagnostics)
            Console.WriteLine($"[{nameof(RevitTestFailureGuard)}] {message}");

        if (result == FailureProcessingResult.ProceedWithRollBack)
            accessor.SetFailureHandlingOptions(accessor.GetFailureHandlingOptions().SetClearAfterRollback(true));
        args.SetProcessingResult(result);
    }
}
