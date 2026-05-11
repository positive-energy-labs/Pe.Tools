using Pe.Shared.ApsAuth;
using Pe.Aps.Auth;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts;
using Pe.Shared.Product;
using System.Net;
using System.Net.Http;
using System.Text;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ApsAuthBoundaryTests {
    [Test]
    public void Delegated_aps_scope_profiles_share_one_refreshable_scope_set() {
        var parameterServiceScopes = ApsTokenRequest.ForParameterService().ResolveScopes();
        var automationUserScopes = ApsTokenRequest.ForAutomationUserContext().ResolveScopes();
        var automationManagementScopes = ApsTokenRequest.ForAutomationManagement().ResolveScopes();
        var artifactStorageScopes = ApsTokenRequest.ForAutomationArtifactStorage().ResolveScopes();

        Assert.Multiple(() => {
            Assert.That(parameterServiceScopes, Is.EqualTo(automationUserScopes));
            Assert.That(parameterServiceScopes, Does.Contain("code:all"));
            Assert.That(parameterServiceScopes, Does.Contain("data:read"));
            Assert.That(parameterServiceScopes, Does.Contain("bucket:read"));
            Assert.That(automationManagementScopes, Is.EqualTo(new[] { "code:all" }));
            Assert.That(artifactStorageScopes, Is.EqualTo(new[] { "bucket:create", "bucket:read", "data:read", "data:write" }));
        });
    }

    [Test]
    public void Aps_host_contracts_are_local_and_use_expected_routes() {
        Assert.Multiple(() => {
            Assert.That(GetApsAuthStatusOperationContract.Definition.ExecutionMode, Is.EqualTo(HostExecutionMode.Local));
            Assert.That(GetApsAuthStatusOperationContract.Definition.Route, Is.EqualTo("/api/aps/auth/status"));
            Assert.That(LoginApsOperationContract.Definition.ExecutionMode, Is.EqualTo(HostExecutionMode.Local));
            Assert.That(LoginApsOperationContract.Definition.Route, Is.EqualTo("/api/aps/auth/login"));
            Assert.That(LogoutApsOperationContract.Definition.ExecutionMode, Is.EqualTo(HostExecutionMode.Local));
            Assert.That(LogoutApsOperationContract.Definition.Route, Is.EqualTo("/api/aps/auth/logout"));
            Assert.That(AcquireApsAccessTokenOperationContract.Definition.ExecutionMode, Is.EqualTo(HostExecutionMode.Local));
            Assert.That(AcquireApsAccessTokenOperationContract.Definition.Route, Is.EqualTo("/api/aps/auth/token"));
            Assert.That(GetApsAuthStatusOperationContract.Definition.Route, Does.StartWith(HttpRoutes.ApsBase));
        });
    }

    [Test]
    public void Persisted_aps_token_store_round_trips_and_deletes_entries_by_client_id() {
        var rootPath = Path.Combine(Path.GetTempPath(), $"pe-aps-auth-{Guid.NewGuid():N}");
        var tokenFilePath = Path.Combine(rootPath, "tokens.json");

        try {
            var store = new PersistedApsTokenStore(tokenFilePath);
            var clientAKey = "client-a|ThreeLeggedConfidential|account:read data:read";
            var clientBKey = "client-b|ThreeLeggedConfidential|account:read data:read";
            var expiresAt = new DateTime(2026, 4, 30, 12, 0, 0, DateTimeKind.Utc);

            store.Save(clientAKey, new PersistedTokenRecord {
                AccessToken = "access-token-a",
                RefreshToken = "refresh-token-a",
                ExpiresAtUtc = expiresAt
            });
            store.Save(clientBKey, new PersistedTokenRecord {
                AccessToken = "access-token-b",
                RefreshToken = "refresh-token-b",
                ExpiresAtUtc = expiresAt.AddHours(1)
            });

            var loaded = store.Load(clientAKey);
            var rawJson = File.ReadAllText(tokenFilePath);

            Assert.Multiple(() => {
                Assert.That(loaded, Is.Not.Null);
                Assert.That(loaded!.AccessToken, Is.EqualTo("access-token-a"));
                Assert.That(loaded.RefreshToken, Is.EqualTo("refresh-token-a"));
                Assert.That(loaded.ExpiresAtUtc, Is.EqualTo(expiresAt));
                Assert.That(rawJson, Does.Contain("protectedPayload"));
                Assert.That(rawJson, Does.Not.Contain("access-token-a"));
                Assert.That(rawJson, Does.Not.Contain("refresh-token-a"));
            });

            store.DeleteByClientId("client-a");

            Assert.Multiple(() => {
                Assert.That(store.Load(clientAKey), Is.Null);
                Assert.That(store.Load(clientBKey), Is.Not.Null);
            });
        } finally {
            TryDeleteDirectory(rootPath);
        }
    }

    [Test]
    public async Task Pe_host_client_posts_json_and_deserializes_auth_response() {
        var captured = new CapturedRequest();
        using var httpClient = new HttpClient(new StubHttpMessageHandler((request, cancellationToken) => {
            captured.Method = request.Method;
            captured.RequestUri = request.RequestUri;
            captured.Content = request.Content == null
                ? ""
                : request.Content.ReadAsStringAsync(cancellationToken).GetAwaiter().GetResult();

            return new HttpResponseMessage(HttpStatusCode.OK) {
                Content = new StringContent(
                    """
                    {
                      "exists": true,
                      "expiresAtUtc": "2026-04-30T12:00:00Z",
                      "hasRefreshToken": true,
                      "scopeProfile": "ParameterService",
                      "flowKind": "ThreeLeggedConfidential"
                    }
                    """,
                    Encoding.UTF8,
                    "application/json"
                )
            };
        }));

        var priorBaseUrl = Environment.GetEnvironmentVariable(HostProcessIdentity.HostBaseUrlVariable);
        Environment.SetEnvironmentVariable(HostProcessIdentity.HostBaseUrlVariable, "http://localhost:7777");

        try {
            using var client = new PeHostClient(httpClient);
            var result = await client.ExecuteAsync<ApsTokenRequest, ApsPersistedTokenStatus>(
                GetApsAuthStatusOperationContract.Definition,
                ApsTokenRequest.ForParameterService()
            );

            Assert.Multiple(() => {
                Assert.That(captured.Method, Is.EqualTo(HttpMethod.Post));
                Assert.That(captured.RequestUri, Is.Not.Null);
                Assert.That(captured.RequestUri!.ToString(), Is.EqualTo("http://localhost:7777/api/aps/auth/status"));
                Assert.That(captured.Content, Does.Contain("\"scopeProfile\":\"ParameterService\""));
                Assert.That(result.Exists, Is.True);
                Assert.That(result.HasRefreshToken, Is.True);
                Assert.That(result.ScopeProfile, Is.EqualTo(ApsScopeProfile.ParameterService));
                Assert.That(result.FlowKind, Is.EqualTo(ApsAuthFlowKind.ThreeLeggedConfidential));
            });
        } finally {
            Environment.SetEnvironmentVariable(HostProcessIdentity.HostBaseUrlVariable, priorBaseUrl);
        }
    }

    [Test]
    public void Pe_host_client_surfaces_problem_detail_messages() {
        using var httpClient = new HttpClient(new StubHttpMessageHandler((request, cancellationToken) =>
            new HttpResponseMessage(HttpStatusCode.Conflict) {
                Content = new StringContent(
                    """
                    {
                      "detail": "Start Pe.Host and try again."
                    }
                    """,
                    Encoding.UTF8,
                    "application/json"
                )
            }
        ));
        using var client = new PeHostClient(httpClient);

        var ex = Assert.ThrowsAsync<PeHostClientException>(() =>
            client.ExecuteAsync<ApsTokenRequest, ApsPersistedTokenStatus>(
                GetApsAuthStatusOperationContract.Definition,
                ApsTokenRequest.ForParameterService()
            )
        );

        Assert.That(ex, Is.Not.Null);
        Assert.That(ex!.Message, Is.EqualTo("Start Pe.Host and try again."));
    }

    private static void TryDeleteDirectory(string path) {
        try {
            if (Directory.Exists(path))
                Directory.Delete(path, true);
        } catch {
            // Best-effort test cleanup.
        }
    }

    private sealed class CapturedRequest {
        public HttpMethod? Method { get; set; }
        public Uri? RequestUri { get; set; }
        public string Content { get; set; } = "";
    }

    private sealed class StubHttpMessageHandler(
        Func<HttpRequestMessage, CancellationToken, HttpResponseMessage> responseFactory
    ) : HttpMessageHandler {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken
        ) => Task.FromResult(responseFactory(request, cancellationToken));
    }
}
