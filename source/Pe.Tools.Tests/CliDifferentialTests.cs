using System.Diagnostics;

namespace Pe.Tools.Tests;

public sealed class CliDifferentialTests : RevitTestBase
{
    [Test]
    public async Task CliIsAvailable_ForDifferentialSuite()
    {
        var runner = ToonCliRunner.CreateOrThrow();

        await Assert.That(string.IsNullOrWhiteSpace(runner.CommandDescription)).IsFalse();
    }

    [Test]
    public async Task OurEncoder_ToonDecodedByCli_MatchesOriginalJson()
    {
        var runner = ToonCliRunner.CreateOrThrow();
        const string json = """
                            {
                              "values": [
                                { "type": "W5BM024", "value": "208V" },
                                { "type": "W5BM036", "value": "208V" },
                                { "type": "W5BM048", "value": "208V" }
                              ],
                              "enabled": true
                            }
                            """;

        var toon = ToonTranspiler.EncodeJson(json);
        var cliDecodedJson = runner.DecodeToJson(toon);

        await Assert.That(JsonSemanticComparer.AreEquivalent(json, cliDecodedJson)).IsTrue();
    }

    [Test]
    public async Task CliEncoder_ToonDecodedByOurParser_MatchesOriginalJson()
    {
        var runner = ToonCliRunner.CreateOrThrow();
        const string json = """
                            {
                              "users": [
                                { "id": 1, "name": "Alice Admin", "role": "admin" },
                                { "id": 2, "name": "Bob Smith", "role": "user" }
                              ],
                              "meta": { "owner": "ops" }
                            }
                            """;

        var cliToon = runner.EncodeToToon(json);
        var decodedByUs = ToonTranspiler.DecodeToJson(cliToon);

        await Assert.That(JsonSemanticComparer.AreEquivalent(json, decodedByUs)).IsTrue();
    }
}

internal sealed class ToonCliRunner
{
    private ToonCliRunner(string command, string fixedArgsPrefix, string commandDescription)
    {
        this.Command = command;
        this.FixedArgsPrefix = fixedArgsPrefix;
        this.CommandDescription = commandDescription;
    }

    private string Command { get; }
    private string FixedArgsPrefix { get; }
    public string CommandDescription { get; }

    public static ToonCliRunner CreateOrThrow()
    {
        var candidates = new[] {
            new ToonCliRunner("toon.cmd", string.Empty, "toon"),
            new ToonCliRunner("pnpm.cmd", "dlx @toon-format/cli", "pnpm dlx @toon-format/cli"),
            new ToonCliRunner("npx.cmd", "-y @toon-format/cli", "npx -y @toon-format/cli")
        };

        foreach (var candidate in candidates)
        {
            if (candidate.CanRunHelp())
            {
                return candidate;
            }
        }

        throw new InvalidOperationException(
            "TOON CLI was not found. Install one of: `npm i -g @toon-format/cli` (toon command) " +
            "or ensure `npx @toon-format/cli` is available.");
    }

    public string EncodeToToon(string json)
    {
        var input = Path.GetTempFileName() + ".json";
        var output = Path.GetTempFileName() + ".toon";
        try
        {
            File.WriteAllText(input, json);
            this.Run($"{Quote(input)} -o {Quote(output)}");
            return File.ReadAllText(output);
        }
        finally
        {
            SafeDelete(input);
            SafeDelete(output);
        }
    }

    public string DecodeToJson(string toon)
    {
        var input = Path.GetTempFileName() + ".toon";
        var output = Path.GetTempFileName() + ".json";
        try
        {
            File.WriteAllText(input, toon);
            this.Run($"{Quote(input)} -o {Quote(output)}");
            return File.ReadAllText(output);
        }
        finally
        {
            SafeDelete(input);
            SafeDelete(output);
        }
    }

    private bool CanRunHelp()
    {
        try
        {
            var result = this.Run("--help", throwOnFailure: false);
            return result.ExitCode == 0;
        }
        catch
        {
            return false;
        }
    }

    private (int ExitCode, string StdOut, string StdErr) Run(string args, bool throwOnFailure = true)
    {
        var allArgs = string.IsNullOrWhiteSpace(this.FixedArgsPrefix)
            ? args
            : $"{this.FixedArgsPrefix} {args}";
        var psi = new ProcessStartInfo(this.Command, allArgs)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {this.CommandDescription}");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();

        if (throwOnFailure && process.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"TOON CLI command failed: {this.CommandDescription} {allArgs}{Environment.NewLine}" +
                $"ExitCode={process.ExitCode}{Environment.NewLine}STDERR:{Environment.NewLine}{stderr}{Environment.NewLine}" +
                $"STDOUT:{Environment.NewLine}{stdout}");
        }

        return (process.ExitCode, stdout, stderr);
    }

    private static string Quote(string path) => $"\"{path}\"";

    private static void SafeDelete(string path)
    {
        try { File.Delete(path); } catch { }
    }
}
