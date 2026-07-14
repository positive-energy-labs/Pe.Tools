namespace Pe.Revit.Global.Lib.Mep;

public class MepCurve {
    /// <summary>
    ///     Get the level of an MEPCurve. First attempt is curve.ReverenceLevel, second is curve's level param.
    /// </summary>
    public static Result<Level> GetReferenceLevel(MEPCurve mepCurve) {
        try {
            var levelId = mepCurve.ReferenceLevel?.Id;
            if (levelId != null && levelId != ElementId.InvalidElementId) {
                var level = mepCurve.Document.GetElement(levelId) as Level;
                if (level != null)
                    return level;
            }

            return new InvalidOperationException($"No level could be found for the MEPCurve {mepCurve.Id}");
        } catch (Exception e) {
            return e;
        }
    }

    /// <summary>
    ///     Get the system type from the main duct to ensure proper inheritance
    /// </summary>
    public static Result<MEPSystemType> GetSystemType(MEPCurve mainDuct) {
        try {
            if (mainDuct.MEPSystem == null) {
                return new InvalidOperationException(
                    $"Duct {mainDuct.Id} is not connected/assigned to any MEP system. " +
                    "System type inheritance requires proper system connectivity."
                );
            }

            var systemTypeId = mainDuct.MEPSystem.GetTypeId();
            if (systemTypeId == ElementId.InvalidElementId) {
                return new InvalidOperationException(
                    $"Duct {mainDuct.Id} has an invalid system type ID. " +
                    "This indicates a corrupted system connection."
                );
            }

            var systemType = mainDuct.Document.GetElement(systemTypeId) as MEPSystemType;
            if (systemType == null) {
                return new InvalidOperationException(
                    $"Could not retrieve system type {systemTypeId} for duct {mainDuct.Id}. " +
                    "The referenced system type may have been deleted."
                );
            }

            return systemType;
        } catch (Exception ex) {
            return new InvalidOperationException($"Error retrieving system type for duct {mainDuct.Id}: {ex.Message}");
        }
    }
}