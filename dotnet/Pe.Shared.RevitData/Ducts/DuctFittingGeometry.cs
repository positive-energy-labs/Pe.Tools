using System.Text.RegularExpressions;

namespace Pe.Shared.RevitData.Ducts;

/// <summary>Pure classifier over the collector's names, parameters and connector dimensions. Thin evidence stays unknown.</summary>
public static class DuctFittingGeometry {
    /// <summary>
    /// Center Radius and Duct Radius are lengths in feet; Angle is degrees. A radius family name or a positive radius
    /// does not establish smooth construction: a segmented elbow can have both. Only explicit construction words qualify.
    /// </summary>
    public static FittingGeometry Classify(string? partType, string? family, string? type,
        IReadOnlyList<DuctConnector> connectors, DuctEvidence<double?> angleDegrees,
        DuctEvidence<double?> centerRadiusFt, DuctEvidence<double?> ductRadiusFt) {
        var name = ((family ?? "") + " " + (type ?? "")).ToLowerInvariant().Replace('-', ' ');
        bool Has(string word) => Regex.IsMatch(name, @"\b" + Regex.Escape(word) + @"\b", RegexOptions.CultureInvariant);
        var unqualified = !Has("not") && !Has("non");
        var round = connectors.Count > 0 && connectors.All(c => c.Shape == DuctShape.Round && DuctPressurePhysics.Positive(c.DiameterIn));
        var elbow = partType == "Elbow" && connectors.Count == 2;
        var mitered = unqualified && (Has("mitered") || Has("mitred"));
        var vaned = (Has("vaned") || Has("vanes")) &&
            !Has("without") && !Has("no vanes") && !Has("unvaned");
        var smooth = unqualified && (Has("smooth") || Has("die stamped")) && !mitered && !vaned &&
            !Has("gored") && !Has("segmented") && !Has("without");
        var construction = elbow && vaned ? FittingConstruction.Vaned
            : elbow && mitered ? FittingConstruction.Mitered
            : elbow && round && smooth ? FittingConstruction.SmoothRound
            : partType is "Tee" or "LateralTee" && connectors.Count == 3 && round && unqualified && Has("simple") &&
                !Has("conical") && !Has("bellmouth") && !Has("saddle") ? FittingConstruction.SimpleJunction
            : partType == "Transition" && (Has("transition") || Has("reducer")) ? FittingConstruction.Transition
            : FittingConstruction.Unknown;
        var constructionEvidence = construction == FittingConstruction.Unknown
            ? "PartType, family/type and connector shape do not establish a supported construction"
            : "PartType + explicit family/type construction + connector shape";

        var angle = angleDegrees.Value is { } a && DuctPressurePhysics.Nonnegative(a) && a <= 180
            ? angleDegrees : angleDegrees with { Value = null, Evidence = angleDegrees.Evidence + "; missing or invalid angle" };
        var diameters = connectors.Select(c => c.DiameterIn).ToList();
        var equalRound = round && diameters.All(d => Math.Abs(d!.Value - diameters[0]!.Value) <= .001);
        var radius = new DuctEvidence<double?>(null, DuctProvenance.Derived, "r/D unknown: need center radius and one round duct diameter");
        if (equalRound && DuctPressurePhysics.Positive(centerRadiusFt.Value)) {
            var ductRadius = ductRadiusFt.Value;
            // Missing Duct Radius can use measured connector size; a contradictory parameter cannot.
            var diameterFt = DuctPressurePhysics.Positive(ductRadius) ? 2 * ductRadius!.Value : diameters[0]!.Value / 12;
            var agrees = ductRadius is null || DuctPressurePhysics.Positive(ductRadius) &&
                Math.Abs(24 * ductRadius.Value - diameters[0]!.Value) <= .001;
            if (agrees) radius = new(centerRadiusFt.Value!.Value / diameterFt, DuctProvenance.Derived,
                centerRadiusFt.Evidence + (ductRadius is null ? " / connector diameter" : " / (2 * " + ductRadiusFt.Evidence + ")"));
            else radius = radius with { Evidence = "Duct Radius disagrees with connector diameter" };
        }
        return new(angle, radius, new(construction, DuctProvenance.Derived, constructionEvidence),
            connectors.Count > 2 ? connectors.Select(c => new FittingConnectorArea(c.Index, new(
                DuctPressurePhysics.Section(c.Shape, c.DiameterIn, c.WidthIn, c.HeightIn)?.AreaFt2,
                DuctProvenance.Geometry, "Connector shape and dimensions"))).ToList() : []);
    }
}
