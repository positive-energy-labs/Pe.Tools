using Pe.FamilyFoundry.OperationSettings;
using Pe.Global;
using Pe.Global.Services.Storage;
using Pe.Global.Revit.Lib;
using Pe.Global.Utils.Files;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using ParamModelRes = Pe.Global.Services.Aps.Models.ParametersApi.Parameters.ParametersResult;
using ParamModel = Pe.Global.Services.Aps.Models.ParametersApi.Parameters;


namespace Pe.FamilyFoundry;

public class BaseProfileSettings {
    [Required] public ExecutionOptions ExecutionOptions { get; init; } = new();
    [Required] public FilterFamiliesSettings FilterFamilies { get; init; } = new();
    [Required] public FilterApsParamsSettings FilterApsParams { get; init; } = new();

    public List<Family> GetFamilies(Document doc) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(f => this.FilterFamilies.Filter(f, doc))
            .ToList();

    /// <summary>
    ///     Gets filtered APS parameter models (no Revit API dependencies).
    ///     These can be safely cached and converted to SharedParameterDefinitions later.
    /// </summary>
    public List<ParamModelRes> GetFilteredApsParamModels() {
        var apsParams = Storage.GlobalDir().StateJson<ParamModel>("parameters-service-cache").Read();
        if (apsParams.Results != null) {
            return apsParams.Results
                .Where(this.FilterApsParams.Filter)
                .Where(p => !p.IsArchived)
                .ToList();
        }

        throw new InvalidOperationException(
            $"This Family Foundry command requires cached parameters data, but no cached data exists. " +
            $"Run the \"Cache Parameters Service\" command on a Revit version above 2024 to generate the cache.");
    }

    /// <summary>
    ///     Converts raw APS parameter models to SharedParameterDefinitions using a TempSharedParamFile.
    ///     The TempSharedParamFile must remain alive while the SharedParameterDefinitions are in use.
    /// </summary>
    public static List<SharedParameterDefinition> ConvertToSharedParameterDefinitions(
        List<ParamModelRes> apsParamModels,
        TempSharedParamFile tempFile
    ) =>
        apsParamModels.Select(p => {
            var dlOpts = p.DownloadOptions;
            return new SharedParameterDefinition(
                dlOpts.GetExternalDefinition(tempFile.TempGroup),
                dlOpts.GetGroupTypeId(),
                dlOpts.IsInstance);
        }).ToList();

    public class FilterFamiliesSettings {
        [Description(
            "Default true. Whether to process all families regardless (true) or only process families that have an instance placed in the document (false).")]
        public bool IncludeUnusedFamilies { get; init; } = true;

        [Description("Categories of families to include (eg. Mechanical Equipment, Plumbing Fixtures, etc.)")]
        [Required]
        public List<Category> IncludeCategoriesEqualing { get; init; } = [];

        [Description(
            "Optional conditional filter based on family parameter values. Uses schedule filter logic to evaluate parameter conditions. Leave FieldName empty to disable this filter.")]
        public ScheduleFilterSpec IncludeByCondition { get; init; } =
            new() { FieldName = "", Value = string.Empty };

        [Description(
            "Filter families by name inclusion. If any include filters are specified (Equaling, Containing, or StartingWith), only families matching at least one filter will pass. If all include filters are empty, all families pass the include check (exclude filters may still apply).")]
        [Required]
        public IncludeFamilies IncludeNames { get; init; } = new();

        [Description(
            "Filter families by name exclusion. If any exclude filters are specified (Equaling, Containing, or StartingWith), families matching any filter will be removed. If all exclude filters are empty, no families are excluded by this filter.")]
        [Required]
        public ExcludeFamilies ExcludeNames { get; init; } = new();


