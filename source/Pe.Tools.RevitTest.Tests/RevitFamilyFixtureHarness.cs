using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.SettingsCatalog.Revit.FamilyFoundry;
using Pe.StorageRuntime.Revit.Core.Json;

namespace Pe.Tools.RevitTest.Tests;

internal static class RevitFamilyFixtureHarness {
    private const string GenericModelTemplateName = "Generic Model.rft";

    public static string ResolveGenericModelTemplatePath(
        Autodesk.Revit.ApplicationServices.Application application
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));

        var templateRoot = application.FamilyTemplatePath;
        var templatePath = Path.Combine(templateRoot, GenericModelTemplateName);

        if (!File.Exists(templatePath)) {
            throw new FileNotFoundException(
                $"Family template not found at '{templatePath}'. This harness uses Revit's installed family template path via Application.FamilyTemplatePath.");
        }

        return templatePath;
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
