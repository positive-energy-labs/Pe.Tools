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
            CheckRoute("self-test", ["self-test"], DevCommandKind.SelfTest, []),
            CheckRemovedRoute("test removed", ["test"]),
            CheckRemovedRoute("doctor removed", ["doctor"]),
            CheckRemovedRoute("status removed", ["status"]),
            CheckRemovedRoute("sync removed", ["sync"]),
            CheckRemovedRoute("codegen removed", ["codegen"]),
            CheckRemovedRoute("bootstrap-path removed", ["bootstrap-path"]),
            CheckRemovedRoute("pea link-dev removed", ["pea", "link-dev"]),
            CheckUsageText("usage advertises minimal surface", ["pe-dev self-test", "pe-dev automation"]),
            CheckUsageText("usage points PATH/dev shims at SDK", ["pe-revit path ensure", "pe-revit dev link"]),
            CheckUsageTextAbsent("usage does not advertise pe-dev test", ["pe-dev test"]),
            CheckUsageTextAbsent("usage does not advertise removed codegen", ["pe-dev codegen sync"]),
            CheckUsageText("usage points Revit tests at SDK", ["pe-revit test fresh|attached"])
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

    private static VerifySelfTestCheck CheckUsageText(string name, IReadOnlyList<string> expectedSnippets) =>
        CheckTextContains(name, DevCliProgram.UsageText, expectedSnippets);

    private static VerifySelfTestCheck CheckUsageTextAbsent(string name, IReadOnlyList<string> forbiddenSnippets) {
        var present = forbiddenSnippets
            .Where(snippet => DevCliProgram.UsageText.Contains(snippet, StringComparison.Ordinal))
            .ToArray();
        return present.Length == 0
            ? new VerifySelfTestCheck(name, true, null)
            : new VerifySelfTestCheck(name, false, $"found forbidden text: {string.Join(", ", present)}");
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
