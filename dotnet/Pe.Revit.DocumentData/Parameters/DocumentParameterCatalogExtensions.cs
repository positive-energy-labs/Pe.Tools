namespace Pe.Revit.DocumentData.Parameters;

public static class DocumentParameterCatalogExtensions {
    public static IReadOnlyList<Category> CollectInstanceCategories(this Document doc) =>
        doc.CollectInstances()
            .Select(element => element.Category)
            .Where(category => category != null)
            .Cast<Category>()
            .GroupBy(category => category.Id.Value())
            .Select(group => group.First())
            .ToList();

    public static IEnumerable<Element> CollectInstances(this Document doc) =>
        new FilteredElementCollector(doc).WhereElementIsNotElementType();

    public static IEnumerable<Element> CollectInstances(this Document doc, long categoryId) =>
        doc.CollectInstances().Where(element => element.Category?.Id.Value() == categoryId);

    public static IEnumerable<Element> ResolveElements(this Document doc, IReadOnlyCollection<string> uniqueIds) =>
        uniqueIds.Select(doc.GetElement).Where(element => element != null).Cast<Element>();

    public static IEnumerable<ElementType> ResolveElementTypes(this Document doc, IEnumerable<Element> elements) =>
        elements.Select(element => doc.GetElement(element.GetTypeId()))
            .OfType<ElementType>()
            .GroupBy(element => element.Id.Value())
            .Select(group => group.First());
}
