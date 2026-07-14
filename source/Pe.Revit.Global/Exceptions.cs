namespace Pe.Revit.Global;

/// <summary>
///     Exception thrown when an element has intersections with other elements
///     that prevent an operation from completing successfully.
/// </summary>
public class ElementIntersectException : Exception {
    /// <summary>
    ///     Creates a new instance of IntersectingElementsException
    /// </summary>
    /// <param name="reference">The ID of the reference element</param>
    /// <param name="intersections">The IDs of intersecting elements</param>
    public ElementIntersectException(ElementId? reference, ElementId[] intersections)
        : base(FormatDefaultMessage(reference, intersections)) {
        this.ReferenceElement = reference;
        this.IntersectionElements = intersections;
    }

    public ElementId? ReferenceElement { get; }
    public ElementId[] IntersectionElements { get; }

    private static string FormatDefaultMessage(ElementId? reference, ElementId[] intersections) {
        if (reference == null)
            return $"{intersections.Length} elements intersect";
        return $"Element {reference} has {intersections.Length} intersection{(intersections.Length != 1 ? "s" : "")}";
    }
}

