using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Parameters;

public static class ParameterReferenceLookup {
    public static Parameter? Find(
        Document document,
        Element element,
        ParameterReference reference,
        RevitParameterLookupPreference preference = RevitParameterLookupPreference.InstanceThenType
    ) {
        var resolved = ParameterReferenceResolver.Resolve([reference]).SingleOrDefault();
        return resolved == null ? null : Find(document, element, resolved, preference);
    }

    public static Parameter? Find(
        Document document,
        Element element,
        ResolvedParameterReference reference,
        RevitParameterLookupPreference preference = RevitParameterLookupPreference.InstanceThenType
    ) {
        if (Guid.TryParse(reference.SharedGuid, out var sharedGuid))
            return Find(document, element, preference, candidate => candidate.get_Parameter(sharedGuid));

        if (reference.BuiltInParameterId.HasValue) {
            var builtIn = (BuiltInParameter)reference.BuiltInParameterId.Value;
            return Find(document, element, preference, candidate => candidate.get_Parameter(builtIn));
        }

        if (reference.ParameterElementId.HasValue) {
            var parameterElementId = reference.ParameterElementId.Value;
            return Find(document, element, preference, candidate => candidate.Parameters
                .Cast<Parameter>()
                .FirstOrDefault(parameter => parameter.Id.Value() == parameterElementId));
        }

        return string.IsNullOrWhiteSpace(reference.Name)
            ? null
            : Find(document, element, preference, candidate => candidate.LookupParameter(reference.Name));
    }

    private static Parameter? Find(
        Document document,
        Element element,
        RevitParameterLookupPreference preference,
        Func<Element, Parameter?> lookup
    ) => preference switch {
        RevitParameterLookupPreference.InstanceOnly => lookup(element),
        RevitParameterLookupPreference.TypeOnly => FindOnType(document, element, lookup),
        _ => lookup(element) ?? FindOnType(document, element, lookup)
    };

    private static Parameter? FindOnType(Document document, Element element, Func<Element, Parameter?> lookup) =>
        document.GetElement(element.GetTypeId()) is ElementType type ? lookup(type) : null;
}
