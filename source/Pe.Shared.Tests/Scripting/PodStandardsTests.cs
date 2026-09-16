using Newtonsoft.Json.Linq;
using Pe.Shared.Scripting.Pods.Standards;

namespace Pe.Shared.Tests.Scripting;

/// <summary>
///     Spike tests for the pod standards brief (.artifacts/handoffs/2026-09-16-pod-standards-brief.md).
///     Deterministic lane. Each test pins one gate's reason string, because verdict 12 makes the
///     reason part of the contract, not a log line.
/// </summary>
[TestFixture]
public sealed class PodStandardsTests {
    private const string BaseManifest = """
        {
          "schemaVersion": 2,
          "id": "acme-standards",
          "name": "Acme Standards",
          "version": "1.0.0",
          "entrypoints": []
        }
        """;

    [Test]
    public void RetiredGlobalScopeNamesItsReplacement() {
        Assert.That(PodReference.TryParse("@global/_mapping-data/mech", out _, out var reason), Is.False);
        Assert.That(reason, Does.Contain("retired"));
        Assert.That(reason, Does.Contain("@default/"));
    }

    [Test]
    public void LocalIsReservedBecauseTheGrammarAlreadyUsesIt() {
        var read = PodHeaderReader.Read(BaseManifest.Replace("acme-standards", "local"));
        Assert.That(read.Success, Is.False);
        Assert.That(read.Findings.Select(f => f.Reason), Has.Some.Contains("reserved by the reference grammar"));
    }

    [Test]
    public void OneVersionPerIdIsAPropertyOfTheMachineNotThePod() {
        var a = new PodWorldEntry(PodId.Parse("mep-base"), Version("1.0.0"), new Dictionary<string, string>());
        var b = new PodWorldEntry(PodId.Parse("mep-base"), Version("2.0.0"), new Dictionary<string, string>());
        Assert.That(PodWorld.TryCreate([a, b], out _, out var reason), Is.False);
        Assert.That(reason, Does.Contain("installed twice"));
        Assert.That(reason, Does.Contain("upgrade replaces in place"));
    }

    [Test]
    public void InstalledPodRefusesToBuildAndNamesFork() {
        const string manifest = """
            {
              "schemaVersion": 2,
              "id": "acme-standards",
              "name": "Acme Standards",
              "version": "1.0.0",
              "entrypoints": [],
              "origin": { "remote": "https://example.invalid/acme.git", "commit": "abc123" }
            }
            """;
        var snapshot = PodSnapshot.Create("acme-standards", [new KeyValuePair<string, string>("pod.json", manifest)]);

        var outcome = PodBuilder.Build(snapshot, PodWorld.Empty, false);

        var report = ((PodBuildOutcome.Refused)outcome).Report;
        Assert.That(report.Errors.Select(e => e.Reason), Has.Some.Contains("pea pod fork acme-standards"));
    }

    [Test]
    public void ClosureRuleSeparatesNotRequiredFromNotInManifest() {
        var snapshot = PodSnapshot.Create("acme-standards", [
            new KeyValuePair<string, string>("pod.json", BaseManifest),
            new KeyValuePair<string, string>("settings/hp.patch.json", """{ "$preset": "@mep-base/patches/hp" }""")
        ]);

        var report = ((PodBuildOutcome.Refused)PodBuilder.Build(snapshot, PodWorld.Empty, false)).Report;
        var closure = report.Errors.Where(e => e.GateId == "pod.closure").ToList();

        Assert.That(closure, Is.Not.Empty);
        Assert.That(closure[0].Reason, Does.Contain("not in requires"));
        Assert.That(closure[0].Reason, Does.Contain("\"id\": \"mep-base\""));
    }

    [Test]
    public void IncludeBesideSiblingsIsRefusedAsOverride() {
        var result = PodComposer.Compose(
            PodPath.Parse("composed/x.patch.json"),
            """{ "$include": "@local/frag", "extra": 1 }""",
            new NullResolver()
        );

        Assert.That(result.Document, Is.Null);
        Assert.That(result.Errors, Has.Some.Contains("includes never override"));
    }

    [Test]
    public void HandEditedComposedDocumentIsDrift() {
        var files = BuildablePod();
        files["composed/hp.patch.json"] = """{ "flow": 999 }""";
        var snapshot = PodSnapshot.Create("acme-standards", files.Select(kv => new KeyValuePair<string, string>(kv.Key, kv.Value)));

        var report = ((PodBuildOutcome.Refused)PodBuilder.Build(snapshot, World(), false)).Report;

        Assert.That(report.Errors.Select(e => e.Reason), Has.Some.Contains("drifted from settings/"));
    }

