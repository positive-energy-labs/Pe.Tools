using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.Shared.StorageRuntime.Core.Json;

namespace Pe.Revit.Tests;

internal static class RevitFamilyFixtureHarness {
    private const string GenericModelTemplateName = "Generic Model.rft";
    private static readonly string[] TemplateSubdirectories = [
        string.Empty,
        "English-Imperial",
        "English_I",
        "English",
        Path.Combine("Family Templates", "English-Imperial"),
        Path.Combine("Family Templates", "English_I"),
        Path.Combine("Family Templates", "English")
    ];

    internal sealed record FamilyTypeState(string Name, IReadOnlyDictionary<string, double> LengthValues);

    public static string ResolveGenericModelTemplatePath(
        Autodesk.Revit.ApplicationServices.Application application
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));

        var templateRoot = application.FamilyTemplatePath;
        var candidates = TemplateSubdirectories
            .Select(subdirectory => string.IsNullOrWhiteSpace(subdirectory)
                ? Path.Combine(templateRoot, GenericModelTemplateName)
                : Path.Combine(templateRoot, subdirectory, GenericModelTemplateName))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var resolved = candidates.FirstOrDefault(File.Exists);
        if (!string.IsNullOrWhiteSpace(resolved))
            return resolved;

        throw new FileNotFoundException(
            $"Family template not found. Application.FamilyTemplatePath='{templateRoot}'. Tried: {string.Join("; ", candidates)}");
    }

    public static Document CreateFamilyDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        BuiltInCategory familyCategory,
        string familyName
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));
        if (string.IsNullOrWhiteSpace(familyName))
            throw new ArgumentException("Family name is required.", nameof(familyName));

        var templatePath = ResolveGenericModelTemplatePath(application);
        var document = application.NewFamilyDocument(templatePath);
        if (document == null)
            throw new InvalidOperationException($"Failed to create family document from template '{templatePath}'.");
        if (!document.IsFamilyDocument)
            throw new InvalidOperationException($"Template '{templatePath}' did not create a family document.");

        ConfigureOwnerFamily(document, familyCategory, familyName);

        return document;
    }

    public static string CreateTemporaryOutputDirectory(string testName) {
        var shortTestToken = CreateShortToken(testName);
        var outputDirectory = Path.Combine(
            Path.GetTempPath(),
            "petrt",
            shortTestToken,
            Guid.NewGuid().ToString("N")[..8]);

        Directory.CreateDirectory(outputDirectory);
        Console.WriteLine($"[PE_FF_TEST_OUTPUT_DIRECTORY] {outputDirectory}");
        return outputDirectory;
    }

    public static string GetExpectedSavedFamilyPath(string outputDirectory, Document familyDocument) {
        if (string.IsNullOrWhiteSpace(outputDirectory))
            throw new ArgumentException("Output directory is required.", nameof(outputDirectory));
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        var familyName = familyDocument.OwnerFamily?.Name;
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = Path.GetFileNameWithoutExtension(familyDocument.Title);
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = "Family";

        var safeFamilyName = SanitizePathSegment(familyName);
        return Path.Combine(outputDirectory, safeFamilyName, $"{safeFamilyName}.rfa");
    }

    public static string GetProfileFixturePath(string fixtureFileName) {
        if (string.IsNullOrWhiteSpace(fixtureFileName))
            throw new ArgumentException("Fixture file name is required.", nameof(fixtureFileName));

        var assemblyDirectory = Path.GetDirectoryName(typeof(RevitFamilyFixtureHarness).Assembly.Location)
                                ?? throw new InvalidOperationException("Could not resolve the test assembly directory.");
        var fixturePath = Path.Combine(assemblyDirectory, "Fixtures", "Profiles", fixtureFileName);
        if (!File.Exists(fixturePath))
            throw new FileNotFoundException($"Profile fixture not found at '{fixturePath}'.", fixturePath);

        return fixturePath;
    }

    public static string GetFamilyFixturePath(string fixtureFileName) {
        if (string.IsNullOrWhiteSpace(fixtureFileName))
            throw new ArgumentException("Fixture file name is required.", nameof(fixtureFileName));

        var assemblyDirectory = Path.GetDirectoryName(typeof(RevitFamilyFixtureHarness).Assembly.Location)
                                ?? throw new InvalidOperationException("Could not resolve the test assembly directory.");
        var fixturePath = Path.Combine(assemblyDirectory, "Fixtures", "Families", fixtureFileName);
        if (!File.Exists(fixturePath))
            throw new FileNotFoundException($"Family fixture not found at '{fixturePath}'.", fixturePath);

        return fixturePath;
    }

    public static Document OpenFamilyFixture(
        Autodesk.Revit.ApplicationServices.Application application,
        string fixtureFileName
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));

        var fixturePath = GetFamilyFixturePath(fixtureFileName);
        return application.OpenDocumentFile(fixturePath)
               ?? throw new InvalidOperationException($"Failed to open family fixture '{fixturePath}'.");
    }

    public static ProfileFamilyManager LoadProfileFixture(string fixtureFileName) {
        var fixturePath = GetProfileFixturePath(fixtureFileName);
        var json = File.ReadAllText(fixturePath);
        var settings = RevitJsonFormatting.CreateRevitIndentedSettings();

        if (!settings.Converters.OfType<StringEnumConverter>().Any())
            settings.Converters.Add(new StringEnumConverter());

        return JsonConvert.DeserializeObject<ProfileFamilyManager>(json, settings)
               ?? throw new InvalidOperationException($"Failed to deserialize profile fixture '{fixturePath}'.");
    }

    public static void AssertSavedFamilyFileIsOpenable(
        Autodesk.Revit.ApplicationServices.Application application,
        string savedFamilyPath
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));
        if (!File.Exists(savedFamilyPath))
            throw new FileNotFoundException($"Saved family file not found at '{savedFamilyPath}'.", savedFamilyPath);

        Document? savedDocument = null;

        try {
            savedDocument = application.OpenDocumentFile(savedFamilyPath);
            Assert.That(savedDocument, Is.Not.Null);
            Assert.That(savedDocument!.IsFamilyDocument, Is.True);
            Assert.That(savedDocument.OwnerFamily, Is.Not.Null);
        } finally {
            CloseDocument(savedDocument);
        }
    }

    public static void CloseDocument(Document? document) {
        if (document == null || !document.IsValidObject)
            return;

        _ = document.Close(false);
    }

    public static IReadOnlyList<(string TypeName, T Result)> EvaluateLengthDrivenStates<T>(
        Document familyDocument,
        IReadOnlyList<FamilyTypeState> states,
        Func<Document, T> evaluator
    ) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");
        if (states.Count == 0)
            return [];

        var familyManager = familyDocument.FamilyManager;
        var results = new List<(string TypeName, T Result)>();

        using var transaction = new Transaction(familyDocument, "Evaluate family type states");
        _ = transaction.Start();

        try {
            foreach (var state in states) {
                var familyType = familyManager.Types
                    .Cast<FamilyType>()
                    .FirstOrDefault(type => string.Equals(type.Name, state.Name, StringComparison.Ordinal))
                    ?? familyManager.NewType(state.Name);

                familyManager.CurrentType = familyType;

                foreach (var (parameterName, value) in state.LengthValues) {
                    var parameter = familyManager.get_Parameter(parameterName)
                        ?? throw new InvalidOperationException($"Family parameter '{parameterName}' was not found.");

                    if (!string.IsNullOrWhiteSpace(parameter.Formula)) {
                        var familyDoc = new FamilyDocument(familyDocument);
                        if (!familyDoc.UnsetFormula(parameter))
                            throw new InvalidOperationException($"Family parameter '{parameterName}' formula could not be cleared for state evaluation.");
                    }

                    familyManager.Set(parameter, value);
                }

                familyDocument.Regenerate();
                try {
                    results.Add((state.Name, evaluator(familyDocument)));
                } catch (Exception ex) {
                    throw new InvalidOperationException($"State '{state.Name}' evaluation failed: {ex.Message}", ex);
                }
            }
        } finally {
            _ = transaction.RollBack();
        }

        return results;
    }

    public static double MeasureFirstRoundExtrusionDiameter(Document familyDocument) {
        var extrusion = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .FirstOrDefault(IsRoundExtrusion)
            ?? throw new InvalidOperationException("No round extrusion was found.");

        var arc = extrusion.Sketch?.Profile
            ?.Cast<CurveArray>()
            .SelectMany(loop => loop.Cast<Curve>())
            .OfType<Arc>()
            .FirstOrDefault();
        if (arc != null)
            return arc.Radius * 2.0;

        var bbox = extrusion.get_BoundingBox(null)
            ?? throw new InvalidOperationException("Round extrusion had no bounding box.");
        var x = bbox.Max.X - bbox.Min.X;
        var y = bbox.Max.Y - bbox.Min.Y;
        return (x + y) / 2.0;
    }

    public static double MeasureFirstRoundConnectorDiameter(Document familyDocument) {
        var connector = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>()
            .FirstOrDefault()
            ?? throw new InvalidOperationException("No connector was found.");

        var diameter = connector.get_Parameter(BuiltInParameter.CONNECTOR_DIAMETER)?.AsDouble();
        if (diameter is > 0.0)
            return diameter.Value;

        var radius = connector.get_Parameter(BuiltInParameter.CONNECTOR_RADIUS)?.AsDouble();
        if (radius is > 0.0)
            return radius.Value * 2.0;

        throw new InvalidOperationException("Round connector diameter parameters were not available.");
    }

    public static double MeasureFirstExtrusionDepth(Document familyDocument) {
        var extrusion = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .FirstOrDefault()
            ?? throw new InvalidOperationException("No extrusion was found.");

        return Math.Abs(extrusion.EndOffset - extrusion.StartOffset);
    }

    public static (double Width, double Length) MeasureFirstRectangularExtrusionPlanExtents(Document familyDocument) {
        var extrusion = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .FirstOrDefault(IsRectangularExtrusion)
            ?? throw new InvalidOperationException("No rectangular extrusion was found.");

        var bbox = extrusion.get_BoundingBox(null)
            ?? throw new InvalidOperationException("Rectangular extrusion had no bounding box.");
        var x = bbox.Max.X - bbox.Min.X;
        var y = bbox.Max.Y - bbox.Min.Y;
        return (Math.Min(x, y), Math.Max(x, y));
    }

    public static (double Width, double Length) MeasureFirstRectangularConnectorSize(Document familyDocument) {
        var connector = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(ConnectorElement))
            .Cast<ConnectorElement>()
            .FirstOrDefault()
            ?? throw new InvalidOperationException("No connector was found.");

        var width = connector.get_Parameter(BuiltInParameter.CONNECTOR_WIDTH)?.AsDouble();
        var height = connector.get_Parameter(BuiltInParameter.CONNECTOR_HEIGHT)?.AsDouble();
        if (width is not > 0.0 || height is not > 0.0)
            throw new InvalidOperationException("Rectangular connector width/height parameters were not available.");

        return (Math.Min(width.Value, height.Value), Math.Max(width.Value, height.Value));
    }

    private static bool IsRoundExtrusion(Extrusion extrusion) {
        var profile = extrusion.Sketch?.Profile;
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        return loop != null && loop.Size > 0 && loop.Cast<Curve>().All(curve => curve is Arc);
    }

    private static bool IsRectangularExtrusion(Extrusion extrusion) {
        var profile = extrusion.Sketch?.Profile;
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        return loop != null && loop.Size == 4 && loop.Cast<Curve>().All(curve => curve is Line);
    }

    private static string SanitizePathSegment(string value) {
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Select(ch => invalidChars.Contains(ch) ? '_' : ch).ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "test" : sanitized;
    }

    private static string CreateShortToken(string value) {
        var sanitized = SanitizePathSegment(value);
        var lettersAndDigits = new string(sanitized
            .Where(char.IsLetterOrDigit)
            .ToArray());

        if (string.IsNullOrWhiteSpace(lettersAndDigits))
            return "test";

        return lettersAndDigits.Length <= 12
            ? lettersAndDigits.ToLowerInvariant()
            : lettersAndDigits[..12].ToLowerInvariant();
    }

    private static void ConfigureOwnerFamily(Document familyDocument, BuiltInCategory familyCategory, string familyName) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        var targetCategory = Category.GetCategory(familyDocument, familyCategory);
        if (targetCategory == null)
            throw new InvalidOperationException($"Category '{familyCategory}' is not available in the family document.");

        using var transaction = new Transaction(familyDocument, "Configure test family");
        _ = transaction.Start();

        familyDocument.OwnerFamily.FamilyCategory = targetCategory;
        familyDocument.OwnerFamily.Name = familyName.Trim();

        _ = transaction.Commit();
    }

}
