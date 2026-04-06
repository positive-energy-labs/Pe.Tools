namespace Pe.Extensions.FamDocument;

/// <summary>
///     A type-safe wrapper around a Revit Document that is guaranteed to be a valid family document.
///     All validation checks are performed at construction time, ensuring type safety throughout the codebase.
/// </summary>
public readonly struct FamilyDocument {
    /// <summary>
    ///     Creates a new FamilyDocument wrapper, validating that the document is a family document
    ///     with a valid FamilyManager.
    /// </summary>
    /// <param name="document">The Revit document to wrap</param>
    public FamilyDocument(Document document) {
        if (document is null) throw new ArgumentNullException("Document is null.", nameof(document));
        if (!document.IsFamilyDocument)
            throw new ArgumentException(@"Document is not a family document.", nameof(document));
        if (document.FamilyManager is null)
            throw new InvalidOperationException("Family document's FamilyManager is null.");

        this.Document = document;
    }

    /// <summary>
    ///     Gets the underlying Revit Document.
    /// </summary>
    public Document Document { get; }

    /// <summary>
    ///     Implicit conversion to Document for seamless integration with existing Revit API methods.
    /// </summary>
    public static implicit operator Document(FamilyDocument familyDocument) => familyDocument.Document;

    // Forward common Document properties for seamless usage
    public FamilyManager FamilyManager => this.Document.FamilyManager;
    public Family OwnerFamily => this.Document.OwnerFamily;
    public string PathName => this.Document.PathName;

    // Forward common Document methods
    public void SaveAs(string filePath, SaveAsOptions options) => this.Document.SaveAs(filePath, options);
    public bool Close(bool save) => this.Document.Close(save);
    public Family LoadFamily(Document doc, IFamilyLoadOptions options) => this.Document.LoadFamily(doc, options);
    public Units GetUnits() => this.Document.GetUnits();
}