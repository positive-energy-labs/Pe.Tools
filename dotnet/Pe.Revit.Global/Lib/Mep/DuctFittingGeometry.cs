using Pe.Shared.RevitData.Ducts;
using System.Globalization;

namespace Pe.Revit.Global.Lib.Mep;

internal static class DuctFittingGeometry {
    // Exact parameter identity and Angle spec, instance before symbol; labels are never numerical inputs.
    internal static DuctFact? Angle(Element element) {
        try {
            foreach (var owner in new[] { element, element.Document.GetElement(element.GetTypeId()) }.OfType<Element>()) {
                var candidates = owner.GetParameters("Angle");
                if (candidates.Count == 0) continue;
                if (candidates.Count != 1) return null;
                var parameter = candidates[0];
                if (!parameter.HasValue || parameter.StorageType != StorageType.Double || parameter.Definition.GetDataType() != SpecTypeId.Angle)
                    return null;
                var raw = parameter.AsDouble();
                var degrees = UnitUtils.ConvertFromInternalUnits(raw, UnitTypeId.Degrees);
                if (double.IsNaN(degrees) || double.IsInfinity(degrees) || degrees <= 0 || degrees > 180) return null;
                var identity = $"{(owner.Id == element.Id ? "instance" : "type")}:{owner.Id.Value()}; uid:{owner.UniqueId}; parameter:{parameter.Id.Value()}; name:Angle; " +
                    $"spec:{parameter.Definition.GetDataType().TypeId}; rawRadians:{raw.ToString("R", CultureInfo.InvariantCulture)}; " +
                    $"builtIn:{(parameter.Definition as InternalDefinition)?.BuiltInParameter}; sharedGuid:{(parameter.IsShared ? parameter.GUID.ToString() : "none")}";
                return new DuctFact("angle", degrees, identity, "deg", DuctProvenance.Geometry);
            }
        } catch (Autodesk.Revit.Exceptions.ApplicationException) {
            return null;
        }
        return null;
    }
}
