using System.Diagnostics;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public sealed class RiderHotReloadService(RevitProcessSessionSelector sessionSelector) {
    private const int DefaultWarningSeconds = 3;

    private readonly RevitProcessSessionSelector _sessionSelector = sessionSelector;

    public async Task<RevitHotReloadResult> RunAsync(string repoRoot, CancellationToken cancellationToken) {
        try {
            var session = this._sessionSelector.SelectNewestVisibleSession();
            if (session is null)
                return new RevitHotReloadResult(RevitHotReloadResultKind.NoSession, "No Revit sessions found.", []);

            var unstagedFiles = await this.GetUnstagedRuntimeFilesAsync(repoRoot, cancellationToken);
            var autoHotkeyExecutable = TryResolveAutoHotkeyExecutable()
                                       ?? throw new InvalidOperationException(
                                           "Could not locate AutoHotkey64.exe."
                                       );
            var ahkScriptPath = this.ResolveHotReloadScriptPath();

            await this.TriggerHotReloadAsync(autoHotkeyExecutable, ahkScriptPath, unstagedFiles, cancellationToken);

            var message = unstagedFiles.Count == 0
                ? $"Auto HR was triggered against selected session PID {session.ProcessId}. No unstaged runtime .cs files were nudged."
                : $"Auto HR was triggered against selected session PID {session.ProcessId} after nudging {unstagedFiles.Count} unstaged runtime file(s).";

            return new RevitHotReloadResult(
                RevitHotReloadResultKind.Triggered,
                message,
                unstagedFiles,
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

    private async Task<IReadOnlyList<string>> GetUnstagedRuntimeFilesAsync(string repoRoot,
        CancellationToken cancellationToken) {
        var output = await RunProcessCaptureAsync(
            "git",
            ["-C", repoRoot, "status", "--porcelain", "--untracked-files=all"],
            cancellationToken
        );

        if (output.ExitCode != 0)
            throw new InvalidOperationException(output.StandardError.Trim());

        return RiderHotReloadFileDiscovery.ParseUnstagedRuntimeFiles(repoRoot, output.StandardOutput);
    }

    private async Task TriggerHotReloadAsync(
        string autoHotkeyExecutable,
        string ahkScriptPath,
        IReadOnlyList<string> unstagedFiles,
        CancellationToken cancellationToken
    ) {
        var artifactPath = Path.Combine(Path.GetTempPath(), $"pe-rider-hot-reload-files-{Guid.NewGuid():N}.txt");

        try {
            await File.WriteAllLinesAsync(artifactPath, unstagedFiles, cancellationToken);

            var result = await RunProcessCaptureAsync(
                autoHotkeyExecutable,
                [ahkScriptPath, artifactPath, DefaultWarningSeconds.ToString(), "0"],
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
        } finally {
            TryDeleteFile(artifactPath);
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

    private static void TryDeleteFile(string path) {
        try {
            if (File.Exists(path))
                File.Delete(path);
        } catch {
        }
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