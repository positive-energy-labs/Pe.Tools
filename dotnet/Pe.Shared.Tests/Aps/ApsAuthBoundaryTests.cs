using Pe.Aps.Auth;
using Pe.Shared.ApsAuth;

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

    private static void TryDeleteDirectory(string path) {
        try {
            if (Directory.Exists(path))
                Directory.Delete(path, true);
        } catch {
            // Best-effort test cleanup.
        }
    }
}
