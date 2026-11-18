using System.Reflection;
using Newtonsoft.Json;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class DuctSlotChainTests {
    [Test]
    public void Applied_slot_receipts_do_not_override_next_request_defaults(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            Assert.That(document.IsWorkshared, Is.False, "Writes require a disposable non-workshared document");
            Assert.That(DuctApplier.ReadStore(document).Store, Is.Null);
            using var group = new TransactionGroup(document, "CL protocol apply and revert");
            group.Start();
            var settings = (JsonSerializerSettings)typeof(Op)
                .GetField("JsonSettings", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;
            DuctParameterSlotOverrides Decode(string json) => JsonConvert.DeserializeObject<DuctParameterSlotOverrides>(json, settings)!;
            var slots = Decode("""{"fanFlow":"PE_M_Fan_AirFlow","terminalFlow":"revit:Flow"}""");
            var initial = new DuctApplyRequest(slots, [], [], [], [], [], [],
                new DuctLossStore { Version = DuctLossStore.CurrentVersion });
            var applied = DuctApplier.Apply(document, initial, false);
            Assert.That(applied.Writes.Any(w => w.Kind == "store" && w.Outcome == "written"), Is.True);

            // The store is a receipt; omitted request slots use the C# defaults.
            var inputs = DuctSnapshots.Snapshot(document, Decode("{}"),
                selector: new DuctSnapshotSelector(Kind: DuctSelectorKind.Roster), metadataOnly: true);
            Assert.Multiple(() => {
                Assert.That(inputs.Slots, Is.EqualTo(new DuctParameterSlotOverrides().Resolve()));
                Assert.That(inputs.Store!.Slots!.FanFlow, Is.EqualTo("PE_M_Fan_AirFlow"));
                Assert.That(inputs.Store.Slots.TerminalFlow, Is.EqualTo("revit:Flow"));
            });
            var next = initial with { Slots = Decode("{}"), Store = inputs.Store! };
            var preview = DuctApplier.Apply(document, next, true);
            Assert.That(preview.Writes.Where(w => w.Kind == "slot").Select(w => w.Key),
                Is.EquivalentTo(new[] { "fanFlow", "terminalFlow" }), "the receipt reports the names this request would write");
            var partial = DuctSnapshots.Snapshot(document, Decode("""{"componentDrop":"Damper Drop"}"""),
                selector: new DuctSnapshotSelector(Kind: DuctSelectorKind.Roster), metadataOnly: true);
            Assert.Multiple(() => {
                Assert.That(partial.Slots.ComponentDrop, Is.EqualTo("Damper Drop"));
                Assert.That(partial.Slots.FanFlow, Is.EqualTo(inputs.Slots.FanFlow));
                Assert.That(partial.Slots.TerminalFlow, Is.EqualTo(inputs.Slots.TerminalFlow));
            });
            group.RollBack();
            Assert.That(DuctApplier.ReadStore(document).Store, Is.Null, "Independent readback after revert");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }
}
