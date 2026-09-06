using Autodesk.Revit.ApplicationServices;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Apply;

/// <summary>
///     The three call shapes of the reconciler as one-liners: build a fresh family from its template, reconcile
///     an open family document, and select the families a patch names in a project (r2-reconcile §6).
/// </summary>
public static class FamilyModelBuild {
    /// <summary>Fresh document from the header's template, reconciled to the model; the caller owns the document.</summary>
    public static (Document Document, FamilyReceipt? Receipt, string TemplatePath) Build(Application application, FamilyModel model, ExecutionOptions? options = null) {
        var templatePath = FamilyTemplate.ResolveTemplatePath(application, model.Family.Template);
        var document = FamilyTemplate.NewDocument(application, model.Family);
        try {
            var receipt = Reconcile(document, model, options);
            return (document, receipt, templatePath);
        } catch {
            try { _ = document.Close(false); } catch { }
            throw;
        }
    }

    /// <summary>Build, save to `outputPath`, close. Returns the receipt (residue 0 is convergence).</summary>
    public static (FamilyReceipt? Receipt, string TemplatePath, Pe.Shared.RevitData.Reading Reading) BuildAndSave(Application application, FamilyModel model, string outputPath, bool overwrite = false) {
        var (document, receipt, templatePath) = Build(application, model);
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            document.SaveAs(outputPath, new SaveAsOptions { OverwriteExistingFile = overwrite, Compact = true, MaximumBackups = 1 });
            return (receipt, templatePath, DocumentReading.Here(document));
        } finally {
            _ = document.Close(false);
        }
    }

    /// <summary>Reconcile an open family document to a full family.json (normalize) through the processor's family-document path.</summary>
    public static FamilyReceipt? Reconcile(Document familyDocument, FamilyModel model, ExecutionOptions? options = null, string? outputFolder = null, LoadAndSaveOptions? save = null) {
        var op = new ReconcileFamily(model);
        using var processor = new OperationProcessor(familyDocument, options);
        var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(op), null, outputFolder, save);
        var (_, error) = contexts.Single().OperationLogs;
        if (error is not null) throw new InvalidOperationException(error.Message, error);
        return op.LastReceipt;
    }

    /// <summary>The families a patch selects in a project: `{}` is every loaded, editable family.</summary>
    public static List<Family> FamiliesMatching(this Document project, PatchSelect select) {
        var names = select.Names is { Count: > 0 } n ? n.ToHashSet(StringComparer.Ordinal) : null;
        var categories = select.Categories is { Count: > 0 } c ? c.Select(x => LenientEnumConverter<FamilyCategory>.Key(x.ToString())).ToHashSet(StringComparer.Ordinal) : null;
        var placed = select.PlacedOnly == true
            ? new FilteredElementCollector(project).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>().Select(i => i.Symbol.Family.Id).ToHashSet()
            : null;
        return new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>()
            .Where(f => f.IsEditable && !f.IsInPlace)
            .Where(f => names is null || names.Contains(f.Name))
            .Where(f => categories is null || (f.FamilyCategory is { } cat && categories.Contains(LenientEnumConverter<FamilyCategory>.Key(cat.Name))))
            .Where(f => placed is null || placed.Contains(f.Id))
            .OrderBy(f => f.Name, StringComparer.Ordinal)
            .ToList();
    }
}
