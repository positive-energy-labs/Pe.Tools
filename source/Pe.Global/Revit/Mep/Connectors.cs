namespace Pe.Global.Revit.Mep;

public class Connectors {
    /// <summary>Get all connectors on an element, ordered from closest to farthest from the specified location</summary>
    public static Result<Connector[]> GetClosestToPoint(Element element, XYZ location) {
        try {
            ConnectorManager cm = null;

            if (element is MEPCurve mepCurve)
                cm = mepCurve.ConnectorManager;
            else if (element is FamilyInstance fi && fi.MEPModel != null)
                cm = fi.MEPModel.ConnectorManager;
            else return new InvalidOperationException($"Error retrieving ConnectorManager for {element.Id}");

            // Create a list of connectors with their distances for sorting
            var connectorsWithDistances = cm.Connectors
                .Cast<Connector>()
                .Select(connector => (
                    connector, distance: location.DistanceTo(connector.Origin)
                ))
                .ToList();

            // Sort by distance (closest first) and return just the connectors
            return connectorsWithDistances
                .OrderBy(x => x.distance)
                .Select(x => x.connector)
                .ToArray();
        } catch (Exception e) {
            return new InvalidOperationException($"Error getting closest connectors: {e.Message}");
        }
    }
}