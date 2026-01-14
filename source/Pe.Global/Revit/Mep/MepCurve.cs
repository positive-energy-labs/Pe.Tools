namespace Pe.Global.Revit.Mep;

public class MepCurve {
    /// <summary>
    ///     Get the level of an MEPCurve. First attempt is curve.ReverenceLevel, second is curve's level param.
    /// </summary>
    public static Result<Level> GetReferenceLevel(MEPCurve mepCurve) {
        try {
            var levelId = mepCurve.ReferenceLevel?.Id;
            if (levelId != null && levelId != ElementId.InvalidElementId)
                return mepCurve.Document.GetElement(levelId) as Level;

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


    /// <summary>
    ///     Copy system properties from main duct to branch duct for proper inheritance
    /// </summary>
    public static Result<(bool nameSuccess, bool abbrevSuccess, bool classifSuccess)> CopySystemProperties(
        MEPCurve sourceCurve,
        MEPCurve targetCurve) {
        try {
            var nameSuccess = false;
            var abbrevSuccess = false;
            var classifSuccess = false;

            var sourceSysName = sourceCurve.FindParameter(BuiltInParameter.RBS_SYSTEM_NAME_PARAM);
            var targetSysName = targetCurve.FindParameter(BuiltInParameter.RBS_SYSTEM_NAME_PARAM);
            if (sourceSysName != null && targetSysName is { IsReadOnly: false }) {
                // targetSysName.Set(sourceSysName.AsString());
                nameSuccess = true;
            }

            var sourceSysAbbrev = sourceCurve.FindParameter(BuiltInParameter.RBS_SYSTEM_ABBREVIATION_PARAM);
            var targetSysAbbrev = targetCurve.FindParameter(BuiltInParameter.RBS_SYSTEM_ABBREVIATION_PARAM);
            if (sourceSysAbbrev != null && targetSysAbbrev is { IsReadOnly: false }) {
                // targetSysAbbrev.Set(sourceSysAbbrev.AsString());
                abbrevSuccess = true;
            }

            var sourceSysClassif = sourceCurve.FindParameter(BuiltInParameter.RBS_SYSTEM_CLASSIFICATION_PARAM);
            var targetSysClassif = targetCurve.FindParameter(BuiltInParameter.RBS_SYSTEM_CLASSIFICATION_PARAM);
            if (sourceSysClassif != null && targetSysClassif is { IsReadOnly: false }) {
                // targetSysClassif.Set(sourceSysClassif.AsString());
                classifSuccess = true;
            }

            return (nameSuccess, abbrevSuccess, classifSuccess);
        } catch (Exception e) {
            return new InvalidOperationException($"Error copying system properties: {e.Message}");
        }
    }
}