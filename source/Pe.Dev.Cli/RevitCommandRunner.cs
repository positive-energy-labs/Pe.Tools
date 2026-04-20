namespace Pe.Dev.Cli;

internal static class RevitCommandRunner
{
    public static Task<int> RunAsync(CliOptions options, RepoLayout repoLayout, CancellationToken cancellationToken) =>
        options.CommandKind switch
        {
            RevitCommandKind.HotReload => PowerShellScriptRunner.RunForegroundAsync(
                repoLayout.RevitTestPrepareHotReloadScript,
                options.ForwardedArguments,
                cancellationToken
            ),
            RevitCommandKind.ApproveAppAddin => PowerShellScriptRunner.RunForegroundAsync(
                repoLayout.AppAutoApproveScript,
                options.ForwardedArguments,
                cancellationToken
            ),
            RevitCommandKind.ApproveTestAddin => PowerShellScriptRunner.RunForegroundAsync(
                repoLayout.RevitTestAutoApproveScript,
                options.ForwardedArguments,
                cancellationToken
            ),
            RevitCommandKind.Logs => Task.FromResult(RunLogs(options.ForwardedArguments)),
            RevitCommandKind.AppPostBuild => Task.FromResult(RunAppPostBuild(repoLayout, options.ForwardedArguments)),
            RevitCommandKind.TestsPostBuild => RunTestsPostBuildAsync(repoLayout, options.ForwardedArguments, cancellationToken),
            _ => Task.FromResult(10)
        };

    private static int RunLogs(IReadOnlyList<string> forwardedArguments)
    {
        RevitLogOptions options;
        try
        {
            options = RevitLogOptions.Parse(forwardedArguments);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        foreach (var (label, filePath) in options.ResolveLogFiles())
        {
            if (options.PrintPathsOnly)
            {
                Console.WriteLine($"{label}: {filePath}");
                continue;
            }

            Console.WriteLine($"== {label} log ==");
            Console.WriteLine(filePath);

            var lines = File.Exists(filePath)
                ? File.ReadAllLines(filePath)
                : [];
            var startIndex = Math.Max(0, lines.Length - options.TailLineCount);
            if (lines.Length == 0)
            {
                Console.WriteLine("(empty)");
            }
            else
            {
                for (var i = startIndex; i < lines.Length; i++)
                    Console.WriteLine(lines[i]);
            }

            Console.WriteLine();
        }

        return 0;
    }

    private static int RunAppPostBuild(RepoLayout repoLayout, IReadOnlyList<string> forwardedArguments)
    {
        AppPostBuildOptions options;
        try
        {
            options = AppPostBuildOptions.Parse(forwardedArguments, repoLayout.AppDirectory);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var logFilePath = Path.Combine(options.ScriptDirectory, "AutoApproveAddin.log");
        var launchResult = PowerShellScriptRunner.StartBackground(
            repoLayout.AppAutoApproveScript,
            [
                "-TimeoutSeconds", options.TimeoutSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "-LogFile", logFilePath,
                "-ScriptDirectory", options.ScriptDirectory
            ]
        );

        if (!launchResult.Success)
        {
            Console.Error.WriteLine(launchResult.Message);
            return launchResult.ExitCode;
        }

        Console.WriteLine(launchResult.Message);
        return 0;
    }

    private static async Task<int> RunTestsPostBuildAsync(
        RepoLayout repoLayout,
        IReadOnlyList<string> forwardedArguments,
        CancellationToken cancellationToken
    )
    {
        TestsPostBuildOptions options;
        try
        {
            options = TestsPostBuildOptions.Parse(forwardedArguments, repoLayout.RevitTestsDirectory);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        if (!HasMatchingRevitSession(options.RevitYear))
        {
            Console.WriteLine(
                $"Skipping Rider hot reload prep and add-in auto-approval because no Revit {options.RevitYear} session is running."
            );
            return 0;
        }

        Console.WriteLine("Running Rider hot reload prep...");
        var hotReloadExitCode = await PowerShellScriptRunner.RunForegroundAsync(
            repoLayout.RevitTestPrepareHotReloadScript,
            ["-RevitYear", options.RevitYear.ToString(System.Globalization.CultureInfo.InvariantCulture)],
            cancellationToken
        );
        if (hotReloadExitCode == 0)
        {
            Console.WriteLine("Rider hot reload prep finished");
        }
        else
        {
            Console.Error.WriteLine($"ERROR running Rider hot reload prep: exit code {hotReloadExitCode}");
        }

        Console.WriteLine("Running add-in auto-approval watcher...");
        var autoApproveExitCode = await PowerShellScriptRunner.RunForegroundAsync(
            repoLayout.RevitTestAutoApproveScript,
            [
                "-TimeoutSeconds", "60",
                "-RevitYear", options.RevitYear.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "-ScriptDirectory", options.ScriptDirectory
            ],
            cancellationToken
        );
        if (autoApproveExitCode == 0)
        {
            Console.WriteLine("Add-in auto-approval watcher finished");
        }
        else
        {
            Console.Error.WriteLine($"ERROR running add-in auto-approval watcher: exit code {autoApproveExitCode}");
        }

        return hotReloadExitCode != 0 ? hotReloadExitCode : autoApproveExitCode;
    }

    private static bool HasMatchingRevitSession(int revitYear)
    {
        var yearText = revitYear.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var revitProcesses = System.Diagnostics.Process.GetProcessesByName("Revit");
        if (revitProcesses.Length == 0)
        {
            return false;
        }

        foreach (var process in revitProcesses)
        {
            try
            {
                if (process.MainWindowTitle.Contains(yearText, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            catch
            {
                // Ignore inaccessible process state and keep checking other sessions.
            }
            finally
            {
                process.Dispose();
            }
        }

        return false;
    }
}
