using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.DataTables;

/// <summary>
///     The fixed shared-parameter column pool behind synthetic data tables. Pool identity is these
///     GUIDs — never regenerate them; documents bind against them and parameter-links address cells
///     through them. All params bind as instance parameters on the dummy data-table category, so no
///     placed model element ever carries them (key elements only exist one-per-table-row).
/// </summary>
public static class DataTableColumnPool {
    public const BuiltInCategory Category = BuiltInCategory.OST_GenericModel;
    private const string SharedGroupName = "Pe Data Tables";

    public sealed record PoolColumn(string Name, Guid Guid, DataTableColumnKind Kind);

    public static readonly IReadOnlyList<PoolColumn> Columns = [
        new("Pe Table Text A", new Guid("9583c197-a313-4c0d-8c00-a5cef75a9297"), DataTableColumnKind.Text),
        new("Pe Table Text B", new Guid("79bd465f-b18f-4f11-8c07-7f2f28585b86"), DataTableColumnKind.Text),
        new("Pe Table Text C", new Guid("66a7e651-596c-4f3e-a53a-cd090f5435cf"), DataTableColumnKind.Text),
        new("Pe Table Text D", new Guid("a842ee0a-4594-42f6-ab51-4f6dd4fa25f0"), DataTableColumnKind.Text),
        new("Pe Table Text E", new Guid("5189d3bb-c20f-4feb-9767-1e1959e1a477"), DataTableColumnKind.Text),
        new("Pe Table Text F", new Guid("81ac7a07-8042-4570-b35e-d26a4d1675fc"), DataTableColumnKind.Text),
        new("Pe Table Text G", new Guid("26ab378e-dedf-4f41-9691-31861576ec7a"), DataTableColumnKind.Text),
        new("Pe Table Text H", new Guid("f8c54739-4b92-4b25-8738-2c9d6bce3a46"), DataTableColumnKind.Text),
        new("Pe Table Number A", new Guid("9cf0c78c-595f-46c3-83b5-3e4c7952a4f1"), DataTableColumnKind.Number),
        new("Pe Table Number B", new Guid("cbfb7322-7ff1-4eac-86f0-d473d7fb1510"), DataTableColumnKind.Number),
        new("Pe Table Number C", new Guid("86758006-7db9-461d-b805-144a65d95ef6"), DataTableColumnKind.Number),
        new("Pe Table Number D", new Guid("a6ede986-12ce-42ad-936e-32920fb715ba"), DataTableColumnKind.Number)
    ];

    public static IEnumerable<PoolColumn> OfKind(DataTableColumnKind kind) =>
        Columns.Where(column => column.Kind == kind);

    public static bool IsPoolParameter(Document document, ElementId parameterId) =>
        document.GetElement(parameterId) is SharedParameterElement shared &&
        Columns.Any(column => column.Guid == shared.GuidValue);

    public static PoolColumn? Resolve(Document document, ElementId parameterId) =>
        document.GetElement(parameterId) is SharedParameterElement shared
            ? Columns.FirstOrDefault(column => column.Guid == shared.GuidValue)
            : null;

    /// <summary>
    ///     Ensures every pool parameter exists as a shared instance project parameter bound to the
    ///     data-table category. Idempotent; must run inside an open transaction. Returns the pool
    ///     column to shared-parameter-element id map.
    /// </summary>
    public static Dictionary<Guid, ElementId> EnsureBound(Document document) {
        var resolved = new Dictionary<Guid, ElementId>();
        var boundAny = false;
        foreach (var column in Columns) {
            var existing = SharedParameterElement.Lookup(document, column.Guid);
            if (existing != null) {
                resolved[column.Guid] = existing.Id;
                continue;
            }

            var element = SharedParameterBinder.EnsureProjectBinding(
                document,
                new SharedDefinitionSpec(
                    column.Name,
                    column.Kind == DataTableColumnKind.Number ? SpecTypeId.Number : SpecTypeId.String.Text,
                    GroupName: SharedGroupName,
                    Description: $"Pe data-table column pool ({SharedGroupName}).",
                    Guid: column.Guid),
                [Category]);
            resolved[column.Guid] = element.Id;
            boundAny = true;
        }

        if (boundAny)
            document.Regenerate();
        return resolved;
    }
}
