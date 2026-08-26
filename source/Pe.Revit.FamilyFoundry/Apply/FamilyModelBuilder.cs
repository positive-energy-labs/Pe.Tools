using Autodesk.Revit.ApplicationServices;
using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Apply;

public sealed record FamilyModelBuildResult(
    Document Document,
    FamilyProfileApplyResult ApplyResult,
    string TemplatePath
);

public sealed record FamilyModelSaveResult(Reading Reading, string TemplatePath, FamilySnapshotRecord Snapshot);

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
            return new FamilyModelSaveResult(DocumentReading.Here(result.Document), result.TemplatePath, snapshot);
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
            ApplyFamilySettings(document, model.Settings);
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

    /// <summary>
    ///     Maps what Revit reports about a family document onto the portable placement vocabulary.
    /// </summary>
    /// <remarks>
    ///     `OneLevelBasedHosted` is what the stock wall-based templates report — proven, not assumed, by the
    ///     wall-hosted roundtrip fixture, which builds from `Plumbing Fixture wall based.rft` and would throw
    ///     on the placement cross-check in <see cref="Build" /> if Revit said anything else. Every other
    ///     placement type collapses to `Unhosted`, which is honest for the ones the vocabulary does not name
    ///     yet and is why a ceiling- or floor-based template cannot masquerade as a supported one: its
    ///     geometry conventions would differ while the placement claim looked ordinary.
    /// </remarks>
    public static FamilyModelPlacement GetPlacement(FamilyPlacementType placementType) => placementType switch {
        FamilyPlacementType.WorkPlaneBased => FamilyModelPlacement.FaceHosted,
        FamilyPlacementType.OneLevelBasedHosted => FamilyModelPlacement.WallHosted,
        _ => FamilyModelPlacement.Unhosted
    };

    /// <summary>
    ///     Resolves a portable installed-template NAME to the machine path Revit will open. Public because
    ///     "which template does this document mean on this machine" is a question the apply contract answers,
    ///     and one a test must be able to ask without rebuilding the probe list.
    /// </summary>
    public static string ResolveTemplatePath(Application application, string template) {
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

    /// <summary>
    ///     Writes the closed `settings` key set onto the family element. Every key is one Revit parameter,
    ///     named in <see cref="FamilyModelSettings" />; an omitted key is left exactly as the template made
    ///     it. Each write is read back, because a Revit parameter can accept a `Set` and keep its old value
    ///     — a silent no-op here would become an authored setting the built family does not carry.
    /// </summary>
    private static void ApplyFamilySettings(Document document, FamilyModelSettings? settings) {
        if (settings == null)
            return;

        using var transaction = new Transaction(document, "Apply family settings");
        _ = transaction.Start();
        var family = document.OwnerFamily;
        SetIntegerSetting(family, BuiltInParameter.FAMILY_ALWAYS_VERTICAL, "alwaysVertical",
            settings.AlwaysVertical is true ? 1 : 0, settings.AlwaysVertical.HasValue);
        SetIntegerSetting(family, BuiltInParameter.FAMILY_SHARED, "shared",
            settings.Shared is true ? 1 : 0, settings.Shared.HasValue);
        SetIntegerSetting(family, BuiltInParameter.FAMILY_ALLOW_CUT_WITH_VOIDS, "cutWithVoidsWhenLoaded",
            settings.CutWithVoidsWhenLoaded is true ? 1 : 0, settings.CutWithVoidsWhenLoaded.HasValue);
        if (settings.PartType.HasValue) {
            if (!Enum.TryParse<PartType>(settings.PartType.Value.ToString(), out var partType)) {
                throw new InvalidOperationException(
                    $"$.settings.partType: '{settings.PartType}' is not an Autodesk.Revit.DB.PartType member in this Revit version.");
            }

            SetIntegerSetting(family, BuiltInParameter.FAMILY_CONTENT_PART_TYPE, "partType", (int)partType, true);
        }

        if (settings.OmniClass != null) {
#if REVIT2026_OR_GREATER
            // Revit 2026 removed BuiltInParameter.OMNICLASS_CODE in favour of ClassificationEntry. Refuse the
            // authored key on this year instead of writing it somewhere that only looks equivalent.
            throw new InvalidOperationException(
                "$.settings.omniClass: Revit 2026 removed the OmniClass Number parameter; its replacement is the " +
                "ClassificationEntry model, which the Family Model does not speak yet.");
#else
            var parameter = family.get_Parameter(BuiltInParameter.OMNICLASS_CODE)
                            ?? throw new InvalidOperationException(
                                "$.settings.omniClass: this family category carries no OmniClass Number parameter.");
            _ = parameter.Set(settings.OmniClass);
            var readBack = parameter.AsString();
            if (!string.Equals(readBack, settings.OmniClass, StringComparison.Ordinal)) {
                throw new InvalidOperationException(
                    $"$.settings.omniClass: Revit stored '{readBack}' instead of '{settings.OmniClass}'.");
            }
#endif
        }

        _ = transaction.Commit();
    }

    private static void SetIntegerSetting(
        Family family,
        BuiltInParameter builtInParameter,
        string key,
        int value,
        bool authored
    ) {
        if (!authored)
            return;

        var parameter = family.get_Parameter(builtInParameter)
                        ?? throw new InvalidOperationException(
                            $"$.settings.{key}: this family carries no '{builtInParameter}' parameter.");
        if (parameter.IsReadOnly)
            throw new InvalidOperationException($"$.settings.{key}: '{builtInParameter}' is read-only here.");

        _ = parameter.Set(value);
        if (parameter.AsInteger() != value) {
            throw new InvalidOperationException(
                $"$.settings.{key}: Revit stored {parameter.AsInteger()} instead of {value}.");
        }
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
