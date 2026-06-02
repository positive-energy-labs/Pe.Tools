using Autodesk.Revit.DB.Electrical;
using Pe.Revit.DocumentData.Parameters;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Electrical;

internal static class ElectricalCollectorSupport {
    private const int DefaultRequestedParameterLimit = 10;

    public static HashSet<string> ToFilterSet(IEnumerable<string>? values) =>
        values == null
            ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            : values
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

    public static string? ReadString(Element element, string parameterName) {
        var parameter = element.LookupParameter(parameterName);
        return parameter?.AsString() ?? parameter?.AsValueString();
    }

    public static string? ReadString(Element element, BuiltInParameter parameterId) {
        var parameter = element.get_Parameter(parameterId);
        return parameter?.AsString() ?? parameter?.AsValueString();
    }

    public static string? ReadDisplay(Element element, string parameterName) {
        var parameter = element.LookupParameter(parameterName);
        return parameter?.AsValueString() ?? parameter?.AsString();
    }

    public static string? ReadDisplay(Element element, BuiltInParameter parameterId) {
        var parameter = element.get_Parameter(parameterId);
        return parameter?.AsValueString() ?? parameter?.AsString();
    }

    public static bool ReadBool(Element element, string parameterName) {
        var parameter = element.LookupParameter(parameterName);
        return parameter?.StorageType == StorageType.Integer && parameter.AsInteger() != 0;
    }

    public static bool ReadBool(Element element, BuiltInParameter parameterId) {
        var parameter = element.get_Parameter(parameterId);
        return parameter?.StorageType == StorageType.Integer && parameter.AsInteger() != 0;
    }

    public static string? ReadMark(Element element) => ReadString(element, BuiltInParameter.ALL_MODEL_MARK);

    public static List<ResolvedParameterReference> NormalizeRequestedParameterReferences(
        RequestedParameterQuery? parameterQuery,
        List<RevitDataIssue> issues,
        string issueContext
    ) {
        var requestedParameters = ParameterReferenceResolver.Resolve(parameterQuery?.Parameters).ToList();

        if (requestedParameters.Count <= DefaultRequestedParameterLimit)
            return requestedParameters;

        issues.Add(Warning(
            $"{issueContext}RequestedParameterLimitExceeded",
            $"Requested parameter count exceeded {DefaultRequestedParameterLimit}; truncating to the first {DefaultRequestedParameterLimit} references."
        ));
        return requestedParameters.Take(DefaultRequestedParameterLimit).ToList();
    }

    public static List<RequestedElementParameterValue>? CollectRequestedParameters(
        Element element,
        IReadOnlyList<ResolvedParameterReference> requestedParameters
    ) {
        if (requestedParameters.Count == 0)
            return null;

        return requestedParameters
            .Select(reference => ToRequestedParameterValue(element, reference))
            .ToList();
    }

    public static CollectedElementIdentity CollectElementIdentity(
        Element element,
        IReadOnlyList<ResolvedParameterReference> requestedParameters
    ) {
        var requestedParametersValues = CollectRequestedParameters(element, requestedParameters);
        var requestedIdentity = requestedParametersValues?
            .FirstOrDefault(parameter => parameter.Found && !string.IsNullOrWhiteSpace(parameter.Value))?
            .Value;
        if (!string.IsNullOrWhiteSpace(requestedIdentity)) {
            return new CollectedElementIdentity(
                requestedIdentity.Trim(),
                ElementIdentitySource.RequestedParameter,
                requestedParametersValues
            );
        }

        var mark = NullIfWhiteSpace(ReadMark(element));
        if (!string.IsNullOrWhiteSpace(mark)) {
            return new CollectedElementIdentity(
                mark,
                ElementIdentitySource.Mark,
                requestedParametersValues
            );
        }

        return new CollectedElementIdentity(
            null,
            ElementIdentitySource.None,
            requestedParametersValues
        );
    }

    public static XYZ? TryGetElementPoint(Element element) {
        if (element.Location is LocationPoint locationPoint)
            return locationPoint.Point;

        if (element.Location is LocationCurve locationCurve)
            return SafeGet(() => locationCurve.Curve?.Evaluate(0.5, true));

        var boundingBox = SafeGet(() => element.get_BoundingBox(null));
        if (boundingBox == null)
            return null;

        return (boundingBox.Min + boundingBox.Max) * 0.5;
    }

    public static string? GetFamilyName(FamilyInstance instance) => instance.Symbol?.Family?.Name;

    public static string? GetTypeName(FamilyInstance instance) => instance.Symbol?.Name;

    public static string? GetPanelName(FamilyInstance? panel) =>
        panel == null
            ? null
            : NullIfWhiteSpace(ReadString(panel, BuiltInParameter.RBS_ELEC_PANEL_NAME)) ?? NullIfWhiteSpace(panel.Name);

