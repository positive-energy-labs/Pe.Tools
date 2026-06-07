using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Product;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Pods;

namespace Pe.Revit.Scripting.Pods;

internal static class PodOriginVersionGuard {
    public const string DiagnosticStage = "pod-origin";

    public static IReadOnlyList<ScriptDiagnostic> Check(PodManifest manifest) {
        if (manifest.Origin is null)
            return [];

        if (!TryResolveLocalManifestPath(manifest.Origin.Path, out var originManifestPath, out var diagnostic))
            return [diagnostic!];

        var originResult = PodManifestValidator.ValidateJson(File.ReadAllText(originManifestPath));
        if (!originResult.Success || originResult.Manifest is null)
            return [
                ScriptDiagnosticFactory.Error(
                    DiagnosticStage,
                    $"Pod origin manifest is invalid: {originManifestPath}"
                )
            ];

        var originManifest = originResult.Manifest;
        if (!string.Equals(originManifest.Id, manifest.Id, StringComparison.Ordinal))
            return [
                ScriptDiagnosticFactory.Error(
                    DiagnosticStage,
                    $"Pod origin id '{originManifest.Id}' does not match local pod id '{manifest.Id}': {originManifestPath}"
                )
            ];

        if (!string.Equals(originManifest.Version, manifest.Version, StringComparison.Ordinal))
            return [
                ScriptDiagnosticFactory.Error(
                    DiagnosticStage,
                    $"Pod origin version is {originManifest.Version}, but local pod version is {manifest.Version}. Reimport the Pod from {manifest.Origin.Path}."
                )
            ];

        return [];
    }

    private static bool TryResolveLocalManifestPath(
        string originPath,
        out string manifestPath,
        out ScriptDiagnostic? diagnostic
    ) {
        manifestPath = string.Empty;
        diagnostic = null;

        if (!File.Exists(originPath) && !Directory.Exists(originPath)) {
            diagnostic = ScriptDiagnosticFactory.Warning(
                DiagnosticStage,
                $"Pod origin path is not currently available, so shared-version freshness could not be checked: {originPath}"
            );
            return false;
        }

        manifestPath = Directory.Exists(originPath)
            ? Path.Combine(originPath, ProductPathNames.PodManifestFileName)
            : originPath;

        if (File.Exists(manifestPath))
            return true;

        diagnostic = ScriptDiagnosticFactory.Warning(
            DiagnosticStage,
            $"Pod origin does not contain {ProductPathNames.PodManifestFileName}, so shared-version freshness could not be checked: {originPath}"
        );
        return false;
    }
}
