namespace Pe.Revit.Extensions.FamDocument;

public static class FamilyDocumentLabelDimensions {
    /// <summary>Assign dimension labels without replacing the parameters' existing per-type values with sketch distances.</summary>
    public static void LabelDimensions(this FamilyDocument document, IEnumerable<(Dimension Dimension, FamilyParameter Parameter)> labels) {
        var assignments = labels.ToList();
        if (assignments.Count == 0) return;
        var manager = document.FamilyManager;
        var parameters = assignments.Select(a => a.Parameter).DistinctBy(p => p.Id).Where(p => p.Formula is null).ToList();
        var values = manager.Types.Cast<FamilyType>().Select(type => (Type: type,
            Cells: parameters.Select(parameter => (Parameter: parameter, Value: document.GetValue(type, parameter))).Where(c => c.Value is not null).ToList())).ToList();
        var original = manager.CurrentType;
        try {
            foreach (var (dimension, parameter) in assignments) dimension.FamilyLabel = parameter;
            document.Document.Regenerate();
            foreach (var (type, cells) in values) {
                var changed = cells.Where(cell => !Equals(document.GetValue(type, cell.Parameter), cell.Value)).ToList();
                if (changed.Count == 0) continue;
                if (manager.CurrentType != type) manager.CurrentType = type;
                foreach (var (parameter, value) in changed) {
                    switch (value) {
                    case double number: manager.Set(parameter, number); break;
                    case int integer: manager.Set(parameter, integer); break;
                    default: throw new InvalidOperationException($"Dimension label '{parameter.Definition.Name}' has non-numeric storage.");
                    }
                }
            }
        } finally { if (original is not null && manager.CurrentType != original) manager.CurrentType = original; }
    }
}
