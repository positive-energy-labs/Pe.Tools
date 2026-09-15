using Autodesk.Revit.DB.Electrical;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ElectricalConnectorParameterCensusTests {
    [Test]
    public void Electrical_connector_parameter_surface_records_current_candidates_by_system_type(UIApplication uiApplication) {
        var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Electrical_connector_parameter_surface_records_current_candidates_by_system_type));
        var rows = new JArray();
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(
            uiApplication.Application, BuiltInCategory.OST_MechanicalEquipment, "Electrical connector parameter census");
        try {
            using var transaction = new Transaction(document, "Census electrical connector parameters");
            transaction.Start();
            var host = new FilteredElementCollector(document).OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
                .OrderBy(plane => plane.Id.Value()).First();
            foreach (var systemType in Enum.GetValues(typeof(ElectricalSystemType)).Cast<ElectricalSystemType>().Distinct()) {
                var row = new JObject { ["systemType"] = systemType.ToString(), ["systemTypeValue"] = (int)systemType };
                rows.Add(row);
                using var attempt = new SubTransaction(document);
                attempt.Start();
                try {
                    var connector = ConnectorElement.CreateElectricalConnector(document, systemType, host.GetReference());
                    document.Regenerate();
                    var parameters = new JArray(connector.Parameters.Cast<Parameter>()
                        .OrderBy(parameter => parameter.Id.Value()).Select(ParameterRow));
                    row["supported"] = true;
                    row["systemClassification"] = connector.SystemClassification.ToString();
                    row["parameters"] = parameters;
                    row["possibleMcaOrCurrentTargets"] = new JArray(parameters.OfType<JObject>()
                        .Where(parameter => parameter.Value<bool>("possibleMcaOrCurrentTarget"))
                        .Select(parameter => new JObject {
                            ["id"] = parameter["id"]?.DeepClone(),
                            ["builtInParameter"] = parameter["builtInParameter"]?.DeepClone(),
                            ["name"] = parameter["name"]?.DeepClone(),
                            ["spec"] = parameter["spec"]?.DeepClone(),
                            ["canAssociate"] = parameter["canAssociate"]?.DeepClone()
                        }));
                } catch (Exception error) {
                    row["supported"] = false;
                    row["errorType"] = error.GetType().FullName;
                    row["error"] = error.Message;
                } finally {
                    if (attempt.GetStatus() == TransactionStatus.Started) attempt.RollBack();
                }
            }
            transaction.RollBack();
        } finally {
            document.Close(false);
            File.WriteAllText(Path.Combine(output, "electrical-connector-parameter-census.json"), rows.ToString());
        }

        Assert.That(rows.OfType<JObject>().Single(row => row.Value<string>("systemType") == nameof(ElectricalSystemType.PowerBalanced))
            .Value<bool>("supported"), Is.True, "The company connector primitive depends on native PowerBalanced creation support.");

        JObject ParameterRow(Parameter parameter) {
            var builtIn = (parameter.Definition as InternalDefinition)?.BuiltInParameter ?? BuiltInParameter.INVALID;
            var spec = parameter.Definition.GetDataType();
            var searchable = $"{parameter.Definition.Name} {builtIn}";
            var possibleCurrentTarget = spec == SpecTypeId.Current
                || new[] { "current", "ampacity", "amperage", "mca" }.Any(term => searchable.Contains(term, StringComparison.OrdinalIgnoreCase));
            return new JObject {
                ["id"] = parameter.Id.Value(),
                ["builtInParameter"] = builtIn == BuiltInParameter.INVALID ? null : builtIn.ToString(),
                ["name"] = parameter.Definition.Name,
                ["spec"] = spec.TypeId,
                ["storage"] = parameter.StorageType.ToString(),
                ["readOnly"] = parameter.IsReadOnly,
                ["canAssociate"] = document.FamilyManager.CanElementParameterBeAssociated(parameter),
                ["possibleMcaOrCurrentTarget"] = possibleCurrentTarget
            };
        }
    }
}
