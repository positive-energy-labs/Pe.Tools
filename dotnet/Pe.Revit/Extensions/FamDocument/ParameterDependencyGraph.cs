using Pe.Revit.Extensions.FamParameter;
using Pe.Revit.Extensions.FamParameter.Formula;

namespace Pe.Revit.Extensions.FamDocument;

public enum ParameterEdgeKind {
    /// <summary>From reads To in its formula text.</summary>
    Formula,
    /// <summary>From is the dimension's family label; the dimension drives geometry.</summary>
    DimensionLabel,
    /// <summary>From is the array's count label.</summary>
    ArrayLabel,
    /// <summary>From is associated to an element parameter (connector, nested instance, form, ...).</summary>
    ElementAssociation,
    /// <summary>From is a family-type selector holding To as its per-type value.</summary>
    FamilyTypeSelector
}

/// <summary>One directed edge out of a family parameter. ElementId is the driven element (or the referenced parameter).</summary>
public sealed record ParameterGraphEdge(string From, string To, ParameterEdgeKind Kind, long ElementId, string ElementKind, string Detail) {
    public string Line => $"{this.From} -[{this.Kind}]-> {this.To} (id {this.ElementId}, {this.ElementKind}) {this.Detail}".TrimEnd();
}

public sealed record ParameterGraphNode(long Id, string Name, string Storage, bool IsInstance, string? Formula);

/// <summary>
///     What a family parameter is wired to right now: formula readers, labelled dimensions and arrays, element-parameter
///     associations, family-type selections. Built from the same dependents discovery the transfer path uses
///     (<see cref="FormulaDependencies" />, <see cref="FamilyParameterGetAssociated" />), so a graph edge and a transfer
///     decision cannot disagree.
/// </summary>
public sealed record ParameterDependencyGraph(IReadOnlyList<ParameterGraphNode> Nodes, IReadOnlyList<ParameterGraphEdge> Edges) {
    public int ParamParamEdges => this.Edges.Count(edge => edge.Kind is ParameterEdgeKind.Formula);
    public int ParamElementEdges => this.Edges.Count(edge => edge.Kind is not ParameterEdgeKind.Formula);

    /// <summary>Distinct elements a parameter drives through a dimension or array label: the geometry the solver must satisfy.</summary>
    public int GeometrySinks => this.Edges.Where(edge => edge.Kind is ParameterEdgeKind.DimensionLabel or ParameterEdgeKind.ArrayLabel)
        .Select(edge => edge.ElementId).Distinct().Count();

    /// <summary>Longest formula chain. Revit rejects circular formulas, so a memoized walk with a path guard terminates.</summary>
    public int FormulaDepth {
        get {
            var reads = this.Edges.Where(edge => edge.Kind is ParameterEdgeKind.Formula)
                .GroupBy(edge => edge.From, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.Select(edge => edge.To).Distinct(StringComparer.Ordinal).ToList(), StringComparer.Ordinal);
            var depths = new Dictionary<string, int>(StringComparer.Ordinal);
            int Depth(string name, HashSet<string> path) {
                if (depths.TryGetValue(name, out var cached)) return cached;
                if (!path.Add(name)) return 0;
                var depth = reads.TryGetValue(name, out var next) && next.Count > 0 ? 1 + next.Max(child => Depth(child, path)) : 0;
                path.Remove(name);
                depths[name] = depth;
                return depth;
            }
            return this.Nodes.Count == 0 ? 0 : this.Nodes.Max(node => Depth(node.Name, []));
        }
    }

    public string Sizes => $"params={this.Nodes.Count} paramParam={this.ParamParamEdges} paramElement={this.ParamElementEdges} formulaDepth={this.FormulaDepth} geometrySinks={this.GeometrySinks}";

    public string ToText() => string.Join(Environment.NewLine,
        [$"# {this.Sizes}", .. this.Edges.Select(edge => edge.Line).OrderBy(line => line, StringComparer.Ordinal)]);

    /// <summary>Edge-level delta, the form that answers "what did this op just rewire".</summary>
    public static string Delta(ParameterDependencyGraph before, ParameterDependencyGraph after) {
        var old = before.Edges.Select(edge => edge.Line).ToHashSet(StringComparer.Ordinal);
        var now = after.Edges.Select(edge => edge.Line).ToHashSet(StringComparer.Ordinal);
        var lines = new List<string>();
        lines.AddRange(old.Except(now).OrderBy(line => line, StringComparer.Ordinal).Select(line => "- " + line));
        lines.AddRange(now.Except(old).OrderBy(line => line, StringComparer.Ordinal).Select(line => "+ " + line));
        return lines.Count == 0 ? "(no edge change)" : string.Join(Environment.NewLine, lines);
    }

