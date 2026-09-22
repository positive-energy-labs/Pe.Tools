using Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public sealed class UnitTypeIdValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.UnitTypeIds,
        SettingsRuntimeMode.HostOnly,
        mode: SettingsOptionsMode.Constraint,
        allowsCustomValue: false
    ) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) => new(ScheduleFieldFormatValueDomain.GetUnitOptions()
        .Select(option => new ValueDomainOptionItem(option.Value, option.Label, null))
        .ToList());
}

public sealed class SymbolTypeIdValueDomain()
    : SettingsValueDomainBase(
        ValueDomainKeys.SymbolTypeIds,
        SettingsRuntimeMode.HostOnly,
        [new SettingsOptionsDependency(ValueDomainContextKeys.UnitTypeId, SettingsOptionsDependencyScope.Sibling)],
        SettingsOptionsMode.Constraint,
        false
    ) {
    public override ValueTask<IReadOnlyList<ValueDomainOptionItem>> GetOptionsAsync(
        ValueDomainExecutionContext context,
        CancellationToken cancellationToken = default
    ) {
        var unitValue = context.TryGetContextValue(ValueDomainContextKeys.UnitTypeId, out var unitTypeId)
            ? unitTypeId
            : null;

        return new(ScheduleFieldFormatValueDomain.GetSymbolOptions(unitValue)
            .Select(option => new ValueDomainOptionItem(option.Value, option.Label, null))
            .ToList());
    }
}
