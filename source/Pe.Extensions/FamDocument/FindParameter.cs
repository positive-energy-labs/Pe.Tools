namespace Pe.Extensions.FamDocument;

public static class FamilyDocumentFindParameter {
    /// <summary>
    ///     Find a shared parameter by ParameterTypeId identifier recieved from Parameters Service
    /// </summary>
    /// <param name="famDoc">The family document</param>
    /// <param name="parameterTypeId">The ForgeTypeId identifier of the parameter</param>
    /// <returns>The shared parameter element</returns>
    /// <exception cref="ArgumentException">Thrown if parameterTypeId format is invalid</exception>
    /// <exception cref="InvalidOperationException">Thrown if no parameter with the specified GUID is found</exception>
    public static SharedParameterElement FindParameter(this FamilyDocument famDoc, ForgeTypeId parameterTypeId) {
        var typeId = parameterTypeId.TypeId;
        var typeIdParts = typeId?.Split(':');
        if (typeIdParts == null || typeIdParts.Length < 2)
            throw new ArgumentException($"ParameterTypeId is not of the Parameters Service format: {typeId}");

        var parameterPart = typeIdParts[1];
        var dashIndex = parameterPart.IndexOf('-');
        var guidText = dashIndex > 0 ? parameterPart.Substring(0, dashIndex) : parameterPart;

        if (!Guid.TryParse(guidText, out var guid))
            throw new ArgumentException($"Could not extract GUID from parameterTypeId: {typeId}");

        return new FilteredElementCollector(famDoc)
            .OfClass(typeof(SharedParameterElement))
            .OfType<SharedParameterElement>()
            .First(p => p.GuidValue == guid);
    }
}