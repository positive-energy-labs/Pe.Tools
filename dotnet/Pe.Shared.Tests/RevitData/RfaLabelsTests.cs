using System.Diagnostics;
using Newtonsoft.Json.Linq;
using Pe.Revit.Rfa;

namespace Pe.Shared.Tests.RevitData;

/// <summary>
///     The .rfa label reader over checked-in tag families (dotnet/Pe.Revit.Tests/Fixtures/Families/TagLabels, Revit 2025 files).
///     Expected rows are the Python decoder's output (.artifacts/tagparams/decoder, 301/301 labels against Revit truth), with the
///     unit reported only where a segment overrides the default format. Built-ins stay ids here: names come from Revit's enum
///     (<c>FamilyLabels.BuiltInParameterNames</c>), which this project does not load; the trailing comments name them.
/// </summary>
[TestFixture]
public sealed class RfaLabelsTests {
    private static readonly Dictionary<string, string[]> Expected = new() {
        ["Tag_Air Terminal.rfa"] = [
            "8066484 Host vis=Family:8066487:_inverse visible AirFlow",
            "  Shared:6296675:36414fcc-3330-4f07-bb76-b6724f9ece4f:PE_G___TagInstance prefix='' suffix='' sample='XXX-#' spaces=1 br=False unit=-",
            "8066485 Host vis=Family:8066483:_visible NeckDims",
            "  Shared:7587717:130f136b-ae6c-4edf-8e53-d165195f6679:PE_M_Grd_OpenLength prefix='' suffix=' x ' sample='00\"' spaces=1 br=False unit=autodesk.unit.unit:inches-1.0.1",
            "  Shared:7587718:115530a1-704c-44e6-bcfa-d60f1223e1bb:PE_M_Grd_OpenWidth prefix='' suffix='' sample='00\"' spaces=0 br=False unit=autodesk.unit.unit:inches-1.0.1",
            "8066486 Host vis=Family:8066482:_visible AirFlow",
            "  Shared:6296675:36414fcc-3330-4f07-bb76-b6724f9ece4f:PE_G___TagInstance prefix='' suffix=' - ' sample='XXX-#' spaces=1 br=False unit=-",
            "  Shared:7600406:d877f942-9431-4c27-911e-d9d34af88a85:PE_M_Grd_AirFlow prefix='' suffix='' sample='000 CFM' spaces=0 br=False unit=-",
        ],
        ["Tag_Zone.rfa"] = [
            "3659197 Host vis=Family:3659360:ZoneName_Trans",
            "  BuiltIn:-1114300 prefix='' suffix='' sample='Zone Name' spaces=1 br=False unit=-", // ZONE_NAME
            "3659346 Host vis=Family:3659359:ZoneNamePLUS_Trans",
            "  BuiltIn:-1114300 prefix='' suffix='' sample='Zone Name' spaces=1 br=False unit=-", // ZONE_NAME
            "  Shared:3659142:9c9ad437-4366-4151-b2d8-cd929378e227:Sensible Cooling Load prefix='' suffix='' sample='Sensible Cooling Load' spaces=1 br=True unit=-",
            "  Shared:3659141:6ed418f1-e2e6-4228-9ff9-9b209cc0ff08:Specified Supply Cooling Airflow prefix='' suffix='' sample='Specified Supply Cooling Airflow' spaces=1 br=True unit=-",
            "3659349 Host vis=Family:3659348:ZoneName",
            "  BuiltIn:-1114300 prefix='' suffix='' sample='Zone Name' spaces=1 br=False unit=-", // ZONE_NAME
            "3659350 Host vis=Family:3659347:ZoneNamePLUS",
            "  BuiltIn:-1114300 prefix='' suffix='' sample='Zone Name' spaces=1 br=False unit=-", // ZONE_NAME
            "  Shared:3659142:9c9ad437-4366-4151-b2d8-cd929378e227:Sensible Cooling Load prefix='' suffix='' sample='Sensible Cooling Load' spaces=1 br=True unit=-",
            "  Shared:3659141:6ed418f1-e2e6-4228-9ff9-9b209cc0ff08:Specified Supply Cooling Airflow prefix='' suffix='' sample='Specified Supply Cooling Airflow' spaces=1 br=True unit=-",
        ],
        ["Tag_Pipe_Plumbing Fixture Units.rfa"] = [
            "3736554 Host vis=Family:3736586:FU",
            "  Shared:3736400:a9fc8ba6-b270-4984-a506-f3f9ad24a171:Plumbing Fixture Units prefix='' suffix='' sample='PFUs' spaces=1 br=False unit=-",
            "3736612 Host vis=Family:3736587:FU with Comments",
            "  Shared:3736400:a9fc8ba6-b270-4984-a506-f3f9ad24a171:Plumbing Fixture Units prefix='' suffix='' sample='FU' spaces=1 br=False unit=-",
            "  BuiltIn:-1010106 prefix='' suffix='' sample='Comment' spaces=1 br=False unit=-", // ALL_MODEL_INSTANCE_COMMENTS
        ],
        ["Tag_Space_Load Info.rfa"] = [
            "3658991 Host vis=Family:3659059:Transparent Text",
            "  BuiltIn:-1114176 prefix='' suffix='' sample='SPEC CFM' spaces=1 br=False unit=-", // ROOM_DESIGN_SUPPLY_AIRFLOW_PARAM
            "3659045 Host vis=Family:3659059:Transparent Text",
            "  BuiltIn:-1006900 prefix='' suffix='' sample='Space Name' spaces=1 br=False unit=-", // ROOM_NAME
            "3659046 Host vis=Family:3659059:Transparent Text",
            "  BuiltIn:-1006901 prefix='' suffix='' sample='101' spaces=1 br=False unit=-", // ROOM_NUMBER
            "3659047 Host vis=Family:3659059:Transparent Text",
            "  BuiltIn:-1114194 prefix='' suffix='' sample='ACT CFM' spaces=1 br=False unit=-", // ROOM_ACTUAL_SUPPLY_AIRFLOW_PARAM
            "3659048 Host vis=Family:3659059:Transparent Text",
            "  BuiltIn:-1114256 prefix='' suffix='' sample='1000 Btu/h' spaces=1 br=False unit=-", // ROOM_DESIGN_COOLING_LOAD_PARAM
            "3659049 Host vis=Family:3659059:Transparent Text",
            "  BuiltIn:-1006902 prefix='Area: ' suffix='' sample='1000 SF' spaces=1 br=False unit=autodesk.unit.unit:squareFeet-1.0.1", // ROOM_AREA
            "3659056 Host vis=Family:3659059:Transparent Text",
            "  BuiltIn:-1114174 prefix='' suffix='' sample='17' spaces=1 br=False unit=-", // ROOM_NUMBER_OF_PEOPLE_PARAM
            "3659060 Host vis=Family:3659058:Opaque Text",
            "  BuiltIn:-1114176 prefix='' suffix='' sample='SPEC CFM' spaces=1 br=False unit=-", // ROOM_DESIGN_SUPPLY_AIRFLOW_PARAM
            "3659061 Host vis=Family:3659058:Opaque Text",
            "  BuiltIn:-1006900 prefix='' suffix='' sample='Space Name' spaces=1 br=False unit=-", // ROOM_NAME
            "3659062 Host vis=Family:3659058:Opaque Text",
            "  BuiltIn:-1006901 prefix='' suffix='' sample='101' spaces=1 br=False unit=-", // ROOM_NUMBER
            "3659063 Host vis=Family:3659058:Opaque Text",
            "  BuiltIn:-1114194 prefix='' suffix='' sample='ACT CFM' spaces=1 br=False unit=-", // ROOM_ACTUAL_SUPPLY_AIRFLOW_PARAM
            "3659064 Host vis=Family:3659058:Opaque Text",
            "  BuiltIn:-1114256 prefix='' suffix='' sample='1000 Btu/h' spaces=1 br=False unit=-", // ROOM_DESIGN_COOLING_LOAD_PARAM
            "3659065 Host vis=Family:3659058:Opaque Text",
            "  BuiltIn:-1006902 prefix='Area: ' suffix='' sample='1000 SF' spaces=1 br=False unit=autodesk.unit.unit:squareFeet-1.0.1", // ROOM_AREA
            "3659070 Host vis=Family:3659058:Opaque Text",
            "  BuiltIn:-1114174 prefix='' suffix='' sample='17' spaces=1 br=False unit=-", // ROOM_NUMBER_OF_PEOPLE_PARAM
            "3659085 Host vis=Family:3659059:Transparent Text",
            "  Shared:3658839:f5ab4959-852f-49a9-9f86-79ecf70ac3ea:Specified Supply Heating Airflow prefix='' suffix='' sample='SPEC H CFM' spaces=1 br=False unit=-",
            "3659087 Host vis=Family:3659058:Opaque Text",
            "  Shared:3658839:f5ab4959-852f-49a9-9f86-79ecf70ac3ea:Specified Supply Heating Airflow prefix='' suffix='' sample='SPEC H CFM' spaces=1 br=False unit=-",
        ],
        // A family (not shared) parameter, and a label with no visibility parameter. Revit logged FamilyParameter id=990317 when it made the fixture.
        ["Tag_TagGeneric_v003_famparam.rfa"] = [
            "985017 Host vis=-",
            "  Family:990317:FamOnly_PE_G___TagInstance prefix='' suffix='' sample='PE_G___TagInstance' spaces=1 br=False unit=-",
        ],
    };

