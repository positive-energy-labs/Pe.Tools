using Newtonsoft.Json.Linq;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests;

/// <summary>
///     K3 native readback: a stored loss store with a sentinel in every map survives a sparse apply that changes one
///     ruling and explicitly deletes another. Plan and apply report the same truthful before/after per touched key.
/// </summary>
[TestFixture]
public sealed class DuctStoreOverlayReadbackTests {
    [Test]
    public void A_sparse_apply_keeps_every_stored_sentinel_and_removes_only_the_named_delete(UIApplication uiApplication) {
        var document = RevitFamilyFixtureHarness.CreateProjectDocument(uiApplication.Application);
        try {
            var now = DateTimeOffset.UnixEpoch;
            var roleTarget = document.ProjectInformation;
            static string Key(int id) => $"5191cd54-1806-4a9d-8e57-bb8a93975f4a-{id:x8}";
            var stored = new DuctLossStore {
                Version = DuctLossStore.CurrentVersion,
                Rules = new(StringComparer.Ordinal) { ["rule-s"] = new DuctRuleChoice("SR5-1") },
                Instances = new() { [Key(101)] = new DuctInstanceRecord("SR5-1", "in", 0.5, now) },
                Terminals = new() { [Key(102)] = new DuctDropRecord(0.1, "s", now) },
                TerminalFlows = new() { [Key(103)] = new DuctFlowRecord(100, "s", now) },
                EquipmentFlows = new() { [Key(104)] = new DuctFlowRecord(200, "s", now) },
                Verdicts = new(StringComparer.Ordinal) {
                    ["keep:1"] = new DuctVerdictRecord("ignore", now), ["drop:2"] = new DuctVerdictRecord("ignore", now)
                },
                Roles = new() { [Key(105)] = new DuctRoleRecord("fan", now) },
                Slots = new DuctParameterSlotOverrides(RequiredEsp: "Stored Static"),
                WorkRevision = 3,
                Unknown = new Dictionary<string, JToken> { ["future"] = "kept" }
            };
            using (var t = new Transaction(document, "Seed store")) {
                t.Start();
                _ = Pe.Revit.Parameters.OwnerBlobStore.Write(document, DuctLossStore.Owner, stored.ToData());
                Assert.That(t.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }

            // Sparse: one new role, one explicit verdict delete, nothing else named.
            var request = new DuctApplyRequest(null, [], [], [], [], [], [],
                new DuctLossStore { Version = DuctLossStore.CurrentVersion, WorkRevision = 3, Roles = new() { [roleTarget.UniqueId] = new DuctRoleRecord("passive", now) } },
                new DuctStoreDeletes { Verdicts = ["drop:2"], Instances = [Key(101)] });
            var plan = DuctApplier.Apply(document, request, true);
            var applied = DuctApplier.Apply(document, request, false);
            foreach (var result in new[] { plan, applied })
                Assert.Multiple(() => {
                    Assert.That(result.Writes.Where(w => w.Kind is "verdict" or "role" or "slot" || w.Kind.StartsWith("store-")).Select(w => (w.Kind, w.Key ?? w.UniqueId, w.Before, w.After)),
                        Is.EquivalentTo(new[] {
                            ("verdict", "drop:2", "ignore", "none"), ("role", roleTarget.UniqueId, "none", "passive"),
                            ("store-instance", Key(101), "SR5-1 c=0.5", "none"),
                            ("slot", "requiredEsp", "Stored Static", "PE_M_Fan_ExternalStaticPressure")
                        }),
                        "every changed store key in every map, with its concrete stored before; no phantom removals");
                    Assert.That(result.Writes.Single(w => w.Kind == "role").Id, Is.EqualTo(roleTarget.Id.Value()));
                    Assert.That(result.Writes.Single(w => w.Kind == "store").After, Is.EqualTo("revision 4"));
                });

            var next = DuctApplier.ReadStore(document).Store!;
            Assert.Multiple(() => {
                Assert.That(next.Rules.Keys, Is.EquivalentTo(new[] { "rule-s" }));
                Assert.That(next.Instances, Is.Empty, "the explicit provenance delete landed");
                Assert.That(next.Terminals.Keys, Is.EquivalentTo(new[] { Key(102) }));
                Assert.That(next.TerminalFlows.Keys, Is.EquivalentTo(new[] { Key(103) }));
                Assert.That(next.EquipmentFlows.Keys, Is.EquivalentTo(new[] { Key(104) }));
                Assert.That(next.Verdicts.Keys, Is.EquivalentTo(new[] { "keep:1" }));
                Assert.That(next.Roles.Keys, Is.EquivalentTo(new[] { Key(105), roleTarget.UniqueId }));
                Assert.That(next.Slots?.RequiredEsp, Is.EqualTo(new DuctParameterSlotOverrides().Resolve().RequiredEsp),
                    "the receipt records the C# default used by this request");
                Assert.That(next.Unknown["future"].ToString(), Is.EqualTo("kept"));
                Assert.That(next.WorkRevision, Is.EqualTo(4));
            });

            // A retained ruling request can still reach the native door with the current revision.
            var repeated = DuctApplier.Apply(document, request with {
                Store = request.Store with { WorkRevision = next.WorkRevision }
            }, true);
            Assert.That(repeated.Writes.Select(w => (w.Kind, w.Outcome, w.After)),
                Is.EqualTo(new[] { ("store", "unchanged", "revision 4") }));
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(document);
        }
    }
}
