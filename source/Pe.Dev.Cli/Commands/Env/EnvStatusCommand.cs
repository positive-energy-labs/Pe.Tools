using Pe.Shared.Product;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pe.Dev.Cli;

internal static class EnvStatusCommand {
    private static readonly JsonSerializerOptions JsonOptions = CreateJsonOptions();

    public static int Run(IReadOnlyList<string> args) {
        var jsonOutput = false;
        foreach (var arg in args) {
            switch (arg) {
            case "--json":
                jsonOutput = true;
                break;
            default:
                Console.Error.WriteLine($"Unknown env status option '{arg}'. Supported options: --json.");
                return 10;
            }
        }

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var applicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var installedRuntime = ProductRuntimeLayout.ForCurrentUser(localAppData);
        var developmentRuntime = ProductDevelopmentRuntimeLayout.ForCurrentUser(localAppData);
        var report = new RuntimeStatusReport(
            installedRuntime.Binaries.HostExecutablePath,
            developmentRuntime.Binaries.HostExecutablePath,
            developmentRuntime.Binaries.PeDevDllPath,
            installedRuntime.Binaries.PeaLauncherPath,
            File.Exists(installedRuntime.Binaries.PeaCurrentVersionPath)
                ? File.ReadAllText(installedRuntime.Binaries.PeaCurrentVersionPath).Trim()
                : null,
            EnumerateRuntimeDescriptors(applicationData).ToArray()
        );

        if (jsonOutput) {
            Console.WriteLine(JsonSerializer.Serialize(report, JsonOptions));
            return 0;
        }

        Console.WriteLine($"host installed={report.InstalledHostExecutablePath}");
        Console.WriteLine($"host dev={report.DevHostExecutablePath}");
        Console.WriteLine($"pe-dev dev={report.DevPeDevDllPath}");
        Console.WriteLine($"pea launcher={report.PeaLauncherPath}");
        Console.WriteLine($"pea currentVersion={(report.PeaCurrentVersion ?? "none")}");

        if (report.RuntimeDescriptors.Count == 0) {
            Console.WriteLine("runtime-descriptor none");
            return 0;
        }

        foreach (var descriptor in report.RuntimeDescriptors) {
            Console.WriteLine(
                $"runtime-descriptor revitYear={descriptor.RevitYear} lane={descriptor.RuntimeLane} source={descriptor.Source} path=\"{descriptor.DescriptorPath}\"");
        }

        return 0;
    }

    private static IEnumerable<RuntimeDescriptorStatus> EnumerateRuntimeDescriptors(string applicationData) {
        var addinsRoot = RevitDeploymentIdentity.ResolvePerUserAddinsRootPath(applicationData);
        if (!Directory.Exists(addinsRoot))
            yield break;

        foreach (var addinDirectory in Directory.EnumerateDirectories(addinsRoot)) {
            var yearSegment = Path.GetFileName(addinDirectory);
            if (!int.TryParse(yearSegment, NumberStyles.None, CultureInfo.InvariantCulture, out var revitYear))
                continue;

            var descriptorPath = RevitDeploymentIdentity.ResolvePerUserRuntimeDescriptorPath(revitYear, applicationData);
            if (PeAppRuntimeDeploymentDescriptor.TryLoad(descriptorPath, out var descriptor) && descriptor is not null) {
                yield return new RuntimeDescriptorStatus(revitYear, descriptorPath, descriptor.RuntimeLane, "runtime-descriptor");
                continue;
            }

            if (File.Exists(descriptorPath))
                yield return new RuntimeDescriptorStatus(revitYear, descriptorPath, ProductRuntimeLane.Installed, "invalid-runtime-descriptor-default");
        }
    }

    private static JsonSerializerOptions CreateJsonOptions() {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) {
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter());
        return options;
    }

    private sealed record RuntimeStatusReport(
        string InstalledHostExecutablePath,
        string DevHostExecutablePath,
        string DevPeDevDllPath,
        string PeaLauncherPath,
        string? PeaCurrentVersion,
        IReadOnlyList<RuntimeDescriptorStatus> RuntimeDescriptors
    );

    private sealed record RuntimeDescriptorStatus(
        int RevitYear,
        string DescriptorPath,
        ProductRuntimeLane RuntimeLane,
        string Source
    );
}
