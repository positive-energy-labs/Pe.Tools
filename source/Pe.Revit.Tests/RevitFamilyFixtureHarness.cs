using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamDocument.GetValue;
using Pe.Revit.Global.Utils.Files;
using Pe.Shared.RevitData.Parameters;
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
    internal sealed record ParameterDefinitionSpec(string Name, ForgeTypeId DataType, ForgeTypeId? Group = null, bool IsInstance = true);
    internal sealed record ParameterTypeSnapshot(string TypeName, IReadOnlyDictionary<string, string> ValuesByParameter);
    internal sealed record ParameterValueSnapshot(
        string TypeName,
        string? Formula,
        object? RawValue,
        string? ValueString,
        bool HasValue,
        StorageType StorageType,
        string DataTypeId
    );

    internal sealed record SharedDefinitionSpec(
        string Name,
        ForgeTypeId DataType,
        string GroupName = "TempGroup",
        string Description = "",
        Guid? Guid = null,
        bool Visible = true
    );

    internal sealed record ProjectBindingProbe(
        string Name,
        string DefinitionType,
        string IdentityKey,
        string IdentityKind,
        Guid? SharedGuid,
        bool IsShared,
        bool IsInstanceBinding,
        string? GroupTypeId,
        string? DataTypeId,
        IReadOnlyList<string> CategoryNames
    );

    internal sealed record FamilyParameterProbe(
        string Name,
        bool IsShared,
        bool IsInstance,
        string IdentityKind,
        Guid? SharedGuid,
        long? ParameterElementId,
        string? GroupTypeId,
        string? DataTypeId,
        string? Formula
    );

    internal sealed record FamilySizeTableProbe(
        string TableName,
        string ExportedCsvPath,
        IReadOnlyList<string> HeaderColumns,
        IReadOnlyList<string> Rows
    );

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

    public static Document CreateProjectDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        UnitSystem unitSystem = UnitSystem.Imperial
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));

        var defaultTemplatePath = application.DefaultProjectTemplate;
        var document = !string.IsNullOrWhiteSpace(defaultTemplatePath) && File.Exists(defaultTemplatePath)
            ? application.NewProjectDocument(defaultTemplatePath)
            : application.NewProjectDocument(unitSystem);
        if (document == null)
            throw new InvalidOperationException($"Failed to create project document for unit system '{unitSystem}'.");
        if (document.IsFamilyDocument)
            throw new InvalidOperationException("Expected a project document.");

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

    public static string SaveDocumentCopy(
        Document document,
        string outputDirectory,
        string fileNameStem
    ) {
        if (document == null)
            throw new ArgumentNullException(nameof(document));
        if (string.IsNullOrWhiteSpace(outputDirectory))
            throw new ArgumentException("Output directory is required.", nameof(outputDirectory));
        if (string.IsNullOrWhiteSpace(fileNameStem))
            throw new ArgumentException("File name stem is required.", nameof(fileNameStem));

        Directory.CreateDirectory(outputDirectory);
        var extension = document.IsFamilyDocument ? ".rfa" : ".rvt";
        var safeFileNameStem = SanitizePathSegment(fileNameStem.Trim());
        var savePath = Path.Combine(outputDirectory, $"{safeFileNameStem}{extension}");
        document.SaveAs(
            savePath,
            new SaveAsOptions {
                OverwriteExistingFile = true,
                Compact = true,
                MaximumBackups = 1
            });

        return savePath;
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

    public static Document OpenFamilyDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        string familyPath
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));
        if (string.IsNullOrWhiteSpace(familyPath))
            throw new ArgumentException("Family path is required.", nameof(familyPath));
        if (!File.Exists(familyPath))
            throw new FileNotFoundException($"Family file was not found at '{familyPath}'.", familyPath);

        return application.OpenDocumentFile(familyPath)
               ?? throw new InvalidOperationException($"Failed to open family document '{familyPath}'.");
    }

    public static FFManagerSettings LoadProfileFixture(string fixtureFileName) {
        var fixturePath = GetProfileFixturePath(fixtureFileName);
        var json = File.ReadAllText(fixturePath);
        var settings = RevitJsonFormatting.CreateRevitIndentedSettings();

        if (!settings.Converters.OfType<StringEnumConverter>().Any())
            settings.Converters.Add(new StringEnumConverter());

        return JsonConvert.DeserializeObject<FFManagerSettings>(json, settings)
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

    public static Family LoadFamilyIntoProject(
        Autodesk.Revit.ApplicationServices.Application application,
        Document projectDocument,
        string familyPath,
        IFamilyLoadOptions? loadOptions = null
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));
        if (projectDocument == null)
            throw new ArgumentNullException(nameof(projectDocument));
        if (projectDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a project document.");
        if (string.IsNullOrWhiteSpace(familyPath))
            throw new ArgumentException("Family path is required.", nameof(familyPath));
        if (!File.Exists(familyPath))
            throw new FileNotFoundException($"Family file was not found at '{familyPath}'.", familyPath);

        Document? familyDocument = null;

        try {
            familyDocument = application.OpenDocumentFile(familyPath);
            if (familyDocument == null || !familyDocument.IsFamilyDocument)
                throw new InvalidOperationException($"Failed to open family document '{familyPath}'.");

            return familyDocument.LoadFamily(projectDocument, loadOptions ?? new DefaultFamilyLoadOptions());
        } finally {
            CloseDocument(familyDocument);
        }
    }

    public static Family LoadFamilyFixtureIntoProject(
        Autodesk.Revit.ApplicationServices.Application application,
        Document projectDocument,
        string fixtureFileName,
        IFamilyLoadOptions? loadOptions = null
    ) {
        var fixturePath = GetFamilyFixturePath(fixtureFileName);
        return LoadFamilyIntoProject(application, projectDocument, fixturePath, loadOptions);
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

    public static FamilyParameter AddFamilyParameter(Document familyDocument, ParameterDefinitionSpec parameter) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        var familyDoc = new FamilyDocument(familyDocument);
        return familyDoc.AddFamilyParameter(
            parameter.Name,
            parameter.Group ?? new ForgeTypeId(""),
            parameter.DataType,
            parameter.IsInstance);
    }

    public static ExternalDefinition CreateSharedParameterDefinition(
        Document document,
        SharedDefinitionSpec definitionSpec
    ) {
        if (document == null)
            throw new ArgumentNullException(nameof(document));
        if (definitionSpec == null)
            throw new ArgumentNullException(nameof(definitionSpec));
        if (string.IsNullOrWhiteSpace(definitionSpec.Name))
            throw new ArgumentException("Shared parameter name is required.", nameof(definitionSpec));

        using var tempSharedParamFile = new TempSharedParamFile(document);
        var definitionGroup = tempSharedParamFile.DefinitionFile.Groups.get_Item(definitionSpec.GroupName)
                              ?? tempSharedParamFile.DefinitionFile.Groups.Create(definitionSpec.GroupName);
        var existing = definitionGroup.Definitions.get_Item(definitionSpec.Name) as ExternalDefinition;
        if (existing != null)
            return existing;

        var options = new ExternalDefinitionCreationOptions(definitionSpec.Name, definitionSpec.DataType) {
            Description = definitionSpec.Description,
            Visible = definitionSpec.Visible
        };
        if (definitionSpec.Guid.HasValue && definitionSpec.Guid.Value != Guid.Empty)
            options.GUID = definitionSpec.Guid.Value;

        return (ExternalDefinition)definitionGroup.Definitions.Create(options);
    }

    public static FamilyParameter AddSharedFamilyParameter(
        Document familyDocument,
        SharedDefinitionSpec definitionSpec,
        ForgeTypeId? groupTypeId = null,
        bool isInstance = true
    ) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        using var tempSharedParamFile = new TempSharedParamFile(familyDocument);
        var definitionGroup = tempSharedParamFile.DefinitionFile.Groups.get_Item(definitionSpec.GroupName)
                              ?? tempSharedParamFile.DefinitionFile.Groups.Create(definitionSpec.GroupName);
        var externalDefinition = definitionGroup.Definitions.get_Item(definitionSpec.Name) as ExternalDefinition;
        if (externalDefinition == null) {
            var options = new ExternalDefinitionCreationOptions(definitionSpec.Name, definitionSpec.DataType) {
                Description = definitionSpec.Description,
                Visible = definitionSpec.Visible
            };
            if (definitionSpec.Guid.HasValue && definitionSpec.Guid.Value != Guid.Empty)
                options.GUID = definitionSpec.Guid.Value;
            externalDefinition = (ExternalDefinition)definitionGroup.Definitions.Create(options);
        }

        var familyDoc = new FamilyDocument(familyDocument);
        return familyDoc.AddSharedParameter(new Pe.Revit.Global.SharedParameterDefinition(
            externalDefinition,
            groupTypeId ?? GroupTypeId.IdentityData,
            isInstance));
    }

    public static FamilyParameter? FindSharedFamilyParameter(Document familyDocument, Guid sharedGuid) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");
        if (sharedGuid == Guid.Empty)
            throw new ArgumentException("Shared GUID is required.", nameof(sharedGuid));

        return familyDocument.FamilyManager.get_Parameter(sharedGuid);
    }

    public static (bool DefinitionExisted, bool BindingSucceeded, string ProvidedDefinitionType) AddOrUpdateProjectParameterBinding(
        Document projectDocument,
        Definition definition,
        bool isInstance,
        ForgeTypeId groupTypeId,
        params BuiltInCategory[] categories
    ) {
        if (projectDocument == null)
            throw new ArgumentNullException(nameof(projectDocument));
        if (projectDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a project document.");
        if (definition == null)
            throw new ArgumentNullException(nameof(definition));

        var categorySet = projectDocument.Application.Create.NewCategorySet();
        foreach (var builtInCategory in categories.Distinct()) {
            var category = Category.GetCategory(projectDocument, builtInCategory);
            if (category != null)
                _ = categorySet.Insert(category);
        }

        ElementBinding binding = isInstance
            ? projectDocument.Application.Create.NewInstanceBinding(categorySet)
            : projectDocument.Application.Create.NewTypeBinding(categorySet);

        using var transaction = new Transaction(projectDocument, $"Bind parameter: {definition.Name}");
        _ = transaction.Start();
        var map = projectDocument.ParameterBindings;
        var exists = map.Contains(definition);
        var success = !exists
            ? map.Insert(definition, binding, groupTypeId)
            : map.ReInsert(definition, binding, groupTypeId);
        _ = transaction.Commit();

        return (exists, success, definition.GetType().Name);
    }

    public static IReadOnlyList<ProjectBindingProbe> CollectProjectBindingProbes(Document projectDocument) {
        if (projectDocument == null)
            throw new ArgumentNullException(nameof(projectDocument));
        if (projectDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a project document.");

        var iterator = projectDocument.ParameterBindings.ForwardIterator();
        var probes = new List<ProjectBindingProbe>();
        while (iterator.MoveNext()) {
            if (iterator.Key is not Definition definition || iterator.Current is not ElementBinding binding)
                continue;

            var identity = RevitParameterIdentityFactory.FromDefinition(projectDocument, definition);
            var sharedGuid = identity.SharedGuid;
            var categoryNames = binding.Categories?.Cast<Category>()
                .Select(category => category.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToArray() ?? [];

            probes.Add(new ProjectBindingProbe(
                definition.Name,
                definition.GetType().Name,
                identity.Key,
                identity.Kind.ToString(),
                sharedGuid,
                sharedGuid.HasValue,
                binding is InstanceBinding,
                NormalizeForgeTypeId(definition.GetGroupTypeId()),
                NormalizeForgeTypeId(definition.GetDataType()),
                categoryNames));
        }

        return probes
            .OrderBy(probe => probe.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(probe => probe.IdentityKey, StringComparer.Ordinal)
            .ToArray();
    }

    public static SharedParameterElement? FindSharedParameterElement(Document projectDocument, Guid sharedGuid) {
        if (projectDocument == null)
            throw new ArgumentNullException(nameof(projectDocument));
        if (projectDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a project document.");
        if (sharedGuid == Guid.Empty)
            throw new ArgumentException("Shared GUID is required.", nameof(sharedGuid));

        return SharedParameterElement.Lookup(projectDocument, sharedGuid);
    }

    public static IReadOnlyList<FamilyParameterProbe> CollectFamilyParameterProbes(Document familyDocument) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");

        return familyDocument.FamilyManager.Parameters
            .Cast<FamilyParameter>()
            .Select(parameter => {
                var identity = RevitParameterIdentityFactory.FromFamilyParameter(parameter);
                return new FamilyParameterProbe(
                    parameter.Definition.Name,
                    parameter.IsShared,
                    parameter.IsInstance,
                    identity.Kind.ToString(),
                    identity.SharedGuid,
                    identity.ParameterElementId,
                    NormalizeForgeTypeId(parameter.Definition.GetGroupTypeId()),
                    NormalizeForgeTypeId(parameter.Definition.GetDataType()),
                    string.IsNullOrWhiteSpace(parameter.Formula) ? null : parameter.Formula);
            })
            .OrderBy(probe => probe.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(probe => probe.SharedGuid.HasValue ? probe.SharedGuid.Value.ToString("D") : string.Empty, StringComparer.Ordinal)
            .ThenBy(probe => probe.ParameterElementId ?? long.MinValue)
            .ToArray();
    }

    public static IReadOnlyList<FamilySizeTableProbe> ExportFamilySizeTables(
        Document familyDocument,
        string outputDirectory
    ) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");
        if (string.IsNullOrWhiteSpace(outputDirectory))
            throw new ArgumentException("Output directory is required.", nameof(outputDirectory));

        Directory.CreateDirectory(outputDirectory);

        using var manager = FamilySizeTableManager.GetFamilySizeTableManager(
            familyDocument,
            familyDocument.OwnerFamily.Id);

        if (manager == null || !manager.IsValidObject || manager.NumberOfSizeTables == 0)
            return [];

        var probes = new List<FamilySizeTableProbe>();
        foreach (var tableName in manager.GetAllSizeTableNames().OrderBy(name => name, StringComparer.Ordinal)) {
            var safeTableName = SanitizePathSegment(tableName);
            var exportPath = Path.Combine(outputDirectory, $"{safeTableName}.csv");
            var exportSucceeded = manager.ExportSizeTable(tableName, exportPath);
            if (!exportSucceeded || !File.Exists(exportPath)) {
                throw new InvalidOperationException($"Failed to export family size table '{tableName}' to '{exportPath}'.");
            }

            var rows = File.ReadAllLines(exportPath);
            var headers = rows.Length == 0
                ? []
                : rows[0].Split(',').Select(header => header.Trim()).ToArray();

            probes.Add(new FamilySizeTableProbe(
                tableName,
                exportPath,
                headers,
                rows));
        }

        return probes;
    }

    public static Document ReopenDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        Document document,
        string outputDirectory,
        string fileNameStem
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));
        if (document == null)
            throw new ArgumentNullException(nameof(document));

        var savedPath = SaveDocumentCopy(document, outputDirectory, fileNameStem);
        CloseDocument(document);
        return application.OpenDocumentFile(savedPath);
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;

    public static FamilyType EnsureFamilyType(Document familyDocument, string typeName) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");
        if (string.IsNullOrWhiteSpace(typeName))
            throw new ArgumentException("Type name is required.", nameof(typeName));

        var familyManager = familyDocument.FamilyManager;
        return familyManager.Types
                   .Cast<FamilyType>()
                   .FirstOrDefault(type => string.Equals(type.Name, typeName, StringComparison.Ordinal))
               ?? familyManager.NewType(typeName);
    }

    public static void SetCurrentType(Document familyDocument, string typeName) {
        var familyType = EnsureFamilyType(familyDocument, typeName);
        familyDocument.FamilyManager.CurrentType = familyType;
    }

    public static IReadOnlyList<ParameterValueSnapshot> CaptureParameterSnapshots(
        Document familyDocument,
        string parameterName,
        IReadOnlyList<string> typeNames
    ) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");
        if (string.IsNullOrWhiteSpace(parameterName))
            throw new ArgumentException("Parameter name is required.", nameof(parameterName));

        var familyDoc = new FamilyDocument(familyDocument);
        var familyManager = familyDocument.FamilyManager;
        var parameter = familyManager.get_Parameter(parameterName)
            ?? throw new InvalidOperationException($"Family parameter '{parameterName}' was not found.");
        var snapshots = new List<ParameterValueSnapshot>(typeNames.Count);

        foreach (var typeName in typeNames.Distinct(StringComparer.Ordinal)) {
            SetCurrentType(familyDocument, typeName);
            familyDocument.Regenerate();
            snapshots.Add(new ParameterValueSnapshot(
                typeName,
                parameter.Formula,
                familyDoc.GetValue(parameter),
                familyDoc.GetValueString(parameter),
                familyDoc.HasValue(parameter),
                parameter.StorageType,
                parameter.Definition.GetDataType().TypeId));
        }

        return snapshots;
    }

    public static IReadOnlyList<ParameterValueSnapshot> ApplyParameterSnapshots(
        Document familyDocument,
        IReadOnlyList<ParameterTypeSnapshot> snapshots,
        Func<Document, string, ParameterValueSnapshot> evaluator
    ) {
        if (familyDocument == null)
            throw new ArgumentNullException(nameof(familyDocument));
        if (!familyDocument.IsFamilyDocument)
            throw new InvalidOperationException("Expected a family document.");
        if (snapshots.Count == 0)
            return [];
        if (evaluator == null)
            throw new ArgumentNullException(nameof(evaluator));

        var familyManager = familyDocument.FamilyManager;
        var familyDoc = new FamilyDocument(familyDocument);
        var results = new List<ParameterValueSnapshot>(snapshots.Count);

        using var transaction = new Transaction(familyDocument, "Apply parameter snapshots");
        _ = transaction.Start();

        try {
            foreach (var snapshot in snapshots) {
                familyManager.CurrentType = EnsureFamilyType(familyDocument, snapshot.TypeName);

                foreach (var (parameterName, value) in snapshot.ValuesByParameter) {
                    var parameter = familyManager.get_Parameter(parameterName)
                        ?? throw new InvalidOperationException($"Family parameter '{parameterName}' was not found.");

                    if (!string.IsNullOrWhiteSpace(parameter.Formula) && !familyDoc.UnsetFormula(parameter)) {
                        throw new InvalidOperationException(
                            $"Family parameter '{parameterName}' formula could not be cleared for snapshot apply evaluation.");
                    }

                    switch (parameter.StorageType) {
                    case StorageType.String:
                        familyManager.Set(parameter, value);
                        break;
                    case StorageType.Integer:
                        familyManager.Set(parameter, int.Parse(value, System.Globalization.CultureInfo.InvariantCulture));
                        break;
                    case StorageType.Double:
                        familyManager.Set(parameter, double.Parse(value, System.Globalization.CultureInfo.InvariantCulture));
                        break;
                    default:
                        throw new InvalidOperationException(
                            $"Snapshot apply does not support StorageType.{parameter.StorageType} for '{parameterName}'.");
                    }
                }

                familyDocument.Regenerate();
                results.Add(evaluator(familyDocument, snapshot.TypeName));
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
