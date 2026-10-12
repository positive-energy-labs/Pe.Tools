using Newtonsoft.Json;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Revit.Global.Services.Aps;

public class Parameters(HttpClient httpClient, IParametersTokenProvider tokenProvider) {
    private const string Suffix = "parameters/v1/accounts/";

    private static async Task<T?> DeserializeToType<T>(HttpResponseMessage res) {
        var asString = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
        return JsonConvert.DeserializeObject<T>(asString);
    }

    private static string Clean(string v) => v.Replace("b.", "").Replace("-", "");

    public async Task<ParametersApi.Groups> GetGroups() {
        var hubId = tokenProvider.GetAccountId();

        var allResults = new List<ParametersApi.Groups.GroupResults>();
        var offset = 0;
        const int limit = 50;

        while (true) {
            var response = await httpClient.GetAsync(
                Suffix + Clean(hubId) + $"/groups?offset={offset}&limit={limit}"
            ).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode) {
                throw new HttpRequestException(
                    $"Failed to fetch groups at offset {offset}. Status: {response.StatusCode}.");
            }

            var page = await DeserializeToType<ParametersApi.Groups>(response).ConfigureAwait(false);
            if (page?.Results == null || page.Results.Count == 0) break;

            allResults.AddRange(page.Results);

            // Check if we've retrieved all results
            if (page.Pagination == null || allResults.Count >= page.Pagination.TotalResults) break;

            offset += limit;
        }

        return new ParametersApi.Groups {
            Results = allResults,
            Pagination =
                new ParametersApi.Pagination { Offset = 0, Limit = allResults.Count, TotalResults = allResults.Count }
        };
    }

    public async Task<ParametersApi.Collections> GetCollections() {
        var (hubId, grpId) = (tokenProvider.GetAccountId(), tokenProvider.GetGroupId());

        var allResults = new List<ParametersApi.Collections.CollectionResults>();
        var offset = 0;
        const int limit = 50;

        while (true) {
            var response = await httpClient.GetAsync(
                Suffix + Clean(hubId) + "/groups/" + Clean(grpId)
                + $"/collections?offset={offset}&limit={limit}"
            ).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode) {
                throw new HttpRequestException(
                    $"Failed to fetch collections at offset {offset}. Status: {response.StatusCode}.");
            }

            var page = await DeserializeToType<ParametersApi.Collections>(response).ConfigureAwait(false);
            if (page?.Results == null || page.Results.Count == 0) break;

            allResults.AddRange(page.Results);

            // Check if we've retrieved all results
            if (page.Pagination == null || allResults.Count >= page.Pagination.TotalResults) break;

            offset += limit;
        }

        return new ParametersApi.Collections {
            Results = allResults,
            Pagination =
                new ParametersApi.Pagination { Offset = 0, Limit = allResults.Count, TotalResults = allResults.Count }
        };
    }

    public async Task<ParametersApi.Parameters> GetParameters(
        JsonReadWriter<ParametersApi.Parameters> cache,
        bool useCache = true,
        int invalidateCacheAfterMinutes = 100
    ) {
        if (cache is not null && useCache) {
            var isCacheValid = cache.IsCacheValid(
                invalidateCacheAfterMinutes,
                data => data?.Results?.Count > 0
            );
            if (isCacheValid) return cache.Read();
        }

        var (hubId, grpId, colId) = (tokenProvider.GetAccountId(), tokenProvider.GetGroupId(),
            tokenProvider.GetCollectionId());

        var allResults = new List<ParametersApi.Parameters.ParametersResult>();
        var offset = 0;
        const int limit = 50;

        while (true) {
            var response = await httpClient.GetAsync(
                Suffix + Clean(hubId) + "/groups/" + Clean(grpId) + "/collections/" + Clean(colId)
                + $"/parameters?offset={offset}&limit={limit}"
            ).ConfigureAwait(false);

            if (!response.IsSuccessStatusCode) {
                throw new HttpRequestException(
                    $"Failed to fetch parameters at offset {offset}. Status: {response.StatusCode}.");
            }

            var page = await DeserializeToType<ParametersApi.Parameters>(response).ConfigureAwait(false);
            if (page?.Results == null || page.Results.Count == 0) break;

            allResults.AddRange(page.Results);

            // Check if we've retrieved all results
            if (page.Pagination == null || allResults.Count >= page.Pagination.TotalResults) break;

            offset += limit;
        }

        var deserializedResponse = new ParametersApi.Parameters {
            Results = allResults.OrderBy(p => p.Name).ToList(),
            Pagination =
                new ParametersApi.Pagination { Offset = 0, Limit = allResults.Count, TotalResults = allResults.Count }
        };

        // Write to cache if it implements JsonWriter
        if (cache is JsonWriter<ParametersApi.Parameters> cacheWriter) _ = cacheWriter.Write(deserializedResponse);
        return deserializedResponse;
    }
}
