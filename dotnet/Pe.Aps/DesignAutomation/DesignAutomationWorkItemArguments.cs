using Pe.Aps.Core;

namespace Pe.Aps.DesignAutomation;

public static class DesignAutomationWorkItemArguments {
    public static string BuildJsonDataUrl(string json) => $"data:application/json,{Uri.EscapeDataString(json)}";

    public static Dictionary<string, object> BuildObjectPutArgument(
        string bucketKey,
        string objectKey,
        string accessToken
    ) =>
        BuildObjectArgument("put", bucketKey, objectKey, accessToken);

    public static Dictionary<string, object> BuildObjectGetArgument(
        string bucketKey,
        string objectKey,
        string accessToken
    ) =>
        BuildObjectArgument("get", bucketKey, objectKey, accessToken);

    private static Dictionary<string, object> BuildObjectArgument(
        string verb,
        string bucketKey,
        string objectKey,
        string accessToken
    ) =>
        new(StringComparer.Ordinal) {
            ["verb"] = verb,
            ["url"] = ObjectStorageApiClient.BuildObjectUrn(bucketKey, objectKey),
            ["headers"] = new Dictionary<string, string>(StringComparer.Ordinal) {
                ["Authorization"] = $"Bearer {accessToken}"
            }
        };
}