    [TestCaseSource(nameof(FixtureNames))]
    public void Reads_every_label_segment_in_order(string fixture) {
        var (labels, error) = RfaLabels.Read(Path.Combine(FixtureDir, fixture));

        Assert.That(error, Is.Null, error?.ToString());
        Assert.That(Lines(labels!), Is.EqualTo(Expected[fixture]));
    }

    [Test]
    public void A_file_that_is_not_a_compound_file_fails_with_its_path() {
        var path = Path.Combine(Path.GetTempPath(), $"not-an-rfa-{Guid.NewGuid():N}.rfa");
        File.WriteAllBytes(path, new byte[1024]);
        try {
            var (labels, error) = RfaLabels.Read(path);
            Assert.That(labels, Is.Null);
            Assert.That(error!.Message, Does.Contain(path).And.Contain("not an OLE compound file"));
        } finally {
            File.Delete(path);
        }
    }

    [Test]
    public void An_unknown_schema_field_type_fails_naming_its_class_and_field() {
        // Formats/Latest with one class X { f }: u16 0, u16 len, name, parent 0, u32 a, u32 1 field, u32 len, name, u32 type, u32 0 guids, u16 0.
        static byte[] Schema(uint type) {
            using var stream = new MemoryStream();
            using var w = new BinaryWriter(stream);
            w.Write((ushort)0);
            w.Write((ushort)1);
            w.Write((byte)'X');
            w.Write((ushort)0);
            w.Write(0u);
            w.Write(1u);
            w.Write(1u);
            w.Write((byte)'f');
            w.Write(type);
            w.Write(0u);
            w.Write((ushort)0);
            return stream.ToArray();
        }

        Assert.That(RfaSchema.Parse(Schema(0x0004)).ById[12].Fields.Single().Name, Is.EqualTo("f"));
        Assert.That(() => RfaSchema.Parse(Schema(0x000c)),
            Throws.TypeOf<InvalidDataException>().With.Message.Contains("X.f has an unknown field type 0x000c"));
    }

