using Autodesk.Revit.DB.Structure;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Apply;

/// <summary>
///     Applies the deliberately tiny composition subset that does not belong to the legacy solid compiler.
///     Revit's centered array is encoded here as its proven native topology, not as public groups or alignments.
/// </summary>
internal static class FamilyModelCompositionBuilder {
    public static void PrepareDependency(Document document) {
        using var transaction = new Transaction(document, "Prepare nested family references");
        _ = transaction.Start();
        foreach (var plane in new FilteredElementCollector(document)
                     .OfClass(typeof(ReferencePlane))
                     .Cast<ReferencePlane>()
                     .Where(plane => plane.Name is "Center (Left/Right)" or "Center (Front/Back)")) {
            // Built-in center planes in a freshly created Generic Model are not reliably exposed through a loaded
            // FamilyInstance. Strong named references are normal Revit state and make the alignment replayable.
            _ = plane.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME)?.Set(13);
        }
        _ = transaction.Commit();
    }

    public static void Apply(
        Document document,
        FamilyModel model,
        IReadOnlyDictionary<string, Family> dependencies
    ) {
        if (model.NestedFamilies.Count == 0 && model.Arrays.Count == 0)
            return;

        using var transaction = new Transaction(document, "Compose nested family model");
        _ = transaction.Start();
        var view = GetPlanView(document);
        var instances = model.NestedFamilies.ToDictionary(
            pair => pair.Key,
            pair => PlaceNestedFamily(document, view, pair.Key, pair.Value, dependencies),
            StringComparer.Ordinal);

        foreach (var pair in model.Arrays)
            CreateCenteredLinearArray(document, view, pair.Key, pair.Value, instances);

        _ = transaction.Commit();
    }

    private static FamilyInstance PlaceNestedFamily(
        Document document,
        View view,
        string slug,
        FamilyModelNestedFamily nested,
        IReadOnlyDictionary<string, Family> dependencies
    ) {
        _ = PortableFamilyReference.TryParse(nested.Family, out var dependencyReference);
        if (!dependencies.TryGetValue(dependencyReference.Target, out var dependency))
            throw new InvalidOperationException($"Nested family '{slug}' dependency was not loaded.");

        var symbol = dependency.GetFamilySymbolIds()
                         .Select(id => document.GetElement(id))
                         .OfType<FamilySymbol>()
                         .SingleOrDefault(item => string.Equals(item.Name, nested.Type, StringComparison.Ordinal))
                     ?? throw new InvalidOperationException(
                         $"Nested family '{dependency.Name}' has no type '{nested.Type}'.");
        if (!symbol.IsActive)
            symbol.Activate();

        var instance = document.FamilyCreate.NewFamilyInstance(XYZ.Zero, symbol, StructuralType.NonStructural);
        document.Regenerate();
        AlignNestedCenter(document, view, instance, "Center (Left/Right)");
        AlignNestedCenter(document, view, instance, "Center (Front/Back)");

        foreach (var binding in nested.ParameterBindings) {
            var target = instance.LookupParameter(binding.Key)
                         ?? throw new InvalidOperationException(
                             $"Nested family '{slug}' has no parameter '{binding.Key}'.");
            _ = PortableFamilyReference.TryParse(binding.Value, out var sourceReference);
            var source = document.FamilyManager.get_Parameter(sourceReference.Target)
                         ?? throw new InvalidOperationException(
                             $"Nested family binding source '{sourceReference.Target}' was not found.");
            if (!document.FamilyManager.CanElementParameterBeAssociated(target)) {
                throw new InvalidOperationException(
                    $"Nested family parameter '{binding.Key}' cannot be associated in Revit.");
            }

            document.FamilyManager.AssociateElementParameterToFamilyParameter(target, source);
        }

        return instance;
    }

    private static void CreateCenteredLinearArray(
        Document document,
        View view,
        string slug,
        FamilyModelArray spec,
        IReadOnlyDictionary<string, FamilyInstance> instances
    ) {
        _ = PortableFamilyReference.TryParse(spec.Member, out var memberReference);
        var seed = instances[memberReference.Target];
        if (!LinearArray.IsElementArrayable(document, seed.Id))
            throw new InvalidOperationException($"Nested family '{memberReference.Target}' is not arrayable.");

        _ = PortableFamilyReference.TryParse(spec.HalfCount, out var halfCountReference);
        var halfCount = document.FamilyManager.get_Parameter(halfCountReference.Target)
                        ?? throw new InvalidOperationException(
                            $"CenteredLinear array '{slug}' half-count parameter was not found.");
        var halfCountFormula = PrepareHalfCountForArrayLabel(document, halfCount);

        var axis = ParseAxis(spec.Axis);
        var towardEnd = LinearArray.Create(document, view, seed.Id, 2, axis, (ArrayAnchorMember)1);
        var centerMemberId = towardEnd.GetOriginalMemberIds().Single();
        var towardStart = LinearArray.Create(document, view, centerMemberId, 2, axis.Negate(), (ArrayAnchorMember)1);

        // The endpoint locks are the stable part of the hand-authored GRD method. Revit owns the generated groups,
        // equality dimensions, and placeholder behavior; exposing those artifacts would make the model less portable.
        AlignArrayEndpoint(document, view, towardEnd, spec.Limits.End, spec.Axis);
        AlignArrayEndpoint(document, view, towardStart, spec.Limits.Start, spec.Axis);

        towardEnd.Label = halfCount;
        towardStart.Label = halfCount;
        if (!string.IsNullOrWhiteSpace(halfCountFormula)) {
            document.FamilyManager.SetFormula(halfCount, halfCountFormula);
            document.Regenerate();
        }
    }

    private static string? PrepareHalfCountForArrayLabel(Document document, FamilyParameter halfCount) {
        var formula = halfCount.Formula;
        if (string.IsNullOrWhiteSpace(formula))
            return null;

        var manager = document.FamilyManager;
        var originalType = manager.CurrentType;
        // Native arrays require a value of at least two at the moment Label is assigned. Clearing the formula and
        // seeding two first is how Revit's own 0/1 placeholder convention is authored; restoring the formula after
        // both half-arrays are labeled allows the same parameter to evaluate to 0 or 1 safely.
        manager.SetFormula(halfCount, null!);
        foreach (var type in manager.Types.Cast<FamilyType>()) {
            manager.CurrentType = type;
            manager.Set(halfCount, 2);
        }
        manager.CurrentType = originalType;
        document.Regenerate();
        return formula;
    }

    private static void AlignNestedCenter(
        Document document,
        View view,
        FamilyInstance instance,
        string hostPlaneName
    ) {
        var hostPlane = GetReferencePlane(document, hostPlaneName);
        var nestedReference = instance.GetReferenceByName(hostPlaneName)
                              ?? throw new InvalidOperationException(
                                  $"Nested family '{instance.Symbol.Family.Name}' exposes no '{hostPlaneName}' reference.");
        _ = document.FamilyCreate.NewAlignment(view, hostPlane.GetReference(), nestedReference);
    }

    private static void AlignArrayEndpoint(
        Document document,
        View view,
        LinearArray array,
        string limitReferenceText,
        string axis
    ) {
        var copiedId = array.GetCopiedMemberIds().Single();
        var copiedElement = document.GetElement(copiedId);
        var endpoint = copiedElement switch {
            Group group => group.GetMemberIds().Select(document.GetElement).OfType<FamilyInstance>().Single(),
            FamilyInstance familyInstance => familyInstance,
            _ => throw new InvalidOperationException(
                $"CenteredLinear copied member '{copiedElement?.GetType().Name}' is not supported.")
        };
        var nestedReferenceName = axis.EndsWith("Y", StringComparison.Ordinal)
            ? "Center (Front/Back)"
            : "Center (Left/Right)";
        var endpointReference = endpoint.GetReferenceByName(nestedReferenceName)
                                ?? throw new InvalidOperationException(
                                    $"Array endpoint exposes no '{nestedReferenceName}' reference.");
        _ = PortableFamilyReference.TryParse(limitReferenceText, out var limitReference);
        var limitPlane = GetReferencePlane(document, limitReference.Target);
        var endpointPoint = (endpoint.Location as LocationPoint)?.Point
                            ?? throw new InvalidOperationException("Array endpoint has no point location.");
        var geometricPlane = limitPlane.GetPlane();
        var move = geometricPlane.Normal.Multiply(
            geometricPlane.Normal.DotProduct(geometricPlane.Origin - endpointPoint));
        if (!move.IsZeroLength()) {
            // NewAlignment only locks references that are already coincident. Moving the generated copied group
            // changes the native array spacing; the following alignment then makes the named limit authoritative.
            ElementTransformUtils.MoveElement(document, copiedId, move);
            document.Regenerate();
        }
        _ = document.FamilyCreate.NewAlignment(view, limitPlane.GetReference(), endpointReference);
    }

    private static ReferencePlane GetReferencePlane(Document document, string name) =>
        new FilteredElementCollector(document)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .SingleOrDefault(plane => string.Equals(plane.Name, name, StringComparison.Ordinal))
        ?? throw new InvalidOperationException($"Reference plane '{name}' was not found.");

    private static XYZ ParseAxis(string axis) => axis switch {
        "+X" => XYZ.BasisX,
        "-X" => XYZ.BasisX.Negate(),
        "+Y" => XYZ.BasisY,
        "-Y" => XYZ.BasisY.Negate(),
        _ => throw new InvalidOperationException(
            $"CenteredLinear axis '{axis}' is not supported; the proven native topology is planar.")
    };

    private static View GetPlanView(Document document) =>
        new FilteredElementCollector(document)
            .OfClass(typeof(ViewPlan))
            .Cast<ViewPlan>()
            .Where(view => !view.IsTemplate)
            .OrderBy(view => view.Name, StringComparer.Ordinal)
            .FirstOrDefault()
        ?? throw new InvalidOperationException("CenteredLinear requires a family plan view.");
}
