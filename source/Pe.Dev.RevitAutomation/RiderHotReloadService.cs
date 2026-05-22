using System.Diagnostics;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class RiderHotReloadService(RevitProcessSessionSelector sessionSelector) {
    private const int DefaultWarningSeconds = 3;
    private const string SignalFileRelativePath = @"source\Pe.Revit.Global\HotReload\PeHotReloadSignal.cs";

    private readonly RevitProcessSessionSelector _sessionSelector = sessionSelector;

    public async Task<RevitHotReloadResult> RunAsync(string repoRoot, CancellationToken cancellationToken) =>
        await this.RunAsync(repoRoot, null, cancellationToken);

    public async Task<RevitHotReloadResult> RunAsync(
        string repoRoot,
        int? revitYear,
        CancellationToken cancellationToken
    ) {
        try {
            var session = this._sessionSelector.SelectNewestVisibleSession(revitYear);
            if (session is null)
                return new RevitHotReloadResult(RevitHotReloadResultKind.NoSession, "No Revit sessions found.", []);

            var signalFilePath = ResolveSignalFilePath(repoRoot);
            var riderExecutable = TryResolveRiderExecutable()
                                  ?? throw new InvalidOperationException("Could not locate rider64.exe or rider.exe.");
            var autoHotkeyExecutable = TryResolveAutoHotkeyExecutable()
                                       ?? throw new InvalidOperationException("Could not locate AutoHotkey64.exe.");
            var ahkScriptPath = this.ResolveHotReloadScriptPath();

            await MutateSignalFileAsync(signalFilePath, cancellationToken);
            await OpenSignalFileInRiderAsync(riderExecutable, signalFilePath, cancellationToken);
            await this.TriggerHotReloadActionsAsync(autoHotkeyExecutable, ahkScriptPath, cancellationToken);

            return new RevitHotReloadResult(
                RevitHotReloadResultKind.Triggered,
                $"Rider reload/apply actions completed against selected session PID {session.ProcessId} using signal file '{Path.GetRelativePath(repoRoot, signalFilePath)}'. Rider may still report restart-required changes asynchronously.",
                [],
                session
            );
        } catch (Exception ex) {
            return new RevitHotReloadResult(
                RevitHotReloadResultKind.Failed,
                $"Hot reload failed: {ex.Message}",
                []
            );
        }
    }

    private static string ResolveSignalFilePath(string repoRoot) {
        var path = Path.GetFullPath(Path.Combine(repoRoot, SignalFileRelativePath));
        if (!File.Exists(path))
            throw new InvalidOperationException($"Hot reload signal file was not found at '{path}'.");
        return path;
    }

    private static async Task MutateSignalFileAsync(string signalFilePath, CancellationToken cancellationToken) {
        var original = await File.ReadAllTextAsync(signalFilePath, cancellationToken);
        var stamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        var updated = ReplaceSignalValue(original, stamp);
        if (string.Equals(original, updated, StringComparison.Ordinal))
            updated = original.TrimEnd() + $"\r\n// PE_HOT_RELOAD_SIGNAL {stamp}\r\n";
        await File.WriteAllTextAsync(signalFilePath, updated, cancellationToken);
    }

    private static string ReplaceSignalValue(string content, string value) {
        const string propertyPrefix = "internal static string Value { get; } = \"";
        var start = content.IndexOf(propertyPrefix, StringComparison.Ordinal);
        if (start < 0)
            return content;

        var valueStart = start + propertyPrefix.Length;
        var valueEnd = content.IndexOf('"', valueStart);
        if (valueEnd < 0)
            return content;

        return content[..valueStart] + value + content[valueEnd..];
    }

    private static async Task OpenSignalFileInRiderAsync(
        string riderExecutable,
        string signalFilePath,
        CancellationToken cancellationToken
    ) {
        var startInfo = new ProcessStartInfo {
            FileName = riderExecutable,
            UseShellExecute = true
        };
        startInfo.ArgumentList.Add(signalFilePath);

        using var process = Process.Start(startInfo)
                            ?? throw new InvalidOperationException($"Failed to start '{riderExecutable}'.");
        await Task.Delay(TimeSpan.FromSeconds(3), cancellationToken);
    }

    private async Task TriggerHotReloadActionsAsync(
        string autoHotkeyExecutable,
        string ahkScriptPath,
        CancellationToken cancellationToken
    ) {
        var result = await RunProcessCaptureAsync(
            autoHotkeyExecutable,
            [ahkScriptPath, DefaultWarningSeconds.ToString(), "0"],
            cancellationToken,
            false
        );
        if (result.ExitCode != 0) {
            throw new InvalidOperationException(
                string.IsNullOrWhiteSpace(result.StandardError)
                    ? $"AutoHotkey exited with code {result.ExitCode}."
                    : result.StandardError.Trim()
            );
        }
    }

    private string ResolveHotReloadScriptPath() {
        var baseDirectory = AppContext.BaseDirectory;
        var assetPath = Path.Combine(baseDirectory, "Assets", "AutoApplyRiderHotReload.ahk");
        if (File.Exists(assetPath))
            return assetPath;

        throw new InvalidOperationException($"Hot reload AHK script was not found at '{assetPath}'.");
    }

    private static string? TryResolveAutoHotkeyExecutable() {
        const string defaultPath = @"C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe";
        return File.Exists(defaultPath) ? defaultPath : null;
    }

    private static string? TryResolveRiderExecutable() {
        var candidates = new[] {
            "rider64.exe",
            "rider.exe",
            @"C:\Program Files\JetBrains\JetBrains Rider 2025.2\bin\rider64.exe",
            @"C:\Program Files\JetBrains\JetBrains Rider 2025.1\bin\rider64.exe",
            @"C:\Program Files\JetBrains\JetBrains Rider 2024.3\bin\rider64.exe"
        };

        foreach (var candidate in candidates) {
            if (Path.IsPathRooted(candidate)) {
                if (File.Exists(candidate))
                    return candidate;
                continue;
            }

            if (TryResolveFromPath(candidate) is { } path)
                return path;
        }

        return null;
    }

    private static string? TryResolveFromPath(string executableName) {
        var pathValue = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrWhiteSpace(pathValue))
            return null;

        foreach (var directory in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)) {
            try {
                var candidate = Path.Combine(directory.Trim(), executableName);
                if (File.Exists(candidate))
                    return candidate;
            } catch {
            }
        }

        return null;
    }

    private static async Task<ProcessCaptureResult> RunProcessCaptureAsync(
        string fileName,
        IReadOnlyList<string> arguments,
        CancellationToken cancellationToken,
        bool useShellExecute = false
    ) {
        var startInfo = new ProcessStartInfo {
            FileName = fileName,
            RedirectStandardOutput = !useShellExecute,
            RedirectStandardError = !useShellExecute,
            UseShellExecute = useShellExecute,
            CreateNoWindow = !useShellExecute
        };
        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
            throw new InvalidOperationException($"Failed to start '{fileName}'.");

        if (useShellExecute) {
            await process.WaitForExitAsync(cancellationToken);
            return new ProcessCaptureResult(process.ExitCode, string.Empty, string.Empty);
        }

        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        return new ProcessCaptureResult(process.ExitCode, await stdoutTask, await stderrTask);
    }

    private readonly record struct ProcessCaptureResult(int ExitCode, string StandardOutput, string StandardError);
}