        public bool Filter(Family f, Document doc) {
            var familyName = f.Name;
            var familyCategory = f.FamilyCategory;

            // Step 1: Filter by category if specified
            if (this.IncludeCategoriesEqualing.Any()) {
                if (familyCategory == null || !this.IncludeCategoriesEqualing.Any(familyCategory.Equals))
                    return false;
            }

            // Step 2: Filter by name inclusion/exclusion
            if (!this.IsNameIncluded(familyName) || this.IsNameExcluded(familyName))
                return false;

            // Step 3: Filter by placed instances if specified
            if (!this.IncludeUnusedFamilies) {
                var hasInstances = new FilteredElementCollector(doc)
                    .OfClass(typeof(FamilyInstance))
                    .Cast<FamilyInstance>()
                    .Any(fi => fi.Symbol?.Family?.Id == f.Id);

                if (!hasInstances)
                    return false;
            }

            // Step 4: Filter by conditional parameter filter if specified
            if (string.IsNullOrEmpty(this.IncludeByCondition.FieldName)) return true;

            // Use ScheduleHelper to evaluate the filter using Revit's native schedule filtering
            var scheduleSpec = new ScheduleSpec {
                Name = "Family Filter",
                CategoryName = familyCategory?.Name ?? "",
                Filters = [this.IncludeByCondition]
            };

            var matchingFamilies = ScheduleHelper.GetFamiliesMatchingFilters(doc, scheduleSpec, [f]);
            return matchingFamilies.Contains(f.Name);
        }

        private bool IsNameIncluded(string familyName) {
            var hasIncludeFilters = this.IncludeNames.Equaling.Any() ||
                                    this.IncludeNames.Containing.Any() ||
                                    this.IncludeNames.StartingWith.Any();

            if (!hasIncludeFilters) return false;

            return this.IncludeNames.Equaling.Any(familyName.Equals) ||
                   this.IncludeNames.Containing.Any(familyName.Contains) ||
                   this.IncludeNames.StartingWith.Any(familyName.StartsWith);
        }

        private bool IsNameExcluded(string familyName) {
            var hasExcludeFilters = this.ExcludeNames.Equaling.Any() ||
                                    this.ExcludeNames.Containing.Any() ||
                                    this.ExcludeNames.StartingWith.Any();

            if (!hasExcludeFilters) return false;

            return this.ExcludeNames.Equaling.Any(familyName.Equals) ||
                   this.ExcludeNames.Containing.Any(familyName.Contains) ||
                   this.ExcludeNames.StartingWith.Any(familyName.StartsWith);
        }
    }

    public class FilterApsParamsSettings {
        [Required]
        [Description(
            "Filter shared parameters by name inclusion. Exclude everything by default. Only parameters matching at least one include filter will be considered. If all include filters are empty, no parameters pass the include check.")]
        public IncludeSharedParameter IncludeNames { get; init; } = new();

        [Required]
        [Description(
            "Filter shared parameters by name exclusion. Parameters matching any exclude filter are removed from those that passed the include filter.")]
        public ExcludeSharedParameter ExcludeNames { get; init; } = new();

        public bool Filter(ParamModelRes p) {
            if (p == null || string.IsNullOrEmpty(p.Name)) return false;
            return this.IsIncluded(p) && !this.IsExcluded(p);
        }

        private bool IsIncluded(ParamModelRes p) {
            if (this.IncludeNames == null) return false;

            var equaling = this.IncludeNames.Equaling ?? [];
            var containing = this.IncludeNames.Containing ?? [];
            var startingWith = this.IncludeNames.StartingWith ?? [];

            var hasIncludeFilters = equaling.Any() || containing.Any() || startingWith.Any();

            // Exclude everything by default - only include if there are include filters AND the parameter matches
            if (!hasIncludeFilters) return false;

            return equaling.Any(p.Name.Equals) ||
                   containing.Any(p.Name.Contains) ||
                   startingWith.Any(p.Name.StartsWith);
        }

        private bool IsExcluded(ParamModelRes p) {
            if (this.ExcludeNames == null) return false;

            var equaling = this.ExcludeNames.Equaling ?? [];
            var containing = this.ExcludeNames.Containing ?? [];
            var startingWith = this.ExcludeNames.StartingWith ?? [];

            var hasExcludeFilters = equaling.Any() || containing.Any() || startingWith.Any();

            if (!hasExcludeFilters) return false;

            return equaling.Any(p.Name.Equals) ||
                   containing.Any(p.Name.Contains) ||
                   startingWith.Any(p.Name.StartsWith);
        }
    }
}