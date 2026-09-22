using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Dev.RevitAutomation;

public static class ScheduleCollectionDefaults {
    public const string DefaultPrimaryParameterName = "Discipline";
    public const string DefaultPrimaryParameterValue = "Mechanical";

    public static ScheduleCatalogRequest CreateDefaultPrimaryCatalogRequest() =>
        new() {
            CustomParameterFilters = [
                new ScheduleCustomParameterFilter(
                    ParameterReference.FromName(DefaultPrimaryParameterName),
                    DefaultPrimaryParameterValue,
                    ScheduleCustomParameterMatchKind.Equals
                )
            ]
        };

    public static ScheduleCatalogRequest CreateDefaultFallbackCatalogRequest() =>
        new() {
            CategoryNames = [
                "Mechanical Equipment",
                "Duct Accessories"
            ]
        };

    public static ScheduleCollectionRequest CreateDefaultRequest() =>
        new(
            CreateDefaultPrimaryCatalogRequest(),
            CreateDefaultFallbackCatalogRequest()
        );
}