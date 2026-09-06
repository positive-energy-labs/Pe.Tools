using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     One native `LinearArray.Create` per entry, labeled with the Integer parameter, with the copied member
///     locked to `spacingPlane` (`MoveTo: Last`) or moved by `spacing` (`MoveTo: Second`). The label must read
///     at least 2 when assigned, so a formula is cleared, reseeded to 2, and restored (harvested from
///     FamilyModelCompositionBuilder).
/// </summary>
public sealed class MakeArrays((string Slug, FamilyModelArray Spec)[] arrays, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Create {arrays.Length} linear arrays: {string.Join(", ", arrays.Select(a => a.Slug))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        var fm = doc.FamilyManager;
        foreach (var (slug, spec) in arrays) {
            try {
                var memberSpec = model.Nested.TryGetValue(spec.Member, out var m) ? m : throw new InvalidOperationException($"Array member '{spec.Member}' is not a nested entry.");
                var member = PlaceNested.Find(doc, memberSpec) ?? throw new InvalidOperationException($"Nested '{spec.Member}' is not placed.");
                if (!LinearArray.IsElementArrayable(doc, member.Id)) throw new InvalidOperationException($"'{spec.Member}' is not arrayable.");
                var label = FamilyRefs.Param(doc, spec.Label);
                var formula = label.Formula;
                if (!string.IsNullOrWhiteSpace(formula)) fm.SetFormula(label, null!);
                var current = fm.CurrentType;
                foreach (var type in fm.Types.Cast<FamilyType>()) { fm.CurrentType = type; if (!type.HasValue(label) || (type.AsInteger(label) ?? 0) < 2) fm.Set(label, 2); }
                fm.CurrentType = current;
                doc.Document.Regenerate();

                var direction = FamilyRefs.Direction(spec.Direction);
                var view = FamilyRefs.ViewFor(doc, null, Math.Abs(direction.Z) > 0.95 ? XYZ.BasisX : XYZ.BasisZ);
                var array = LinearArray.Create(doc, view, member.Id, 2, direction * (spec.Spacing is { } sp ? FamilyRefs.Feet(doc, sp) : 1.0), spec.MoveTo == ArrayAnchor.Second ? ArrayAnchorMember.Second : ArrayAnchorMember.Last);
                if (spec.SpacingPlane is { } planeName) {
                    var copied = doc.Document.GetElement(array.GetCopiedMemberIds().Single());
                    var endpoint = copied switch {
                        Group group => group.GetMemberIds().Select(id => doc.Document.GetElement(id)).OfType<FamilyInstance>().Single(),
                        FamilyInstance fi => fi,
                        _ => throw new InvalidOperationException($"Copied member is a {copied?.GetType().Name}.")
                    };
                    var (planeRef, plane) = FamilyRefs.Resolve(doc, planeName);
                    var alignName = memberSpec.Align?.FirstOrDefault(a => FamilyRefs.Resolve(doc, a.To).Plane.Normal.IsAlmostEqualTo(plane.Normal) || FamilyRefs.Resolve(doc, a.To).Plane.Normal.IsAlmostEqualTo(-plane.Normal))?.Instance
                                    ?? throw new InvalidOperationException($"Array '{slug}' needs a member alignment parallel to '{planeName}' to lock the last copy.");
                    var point = (endpoint.Location as LocationPoint)?.Point ?? throw new InvalidOperationException("Array endpoint has no point location.");
                    var move = plane.Normal * plane.Normal.DotProduct(plane.Origin - point);
                    if (!move.IsZeroLength()) { ElementTransformUtils.MoveElement(doc, copied!.Id, move); doc.Document.Regenerate(); }
                    FamilyRefs.Align(doc, view, planeRef, endpoint.GetReferenceByName(alignName) ?? throw new InvalidOperationException($"Endpoint exposes no '{alignName}'."));
                }
                array.Label = label;
                if (!string.IsNullOrWhiteSpace(formula)) { fm.SetFormula(label, formula); doc.Document.Regenerate(); }
                logs.Add(new LogEntry(slug).Success($"Array of {spec.Member} along {spec.Direction}, label {spec.Label}."));
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }
}
