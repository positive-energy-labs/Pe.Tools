using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Dev.Cli;

internal static class VerifySelfTestCommand {
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static int Run(IReadOnlyList<string> args) {
        var jsonOutput = false;
        foreach (var arg in args) {
            if (string.Equals(arg, "--json", StringComparison.OrdinalIgnoreCase)) {
                jsonOutput = true;
                continue;
            }

            Console.Error.WriteLine($"Unknown self-test option '{arg}'. Supported options: --json.");
            return 10;
        }

        var checks = new[] {
            CheckRoute("test", ["test", "--filter", "Name~AssemblyLoadDiagnostics"], DevCommandKind.Test, ["--filter", "Name~AssemblyLoadDiagnostics"]),
            CheckRoute("test json", ["test", "--json", "--filter", "Name~AssemblyLoadDiagnostics"], DevCommandKind.Test, ["--json", "--filter", "Name~AssemblyLoadDiagnostics"]),
            CheckRoute("test plan json", ["test", "--plan", "--json", "--timeout-seconds", "900", "--filter", "Name~AssemblyLoadDiagnostics"], DevCommandKind.Test, ["--plan", "--json", "--timeout-seconds", "900", "--filter", "Name~AssemblyLoadDiagnostics"]),
            CheckRoute("self-test", ["self-test"], DevCommandKind.SelfTest, []),
            CheckFreshOptions("test accepts plan json timeout", ["--plan", "--json", "--timeout-seconds", "900"], shouldPass: true),
            CheckFreshOptions("test rejects zero timeout", ["--json", "--timeout-seconds", "0"], shouldPass: false),
            CheckRemovedRoute("doctor removed", ["doctor"]),
            CheckRemovedRoute("status removed", ["status"]),
            CheckRemovedRoute("sync removed", ["sync"]),
            CheckUsageText("usage advertises minimal surface", ["pe-dev test", "pe-dev self-test", "pe-dev automation", "pe-dev codegen"]),
            CheckUsageText("usage advertises fresh safety options", ["--plan", "--timeout-seconds", "--json"]),
            CheckGuidanceText("fresh guidance distinguishes proof and attached lanes", writer => AgentGuidanceWriter.WriteFreshOwnedLane(writer, 2025), ["FreshOwnedRevit", "proof-grade", "AttachedRrd scripting"])
        };
        var report = new VerifySelfTestReport(
            SchemaVersion: 1,
            Command: "self-test",
            Outcome: checks.All(check => check.Passed) ? "passed" : "failed",
            ExitCode: checks.All(check => check.Passed) ? 0 : 1,
            Checks: checks
        );

        if (jsonOutput)
            Console.WriteLine(JsonSerializer.Serialize(report, JsonOptions));
        else
            WriteHumanReport(report);

        return report.ExitCode;
    }

    private static VerifySelfTestCheck CheckRoute(
        string name,
        IReadOnlyList<string> args,
        DevCommandKind expectedKind,
        IReadOnlyList<string> expectedForwardedArgs
    ) {
        var parse = DevCliOptions.Parse(args);
        if (!parse.Success || parse.Options is null)
            return new VerifySelfTestCheck(name, false, $"parse failed: {parse.ErrorMessage ?? "unknown"}");

        if (parse.Options.CommandKind != expectedKind)
            return new VerifySelfTestCheck(name, false, $"expected command {expectedKind}, got {parse.Options.CommandKind}");

        if (!parse.Options.CommandArguments.SequenceEqual(expectedForwardedArgs))
            return new VerifySelfTestCheck(name, false, $"expected forwarded args [{string.Join(", ", expectedForwardedArgs)}], got [{string.Join(", ", parse.Options.CommandArguments)}]");

        return new VerifySelfTestCheck(name, true, null);
    }

    private static VerifySelfTestCheck CheckRemovedRoute(string name, IReadOnlyList<string> args) {
        var parse = DevCliOptions.Parse(args);
        return !parse.Success && parse.ErrorMessage?.Contains("has been removed", StringComparison.Ordinal) == true
            ? new VerifySelfTestCheck(name, true, null)
            : new VerifySelfTestCheck(name, false, "expected removed-route parse failure");
    }

    private static VerifySelfTestCheck CheckFreshOptions(string name, IReadOnlyList<string> args, bool shouldPass) {
        try {
            var options = RevitTestCliOptions.Parse(args);
            if (shouldPass && args.Any(arg => string.Equals(arg, "--plan", StringComparison.OrdinalIgnoreCase)) && !options.PlanOnly)
                return new VerifySelfTestCheck(name, false, "expected plan-only mode");
            if (shouldPass && args.Any(arg => string.Equals(arg, "--timeout-seconds", StringComparison.OrdinalIgnoreCase)) && options.TimeoutSeconds is not 900)
                return new VerifySelfTestCheck(name, false, "expected timeoutSeconds=900");
            return shouldPass
                ? new VerifySelfTestCheck(name, true, null)
                : new VerifySelfTestCheck(name, false, "expected parse failure, but parse passed");
        } catch (Exception ex) {
            return shouldPass
                ? new VerifySelfTestCheck(name, false, ex.Message)
                : new VerifySelfTestCheck(name, true, null);
        }
    }

    private static VerifySelfTestCheck CheckUsageText(string name, IReadOnlyList<string> expectedSnippets) =>
        CheckTextContains(name, DevCliProgram.UsageText, expectedSnippets);

    private static VerifySelfTestCheck CheckGuidanceText(
        string name,
        Action<TextWriter> writeGuidance,
        IReadOnlyList<string> expectedSnippets
    ) {
        using var writer = new StringWriter();
        writeGuidance(writer);
        return CheckTextContains(name, writer.ToString(), expectedSnippets);
    }

    private static VerifySelfTestCheck CheckTextContains(
        string name,
        string text,
        IReadOnlyList<string> expectedSnippets
    ) {
        var missing = expectedSnippets
            .Where(snippet => !text.Contains(snippet, StringComparison.Ordinal))
            .ToArray();
        return missing.Length == 0
            ? new VerifySelfTestCheck(name, true, null)
            : new VerifySelfTestCheck(name, false, $"missing expected text: {string.Join(", ", missing)}");
    }

    private static void WriteHumanReport(VerifySelfTestReport report) {
        Console.WriteLine($"self-test outcome={report.Outcome} exitCode={report.ExitCode} checks={report.Checks.Count}");
        foreach (var check in report.Checks)
            Console.WriteLine($"check name=\"{check.Name}\" passed={check.Passed} message=\"{check.Message ?? ""}\"");
    }

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }
}

internal sealed record VerifySelfTestReport(
    int SchemaVersion,
    string Command,
    string Outcome,
    int ExitCode,
    IReadOnlyList<VerifySelfTestCheck> Checks
);

internal sealed record VerifySelfTestCheck(string Name, bool Passed, string? Message);
