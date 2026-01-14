using Newtonsoft.Json;

namespace Pe.Global.Services.Aps.Models;

public class ParametersApi {
    public class Pagination {
        [UsedImplicitly] public int Offset { get; init; }
        [UsedImplicitly] public int Limit { get; init; }
        [UsedImplicitly] public int TotalResults { get; init; }
    }

    public class Groups {
        [UsedImplicitly] public required Pagination Pagination { get; init; }
        [UsedImplicitly] public required List<GroupResults> Results { get; init; }

        public class GroupResults {
            [UsedImplicitly] public required string Id { get; init; }
            [UsedImplicitly] public required string Title { get; init; }
            [UsedImplicitly] public required string Description { get; init; }
            [UsedImplicitly] public required string CreatedBy { get; init; } // make date?
            [UsedImplicitly] public required string CreatedAt { get; init; } // make date?
            [UsedImplicitly] public required string UpdatedBy { get; init; }
            [UsedImplicitly] public required string UpdatedAt { get; init; } // make date?
        }
    }

    public class Collections {
        [UsedImplicitly] public required Pagination Pagination { get; init; }

        [UsedImplicitly] public required List<CollectionResults> Results { get; init; }

        public class CollectionResults {
            [UsedImplicitly] public required string Id { get; init; }
            [UsedImplicitly] public required string Title { get; init; }
            [UsedImplicitly] public required string Description { get; init; }
            [UsedImplicitly] public required FieldId Group { get; init; }
            [UsedImplicitly] public required FieldId Account { get; init; }
            [UsedImplicitly] public bool IsArchived { get; init; }
            [UsedImplicitly] public required string CreatedBy { get; init; }
            [UsedImplicitly] public required string CreatedAt { get; init; }
            [UsedImplicitly] public required string UpdatedBy { get; init; }
            [UsedImplicitly] public required string UpdatedAt { get; init; }

            public class FieldId {
                [UsedImplicitly] public required string Id { get; init; }
            }
        }
    }

    public class Parameters {
        [UsedImplicitly] public Pagination? Pagination { get; init; }
        [UsedImplicitly] public List<ParametersResult>? Results { get; set; }

        public class ParametersResult {
            private ParameterDownloadOpts? _downloadOptions;
            [UsedImplicitly] public string? Id { get; set; }
            [UsedImplicitly] public string? Name { get; init; }
            [UsedImplicitly] public string? Description { get; init; }
            [UsedImplicitly] public string? SpecId { get; init; }
            [UsedImplicitly] public string? ValueTypeId { get; init; }
            [UsedImplicitly] public bool ReadOnly { get; init; }

            [UsedImplicitly] public List<RawMetadataValue>? Metadata { get; init; }

            [UsedImplicitly] public string? CreatedBy { get; init; }
            [UsedImplicitly] public string? CreatedAt { get; init; }

            [JsonIgnore]
            public bool IsArchived =>
                this.Metadata?.Any(m => m.Id == "isArchived" && m.Value is bool v && v) == true;

            [JsonIgnore]
            public ParameterDownloadOpts DownloadOptions => this._downloadOptions ??= new ParameterDownloadOpts(this);

            public class RawMetadataValue {
                [UsedImplicitly] public required string Id { get; init; }
                [UsedImplicitly] public required object Value { get; init; }
            }

            public class ParameterDownloadOpts {
                private readonly List<MetadataBinding>? _categories;
                private readonly string? _groupId;
                private readonly string? _guidText;
                private readonly ParametersResult _parent;
                public readonly bool IsInstance;
                public readonly bool Visible;
                private DefinitionGroup? _cachedDefinitionGroup;

                // Lazy-cached values
                private ExternalDefinition? _externalDefinition;
                private ForgeTypeId? _groupTypeId;
                private Guid? _guid;
                private ForgeTypeId? _parameterTypeId;
                private ForgeTypeId? _specTypeId;

                public ParameterDownloadOpts(ParametersResult parent) {
                    this._parent = parent;

                    // Parse metadata once and cache all values
                    if (parent.Metadata != null) {
                        foreach (var item in parent.Metadata) {
                            _ = item.Id switch {
                                "isHidden" => this.Visible = !(item.Value is bool v && v),
                                "instanceTypeAssociation" => this.IsInstance =
                                    item.Value is not string s || s.Equals("INSTANCE", StringComparison.OrdinalIgnoreCase),
                                "categories" => this._categories = item.Value as List<MetadataBinding>,
                                "group" => this._groupId = (item.Value as MetadataBinding)?.Id,
                                _ => default(object)
                            };
                        }
                    }

                    // Pre-extract GUID text from Parameters Service ID
                    var typeIdParts = parent.Id?.Split(':');
                    if (typeIdParts?.Length >= 2) {
                        var parameterPart = typeIdParts[1];
                        var dashIndex = parameterPart.IndexOf('-');
                        this._guidText = dashIndex > 0 ? parameterPart[..dashIndex] : parameterPart;
                    }
                }