    /// <summary>
    ///     Parity with the Python decoder over the 93-family tag corpus, machine-local under <c>.artifacts/tagparams</c>. Explicit:
    ///     the corpus and the Python reference output are not committed. Writes the diff and per-file timing beside the reference.
    /// </summary>
    [Test, Explicit("machine-local corpus: .artifacts/tagparams/tpl/rfa and parity/py.json")]
    public void Matches_the_python_decoder_on_the_tag_corpus() {
        var root = Path.Combine(RepoRoot, ".artifacts", "tagparams");
        var reference = Path.Combine(root, "parity", "py.json");
        if (!File.Exists(reference)) Assert.Ignore($"no Python reference at {reference}");
        var python = JObject.Parse(File.ReadAllText(reference));

        var diff = new List<string>();
        var times = new List<(string File, double Ms)>();
        var labelCount = 0;
        foreach (var (file, entry) in python.Properties().Select(p => (p.Name, (JObject)p.Value))) {
            var path = Path.Combine(root, file.Replace('/', Path.DirectorySeparatorChar));
            var watch = Stopwatch.StartNew();
            var (labels, error) = RfaLabels.Read(path);
            times.Add((file, watch.Elapsed.TotalMilliseconds));
            var expected = ((JArray)entry["labels"]!).Cast<JObject>().SelectMany(PythonLines).ToList();
            var actual = error == null ? Lines(labels!).ToList() : [$"ERROR {error.Message}"];
            labelCount += labels?.Count ?? 0;
            if (!expected.SequenceEqual(actual))
                diff.Add($"== {file}\n-- python\n{string.Join("\n", expected)}\n-- c#\n{string.Join("\n", actual)}");
        }

        var ms = times.Select(t => t.Ms).OrderBy(t => t).ToList();
        var summary = $"files={times.Count} labels={labelCount} mismatchedFiles={diff.Count} " +
                      $"firstMs={times[0].Ms:F1} medianMs={ms[ms.Count / 2]:F1} p90Ms={ms[(int)(ms.Count * 0.9)]:F1} maxMs={ms[^1]:F1} totalMs={ms.Sum():F0}";
        File.WriteAllText(Path.Combine(root, "parity", "cs-diff.txt"), summary + "\n" + string.Join("\n", diff));
        File.WriteAllLines(Path.Combine(root, "parity", "cs-timing.tsv"), times.Select(t => $"{t.File}\t{t.Ms:F2}"));
        TestContext.Progress.WriteLine($"[PE_RFA_PARITY] {summary}");
        Assert.That(diff, Is.Empty, summary);
    }

