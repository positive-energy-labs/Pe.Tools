namespace Pe.Revit.Parameters;

/// <summary>
///     Declarative shape of a shared parameter definition, independent of any shared parameter file.
/// </summary>
public sealed record SharedDefinitionSpec(
    string Name,
    ForgeTypeId DataType,
    string GroupName = "TempGroup",
    string Description = "",
    Guid? Guid = null,
    bool Visible = true,
    bool UserModifiable = true
);

/// <summary>
///     The one place that creates shared parameter definitions and binds them as project
///     parameters. All methods assume the caller owns any required transaction. Definition
///     creation goes through <see cref="TempSharedParamFile" /> so the user's shared parameter
///     file is never touched.
/// </summary>
public static class SharedParameterBinder {
    /// <summary>
    ///     Gets or creates an <see cref="ExternalDefinition" /> for the spec inside the given temp
    ///     shared parameter file. The definition is only guaranteed valid while
    ///     <paramref name="tempFile" /> is alive.
    /// </summary>
    public static ExternalDefinition EnsureDefinition(TempSharedParamFile tempFile, SharedDefinitionSpec spec) {
        var group = tempFile.DefinitionFile.Groups.get_Item(spec.GroupName)
                    ?? tempFile.DefinitionFile.Groups.Create(spec.GroupName);
        return EnsureDefinition(group, spec);
    }

    /// <summary>Gets or creates an <see cref="ExternalDefinition" /> in an already-open definition group.</summary>
    public static ExternalDefinition EnsureDefinition(DefinitionGroup group, SharedDefinitionSpec spec) {
        if (string.IsNullOrWhiteSpace(spec.Name))
            throw new ArgumentException("Shared parameter name is required.", nameof(spec));

        if (group.Definitions.get_Item(spec.Name) is ExternalDefinition existing)
            return existing;

        var options = new ExternalDefinitionCreationOptions(spec.Name, spec.DataType) {
            Description = spec.Description,
            Visible = spec.Visible,
            UserModifiable = spec.UserModifiable
        };
        if (spec.Guid is { } guid && guid != System.Guid.Empty)
            options.GUID = guid;

        return (ExternalDefinition)group.Definitions.Create(options);
    }

    /// <summary>
    ///     Binds a definition to the given categories as a project parameter, re-inserting when a
    ///     binding already exists. Returns false when Revit rejects the binding.
    /// </summary>
    public static bool Bind(
        Document document,
        Definition definition,
        IEnumerable<BuiltInCategory> categories,
        bool isInstance = true,
        ForgeTypeId? groupTypeId = null
    ) {
        var categorySet = document.Application.Create.NewCategorySet();
        foreach (var builtInCategory in categories.Distinct())
            _ = categorySet.Insert(builtInCategory.ToCategory(document));

        ElementBinding binding = isInstance
            ? document.Application.Create.NewInstanceBinding(categorySet)
            : document.Application.Create.NewTypeBinding(categorySet);

        var bindings = document.ParameterBindings;
        return bindings.Contains(definition)
            ? bindings.ReInsert(definition, binding, groupTypeId ?? GroupTypeId.Data)
            : bindings.Insert(definition, binding, groupTypeId ?? GroupTypeId.Data);
    }

    /// <summary>
    ///     Ensures a shared project parameter exists and is bound to the given categories:
    ///     resolves by GUID first, creates the definition in a temp shared parameter file when
    ///     missing, and binds it. Requires <see cref="SharedDefinitionSpec.Guid" /> (identity) and
    ///     an open transaction. Idempotent.
    /// </summary>
    public static SharedParameterElement EnsureProjectBinding(
        Document document,
        SharedDefinitionSpec spec,
        IEnumerable<BuiltInCategory> categories,
        bool isInstance = true,
        ForgeTypeId? groupTypeId = null
    ) {
        if (spec.Guid is not { } guid || guid == System.Guid.Empty)
            throw new ArgumentException("EnsureProjectBinding requires a stable shared parameter GUID.", nameof(spec));

        var existing = SharedParameterElement.Lookup(document, guid);
        if (existing != null && document.ParameterBindings.Contains(existing.GetDefinition()))
            return existing;

        using var tempFile = existing == null ? new TempSharedParamFile(document) : null;
        Definition definition = existing != null
            ? existing.GetDefinition()
            : EnsureDefinition(tempFile!, spec);

        if (!Bind(document, definition, categories, isInstance, groupTypeId))
            throw new InvalidOperationException($"Could not bind shared parameter '{spec.Name}'.");

        return SharedParameterElement.Lookup(document, guid)
               ?? throw new InvalidOperationException($"Shared parameter '{spec.Name}' bound but not resolvable.");
    }
}