                public ForgeTypeId GetParameterTypeId() => this._parameterTypeId ??= new ForgeTypeId(this._parent.Id ?? "");
                public ForgeTypeId GetGroupTypeId() => this._groupTypeId ??= new ForgeTypeId(this._groupId ?? "");
                public ForgeTypeId GetSpecTypeId() => this._specTypeId ??= new ForgeTypeId(this._parent.SpecId ?? "");

                public Guid GetGuid() {
                    if (this._guid.HasValue) return this._guid.Value;

                    if (string.IsNullOrEmpty(this._guidText) || !Guid.TryParse(this._guidText, out var guid)) {
                        throw new ArgumentException(
                            $"Could not extract GUID from parameter ID: {this._parent.Id}");
                    }

                    this._guid = guid;
                    return guid;
                }

                public ExternalDefinition? GetExternalDefinition(DefinitionGroup group) {
                    // Return cached definition only if it's from the same group
                    if (this._externalDefinition != null && this._cachedDefinitionGroup == group)
                        return this._externalDefinition;

                    try {
                        this._externalDefinition = group.Definitions.Create(
                            new ExternalDefinitionCreationOptions(this._parent.Name ?? "", this.GetSpecTypeId()) {
                                GUID = this.GetGuid(),
                                Visible = this.Visible,
                                UserModifiable = !this._parent.ReadOnly,
                                Description = this._parent.Description ?? ""
                            }) as ExternalDefinition;
                    } catch (Exception ex) {
                        this._externalDefinition = group.Definitions.get_Item(this._parent.Name ?? "") as ExternalDefinition
                                                   ?? throw new Exception(
                                                       $"Failed to create external definition for parameter {this._parent.Name}: {ex.Message}");
                    }

                    this._cachedDefinitionGroup = group;
                    return this._externalDefinition;
                }

                public ISet<ElementId>? CategorySet(Autodesk.Revit.DB.Document doc) => // check this logic in testing
                    this._categories?.Any() == true
                        ? MapCategoriesToElementIds(doc, this._categories)
                        : null;

                /// <summary>
                ///     Maps APS category bindings to Revit category ElementIds.
                ///     Extracts category names from APS category IDs and converts them to Revit categories.
                /// </summary>
                private static ISet<ElementId> MapCategoriesToElementIds(
                    Autodesk.Revit.DB.Document doc,
                    List<MetadataBinding> categories
                ) {
                    var categorySet = new HashSet<ElementId>();

                    foreach (var binding in categories) {
                        var categoryName = ExtractCategoryNameFromApsId(binding.Id);
                        if (string.IsNullOrEmpty(categoryName)) continue;

                        var elementId = GetRevitCategoryElementId(doc, categoryName);
                        if (elementId != null) _ = categorySet.Add(elementId);
                    }

                    return categorySet;
                }

                /// <summary>
                ///     Extracts category name from APS category ID.
                ///     Example: "autodesk.revit.category.family:ductTerminal-1.0.0" -> "ductTerminal"
                /// </summary>
                private static string? ExtractCategoryNameFromApsId(string categoryId) {
                    if (string.IsNullOrEmpty(categoryId)) return null;

                    // Extract the part between the last ':' and '-'
                    var colonIndex = categoryId.LastIndexOf(':');
                    var hyphenIndex = categoryId.LastIndexOf('-');

                    return colonIndex >= 0 && hyphenIndex > colonIndex
                        ? categoryId.Substring(colonIndex + 1, hyphenIndex - colonIndex - 1)
                        : null;
                }

                /// <summary>
                ///     Converts APS category name to Revit category ElementId.
                ///     Maps common APS category names to Revit BuiltInCategory values.
                ///     TODO: fix this, it does not do anything
                /// </summary>
                private static ElementId?
                    GetRevitCategoryElementId(Autodesk.Revit.DB.Document doc, string categoryName) {
                    try {
                        // If not found in mapping, try to find by name in all categories
                        foreach (BuiltInCategory bic in Enum.GetValues(typeof(BuiltInCategory))) {
                            try {
                                var category = Category.GetCategory(doc, bic);
                                if (category?.Name?.Contains(categoryName, StringComparison.OrdinalIgnoreCase) == true)
                                    return category.Id;
                            } catch {
                                // Some BuiltInCategory values may not be valid for this document
                            }
                        }

                        return null;
                    } catch (Exception ex) {
                        throw new Exception($"Failed to map category '{categoryName}' to Revit category: {ex.Message}");
                    }
                }

                public class MetadataBinding {
                    [UsedImplicitly] public required string BindingId { get; init; }
                    [UsedImplicitly] public required string Id { get; init; }
                }
            }
        }
    }
}