    public static string? GetDistributionSystemName(ElectricalEquipment? equipment) =>
        NullIfWhiteSpace(equipment?.DistributionSystem?.Name);

    public static List<ElectricalSystem> GetAssignedCircuits(ElectricalEquipment? equipment) =>
        equipment?.GetAssignedElectricalSystems()?.OfType<ElectricalSystem>().ToList() ?? [];

    public static List<Connector> GetElectricalConnectors(FamilyInstance? family) =>
        family?.MEPModel?.ConnectorManager?.Connectors
            .Cast<Connector>()
            .Where(connector => connector.Domain == Domain.DomainElectrical)
            .ToList() ?? [];

    public static int CountElectricalConnectors(FamilyInstance? family) =>
        GetElectricalConnectors(family).Count;

    public static bool HasElectricalConnector(FamilyInstance? family) =>
        CountElectricalConnectors(family) > 0;

    public static bool IsProxyLikeRole(ElectricalInsightRole role) =>
        role == ElectricalInsightRole.ProxyFixture ||
        role == ElectricalInsightRole.InlineElectricalEquipment;

    public static bool IsNearbyProxyCandidateRole(ElectricalInsightRole role) =>
        role == ElectricalInsightRole.ProxyFixture ||
        role == ElectricalInsightRole.InlineElectricalEquipment ||
        role == ElectricalInsightRole.LoadFamilyInstance ||
        role == ElectricalInsightRole.DownstreamPanel;

    public static List<ElectricalSystem> GetElectricalSystems(FamilyInstance? family) {
        var directSystems = family?.MEPModel?.GetElectricalSystems()?.OfType<ElectricalSystem>().ToList() ?? [];
        if (directSystems.Count != 0)
            return directSystems;

        return GetElectricalConnectors(family)
            .Select(connector => connector.MEPSystem)
            .OfType<ElectricalSystem>()
            .GroupBy(system => system.Id.Value())
            .Select(group => group.First())
            .ToList();
    }

    public static ElectricalInsightRole DeterminePanelRole(
        ElectricalEquipment? equipment,
        int assignedCircuitCount,
        int panelScheduleCount
    ) {
        if (equipment == null)
            return ElectricalInsightRole.Element;

        if (assignedCircuitCount > 0 || panelScheduleCount > 0)
            return ElectricalInsightRole.Panel;

        return ElectricalInsightRole.InlineElectricalEquipment;
    }

    public static ElectricalInsightRole DetermineCircuitConnectedElementRole(Element element) {
        if (element is ElectricalSystem)
            return ElectricalInsightRole.Circuit;

        if (element is Wire)
            return ElectricalInsightRole.Wire;

        if (element is ElectricalLoadClassification)
            return ElectricalInsightRole.LoadClassification;

        if (element is not FamilyInstance family)
            return ElectricalInsightRole.Element;

        if (family.MEPModel is ElectricalEquipment equipment) {
            var panelRole = DeterminePanelRole(equipment, GetAssignedCircuits(equipment).Count, 0);
            return panelRole == ElectricalInsightRole.Panel
                ? ElectricalInsightRole.DownstreamPanel
                : ElectricalInsightRole.InlineElectricalEquipment;
        }

        if (IsProxyLikeElectricalCategory(family))
            return ElectricalInsightRole.ProxyFixture;

        if (HasElectricalConnector(family))
            return ElectricalInsightRole.LoadFamilyInstance;

        return ElectricalInsightRole.Element;
    }

    public static ElectricalInsightRole DetermineSelectionRole(
        Element element,
        int panelScheduleCount = 0
    ) {
        if (element is ElectricalSystem)
            return ElectricalInsightRole.Circuit;

        if (element is Wire)
            return ElectricalInsightRole.Wire;

        if (element is ElectricalLoadClassification)
            return ElectricalInsightRole.LoadClassification;

        if (element is not FamilyInstance family)
            return ElectricalInsightRole.Element;

        if (family.MEPModel is ElectricalEquipment equipment)
            return DeterminePanelRole(equipment, GetAssignedCircuits(equipment).Count, panelScheduleCount);

        return DetermineCircuitConnectedElementRole(element);
    }

    public static RevitDataIssue Warning(string code, string message, string? elementName = null) =>
        new(code, RevitDataIssueSeverity.Warning, message, TypeName: elementName);

    public static bool MatchesCircuitFilter(
        ElectricalSystem circuit,
        HashSet<string> panelNames,
        HashSet<string> circuitNumbers,
        HashSet<string> loadNames
    ) {
        if (panelNames.Count != 0 && !panelNames.Contains(circuit.PanelName))
            return false;

        if (circuitNumbers.Count != 0 && !circuitNumbers.Contains(circuit.CircuitNumber))
            return false;

        return loadNames.Count == 0 ||
               (!string.IsNullOrWhiteSpace(circuit.LoadName) && loadNames.Contains(circuit.LoadName));
    }

