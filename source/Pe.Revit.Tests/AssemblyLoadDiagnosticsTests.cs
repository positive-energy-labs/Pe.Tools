using System.Diagnostics;
using System.Reflection;
using Pe.Revit.FamilyFoundry;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.Tools.Commands.FamilyFoundry;

namespace Pe.Tools.RevitTest.Tests;

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

        foreach (var assembly in GetRelevantAssemblies()) {
            TestContext.Progress.WriteLine(FormatAssemblyLine(assembly));
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
            typeof(AssemblyLoadDiagnosticsTests).Assembly,
            typeof(CmdFFManager).Assembly,
            typeof(ProfileFamilyManager).Assembly
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

        return $"{assemblyName.Name}|Version={version}|Mvid={moduleVersionId}|LastWriteUtc={lastWriteTime}|Location={location}";
    }

    private static string SafeGetAssemblyLocation(Assembly assembly) {
        try {
            return string.IsNullOrWhiteSpace(assembly.Location) ? "<empty>" : assembly.Location;
        } catch (Exception ex) {
            return $"<unavailable:{ex.GetType().Name}>";
        }
    }

    private static string TryGetLastWriteTimeUtc(string location) {
        if (string.IsNullOrWhiteSpace(location) || location.StartsWith('<'))
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
