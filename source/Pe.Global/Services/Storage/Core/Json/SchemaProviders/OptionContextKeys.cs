namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Standard keys used in ExamplesRequest.SiblingValues for contextual option filtering.
/// </summary>
public static class OptionContextKeys {
    /// <summary>
    ///     Comma/semicolon/pipe-delimited family names selected by the UI.
    /// </summary>
    public const string SelectedFamilyNames = "SelectedFamilyNames";

    /// <summary>
    ///     Optional category name selected by the UI.
    /// </summary>
    public const string SelectedCategoryName = "SelectedCategoryName";

    /// <summary>
    ///     Category name selected for dependent provider filtering.
    /// </summary>
    public const string CategoryName = "CategoryName";

    /// <summary>
    ///     Tag family name selected for dependent provider filtering.
    /// </summary>
    public const string TagFamilyName = "TagFamilyName";
}
