using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Structure;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Mep;

namespace Pe.Revit.Tests;

[TestFixture, NonParallelizable]
public sealed class ReviewMepScopeTests {
    [Test]
    public void Explicit_electrical_system_is_not_a_duct_system(UIApplication ui) {
        var template = Directory.GetFiles(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            $"Autodesk\\RVT {ui.Application.VersionNumber}\\Templates"), "Electrical-Default.rte", SearchOption.AllDirectories).First();
        var document = ui.Application.NewProjectDocument(template);
        try {
            ElectricalSystem circuit;
            using (var tx = new Transaction(document, "Seed an electrical circuit")) {
                tx.Start();
                var symbol = new FilteredElementCollector(document).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
                    .First(s => s.FamilyName.StartsWith("Dry Type Transformer", StringComparison.Ordinal) && s.Name == "15 kVA");
                symbol.Activate();
                var level = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>().First();
                var equipment = document.Create.NewFamilyInstance(XYZ.Zero, symbol, level, StructuralType.NonStructural);
                document.Regenerate();
                circuit = ElectricalSystem.Create(document, new List<ElementId> { equipment.Id }, ElectricalSystemType.PowerCircuit);
                tx.Commit();
            }
            foreach (var domain in new string?[] { "duct", null, "piping" }) {
                var result = MepSystemReads.Members(document, new MepSystemMembersRequest(circuit.UniqueId, Domain: domain));
                TestContext.WriteLine(Newtonsoft.Json.JsonConvert.SerializeObject(new { domain, result }));
                Assert.Multiple(() => {
                    Assert.That(result.Value, Is.Null, "an unsupported electrical system must not be reported as a duct");
                    Assert.That(result.Refusal?.Code, Is.EqualTo("MepSystemsEmpty"));
                });
            }
        } finally { document.Close(false); }
    }
}
