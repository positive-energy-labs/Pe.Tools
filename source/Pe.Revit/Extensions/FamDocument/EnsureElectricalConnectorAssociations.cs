using Autodesk.Revit.DB.Electrical;

namespace Pe.Revit.Extensions.FamDocument;

public static class FamilyDocumentElectricalConnectorAssociations {
    private static readonly string[] PreferredPlaneNames = [
        "Center (Left/Right)", "CenterLR", "Center (Front/Back)", "CenterFB", "Reference Plane"
    ];

    /// <summary>Power connectors carry voltage, poles and load; Controls, Data, Telephone and similar electrical connectors carry none.</summary>
    public static bool IsPowerConnector(this ConnectorElement connector) =>
        connector.Domain == Domain.DomainElectrical &&
        connector.SystemClassification is MEPSystemClassification.PowerBalanced or MEPSystemClassification.PowerUnBalanced;

    /// <summary>The connector parameter a family parameter can drive for <paramref name="targetId"/>. On a Power - Unbalanced connector
    /// the total Apparent Load is computed per phase and never associable; a one-pole load lives on phase 1, more poles are refused.</summary>
    public static Parameter AssociableSlot(this ConnectorElement connector, BuiltInParameter targetId) {
        var target = connector.get_Parameter(targetId)
            ?? throw new InvalidOperationException($"Electrical connector {connector.Id.Value()} has no '{targetId}' parameter.");
        if (targetId != BuiltInParameter.RBS_ELEC_APPARENT_LOAD || connector.SystemClassification != MEPSystemClassification.PowerUnBalanced) return target;
        // A balanced connector also answers get_Parameter for the hidden phase slots; only the classification decides.
        var phase1 = connector.get_Parameter(BuiltInParameter.RBS_ELEC_APPARENT_LOAD_PHASE1)
            ?? throw new InvalidOperationException($"Electrical connector {connector.Id.Value()} is Power - Unbalanced without a phase 1 load parameter.");
        var poles = connector.get_Parameter(BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES)?.AsInteger() ?? 0;
        if (poles != 1)
            throw new InvalidOperationException($"Electrical connector {connector.Id.Value()} is Power - Unbalanced with {poles} poles; one Apparent Power parameter cannot drive its per-phase loads.");
        return phase1;
    }

    /// <summary>Associate every electrical connector to the requested family parameters, creating one on a native host when absent.</summary>
    /// <returns>Ids of connectors created or reassociated by this call. The caller owns the transaction.</returns>
    public static IReadOnlyList<ElementId> EnsureElectricalConnectorAssociations(this FamilyDocument document,
        IReadOnlyDictionary<BuiltInParameter, string> mappings, bool createIfAbsent = true) {
        if (mappings is null) throw new ArgumentNullException(nameof(mappings));
        if (mappings.Count == 0) return [];
        var manager = document.FamilyManager;
        var sources = mappings.OrderBy(mapping => (int)mapping.Key).Select(mapping => (
            Target: mapping.Key,
            Source: string.IsNullOrWhiteSpace(mapping.Value)
                ? throw new ArgumentException($"A source parameter is required for '{mapping.Key}'.", nameof(mappings))
                : manager.get_Parameter(mapping.Value) ?? throw new InvalidOperationException($"Family parameter '{mapping.Value}' was not found."))).ToList();
        var connectors = new FilteredElementCollector(document)
            .OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>()
            .Where(connector => connector.IsPowerConnector())
            .OrderBy(connector => connector.Id.Value()).ToList();
        var changed = new HashSet<ElementId>();
        if (connectors.Count == 0 && !createIfAbsent) return [];
        if (connectors.Count == 0) {
            var connector = Create(document);
            document.Document.Regenerate();
            connectors.Add(connector);
            changed.Add(connector.Id);
        }

        foreach (var connector in connectors)
            foreach (var (targetId, source) in sources) {
                var target = connector.AssociableSlot(targetId);
                if (target.Definition.GetDataType() != source.Definition.GetDataType())
                    throw new InvalidOperationException($"Connector parameter '{target.Definition.Name}' is incompatible with family parameter '{source.Definition.Name}'.");
                var existing = manager.GetAssociatedFamilyParameter(target);
                if (existing?.Id == source.Id) continue;
                // An associated parameter reports itself as not associable; release the legacy association before asking.
                if (existing is not null) manager.AssociateElementParameterToFamilyParameter(target, null);
                if (!manager.CanElementParameterBeAssociated(target))
                    throw new InvalidOperationException($"Connector parameter '{target.Definition.Name}' cannot be associated on connector {connector.Id.Value()} (read-only: {target.IsReadOnly}; was: {existing?.Definition.Name ?? "unassociated"}; " +
                        string.Join(", ", connector.Parameters.Cast<Parameter>().OrderBy(p => p.Definition.Name).Select(p => $"{p.Definition.Name}={p.AsValueString() ?? p.AsString()}")) + ").");
                manager.AssociateElementParameterToFamilyParameter(target, source);
                changed.Add(connector.Id);
            }
        return changed.OrderBy(id => id.Value()).ToList();
    }