    /// <summary>
    ///     The project path against the Python project decoder (rvt_labels.py) on the 280 MB template-cache project, machine-local.
    ///     Per family: name, project Family id, and labels; host and group-definition labels in file order, nested labels as a
    ///     set (the order nested documents are visited is not meaningful). Families only C# links are listed, not failed: Python
    ///     drops a Family whose deferred FamilyTypeTable outruns its 1 MB scan window.
    /// </summary>
    [Test, Explicit("machine-local 280 MB project: .artifacts/tagparams/tpl/in and parity/py-rvt.json")]
    public void Matches_the_python_decoder_on_the_template_project() {
        var root = Path.Combine(RepoRoot, ".artifacts", "tagparams");
        var reference = Path.Combine(root, "parity", "py-rvt.json");
        var project = Path.Combine(root, "tpl", "in", "MEP_Architect_template_cache.rvt");
        if (!File.Exists(reference) || !File.Exists(project)) Assert.Ignore($"no Python reference at {reference} or project at {project}");
        var python = (JObject)JObject.Parse(File.ReadAllText(reference))["families"]!;

        var watch = Stopwatch.StartNew();
        var (labels, error) = RfaLabels.ReadProject(project);
        var seconds = watch.Elapsed.TotalSeconds;
        Assert.That(error, Is.Null, error?.ToString());
        var byGuid = labels!.Families.ToDictionary(f => f.ContentDocument!.Value.ToString());

        static List<string> Ordered(IEnumerable<IReadOnlyList<string>> labels, bool nested) =>
            nested ? labels.Select(l => string.Join("\n", l)).OrderBy(l => l, StringComparer.Ordinal).ToList() : labels.Select(l => string.Join("\n", l)).ToList();
        var diff = new List<string>();
        foreach (var (guid, entry) in python.Properties().Select(p => (p.Name, (JObject)p.Value))) {
            if (!byGuid.TryGetValue(guid, out var family)) {
                diff.Add($"== {guid} {entry["name"]}: missing in C#");
                continue;
            }
            var expected = ((JArray)entry["labels"]!).Cast<JObject>().Select(l => (Nested: (string)l["scope"]! == "nested", Lines: (IReadOnlyList<string>)PythonLines(l).ToList())).ToList();
            var actual = family.Labels.Select(l => (Nested: l.Container == RfaLabelContainer.Nested, Lines: (IReadOnlyList<string>)Lines([l]).ToList())).ToList();
            var same = family.Name == (string)entry["name"]! && family.FamilyId == (long)entry["projectFamilyId"]!
                       && Ordered(expected.Where(l => !l.Nested).Select(l => l.Lines), false).SequenceEqual(Ordered(actual.Where(l => !l.Nested).Select(l => l.Lines), false))
                       && Ordered(expected.Where(l => l.Nested).Select(l => l.Lines), true).SequenceEqual(Ordered(actual.Where(l => l.Nested).Select(l => l.Lines), true));
            if (!same)
                diff.Add($"== {guid} {entry["name"]} / {family.Name} {family.FamilyId}\n-- python\n{string.Join("\n", expected.SelectMany(l => l.Lines))}\n-- c#\n{string.Join("\n", actual.SelectMany(l => l.Lines))}");
        }
        var extra = labels.Families.Where(f => python[f.ContentDocument!.Value.ToString()] == null).ToList();
        var summary = $"pythonFamilies={python.Count} csFamilies={labels.Families.Count} csLabels={labels.Families.Sum(f => f.Labels.Count)} " +
                      $"mismatched={diff.Count} csOnly={extra.Count} ({extra.Sum(f => f.Labels.Count)} labels) diagnostics={labels.Diagnostics.Count} " +
                      $"version={labels.Version} seconds={seconds:F1}";
        File.WriteAllText(Path.Combine(root, "parity", "cs-rvt-diff.txt"),
            summary + "\n" + string.Join("\n", extra.Select(f => $"csOnly {f.Name} {f.FamilyId} labels={f.Labels.Count}")) + "\n" + string.Join("\n", diff));
        TestContext.Progress.WriteLine($"[PE_RVT_PARITY] {summary}");
        Assert.That(diff, Is.Empty, summary);
    }

