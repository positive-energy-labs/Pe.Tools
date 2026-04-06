namespace Pe.Global.PolyFill;

/// <summary>
///     Polyfill extension methods to provide consistent API across Revit versions.
///     These methods abstract version-specific differences in the Revit API.
/// </summary>
public static class CategoryExtensions {
    /// <summary>
    ///     Gets the BuiltInCategory value of a Category, providing a polyfill for Category.BuiltInCategory
    ///     which is available in Revit 2025+ but requires casting from Id.Value in earlier versions.
    /// </summary>
    /// <param name="category">The Category to get the BuiltInCategory from</param>
    /// <returns>The BuiltInCategory value of the Category</returns>
    public static BuiltInCategory ToBuiltInCategory(this Category? category) {
        if (category == null) return BuiltInCategory.INVALID;

#if REVIT2025 || REVIT2026
        return category.BuiltInCategory;
#else
        var rawValue = category.Id.Value();
        var builtInCategory = (BuiltInCategory)rawValue;
        return Enum.IsDefined(typeof(BuiltInCategory), builtInCategory)
            ? builtInCategory
            : BuiltInCategory.INVALID;
#endif
    }
}