    [Test]
    public void AProvenBuildCarriesALayerStampForEveryPodItsBytesCameFrom() {
        var files = BuildablePod();
        var snapshot = PodSnapshot.Create("acme-standards", files.Select(kv => new KeyValuePair<string, string>(kv.Key, kv.Value)));

        var outcome = PodBuilder.Build(snapshot, World(), false);

        Assert.That(outcome, Is.TypeOf<PodBuildOutcome.Built>(), Report(outcome));
        var receipt = ((PodBuildOutcome.Built)outcome).Pod.Receipt;
        Assert.That(receipt.Layers.Select(l => l.Id.Value), Is.EquivalentTo(new[] { "mep-base" }));
        Assert.That(receipt.Layers[0].ToString(), Does.StartWith("mep-base@1.0.0+"));
    }

    [Test]
    public void OfflineOnlineGateBecomesAWarningThatNamesTheRunLane() {
        var files = BuildablePod();
        var snapshot = PodSnapshot.Create("acme-standards", files.Select(kv => new KeyValuePair<string, string>(kv.Key, kv.Value)));

        var outcome = PodBuilder.Build(snapshot, World(), false);

        var warnings = ((PodBuildOutcome.Built)outcome).Pod.Receipt.Warnings;
        Assert.That(warnings.Select(w => w.Reason), Has.Some.Contains("fails hard there"));
    }

    private static PodVersion Version(string raw) {
        PodVersion.TryParse(raw, out var version, out _);
        return version;
    }

    private static PodWorld World() {
        PodWorld.TryCreate(
            [
                new PodWorldEntry(PodId.Parse("mep-base"), Version("1.0.0"), new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                    ["composed/patches/hp.patch.json"] = """{ "select": { "categories": ["MechanicalEquipment"] }, "patch": { "flow": 1 } }"""
                })
            ],
            out var world,
            out _
        );
        return world;
    }

    /// <summary>A pod whose composed/ and manifest.json were produced by the build itself.</summary>
    private static Dictionary<string, string> BuildablePod() {
        const string manifest = """
            {
              "schemaVersion": 2,
              "id": "acme-standards",
              "name": "Acme Standards",
              "version": "1.0.0",
              "entrypoints": [],
              "requires": [ { "id": "mep-base", "version": "1.0.0" } ]
            }
            """;
        const string source = """{ "$preset": "@mep-base/patches/hp", "patch": { "flow": 2 } }""";

        var files = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            ["pod.json"] = manifest,
            ["settings/hp.patch.json"] = source
        };

        var seed = PodSnapshot.Create("acme-standards", files.Select(kv => new KeyValuePair<string, string>(kv.Key, kv.Value)));
        var composed = PodComposer.Compose(PodPath.Parse("composed/hp.patch.json"), source, new WorldResolver(World(), seed));
        Assert.That(composed.Document, Is.Not.Null, string.Join("; ", composed.Errors));
        files["composed/hp.patch.json"] = composed.Document!.Serialize();

        var index = new JObject {
            ["files"] = new JObject(files
                .Where(kv => kv.Key.StartsWith("settings/") || kv.Key.StartsWith("composed/"))
                .Select(kv => new JProperty(kv.Key, PodSnapshot.Sha256(kv.Value))))
        };
        files["manifest.json"] = index.ToString();
        return files;
    }

    private static string Report(PodBuildOutcome outcome) =>
        outcome is PodBuildOutcome.Refused refused ? string.Join("\n", refused.Report.Findings) : string.Empty;

    private sealed class NullResolver : IPodReferenceResolver {
        public string? Resolve(PodReference reference, out string? reason) {
            reason = "no resolver";
            return null;
        }
    }

    private sealed class WorldResolver(PodWorld world, PodSnapshot snapshot) : IPodReferenceResolver {
        public string? Resolve(PodReference reference, out string? reason) {
            reason = null;
            switch (reference) {
            case PodReference.Local local:
                var localPath = $"settings/{local.Path}";
                var content = snapshot.Read(PodPath.Parse(localPath));
                if (content is null)
                    reason = $"'{local}' names no file in this pod.";
                return content;
            case PodReference.Foreign foreign:
                if (!world.Pods.TryGetValue(foreign.PodId, out var entry)) {
                    reason = $"Pod '{foreign.PodId}' is not installed.";
                    return null;
                }

                foreach (var suffix in new[] { string.Empty, ".patch.json", ".family.json" }) {
                    if (entry.ComposedFiles.TryGetValue($"composed/{foreign.Path}{suffix}", out var text))
                        return text;
                }

                reason = $"'{foreign}' names no file in '{foreign.PodId}'.";
                return null;
            default:
                reason = "unhandled";
                return null;
            }
        }
    }
}

