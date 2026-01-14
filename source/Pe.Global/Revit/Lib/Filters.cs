using Autodesk.Revit.DB.Mechanical;
using Pe.Global.Revit.Mep.Mechanical;

namespace Pe.Global.Revit.Lib;

public class Filters {
    /// <summary>
    ///     Retrieves the first element of a specified type from the Revit document.
    ///     This method generalizes the pattern of collecting elements by class and casting them.
    /// </summary>
    /// <typeparam name="T">The type of Element to retrieve. Must inherit from Autodesk.Revit.DB.Element.</typeparam>
    /// <returns>The first element of the specified type that matches the predicate, or null if none is found.</returns>
    public static T FirstElementOfType<T>(
        Document doc,
        Func<T, bool> filter = null)
        where T : Element {
        var elements = new FilteredElementCollector(doc).OfClass(typeof(T)).OfType<T>();

        if (filter != null)
            return elements.Where(filter).FirstOrDefault();
        return elements.FirstOrDefault();
    }

    /// <summary>
    ///     Retrieves a FamilySymbol by its Family Name and Family Symbol Name (Type Name).
    ///     Performs case-insensitive comparison.
    /// </summary>
    /// <param name="doc">The active Revit Document.</param>
    /// <param name="familyName">The name of the Family.</param>
    /// <param name="familySymbolName">The name of the Family Symbol (Type).</param>
    /// <returns>The matching FamilySymbol, or null if not found.</returns>
    public static FamilySymbol FamilySymbolByName(
        Document doc,
        string familyName,
        string familySymbolName
    ) =>
        FirstElementOfType<FamilySymbol>(
            doc,
            fs => fs.FamilyName.Equals(familyName, StringComparison.OrdinalIgnoreCase)
                  && fs.Name.Equals(familySymbolName, StringComparison.OrdinalIgnoreCase)
        );

    // --- Specialized Methods using the Generic Helpers ---

    /// <summary>
    ///     Retrieves an MEPSystemType by its Name.
    ///     Performs case-insensitive comparison.
    /// </summary>
    /// <returns>The matching MEPSystemType, or null if not found.</returns>
    public static MEPSystemType MepSystemTypeByName(
        Document doc,
        string name
    ) =>
        FirstElementOfType<MEPSystemType>(
            doc,
            mst => mst.Name.Equals(name, StringComparison.OrdinalIgnoreCase)
        );

    /// <summary>
    ///     Retrieves a DuctType by matching its shape, junction type, and elbow type.
    ///     Performs case-insensitive comparison for elbow type names, for type none, no filter is applied.
    /// </summary>
    /// <param name="doc">The current Revit document</param>
    /// <param name="ductShape">The desired duct connector profile type</param>
    /// <param name="junctionType">The preferred junction type for the duct</param>
    /// <param name="elbowType">The type of elbow (Mitered, Radius, or Gored)</param>
    /// <returns>The matching DuctType, or null if not found.</returns>
    /// <example>
    ///     PE template DuctType examples (shape is in the parent family's name): <br></br> - Taps <br></br> - Tees <br></br> -
    ///     Taps / Short Radius <br></br> - Radius Elbows /
    ///     Taps <br></br> - Mitered Elbows w Vanes / Tees <br></br>
    /// </example>
    public static DuctType DuctType(
        Document doc,
        ConnectorProfileType ductShape,
        JunctionType junctionType,
        ElbowType elbowType = ElbowType.None
    ) {
        Func<string, bool> elbowFilter = elbowType switch {
            ElbowType.Mitered => elbowName => elbowName.IndexOf("Mitered", StringComparison.OrdinalIgnoreCase) >= 0,
            ElbowType.Radius => elbowName => elbowName.IndexOf("Radius", StringComparison.OrdinalIgnoreCase) >= 0,
            ElbowType.Gored => elbowName => elbowName.IndexOf("Gored", StringComparison.OrdinalIgnoreCase) >= 0,
            _ => elbowName => true
        };

        return FirstElementOfType<DuctType>(
            doc,
            dt => dt.Shape == ductShape
                  && dt.PreferredJunctionType == junctionType
                  && elbowFilter(dt.Elbow.FamilyName)
        );
    }
    //public static PipingSystemType GetByNamePipingSystemType(Document doc, string name)
    //{
    //    return PipingSystemType.Hydronic
    //}
}