    public static bool MatchesLoadClassificationFilter(
        ElectricalLoadClassification classification,
        HashSet<string> names,
        HashSet<string> abbreviations
    ) {
        if (names.Count != 0 && !names.Contains(classification.Name))
            return false;

        return abbreviations.Count == 0 ||
               (!string.IsNullOrWhiteSpace(classification.Abbreviation) &&
                abbreviations.Contains(classification.Abbreviation));
    }

    public static string? NullIfWhiteSpace(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    public static T? SafeGet<T>(Func<T> func) {
        try {
            return func();
        } catch {
            return default;
        }
    }

    private static RequestedElementParameterValue ToRequestedParameterValue(Element element, ResolvedParameterReference reference) {
        var parameter = TryFindRequestedParameter(element, reference, out var source);
        var value = parameter == null
            ? null
            : NullIfWhiteSpace(parameter.AsString()) ?? NullIfWhiteSpace(parameter.AsValueString());
        var displayValue = parameter == null
            ? null
            : NullIfWhiteSpace(parameter.AsValueString()) ?? NullIfWhiteSpace(parameter.AsString());
        return new RequestedElementParameterValue(
            ToRequestedParameterDefinition(reference, parameter, source),
            parameter != null,
            parameter == null || (string.IsNullOrWhiteSpace(value) && string.IsNullOrWhiteSpace(displayValue)),
            value,
            displayValue,
            ToRequestedParameterStorageType(parameter?.StorageType ?? StorageType.None),
            source
        );
    }

    private static Parameter? TryFindRequestedParameter(
        Element element,
        ResolvedParameterReference reference,
        out RequestedParameterValueSource source
    ) {
        var instanceParameter = FindParameter(element, reference);
        if (instanceParameter != null) {
            source = RequestedParameterValueSource.Instance;
            return instanceParameter;
        }

        var typeId = SafeGet(element.GetTypeId);
        var typeElement = typeId == null || typeId == ElementId.InvalidElementId
            ? null
            : SafeGet(() => element.Document.GetElement(typeId));
        var typeParameter = typeElement == null ? null : FindParameter(typeElement, reference);
        source = typeParameter == null ? RequestedParameterValueSource.None : RequestedParameterValueSource.Type;
        return typeParameter;
    }

    private static Parameter? FindParameter(Element element, ResolvedParameterReference reference) =>
        element.Parameters
            .Cast<Parameter>()
            .FirstOrDefault(parameter => ParameterReferenceResolver.Matches(
                ParameterIdentityEngine.FromCanonical(ParameterIdentityFactory.FromParameter(parameter)),
                reference));

    private static ParameterDefinitionDescriptor ToRequestedParameterDefinition(
        ResolvedParameterReference reference,
        Parameter? parameter,
        RequestedParameterValueSource source
    ) {
        if (parameter?.Definition == null) {
            return new ParameterDefinitionDescriptor(
                reference.Identity,
                source == RequestedParameterValueSource.None ? null : source == RequestedParameterValueSource.Instance,
                null,
                null,
                null,
                null
            );
        }

        var definition = parameter.Definition;
        return new ParameterDefinitionDescriptor(
            ParameterIdentityEngine.FromCanonical(ParameterIdentityFactory.FromParameter(parameter)),
            source == RequestedParameterValueSource.None ? null : source == RequestedParameterValueSource.Instance,
            NormalizeForgeTypeId(definition.GetDataType()),
            null,
            NormalizeForgeTypeId(definition.GetGroupTypeId()),
            null
        );
    }

    private static string? NormalizeForgeTypeId(ForgeTypeId forgeTypeId) =>
        string.IsNullOrWhiteSpace(forgeTypeId?.TypeId) ? null : forgeTypeId.TypeId;

    private static RequestedParameterStorageType ToRequestedParameterStorageType(StorageType storageType) =>
        storageType switch {
            StorageType.String => RequestedParameterStorageType.String,
            StorageType.Integer => RequestedParameterStorageType.Integer,
            StorageType.Double => RequestedParameterStorageType.Double,
            StorageType.ElementId => RequestedParameterStorageType.ElementId,
            _ => RequestedParameterStorageType.None
        };

    private static bool IsProxyLikeElectricalCategory(FamilyInstance family) =>
        string.Equals(family.Category?.Name, "Electrical Fixtures", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(family.Category?.Name, "Electrical Devices", StringComparison.OrdinalIgnoreCase);
}

internal sealed record CollectedElementIdentity(
    string? EffectiveIdentity,
    ElementIdentitySource EffectiveIdentitySource,
    List<RequestedElementParameterValue>? RequestedParameters
);
