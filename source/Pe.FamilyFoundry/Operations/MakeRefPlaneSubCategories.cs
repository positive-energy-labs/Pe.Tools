using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Snapshots;

namespace Pe.FamilyFoundry.Operations;

// var specs = new List<RefPlaneSubcategorySpec> {
//     new RefPlaneSubcategorySpec {
//         Strength = RpStrength.NotARef,
//         SubcategoryName = "NotAReference",
//         Color = new Color(211, 211, 211),
//     },
//     new RefPlaneSubcategorySpec {
//         Strength = RpStrength.WeakRef,
//         SubcategoryName = "WeakReference",
//         Color = new Color(217, 124, 0),
//     },
//     new RefPlaneSubcategorySpec {
//         Strength = RpStrength.StrongRef,
//         SubcategoryName = "StrongReference",
//         Color = new Color(255, 0, 0),
//     },
//     new RefPlaneSubcategorySpec {
//         Strength = RpStrength.CenterLR,
//         SubcategoryName = "Center",
//         Color = new Color(115, 0, 253),
//     },
//     new RefPlaneSubcategorySpec {
//         Strength = RpStrength.CenterFB,
//         SubcategoryName = "Center",
//         Color = new Color(115, 0, 253),
//     }
// };
public record RefPlaneSubcategorySpec {
    public RpStrength Strength { get; init; }
    public string Name { get; init; }
    public Color Color { get; init; }
    public string LinePatternName { get; init; } = "Dash"; // null = use solid line

    public ElementId GetLinePatternId(Document doc) {
        if (string.IsNullOrEmpty(this.LinePatternName))
            return null;

        if (this.LinePatternName.Equals("Solid", StringComparison.OrdinalIgnoreCase))
            return null;

        var linePattern = new FilteredElementCollector(doc)
                              .OfClass(typeof(LinePatternElement))
                              .Cast<LinePatternElement>()
                              .FirstOrDefault(lp => lp.Name == this.LinePatternName)
                          ?? throw new InvalidOperationException(
                              $"Line pattern '{this.LinePatternName}' not found in document");

        return linePattern.Id;
    }
}

public class MakeRefPlaneSubcategories(List<RefPlaneSubcategorySpec> specs)
    : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    private readonly List<RefPlaneSubcategorySpec> _specs = specs;
    public override string Description => "Make reference planes subcategories with custom colors and line patterns";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();

        try {
            var category = Category.GetCategory(doc.Document, BuiltInCategory.OST_CLines);
            var subcategoryCache = new SubcategoryCache(doc.Document, BuiltInCategory.OST_CLines);

            foreach (var spec in this._specs) {
                var refPlanes = new FilteredElementCollector(doc.Document)
                    .OfClass(typeof(ReferencePlane))
                    .Cast<ReferencePlane>()
                    .Where(rp =>
                        rp.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME).AsInteger() == (int)spec.Strength)
                    .ToList();

                if (!refPlanes.Any()) {
                    logs.Add(new LogEntry($"No '{spec.Strength}' RPs found").Skip());
                    continue;
                }

                // Get or create subcategory once per unique subcategory name
                var matchingSubcat = subcategoryCache.GetMatching(spec);
                Category subcategory;

                if (matchingSubcat != null)
                    subcategory = matchingSubcat; // silently continue
                else {
                    var existing = subcategoryCache.GetExisting(spec.Name);
                    if (existing != null) {
                        subcategory = this.ApplySubcategoryStyle(existing, spec, doc.Document);
                        logs.Add(new LogEntry($"Subcategory: '{spec.Name}'").Success("Updated"));
                    } else {
                        var newSubCat = doc.Document.Settings.Categories.NewSubcategory(category, spec.Name);
                        subcategory = this.ApplySubcategoryStyle(newSubCat, spec, doc.Document);
                        subcategoryCache.Set(spec.Name, subcategory);
                        logs.Add(new LogEntry($"Subcategory: '{spec.Name}'").Success("Created"));
                    }
                }

                // Apply the subcategory to all matching reference planes
                foreach (var refPlane in refPlanes) {
                    var subcategoryParam = refPlane.get_Parameter(BuiltInParameter.CLINE_SUBCATEGORY);
                    _ = subcategoryParam?.Set(subcategory.Id);

                    logs.Add(new LogEntry($"Applied '{subcategory.Name}' to '{refPlane.Name}'").Success());
                }
            }
        } catch (Exception ex) {
            logs.Add(new LogEntry(ex.GetType().Name).Error(ex));
        }

        return new OperationLog(nameof(MakeRefPlaneSubcategories), logs);
    }

    private Category ApplySubcategoryStyle(Category subcat, RefPlaneSubcategorySpec spec, Document doc) {
        subcat.LineColor = spec.Color;
        if (spec.LinePatternName != null) {
            var patternId = spec.GetLinePatternId(doc);
            subcat.SetLinePatternId(patternId, GraphicsStyleType.Projection);
        }

        return subcat;
    }
}

public class SubcategoryCache {
    private readonly Dictionary<string, Category> _cache = new();
    private readonly Document _doc;
    private readonly Category _parentCategory;

    public SubcategoryCache(Document doc, BuiltInCategory parentCategory) {
        this._doc = doc;
        this._parentCategory = Category.GetCategory(doc, parentCategory);
    }

    public Category GetMatching(RefPlaneSubcategorySpec spec) {
        var existing = this.GetExisting(spec.Name);
        if (existing == null) return null;
        return this.MatchesSpec(existing, spec) ? existing : null;
    }

    public Category GetExisting(string name) {
        if (string.IsNullOrEmpty(name)) return null;

        if (this._cache.ContainsKey(name)) return this._cache[name];
        var subcategory = this._parentCategory.SubCategories
            .Cast<Category>()
            .FirstOrDefault(sc => sc.Name == name);
        if (subcategory == null) return null;
        this._cache[name] = subcategory;
        return subcategory;
    }

    private bool MatchesSpec(Category subcat, RefPlaneSubcategorySpec spec) {
        static bool ColorsMatch(Color c1, Color c2) {
            return c1.Red == c2.Red && c1.Green == c2.Green && c1.Blue == c2.Blue;
        }

        if (!ColorsMatch(subcat.LineColor, spec.Color))
            return false;

        if (spec.LinePatternName != null) {
            var specPatternId = spec.GetLinePatternId(this._doc);
            var currentPattern = subcat.GetLinePatternId(GraphicsStyleType.Projection);
            if (currentPattern != specPatternId)
                return false;
        }

        return true;
    }

    public void Set(string name, Category subcategory) {
        if (!string.IsNullOrEmpty(name) && subcategory != null) this._cache[name] = subcategory;
    }
}