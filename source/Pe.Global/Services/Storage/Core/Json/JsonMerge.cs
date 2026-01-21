using Newtonsoft.Json.Linq;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Utility for deep merging JSON objects. Used by ComposableJson to merge base and child profiles.
/// </summary>
/// <remarks>
///     Merge rules:
///     <list type="bullet">
///         <item>Objects: recursively merge (child properties override base)</item>
///         <item>Arrays: concatenate (base elements first, then child elements)</item>
///         <item>Primitives: child overrides base</item>
///         <item>Explicit null in child: removes property from result</item>
///     </list>
/// </remarks>
public static class JsonMerge {
    /// <summary>
    ///     Deep merges a child JObject onto a base JObject.
    ///     The base object is NOT modified; a new merged JObject is returned.
    /// </summary>
    /// <param name="baseObj">The base object to merge onto (not modified)</param>
    /// <param name="childObj">The child object with overrides</param>
    /// <returns>A new JObject with merged properties</returns>
    public static JObject DeepMerge(JObject baseObj, JObject childObj) {
        // Clone base so we don't modify the original
        var result = (JObject)baseObj.DeepClone();
        MergeInto(result, childObj);
        return result;
    }

    /// <summary>
    ///     Merges child properties into target (modifies target in place).
    /// </summary>
    private static void MergeInto(JObject target, JObject child) {
        foreach (var prop in child.Properties()) {
            var propName = prop.Name;
            var childValue = prop.Value;

            // Explicit null in child = remove from result
            if (childValue.Type == JTokenType.Null) {
                _ = target.Remove(propName);
                continue;
            }

            // If property doesn't exist in target, just add it
            if (!target.TryGetValue(propName, out var targetValue)) {
                target[propName] = childValue.DeepClone();
                continue;
            }

            // Both are objects? Recursive merge
            if (targetValue is JObject targetObj && childValue is JObject childValueObj) {
                MergeInto(targetObj, childValueObj);
                continue;
            }

            // Both are arrays? Concatenate (base first, then child)
            if (targetValue is JArray targetArray && childValue is JArray childArray) {
                var mergedArray = new JArray();
                // Add all base elements
                foreach (var item in targetArray) mergedArray.Add(item.DeepClone());
                // Add all child elements
                foreach (var item in childArray) mergedArray.Add(item.DeepClone());
                target[propName] = mergedArray;
                continue;
            }

            // Primitives or mismatched types: child replaces entirely
            target[propName] = childValue.DeepClone();
        }
    }
}