    private static IEnumerable<string> PythonLines(JObject label) {
        static string P(JToken? p) {
            if (p == null || p.Type == JTokenType.Null) return "-";
            var kind = (string)p["kind"]! switch {
                "builtin" => "BuiltIn", "shared" => "Shared", "family" => "Family", "none" => "None", "unresolved" => "Unresolved", _ => "Other"
            };
            var s = $"{kind}:{(long)p["id"]!}";
            if (p["guid"] is { Type: JTokenType.String } g) s += $":{g}";
            if (kind != "BuiltIn" && p["name"] is { Type: JTokenType.String } n) s += $":{n}";
            return s;
        }
        var scope = (string)label["scope"]! switch { "host" => "Host", "groupDefinition" => "GroupDefinition", _ => "Nested" };
        yield return $"{(long)label["id"]!} {scope} vis={P(label["visibleParam"])}";
        foreach (var s in label["segments"]!) {
            var unit = (bool)s["useDefaultFormat"]! ? null : s["unit"]?.Type == JTokenType.Null ? null : (string?)s["unit"];
            yield return $"  {P(s)} prefix='{s["prefix"]}' suffix='{s["suffix"]}' sample='{s["sample"]}' spaces={(long)s["spaces"]!} br={(bool)s["lineBreak"]!} unit={(string.IsNullOrEmpty(unit) ? "-" : unit)}";
        }
    }

    private static IEnumerable<string> Lines(IEnumerable<RfaLabel> labels) {
        static string P(RfaParam? p) =>
            p == null ? "-" : $"{p.Kind}:{p.Id}" + (p.SharedGuid is { } g ? $":{g}" : "") + (p.Kind != RfaParamKind.BuiltIn && p.Name != null ? $":{p.Name}" : "");
        foreach (var label in labels) {
            yield return $"{label.Id} {label.Container} vis={P(label.Visibility)}";
            foreach (var s in label.Segments)
                yield return $"  {P(s.Param)} prefix='{s.Prefix}' suffix='{s.Suffix}' sample='{s.Sample}' spaces={s.Spaces} br={s.LineBreak} unit={s.Unit ?? "-"}";
        }
    }

    private static IEnumerable<string> FixtureNames => Expected.Keys;

    private static string RepoRoot {
        get {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !File.Exists(Path.Combine(dir.FullName, "Pe.Tools.slnx"))) dir = dir.Parent;
            return dir!.FullName;
        }
    }

    private static string FixtureDir => Path.Combine(RepoRoot, "dotnet", "Pe.Revit.Tests", "Fixtures", "Families", "TagLabels");
}