    public static ParameterDependencyGraph Capture(FamilyDocument document) {
        var fm = document.FamilyManager;
        var parameters = fm.Parameters.OfType<FamilyParameter>().ToList();
        var nodes = parameters.Select(parameter => new ParameterGraphNode(parameter.Id.Value(), parameter.Definition.Name,
            parameter.StorageType.ToString(), parameter.IsInstance, Formula(parameter))).ToList();
        var edges = new List<ParameterGraphEdge>();
        var types = fm.Types.Cast<FamilyType>().ToList();
        foreach (var parameter in parameters) {
            var name = parameter.Definition.Name;
            if (Formula(parameter) is { } formula && !string.IsNullOrWhiteSpace(formula))
                foreach (var referenced in fm.Parameters.GetReferencedIn(formula).Where(other => other.Id != parameter.Id))
                    edges.Add(new ParameterGraphEdge(name, referenced.Definition.Name, ParameterEdgeKind.Formula, referenced.Id.Value(), "FamilyParameter", formula));
            foreach (Parameter associated in parameter.AssociatedParameters) {
                if (associated.Element is not { IsValidObject: true } element) continue;
                edges.Add(new ParameterGraphEdge(name, $"{element.GetType().Name}:{element.Id.Value()}", ParameterEdgeKind.ElementAssociation,
                    element.Id.Value(), element.GetType().Name, associated.Definition.Name));
            }
            if (parameter.StorageType != StorageType.ElementId) continue;
            foreach (var type in types.Where(type => type.HasValue(parameter))) {
                var value = type.AsElementId(parameter);
                if (value is null || value == ElementId.InvalidElementId) continue;
                edges.Add(new ParameterGraphEdge(name, Describe(document, value.Value()), ParameterEdgeKind.FamilyTypeSelector, value.Value(),
                    document.Document.GetElement(value)?.GetType().Name ?? "Element", type.Name));
            }
        }
        foreach (var dimension in new FilteredElementCollector(document).OfClass(typeof(Dimension)).Cast<Dimension>()) {
            FamilyParameter? label;
            // Native dimensions that cannot be labeled throw rather than answering null.
            try { label = dimension.FamilyLabel; } catch (Autodesk.Revit.Exceptions.InvalidOperationException) { continue; }
            if (label is null) continue;
            edges.Add(new ParameterGraphEdge(label.Definition.Name, $"Dimension:{dimension.Id.Value()}", ParameterEdgeKind.DimensionLabel,
                dimension.Id.Value(), Shape(dimension), $"val={Value(dimension)} refs=[{Refs(document, dimension)}]"));
        }
        foreach (var array in new FilteredElementCollector(document).WhereElementIsNotElementType().OfType<BaseArray>()) {
            if (array.Label is not { } label) continue;
            edges.Add(new ParameterGraphEdge(label.Definition.Name, $"BaseArray:{array.Id.Value()}", ParameterEdgeKind.ArrayLabel,
                array.Id.Value(), array.GetType().Name, array.Name ?? string.Empty));
        }
        return new ParameterDependencyGraph(nodes, edges);
    }

    /// <summary>Resolve the element ids Revit names in a posted failure into something readable.</summary>
    public static string Describe(FamilyDocument document, params long[] ids) =>
        string.Join("; ", ids.Select(id => Describe(document, id)));

    private static string Describe(FamilyDocument document, long id) {
        var element = document.Document.GetElement(id.ToElementId());
        if (element is null) return $"{id}=<missing>";
        var category = element.Category?.Name;
        var style = (element as CurveElement)?.LineStyle?.Name;
        var extra = element switch {
            Dimension dimension => $" shape={Shape(dimension)} label='{LabelName(dimension)}' refs=[{Refs(document, dimension)}] value={Value(dimension)}",
            ReferencePlane plane => $" name='{plane.Name}'",
            _ => string.Empty
        };
        return $"{id}={element.GetType().Name}{(category is null ? "" : $" cat='{category}'")}{(style is null ? "" : $" style='{style}'")}{extra}";
    }

    private static string LabelName(Dimension dimension) {
        try { return dimension.FamilyLabel?.Definition.Name ?? string.Empty; }
        catch (Autodesk.Revit.Exceptions.InvalidOperationException) { return "<unlabelable>"; }
    }

    private static string Value(Dimension dimension) {
        try { return dimension.Value?.ToString("0.####") ?? "<none>"; }
        catch (Autodesk.Revit.Exceptions.ApplicationException) { return "<multi>"; }
    }

    private static string Shape(Dimension dimension) {
        try { return dimension.DimensionShape.ToString(); }
        catch (Autodesk.Revit.Exceptions.ApplicationException) { return "Dimension"; }
    }

    private static string Refs(FamilyDocument document, Dimension dimension) {
        try {
            return string.Join(",", dimension.References.Cast<Reference>().Select(reference => {
                var element = document.Document.GetElement(reference.ElementId);
                return $"{reference.ElementId.Value()}:{element?.GetType().Name ?? "?"}";
            }));
        } catch (Autodesk.Revit.Exceptions.ApplicationException) { return "?"; }
    }

    private static string? Formula(FamilyParameter parameter) {
        try { return parameter.Formula; }
        catch (Autodesk.Revit.Exceptions.ApplicationException) { return null; }
    }
}
