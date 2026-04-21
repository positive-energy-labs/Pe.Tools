using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Pe.Dev.RevitAutomation;

public sealed class RiderHotReloadService(
    RevitProcessSessionSelector sessionSelector,
    RiderRecentOpenCache recentOpenCache
) {
    private static readonly Regex RestartLikelyRegex = new(
        @"^[\+\-]\s*(\[[^\]]+\]\s*)*(public|internal|protected|private|file)?\s*(sealed|abstract|static|partial|readonly|unsafe|new|\s)*\s*(class|record|interface|enum|struct|delegate)\b|^[\+\-].*\)\s*(?:=>|{|;)\s*$",
        RegexOptions.Compiled | RegexOptions.Multiline
    );

    private readonly RevitProcessSessionSelector _sessionSelector = sessionSelector;
    private readonly RiderRecentOpenCache _recentOpenCache = recentOpenCache;

    public async Task<RevitHotReloadResult> RunAsync(string repoRoot, CancellationToken cancellationToken) {
        try {
            var session = this._sessionSelector.SelectNewestVisibleSession();
            if (session is null)
                return new RevitHotReloadResult(RevitHotReloadResultKind.NoSession, "No Revit sessions found.", []);

            var dirtyFiles = await this.GetDirtyRuntimeFilesAsync(repoRoot, cancellationToken);
            var filesToOpen = this.GetFilesToOpen(dirtyFiles, session);
            var riderExecutable = TryResolveRiderExecutable()
                                  ?? throw new InvalidOperationException("Could not locate rider64.exe.");
            var autoHotkeyExecutable = TryResolveAutoHotkeyExecutable()
                                       ?? throw new InvalidOperationException(
                                           "Could not locate AutoHotkey64.exe."
                                       );
            var ahkScriptPath = this.ResolveHotReloadScriptPath();

            await this.OpenFilesInRiderAsync(riderExecutable, repoRoot, filesToOpen, session, cancellationToken);
            await this.TriggerHotReloadAsync(autoHotkeyExecutable, ahkScriptPath, dirtyFiles, cancellationToken);

            var restartRequiredLikely = await this.IsRestartRequiredLikelyAsync(repoRoot, dirtyFiles, cancellationToken);
            var dirtySummary = dirtyFiles.Count == 0
                ? "No dirty runtime .cs files were detected, but Auto HR was still triggered."
                : $"Hot reload was triggered for {dirtyFiles.Count} runtime file(s) against selected session PID {session.ProcessId}.";
            return restartRequiredLikely
                ? new RevitHotReloadResult(
                    RevitHotReloadResultKind.RestartRequiredLikely,
                    "Hot reload was triggered, but the dirty set includes likely restart-required shape changes. The live runtime may still be stale.",
                    dirtyFiles,
                    session
                )
                : new RevitHotReloadResult(
                    RevitHotReloadResultKind.Triggered,
                    dirtySummary,
                    dirtyFiles,
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

    private async Task<IReadOnlyList<string>> GetDirtyRuntimeFilesAsync(string repoRoot, CancellationToken cancellationToken) {
        var output = await RunProcessCaptureAsync(
            "git",
            ["-C", repoRoot, "status", "--porcelain", "--untracked-files=all"],
            cancellationToken
        );

        if (output.ExitCode != 0)
            throw new InvalidOperationException(output.StandardError.Trim());

        return output.StandardOutput
            .Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries)
            .Select(ParsePorcelainPath)
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Where(path => path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase))
            .Select(path => Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(repoRoot, path)))
            .Where(File.Exists)
            .Where(path => !IsTestPath(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private IReadOnlyList<string> GetFilesToOpen(IReadOnlyList<string> dirtyFiles, RevitProcessSessionIdentity session) {
        var cacheEntries = this._recentOpenCache.Load();
        var cutoffUtc = DateTime.UtcNow.AddMinutes(-15);
        var filesToOpen = dirtyFiles
            .Where(path => !cacheEntries.TryGetValue(path, out var cacheEntry)
                           || cacheEntry.LastOpenedUtc < cutoffUtc
                           || cacheEntry.RevitPid != session.ProcessId
                           || cacheEntry.RevitStartUtc != session.ProcessStartUtc)
            .ToArray();

        if (filesToOpen.Length == 0)
            return [];

        var updatedEntries = new Dictionary<string, RiderRecentOpenCacheEntry>(cacheEntries, StringComparer.OrdinalIgnoreCase);
        var openedAtUtc = DateTime.UtcNow;
        foreach (var file in filesToOpen) {
            updatedEntries[file] = new RiderRecentOpenCacheEntry(
                file,
                openedAtUtc,
                session.ProcessId,
                session.ProcessStartUtc
            );
        }

        this._recentOpenCache.Save(updatedEntries);
        return filesToOpen;
    }

    private async Task OpenFilesInRiderAsync(
        string riderExecutable,
        string repoRoot,
        IReadOnlyList<string> filesToOpen,
        RevitProcessSessionIdentity session,
        CancellationToken cancellationToken
    ) {
        foreach (var file in filesToOpen) {
            using var process = Process.Start(
                new ProcessStartInfo {
                    FileName = riderExecutable,
                    UseShellExecute = true,
                    ArgumentList = { repoRoot, file }
                }
            );
            if (process is null)
                throw new InvalidOperationException($"Failed to open '{file}' in Rider.");

            await Task.Delay(500, cancellationToken);
        }
    }

    private async Task TriggerHotReloadAsync(
        string autoHotkeyExecutable,
        string ahkScriptPath,
        IReadOnlyList<string> dirtyFiles,
        CancellationToken cancellationToken
    ) {
        var artifactPath = Path.Combine(Path.GetTempPath(), "pe-rider-hot-reload-files.txt");
        await File.WriteAllLinesAsync(artifactPath, dirtyFiles, cancellationToken);

        var result = await RunProcessCaptureAsync(
            autoHotkeyExecutable,
            [ahkScriptPath, artifactPath, "0", "1"],
            cancellationToken,
            useShellExecute: false
        );
        if (result.ExitCode != 0)
            throw new InvalidOperationException(
                string.IsNullOrWhiteSpace(result.StandardError)
                    ? $"AutoHotkey exited with code {result.ExitCode}."
                    : result.StandardError.Trim()
            );
    }

    private async Task<bool> IsRestartRequiredLikelyAsync(
        string repoRoot,
        IReadOnlyList<string> dirtyFiles,
        CancellationToken cancellationToken
    ) {
        foreach (var file in dirtyFiles) {
            var relativePath = Path.GetRelativePath(repoRoot, file);
            var diffResult = await RunProcessCaptureAsync(
                "git",
                ["-C", repoRoot, "diff", "--unified=0", "--", relativePath],
                cancellationToken
            );

            if (diffResult.ExitCode == 0 && RestartLikelyRegex.IsMatch(diffResult.StandardOutput))
                return true;

            if (!string.IsNullOrWhiteSpace(diffResult.StandardOutput))
                continue;

            var content = await File.ReadAllTextAsync(file, cancellationToken);
            if (Regex.IsMatch(content, @"\b(class|record|interface|enum|struct|delegate)\b"))
                return true;
        }

        return false;
    }

    private string ResolveHotReloadScriptPath() {
        var baseDirectory = AppContext.BaseDirectory;
        var assetPath = Path.Combine(baseDirectory, "Assets", "AutoApplyRiderHotReload.ahk");
        if (File.Exists(assetPath))
            return assetPath;

        throw new InvalidOperationException($"Hot reload AHK script was not found at '{assetPath}'.");
    }

    private static bool IsTestPath(string path) {
        var segments = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(segment => segment.Contains("test", StringComparison.OrdinalIgnoreCase));
    }

    private static string ParsePorcelainPath(string line) {
        var trimmed = line.Length >= 4 ? line[3..].Trim() : line.Trim();
        var renameSeparatorIndex = trimmed.IndexOf(" -> ", StringComparison.Ordinal);
        return renameSeparatorIndex >= 0
            ? trimmed[(renameSeparatorIndex + 4)..].Trim()
            : trimmed;
    }

    private static string? TryResolveRiderExecutable() {
        const string defaultPath = @"C:\Program Files\JetBrains\JetBrains Rider 2025.2\bin\rider64.exe";
        if (File.Exists(defaultPath))
            return defaultPath;

        var jetBrainsRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "JetBrains"
        );
        if (!Directory.Exists(jetBrainsRoot))
            return null;

        return Directory.EnumerateFiles(jetBrainsRoot, "rider64.exe", SearchOption.AllDirectories)
            .OrderByDescending(path => path, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
    }

    private static string? TryResolveAutoHotkeyExecutable() {
        const string defaultPath = @"C:\Program Files\AutoHotkey\v2\AutoHotkey64.exe";
        return File.Exists(defaultPath) ? defaultPath : null;
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

// KAI_HR_NUDGE
