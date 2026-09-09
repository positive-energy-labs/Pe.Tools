using Pe.Revit.FamilyFoundry.Apply;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilyModelDependencyTests {
    [Test]
    public void Sibling_models_precede_native_files_and_nested_families_survive_save(UIApplication ui) {
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory("dependencies");
        var leaf = Model("leaf");
        File.WriteAllText(Path.Combine(directory, "leaf.family.json"), FamilyModelJson.Serialize(leaf));
        File.WriteAllText(Path.Combine(directory, "leaf.rfa"), "Invalid native file must not be opened when JSON exists.");
        var branch = Model("branch", "leaf");
        File.WriteAllText(Path.Combine(directory, "branch.family.json"), FamilyModelJson.Serialize(branch));
        var before = ui.Application.Documents.Cast<Document>().ToArray();
        var output = Path.Combine(directory, "parent.rfa");
        var built = FamilyModelBuild.BuildAndSave(ui.Application, Model("parent", "branch"), output, modelDirectory: directory);
        Assert.That(built.Receipt?.Converged, Is.True);
        Assert.That(ui.Application.Documents.Cast<Document>(), Is.EquivalentTo(before));
        var reopened = ui.Application.OpenDocumentFile(output);
        Document? nested = null;
        try {
            var family = new FilteredElementCollector(reopened).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == "branch");
            nested = reopened.EditFamily(family);
            Assert.That(new FilteredElementCollector(nested).OfClass(typeof(Family)).Cast<Family>().Select(f => f.Name), Does.Contain("leaf"));
        } finally {
            if (nested is not null) _ = nested.Close(false);
            _ = reopened.Close(false);
        }
        // Native sidecar fallback uses the same loader and must not modify the saved dependency.
        var hash = System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(output));
        var native = FamilyModelBuild.Build(ui.Application, Model("native-parent", "parent"), modelDirectory: directory).Document;
        _ = native.Close(false);
        Assert.That(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(output)), Is.EqualTo(hash));
        Assert.That(ui.Application.Documents.Cast<Document>(), Is.EquivalentTo(before));
        File.WriteAllText(Path.Combine(directory, "leaf.family.json"), "{}");
        File.WriteAllText(Path.Combine(directory, "leaf.rfa"), "Must not fall back after invalid JSON.");
        Assert.That(Assert.Throws<InvalidOperationException>(() => FamilyModelBuild.Build(ui.Application, Model("parent", "leaf"), modelDirectory: directory))!.Message,
            Does.Contain("Invalid dependency"));
        Assert.That(ui.Application.Documents.Cast<Document>(), Is.EquivalentTo(before));
    }

    [Test]
    public void Cycles_missing_dependencies_and_missing_types_close_all_child_documents(UIApplication ui) {
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory("dependency-refusals");
        var before = ui.Application.Documents.Cast<Document>().ToArray();
        File.WriteAllText(Path.Combine(directory, "A.family.json"), FamilyModelJson.Serialize(Model("A", "B")));
        File.WriteAllText(Path.Combine(directory, "B.family.json"), FamilyModelJson.Serialize(Model("B", "A")));
        var cycle = Assert.Throws<InvalidOperationException>(() => FamilyModelBuild.Build(ui.Application, Model("A", "B"), modelDirectory: directory));
        Assert.That(cycle!.Message, Does.Contain("A -> B -> A"));
        Assert.That(ui.Application.Documents.Cast<Document>(), Is.EquivalentTo(before));
        Assert.Throws<FileNotFoundException>(() => FamilyModelBuild.Build(ui.Application, Model("missing", "absent"), modelDirectory: directory));
        Assert.That(ui.Application.Documents.Cast<Document>(), Is.EquivalentTo(before));
        File.WriteAllText(Path.Combine(directory, "leaf.family.json"), FamilyModelJson.Serialize(Model("leaf")));
        var missingType = Model("parent", "leaf");
        missingType.Nested["child"] = new FamilyModelNested { Family = "leaf", Type = "absent", Host = "Ref. Level" };
        Assert.That(Assert.Throws<InvalidOperationException>(() => FamilyModelBuild.Build(ui.Application, missingType, modelDirectory: directory))!.Message,
            Does.Contain("has no type 'absent'"));
        Assert.That(ui.Application.Documents.Cast<Document>(), Is.EquivalentTo(before));
    }

    private static FamilyModel Model(string name, string? child = null) {
        var model = FamilyModelJson.Parse("""
            { "family": { "name": "placeholder", "category": "GenericModels", "template": "Generic Model", "placement": "OneLevelBased" },
              "types": { "default": {} }, "datums": { "Ref. Level": { "normal": "Z", "isLevel": true } } }
            """.Replace("placeholder", name)).Value!;
        if (child is not null) model.Nested["child"] = new FamilyModelNested { Family = child, Type = "default", Host = "Ref. Level" };
        return model;
    }
}
