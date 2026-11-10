namespace Pe.Revit.Global.Lib.Mep;

internal static class MepConnectors {
    internal static IEnumerable<Connector> Physical(Element element, Domain domain) {
        var manager = element switch {
            MEPCurve curve => curve.ConnectorManager,
            FamilyInstance instance => instance.MEPModel?.ConnectorManager,
            _ => null
        };
        if (manager is null) yield break;
        foreach (Connector connector in manager.Connectors)
            if (connector.Domain == domain && connector.ConnectorType is ConnectorType.End or ConnectorType.Curve)
                yield return connector;
    }

    internal static IEnumerable<Connector> Peers(Connector connector, Domain domain) =>
        connector.AllRefs.Cast<Connector>().Where(other => other.Domain == domain &&
            other.ConnectorType is ConnectorType.End or ConnectorType.Curve && other.Owner.Id != connector.Owner.Id);
}
