using Newtonsoft.Json.Linq;

namespace Pe.Shared.StorageRuntime.Json;

public static class JsonDiff {
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

            if (hasBase && !hasEdited) {
                patch[propName] = JValue.CreateNull();
                continue;
            }

            if (!hasBase && hasEdited) {
                patch[propName] = editedValue!.DeepClone();
                continue;
            }

            if (hasBase && hasEdited) {
                if (baseValue is JObject baseChildObj && editedValue is JObject editedChildObj) {
                    var childPatch = new JObject();
                    CreatePatchRecursive(baseChildObj, editedChildObj, childPatch);

                    if (childPatch.HasValues)
                        patch[propName] = childPatch;
                    continue;
                }

                if (!JToken.DeepEquals(baseValue, editedValue))
                    patch[propName] = editedValue!.DeepClone();
            }
        }
    }
}