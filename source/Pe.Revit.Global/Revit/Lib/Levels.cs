namespace Pe.Global.Revit.Lib;

public class Levels {
    /// <summary>
    ///     Retrieves the associated Level of the active View in Revit.
    /// </summary>
    /// <param name="view">The View object for which to find the associated Level.</param>
    /// <returns>The Level object associated with the view, or null if no level is associated or found.</returns>
    public static Level? LevelOfActiveView(View view) {
        var doc = view.Document;
        var levelId = view.GenLevel.Id;

        if (levelId != ElementId.InvalidElementId && levelId != null)
            return doc.GetElement(levelId) as Level;
        return null;
    }
}