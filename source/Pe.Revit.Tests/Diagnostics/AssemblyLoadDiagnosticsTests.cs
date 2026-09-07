using Pe.App.Commands.FamilyFoundry;
using System.Diagnostics;
using System.Reflection;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class AssemblyLoadDiagnosticsTests {
    [Test]
    public void Reports_runtime_assembly_load_paths(UIApplication uiApplication) {
        var process = Process.GetCurrentProcess();
        var revitApplication = uiApplication.Application;

        TestContext.Progress.WriteLine($"ProcessName={process.ProcessName}");
        TestContext.Progress.WriteLine($"ProcessId={process.Id}");
        TestContext.Progress.WriteLine($"MainModule={SafeGetMainModuleFileName(process)}");
        TestContext.Progress.WriteLine($"RevitVersion={revitApplication.VersionNumber}");
        TestContext.Progress.WriteLine($"RevitSubVersion={revitApplication.SubVersionNumber}");

        var lines = GetRelevantAssemblies().Select(FormatAssemblyLine).ToArray();
        foreach (var line in lines) TestContext.Progress.WriteLine(line);
        if (Environment.GetEnvironmentVariable("PE_FF_PROOF_OUTPUT") is { Length: > 0 } output) {
            Directory.CreateDirectory(output);
            File.WriteAllLines(Path.Combine(output, "assembly-load.txt"),
                new[] { $"ProcessId={process.Id}", $"RevitVersion={revitApplication.VersionNumber}",
                    $"TestAssembly={typeof(AssemblyLoadDiagnosticsTests).Assembly.Location}" }.Concat(lines));
        }

        Assert.That(process.ProcessName, Is.EqualTo("Revit"));
    }

    private static IReadOnlyList<Assembly> GetRelevantAssemblies() {
        var currentDomainAssemblies = AppDomain.CurrentDomain
            .GetAssemblies()
            .Where(assembly => !assembly.IsDynamic)
            .Where(assembly => {
                var name = assembly.GetName().Name;
                return name is not null && (name.StartsWith("Pe.") || name.StartsWith("Autodesk.Revit"));
            });

        var anchorAssemblies = new[] {
            typeof(AssemblyLoadDiagnosticsTests).Assembly, typeof(CmdFFManager).Assembly,
            typeof(Pe.Revit.FamilyFoundry.OperationProcessor).Assembly
        };

        return currentDomainAssemblies
            .Concat(anchorAssemblies)
            .Distinct()
            .OrderBy(assembly => assembly.GetName().Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string FormatAssemblyLine(Assembly assembly) {
        var assemblyName = assembly.GetName();
        var location = SafeGetAssemblyLocation(assembly);
        var version = assemblyName.Version?.ToString() ?? "<null>";
        var lastWriteTime = TryGetLastWriteTimeUtc(location);
        var moduleVersionId = assembly.ManifestModule.ModuleVersionId;

        return
            $"{assemblyName.Name}|Version={version}|Mvid={moduleVersionId}|LastWriteUtc={lastWriteTime}|Location={location}";
    }

    private static string SafeGetAssemblyLocation(Assembly assembly) {
        try {
            return string.IsNullOrWhiteSpace(assembly.Location) ? "<empty>" : assembly.Location;
        } catch (Exception ex) {
            return $"<unavailable:{ex.GetType().Name}>";
        }
    }

    private static string TryGetLastWriteTimeUtc(string location) {
        if (string.IsNullOrWhiteSpace(location) || location.StartsWith("<", StringComparison.Ordinal))
            return "<unknown>";
        if (!File.Exists(location))
            return "<missing>";

        return File.GetLastWriteTimeUtc(location).ToString("O");
    }

    private static string SafeGetMainModuleFileName(Process process) {
        try {
            return process.MainModule?.FileName ?? "<null>";
        } catch (Exception ex) {
            return $"<unavailable:{ex.GetType().Name}>";
        }
    }
}
