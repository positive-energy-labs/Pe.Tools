using Autodesk.Revit.ApplicationServices;
using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Apply;

public sealed record FamilyModelBuildResult(
    Document Document,
    FamilyProfileApplyResult ApplyResult,
    string TemplatePath
);

public sealed record FamilyModelSaveResult(string TemplatePath, FamilySnapshotRecord Snapshot);

/// <summary>
///     Creates a new family from portable authored truth. This is intentionally a new-document API: applying
///     geometry onto an arbitrary existing family is not a supported FFManager v1 promise.
/// </summary>
public static class FamilyModelBuilder {
    private static readonly string[] TemplateSubdirectories = [
        string.Empty,
        "English-Imperial",
        "English_I",
        "English",
        Path.Combine("Family Templates", "English-Imperial"),
        Path.Combine("Family Templates", "English_I"),
        Path.Combine("Family Templates", "English")
    ];

    public static FamilyModelBuildResult Build(Application application, FamilyModel model) =>
        Build(application, model, modelDirectory: null);

    public static FamilyModelBuildResult Build(
        Application application,
        FamilyModel model,
        string? modelDirectory
    ) => Build(application, model, modelDirectory, new HashSet<string>(StringComparer.OrdinalIgnoreCase));

    public static FamilyModelSaveResult BuildAndSave(
        Application application,
        FamilyModel model,
        string outputPath,
        string? modelDirectory = null,
        bool overwrite = false
    ) {
        var result = Build(application, model, modelDirectory);
        try {
            // Snapshot the built document while it is open — the evidence projection
            // (resolved per-type values, provenance) rides back with the build result.
            var snapshot = FamilySnapshotExtractor.ExtractFromFamilyDocument(result.Document);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            result.Document.SaveAs(outputPath, new SaveAsOptions {
                OverwriteExistingFile = overwrite,
                Compact = true,
                MaximumBackups = 1
            });
            return new FamilyModelSaveResult(result.TemplatePath, snapshot);
        } finally {
            _ = result.Document.Close(false);
        }
    }

