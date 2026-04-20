using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace Pe.Dev.RevitAutomation;

public sealed class RevitAddinApprovalWatcherService {
    private const string DialogTitle = "Security - Unsigned Add-In";
    private const string AlwaysLoadAutomationId = "CommandButton_1001";
    private const int PollingIntervalMilliseconds = 200;
    private static readonly object LogLock = new();

    public async Task<int> RunAsync(int timeoutSeconds, int? revitYear, CancellationToken cancellationToken) {
        Log($"Watcher started. TimeoutSeconds={timeoutSeconds}, RevitYear={(revitYear?.ToString() ?? "any")}.");
        var timeoutUtc = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        var clickedHandles = new HashSet<int>();
        var seenHandles = new HashSet<int>();
        DateTime? lastDialogHandledUtc = null;

        while (DateTime.UtcNow < timeoutUtc && !cancellationToken.IsCancellationRequested) {
            foreach (var dialog in FindDialogs(revitYear)) {
                var handle = dialog.Current.NativeWindowHandle;
                if (handle == 0 || clickedHandles.Contains(handle))
                    continue;

                if (seenHandles.Add(handle))
                    Log($"Detected dialog handle={handle}, name=\"{SafeName(dialog)}\", processId={dialog.Current.ProcessId}.");

                if (!TryClickAlwaysLoad(dialog, out var clickDetails)) {
                    Log($"Did not click dialog handle={handle}. {clickDetails}");
                    continue;
                }

                Log($"Click attempted for dialog handle={handle}. {clickDetails}");

                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
                if (!DialogStillExists(handle, revitYear)) {
                    clickedHandles.Add(handle);
                    lastDialogHandledUtc = DateTime.UtcNow;
                    Log($"Dialog handle={handle} closed after click.");
                } else {
                    Log($"Dialog handle={handle} still exists after click attempt.");
                }
            }

            if (clickedHandles.Count > 0 && lastDialogHandledUtc.HasValue) {
                var quietPeriod = DateTime.UtcNow - lastDialogHandledUtc.Value;
                if (quietPeriod > TimeSpan.FromMilliseconds(500)) {
                    Log($"Watcher exiting after quiet period. ClickedDialogs={clickedHandles.Count}.");
                    return 0;
                }
            }

            await Task.Delay(PollingIntervalMilliseconds, cancellationToken);
        }

        if (cancellationToken.IsCancellationRequested)
            Log("Watcher cancelled.");
        else
            Log("Watcher timed out.");

        return 0;
    }

    private static IEnumerable<AutomationElement> FindDialogs(int? revitYear) {
        var condition = new PropertyCondition(AutomationElement.NameProperty, DialogTitle);
        var dialogs = AutomationElement.RootElement.FindAll(TreeScope.Descendants, condition);
        foreach (AutomationElement dialog in dialogs) {
            if (revitYear.HasValue && !DialogMatchesYear(dialog, revitYear.Value))
                continue;

            yield return dialog;
        }
    }

    private static bool DialogStillExists(int handle, int? revitYear) =>
        FindDialogs(revitYear).Any(dialog => dialog.Current.NativeWindowHandle == handle);

    private static bool DialogMatchesYear(AutomationElement dialog, int revitYear) {
        try {
            var owner = dialog.Current.ProcessId;
            using var process = System.Diagnostics.Process.GetProcessById(owner);
            var title = RevitProcessIdentityResolver.GetDisplayTitle(process);
            var resolvedYear = RevitProcessIdentityResolver.TryResolveRevitYear(process);
            var matches = resolvedYear == revitYear;
            if (!matches)
                Log($"Rejected dialog handle={dialog.Current.NativeWindowHandle} because owner identity \"{title}\" resolved to year {(resolvedYear?.ToString() ?? "unknown")} instead of {revitYear}.");
            return matches;
        } catch {
            Log($"Rejected dialog handle={dialog.Current.NativeWindowHandle} because owner process inspection failed.");
            return false;
        }
    }

    private static bool TryClickAlwaysLoad(AutomationElement dialog, out string details) {
        var button = dialog.FindFirst(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.AutomationIdProperty, AlwaysLoadAutomationId)
        );
        if (button is null) {
            details = "Always Load button not found by automation id.";
            return false;
        }

        var handle = button.Current.NativeWindowHandle;
        if (handle == 0) {
            details = $"Always Load button was found, but its native handle was 0. ButtonName=\"{SafeName(button)}\".";
            return false;
        }

        var posted = PostMessage((nint)handle, 0x00F5, IntPtr.Zero, IntPtr.Zero);
        var lastError = Marshal.GetLastWin32Error();
        details = $"ButtonHandle={handle}, ButtonName=\"{SafeName(button)}\", PostMessageResult={posted}, LastWin32Error={lastError}.";
        return posted;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private static string SafeName(AutomationElement element) {
        try {
            return element.Current.Name ?? "<null>";
        } catch (Exception ex) {
            return $"<unavailable:{ex.GetType().Name}>";
        }
    }

    private static void Log(string message) {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}{Environment.NewLine}";
        lock (LogLock)
            File.AppendAllText(DevLogPathResolver.RevitApprovalWatcherLogPath, line);
    }
}
