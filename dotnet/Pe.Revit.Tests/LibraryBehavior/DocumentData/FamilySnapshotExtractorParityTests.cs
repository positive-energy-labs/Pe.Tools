using Pe.Revit.Parameters;
using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData;
using Newtonsoft.Json.Linq;
using System.Reflection;
using System.Security.Cryptography;

namespace Pe.Revit.Tests;

/// <summary>
///     Parity proof for the FamilyType.As* extraction path: values must match, cell for cell, raw values from a FamilyManager.CurrentType loop. Doubles are now exact explicit-unit strings,
///     so parity is numerical; strings, integers and references retain their existing representations.
/// </summary>
[TestFixture]
public sealed class FamilySnapshotExtractorParityTests {
    private Application _dbApplication = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) =>
        this._dbApplication = uiApplication?.Application
                              ?? throw new InvalidOperationException(
                                  "ricaun.RevitTest did not provide a UIApplication.");

    [Test]
    public void Extractor_matches_currenttype_ground_truth_cell_by_cell() {
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            this._dbApplication,
            BuiltInCategory.OST_GenericModel,
            "Snapshot Parity Generic Model");
        try {
            var fm = familyDocument.FamilyManager;
            using (var transaction = new Transaction(familyDocument, "Build parity fixture")) {
                _ = transaction.Start();
                var typeA = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Parity Type A");
                var typeB = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Parity Type B");
                var lengthParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Parity Length", SpecTypeId.Length, GroupTypeId.Geometry, false));
                var textParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Parity Text", SpecTypeId.String.Text, GroupTypeId.IdentityData, true));
                var yesNoParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Parity YesNo", SpecTypeId.Boolean.YesNo, GroupTypeId.Constraints, false));
                var formulaParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Parity Formula Length", SpecTypeId.Length, GroupTypeId.Geometry, false));

                fm.CurrentType = typeA;
                fm.Set(lengthParameter, 1.0);
                fm.Set(textParameter, "alpha");
                fm.Set(yesNoParameter, 1);
                fm.CurrentType = typeB;
                fm.Set(lengthParameter, 2.5);
                fm.Set(textParameter, "");
                fm.Set(yesNoParameter, 0);
                fm.SetFormula(formulaParameter, "Parity Length * 2");
                _ = transaction.Commit();
            }

            // Ground truth via the legacy path: switch CurrentType, read with the CurrentType-based
            // GetValueString overload. Sandbox because CurrentType switching mutates the document.
            var famDoc = new FamilyDocument(familyDocument);
            var groundTruth = new Dictionary<string, string?>(StringComparer.Ordinal);
            var rawDoubles = new Dictionary<string, double>(StringComparer.Ordinal);
            using (DocumentSandbox.BeginRollback(familyDocument, "Parity ground truth")) {
                foreach (var familyType in fm.Types.Cast<FamilyType>()) {
                    fm.CurrentType = familyType;
                    foreach (var parameter in fm.GetParameters()) {
                        var key = $"{parameter.Definition.Name}|{familyType.Name}";
                        groundTruth[key] = famDoc.GetValueString(parameter);
                        if (parameter.StorageType == StorageType.Double && familyType.HasValue(parameter)) rawDoubles[key] = familyType.AsDouble(parameter)!.Value;
                    }
                }
            }

            var record = FamilySnapshotExtractor.ExtractFromFamilyDocument(familyDocument);
            foreach (var issue in record.Issues.Where(issue => issue.Code == "FamilyParameterDescriptionReadFailed"))
                TestContext.Progress.WriteLine($"[PE_FF_PARAMETER_DESCRIPTION_EVIDENCE] {issue.ParameterName}: {issue.Message}");

            Assert.That(record.IsPartial, Is.False);
            Assert.That(record.Issues.Where(issue => issue.Severity == RevitDataIssueSeverity.Error), Is.Empty);
            Assert.That(record.TypeNames, Does.Contain("Parity Type A").And.Contain("Parity Type B"));
            Assert.That(record.Parameters.Select(parameter => parameter.Definition.Identity.Name),
                Is.SupersetOf(new[] { "Parity Length", "Parity Text", "Parity YesNo", "Parity Formula Length" }),
                string.Join(" | ", record.Issues.Select(issue => issue.Message)));

            var comparedCells = 0;
            foreach (var parameterSnapshot in record.Parameters) {
                foreach (var (typeName, extractedValue) in parameterSnapshot.ValuesPerType) {
                    var key = $"{parameterSnapshot.Definition.Identity.Name}|{typeName}";
                    Assert.That(groundTruth.ContainsKey(key), Is.True, $"Ground truth missing cell '{key}'.");
                    if (rawDoubles.TryGetValue(key, out var raw)) {
                        var spec = new ForgeTypeId(parameterSnapshot.Definition.DataTypeId);
                        double parsed;
                        if (Pe.Shared.RevitData.Families.PortableScalar.TryParse(extractedValue, out var scalar))
                            parsed = scalar.Kind == Pe.Shared.RevitData.Families.PortableScalarKind.Length ? scalar.Feet : UnitUtils.ConvertToInternalUnits(scalar.Value, UnitTypeId.Degrees);
                        else if (spec == SpecTypeId.Number) parsed = double.Parse(extractedValue!, System.Globalization.CultureInfo.InvariantCulture);
                        else Assert.That(UnitValueResolver.TryParse(familyDocument.GetUnits(), spec, extractedValue, out parsed), Is.True, key);
                        Assert.That(parsed, Is.EqualTo(raw).Within(Math.Max(1, Math.Abs(raw)) * 1e-12), key);
                    } else Assert.That(extractedValue, Is.EqualTo(groundTruth[key]), $"Cell '{key}' diverged.");
                    comparedCells++;
                }
            }

            Assert.That(comparedCells, Is.GreaterThanOrEqualTo(8), "Expected at least 4 parameters × 2 types.");

            var formulaSnapshot = record.Parameters.Single(parameter =>
                parameter.Definition.Identity.Name == "Parity Formula Length");
            Assert.That(formulaSnapshot.Formula, Is.EqualTo("Parity Length * 2"));
            Assert.That(formulaSnapshot.FormulaState, Is.EqualTo(FormulaState.Present));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void Internal_parameter_schema_probe_records_local_and_shared_description_evidence() {
        const string localDescription = "Known local family parameter description.";
        const string sharedDescription = "Known shared family parameter description.";
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(Internal_parameter_schema_probe_records_local_and_shared_description_evidence));
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            this._dbApplication,
            BuiltInCategory.OST_GenericModel,
            "Parameter schema description probe");
        try {
            FamilyParameter local;
            FamilyParameter shared;
            using (var transaction = new Transaction(familyDocument, "Build parameter schema probe")) {
                _ = transaction.Start();
                local = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "Schema Probe Local", SpecTypeId.String.Text, GroupTypeId.IdentityData, false));
                familyDocument.FamilyManager.SetDescription(local, localDescription);
                shared = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
                    familyDocument,
                    new SharedDefinitionSpec(
                        "Schema Probe Shared",
                        SpecTypeId.String.Text,
                        Description: sharedDescription,
                        Guid: Guid.NewGuid()),
                    GroupTypeId.IdentityData,
                    false);
                _ = transaction.Commit();
            }

            var apiAssembly = typeof(ParameterUtils).Assembly;
            var method = typeof(ParameterUtils).GetMethod(
                "GetParameterSchema",
                BindingFlags.Static | BindingFlags.NonPublic,
                null,
                [typeof(ElementId), typeof(Document)],
                null);
            var parameters = new JArray(
                Probe(local, "local", localDescription),
                Probe(shared, "shared", sharedDescription));
            var evidence = new JObject {
                ["revit"] = new JObject {
                    ["versionNumber"] = this._dbApplication.VersionNumber,
                    ["versionBuild"] = this._dbApplication.VersionBuild
                },
                ["api"] = new JObject {
                    ["assemblyName"] = apiAssembly.FullName,
                    ["version"] = apiAssembly.GetName().Version?.ToString(),
                    ["moduleVersionId"] = apiAssembly.ManifestModule.ModuleVersionId.ToString("D"),
                    ["path"] = apiAssembly.Location,
                    ["sha256"] = Sha256(apiAssembly.Location)
                },
                ["method"] = method == null
                    ? null
                    : new JObject {
                        ["name"] = method.Name,
                        ["isStatic"] = method.IsStatic,
                        ["isPublic"] = method.IsPublic,
                        ["isAssembly"] = method.IsAssembly,
                        ["returnType"] = method.ReturnType.FullName
                    },
                ["parameters"] = parameters
            };
            var path = Path.Combine(output, "family-parameter-schema-description.json");
            File.WriteAllText(path, evidence.ToString());

            Assert.That(File.Exists(path), Is.True);
            var emitted = JObject.Parse(File.ReadAllText(path));
            Assert.That(emitted["api"]?["version"]?.Value<string>(), Is.Not.Empty);
            Assert.That(emitted["api"]?["sha256"]?.Value<string>(), Has.Length.EqualTo(64));
            Assert.That(emitted["parameters"], Has.Count.EqualTo(2));
            foreach (var parameter in emitted["parameters"]!.OfType<JObject>()) {
                Assert.That(parameter["id"]?.Value<long>(), Is.Not.Zero);
                Assert.That(parameter["kind"]?.Value<string>(), Is.AnyOf("local", "shared"));
                Assert.That(parameter["error"], Is.Null, parameter["error"]?.Value<string>());
                Assert.That(parameter["rawJson"]?.Value<string>(), Is.Not.Empty);
                var rawJson = parameter["rawJson"]!.Value<string>()!;
                var schema = JObject.Parse(rawJson);
                var description = schema["constants"]?.OfType<JObject>()
                    .SingleOrDefault(constant => constant.Value<string>("id") == "description");
                Assert.That(description?.Value<string>("value"),
                    Is.EqualTo(parameter["expectedDescription"]?.Value<string>()),
                    $"Schema constants did not preserve the authored description for '{parameter["name"]}'.");
            }

            var captured = FamilySnapshotExtractor.ExtractFromFamilyDocument(familyDocument);
            Assert.That(captured.Issues.Where(issue => issue.Code == "FamilyParameterDescriptionReadFailed"), Is.Empty);
            Assert.That(captured.Parameters.Single(parameter => parameter.Definition.Identity.Name == local.Definition.Name)
                .Definition.Description, Is.EqualTo(localDescription));
            Assert.That(captured.Parameters.Single(parameter => parameter.Definition.Identity.Name == shared.Definition.Name)
                .Definition.Description, Is.EqualTo(sharedDescription));

            JObject Probe(FamilyParameter parameter, string kind, string expectedDescription) {
                var row = new JObject {
                    ["id"] = parameter.Id.Value(),
                    ["kind"] = kind,
                    ["name"] = parameter.Definition.Name,
                    ["expectedDescription"] = expectedDescription
                };
                try {
                    if (method == null)
                        throw new MissingMethodException(typeof(ParameterUtils).FullName, "GetParameterSchema");
                    row["rawJson"] = (string?)method.Invoke(null, [parameter.Id, familyDocument]);
                } catch (Exception error) {
                    var cause = error is TargetInvocationException { InnerException: { } inner } ? inner : error;
                    row["errorType"] = cause.GetType().FullName;
                    row["errorMessage"] = cause.Message;
                    row["error"] = cause.ToString();
                }

                return row;
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }

        static string Sha256(string path) {
            using var stream = File.OpenRead(path);
            using var hash = SHA256.Create();
            return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", string.Empty);
        }
    }
}