    private static FamilyModelBuildResult Build(
        Application application,
        FamilyModel model,
        string? modelDirectory,
        ISet<string> dependencyStack
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));
        if (model == null)
            throw new ArgumentNullException(nameof(model));

        var lowering = FamilyModelLowerer.Lower(model);
        if (lowering.Profile == null) {
            throw new InvalidOperationException(string.Join(Environment.NewLine,
                lowering.Diagnostics.Select(diagnostic => $"{diagnostic.Path}: {diagnostic.Message}")));
        }

        var templatePath = ResolveTemplatePath(application, model.Family.Template);
        Document? document = null;
        try {
            document = application.NewFamilyDocument(templatePath)
                       ?? throw new InvalidOperationException(
                           $"Revit did not create a family document from template '{templatePath}'.");
            if (!document.IsFamilyDocument)
                throw new InvalidOperationException($"Template '{templatePath}' did not create a family document.");

            var actualPlacement = GetPlacement(document.OwnerFamily.FamilyPlacementType);
            if (actualPlacement != model.Family.Placement) {
                throw new InvalidOperationException(
                    $"Template '{model.Family.Template}' creates {actualPlacement} families, but the model declares {model.Family.Placement}.");
            }

            ConfigureFamily(document, model.Family);
            SeedFamilyTypes(document, lowering.FamilyTypeNames);

            var applyResult = document.ApplyFamilyProfile(lowering.Profile, model.Family.Name);
            if (!applyResult.Success)
                throw new InvalidOperationException(applyResult.Error ?? "Family Model apply failed.");

            var dependencies = LoadDependencies(application, document, model, modelDirectory, dependencyStack);
            FamilyModelCompositionBuilder.Apply(document, model, dependencies);

            return new FamilyModelBuildResult(document, applyResult, templatePath);
        } catch {
            if (document != null) {
                try {
                    _ = document.Close(false);
                } catch {
                    // Preserve the build failure. Revit sometimes refuses a close while unwinding a failed transaction.
                }
            }

            throw;
        }
    }

    private static IReadOnlyDictionary<string, Family> LoadDependencies(
        Application application,
        Document hostDocument,
        FamilyModel model,
        string? modelDirectory,
        ISet<string> dependencyStack
    ) {
        var slugs = model.NestedFamilies.Values
            .Select(nested => {
                _ = PortableFamilyReference.TryParse(nested.Family, out var dependency);
                return dependency.Target;
            })
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (slugs.Count == 0)
            return new Dictionary<string, Family>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(modelDirectory)) {
            throw new InvalidOperationException(
                "A model directory is required when family.json references portable dependencies.");
        }

        var loaded = new Dictionary<string, Family>(StringComparer.Ordinal);
        foreach (var slug in slugs) {
            var dependencyPath = Path.GetFullPath(Path.Combine(modelDirectory!, "dependencies", $"{slug}.family.json"));
            if (!File.Exists(dependencyPath))
                throw new FileNotFoundException($"Family Model dependency '{slug}' was not found.", dependencyPath);
            if (!dependencyStack.Add(dependencyPath))
                throw new InvalidOperationException($"Family Model dependency cycle includes '{dependencyPath}'.");

            Document? dependencyDocument = null;
            string? temporaryDirectory = null;
            try {
                var parsed = FamilyModelJson.Parse(File.ReadAllText(dependencyPath));
                if (parsed.Value == null || parsed.Diagnostics.Count != 0) {
                    throw new InvalidOperationException(string.Join(Environment.NewLine,
                        parsed.Diagnostics.Select(diagnostic =>
                            $"{dependencyPath} {diagnostic.Path}: {diagnostic.Message}")));
                }

                dependencyDocument = Build(
                    application,
                    parsed.Value,
                    Path.GetDirectoryName(dependencyPath),
                    dependencyStack).Document;
                FamilyModelCompositionBuilder.PrepareDependency(dependencyDocument);
                // LoadFamily names an unsaved family after Revit's transient document title (for example Family2),
                // not OwnerFamily.Name. Save under the portable dependency slug so the observable nested identity
                // roundtrips without a hidden parameter or extensible-storage alias.
                temporaryDirectory = Path.Combine(
                    Path.GetTempPath(),
                    "Pe.Tools",
                    "FamilyModelDependencies",
                    Guid.NewGuid().ToString("N"));
                _ = Directory.CreateDirectory(temporaryDirectory);
                dependencyDocument.SaveAs(
                    Path.Combine(temporaryDirectory, $"{slug}.rfa"),
                    new SaveAsOptions { OverwriteExistingFile = true, MaximumBackups = 1 });
                loaded[slug] = dependencyDocument.LoadFamily(hostDocument, new DefaultFamilyLoadOptions());
            } finally {
                _ = dependencyStack.Remove(dependencyPath);
                if (dependencyDocument != null) {
                    try {
                        _ = dependencyDocument.Close(false);
                    } catch {
                        // Preserve the load/build failure; a nested family document can refuse close while unwinding.
                    }
                }
                if (temporaryDirectory != null && Directory.Exists(temporaryDirectory)) {
                    try {
                        Directory.Delete(temporaryDirectory, recursive: true);
                    } catch {
                        // The generated RFA is disposable. A cleanup failure must not hide the Revit build result.
                    }
                }
            }
        }

        return loaded;
    }

    public static FamilyModelPlacement GetPlacement(FamilyPlacementType placementType) => placementType switch {
        FamilyPlacementType.WorkPlaneBased => FamilyModelPlacement.FaceHosted,
        FamilyPlacementType.OneLevelBasedHosted => FamilyModelPlacement.WallHosted,
        _ => FamilyModelPlacement.Unhosted
    };

    internal static string ResolveTemplatePath(Application application, string template) {
        var templateName = template.Trim();
        if (Path.IsPathRooted(templateName) ||
            templateName.IndexOfAny([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) >= 0) {
            throw new InvalidOperationException(
                "family.template is a portable installed-template name, not a machine path.");
        }

        if (!templateName.EndsWith(".rft", StringComparison.OrdinalIgnoreCase))
            templateName += ".rft";

        var candidates = TemplateSubdirectories
            .Select(subdirectory => string.IsNullOrWhiteSpace(subdirectory)
                ? Path.Combine(application.FamilyTemplatePath, templateName)
                : Path.Combine(application.FamilyTemplatePath, subdirectory, templateName))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var resolved = candidates.FirstOrDefault(File.Exists);
        return resolved ?? throw new FileNotFoundException(
            $"Installed family template '{templateName}' was not found. Tried: {string.Join("; ", candidates)}");
    }

    private static void ConfigureFamily(Document document, FamilyModelHeader header) {
        var categories = RevitLabelCatalog.GetLabelToBuiltInCategoryMap();
        if (!categories.TryGetValue(header.Category, out var builtInCategory))
            throw new InvalidOperationException($"Revit family category '{header.Category}' was not found.");

        var category = Category.GetCategory(document, builtInCategory)
                       ?? throw new InvalidOperationException(
                           $"Category '{header.Category}' is not available in template '{header.Template}'.");

        using var transaction = new Transaction(document, "Configure family model");
        _ = transaction.Start();
        document.OwnerFamily.FamilyCategory = category;
        document.OwnerFamily.Name = header.Name.Trim();
        _ = transaction.Commit();
    }

    private static void SeedFamilyTypes(Document document, IReadOnlyList<string> typeNames) {
        if (typeNames.Count == 0)
            return;

        var manager = document.FamilyManager;
        var existing = manager.Types.Cast<FamilyType>()
            .Select(type => type.Name)
            .ToHashSet(StringComparer.Ordinal);
        var missing = typeNames.Where(name => !existing.Contains(name)).ToList();
        if (missing.Count == 0)
            return;

        // NewType is a transaction-only mutation. Seeding before parameters exist is deliberate: empty authored
        // types must survive without inventing a fake value assignment in the portable model.
        using var transaction = new Transaction(document, "Seed family model types");
        _ = transaction.Start();
        foreach (var typeName in missing)
            _ = manager.NewType(typeName);
        _ = transaction.Commit();
    }
}
