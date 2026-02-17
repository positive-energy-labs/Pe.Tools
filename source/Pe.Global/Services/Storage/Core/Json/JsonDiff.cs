using Newtonsoft.Json.Linq;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Utility for creating sparse JSON patches by diffing an edited object against a base.
///     Used for saving UI edits back to child profile files.
/// </summary>
/// <remarks>
///     Diff rules (inverse of merge):
///     <list type="bullet">
///         <item>If property value equals base: omit from patch (inherited)</item>
///         <item>If property value differs from base: include in patch (override)</item>
///         <item>If property exists in edited but not base: include in patch (new)</item>
///         <item>If property exists in base but not edited: include explicit null (deletion)</item>
///         <item>Objects: recursively diff, only include non-empty child diffs</item>
///         <item>Arrays: compared by value equality (not element-wise)</item>
///     </list>
/// </remarks>
public static class JsonDiff {
    /// <summary>
    ///     Creates a sparse patch containing only the differences between edited and base.
    /// </summary>
    /// <param name="baseObj">The base object to diff against</param>
    /// <param name="editedObj">The edited object</param>
    /// <returns>A sparse JObject with only overridden/added/deleted properties</returns>
    public static JObject CreatePatch(JObject baseObj, JObject editedObj) {
        var patch = new JObject();
        CreatePatchRecursive(baseObj, editedObj, patch);
        return patch;
    }

    private static void CreatePatchRecursive(JObject baseObj, JObject editedObj, JObject patch) {
        var allPropertyNames = baseObj.Properties()
            .Select(p => p.Name)
            .Union(editedObj.Properties().Select(p => p.Name))
            .Distinct();

        foreach (var propName in allPropertyNames) {
            var hasBase = baseObj.TryGetValue(propName, out var baseValue);
            var hasEdited = editedObj.TryGetValue(propName, out var editedValue);

            // Property removed in edited - include explicit null
            if (hasBase && !hasEdited) {
                patch[propName] = JValue.CreateNull();
                continue;
            }

            // Property added in edited - include it
            if (!hasBase && hasEdited) {
                patch[propName] = editedValue!.DeepClone();
                continue;
            }

            // Both exist - compare values
            if (hasBase && hasEdited) {
                // Both are objects? Recursive diff
                if (baseValue is JObject baseChildObj && editedValue is JObject editedChildObj) {
                    var childPatch = new JObject();
                    CreatePatchRecursive(baseChildObj, editedChildObj, childPatch);

                    // Only include if there are actual differences
                    if (childPatch.HasValues) patch[propName] = childPatch;
                    continue;
                }

                // Arrays or primitives - compare by deep equality
                if (!JToken.DeepEquals(baseValue, editedValue)) patch[propName] = editedValue!.DeepClone();
            }
        }
    }
}