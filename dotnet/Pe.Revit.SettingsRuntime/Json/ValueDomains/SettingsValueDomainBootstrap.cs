namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public static class SettingsValueDomainBootstrap {
    private static int _registered;

    public static void RegisterDefaults() {
        if (Interlocked.Exchange(ref _registered, 1) == 1)
            return;

        var registry = SettingsValueDomainRegistry.Shared;
        registry.Register(ValueDomainKeys.AnnotationTagFamilyNames, static () => new AnnotationTagFamilyNamesValueDomain());
        registry.Register(ValueDomainKeys.AnnotationTagTypeNames, static () => new AnnotationTagTypeNamesValueDomain());
        registry.Register(ValueDomainKeys.CategoryNames, static () => new CategoryNamesValueDomain());
        registry.Register(ValueDomainKeys.FamilyNames, static () => new FamilyNamesValueDomain());
        registry.Register(ValueDomainKeys.PropertyGroupNames, static () => new PropertyGroupNamesValueDomain());
        registry.Register(ValueDomainKeys.ScheduleFieldNames, static () => new ScheduleFieldNamesValueDomain());
        registry.Register(ValueDomainKeys.ScheduleViewTemplateNames, static () => new ScheduleViewTemplateNamesValueDomain());
        registry.Register(ValueDomainKeys.SharedParameterNames, static () => new SharedParameterNamesValueDomain());
        registry.Register(ValueDomainKeys.SpecNames, static () => new SpecNamesValueDomain());
        registry.Register(ValueDomainKeys.UnitTypeIds, static () => new UnitTypeIdValueDomain());
        registry.Register(ValueDomainKeys.SymbolTypeIds, static () => new SymbolTypeIdValueDomain());
        registry.Register(ValueDomainKeys.LineStyleNames, static () => new LineStyleNamesValueDomain());
        registry.Register(ValueDomainKeys.CategoryIds, static () => new CategoryIdsValueDomain());
        registry.Register(ValueDomainKeys.ElementUniqueIds, static () => new ElementUniqueIdsValueDomain());
        registry.Register(ValueDomainKeys.ParameterIdentities, static () => new ParameterIdentitiesValueDomain());
    }
}
