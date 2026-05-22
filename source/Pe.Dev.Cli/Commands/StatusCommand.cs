using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Dev.Cli;

internal static class StatusCommand {
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static int Run(IReadOnlyList<string> args) {
        var jsonOutput = false;
        foreach (var arg in args) {
            if (string.Equals(arg, "--json", StringComparison.OrdinalIgnoreCase)) {
                jsonOutput = true;
                continue;
            }

            Console.Error.WriteLine($"Unknown status option '{arg}'. Supported options: --json.");
            return 10;
        }

        var environment = EnvStatusCommand.CreateReport();
        var session = RevitCommandRunner.CreateCurrentSessionReport();
        var report = new DevStatusReport(1, "status", environment, session);

        if (jsonOutput) {
            Console.WriteLine(JsonSerializer.Serialize(report, JsonOptions));
            return 0;
        }

        Console.WriteLine($"host installed={environment.InstalledHostExecutablePath}");
        Console.WriteLine($"host dev={environment.DevHostExecutablePath}");
        Console.WriteLine($"pe-dev dev={environment.DevPeDevDllPath}");
        Console.WriteLine($"pea launcher={environment.PeaLauncherPath}");
        Console.WriteLine($"pea currentVersion={(environment.PeaCurrentVersion ?? "none")}");
        foreach (var descriptor in environment.RuntimeDescriptors)
            Console.WriteLine($"runtime-descriptor revitYear={descriptor.RevitYear} lane={descriptor.RuntimeLane} source={descriptor.Source} path=\"{descriptor.DescriptorPath}\"");

        RevitCommandRunner.WriteStatusSummary(session);
        return 0;
    }

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }

    private sealed record DevStatusReport(
        int SchemaVersion,
        string Command,
        EnvStatusCommand.RuntimeStatusReport Environment,
        RevitSessionReport Revit
    );
}