    private static ConnectorElement Create(FamilyDocument document) {
        var attempts = new List<string>();
        foreach (var candidate in HostCandidates(document)) {
            try {
                return ConnectorElement.CreateElectricalConnector(document, ElectricalSystemType.PowerBalanced, candidate.Reference);
            } catch (Exception referenceError) {
                if (candidate.Edge is null) {
                    attempts.Add($"{candidate.Source}: {referenceError.Message}");
                    continue;
                }
                try {
                    return ConnectorElement.CreateElectricalConnector(document, ElectricalSystemType.PowerBalanced, candidate.Reference, candidate.Edge);
                } catch (Exception edgeError) {
                    attempts.Add($"{candidate.Source}: {referenceError.Message} | with edge: {edgeError.Message}");
                }
            }
        }
        throw new InvalidOperationException(attempts.Count == 0
            ? "Could not create an electrical connector because the family has no supported native host."
            : $"Could not create an electrical connector. Attempts: {string.Join(" | ", attempts)}");
    }

    private static IEnumerable<HostCandidate> HostCandidates(FamilyDocument document) {
        var planes = new FilteredElementCollector(document)
            .OfClass(typeof(ReferencePlane)).Cast<ReferencePlane>()
            .Select(plane => (Plane: plane, Rank: Array.FindIndex(PreferredPlaneNames,
                name => string.Equals(name, plane.Name, StringComparison.OrdinalIgnoreCase))))
            .OrderBy(candidate => candidate.Rank < 0 ? int.MaxValue : candidate.Rank)
            .ThenBy(candidate => candidate.Plane.Id.Value());
        foreach (var candidate in planes) {
            Reference reference;
            try { reference = candidate.Plane.GetReference(); }
            catch { continue; }
            yield return new HostCandidate(reference, null, $"reference plane '{candidate.Plane.Name}' ({candidate.Plane.Id.Value()})");
        }

        foreach (var candidate in PlanarFaces(document).OrderByDescending(candidate => candidate.Area).ThenBy(candidate => candidate.Stable, StringComparer.Ordinal))
            yield return candidate;
    }

    private static IEnumerable<HostCandidate> PlanarFaces(FamilyDocument document) {
        var options = new Options { ComputeReferences = true, IncludeNonVisibleObjects = true, DetailLevel = ViewDetailLevel.Fine };
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var element in new FilteredElementCollector(document).WhereElementIsNotElementType().OrderBy(element => element.Id.Value())) {
            if (element is ConnectorElement) continue;
            GeometryElement geometry;
            try { geometry = element.get_Geometry(options); }
            catch { continue; }
            if (geometry is null) continue;
            foreach (var (face, source) in EnumeratePlanarFaces(geometry, $"element {element.Id.Value()}")) {
                if (face.Reference is null) continue;
                var stable = Stable(document, face.Reference, $"{element.Id.Value()}:{source}:{face.Area:R}");
                if (!seen.Add(stable)) continue;
                var edge = face.EdgeLoops.Cast<EdgeArray>().SelectMany(loop => loop.Cast<Edge>())
                    .OrderBy(candidate => Stable(document, candidate.Reference, candidate.ApproximateLength.ToString("R", System.Globalization.CultureInfo.InvariantCulture)), StringComparer.Ordinal)
                    .FirstOrDefault();
                yield return new HostCandidate(face.Reference, edge, source, face.Area, stable);
            }
        }
    }

    private static IEnumerable<(PlanarFace Face, string Source)> EnumeratePlanarFaces(GeometryElement geometry, string source) {
        var index = 0;
        foreach (var item in geometry) {
            switch (item) {
            case Solid solid when solid.Faces.Size > 0:
                foreach (var face in solid.Faces.Cast<Face>().OfType<PlanarFace>()) yield return (face, $"{source}/face {index++}");
                break;
            case GeometryInstance instance:
                GeometryElement nested;
                try { nested = instance.GetInstanceGeometry(); }
                catch { continue; }
                foreach (var face in EnumeratePlanarFaces(nested, $"{source}/instance {index++}")) yield return face;
                break;
            }
        }
    }

    private static string Stable(FamilyDocument document, Reference? reference, string fallback) {
        if (reference is null) return fallback;
        try { return reference.ConvertToStableRepresentation(document); }
        catch { return fallback; }
    }

    private sealed record HostCandidate(Reference Reference, Edge? Edge, string Source, double Area = 0, string Stable = "");
}
