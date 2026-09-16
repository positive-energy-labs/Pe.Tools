using System.Net;
using Pe.Revit.Global.Services.Aps;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ParametersPaginationTests {
    [Test]
    public void Failure_after_first_page_refuses_a_partial_authority_snapshot() {
        using var handler = new Pages();
        using var client = new HttpClient(handler) { BaseAddress = new Uri("https://example.invalid/") };
        var parameters = new Pe.Revit.Global.Services.Aps.Parameters(client, new Settings());
        var error = Assert.ThrowsAsync<HttpRequestException>(async () => await parameters.GetParameters(null!, false));
        Assert.That(error!.Message, Does.Contain("offset 50"));
        Assert.That(handler.Requests, Is.EqualTo(2));
    }

    private sealed class Settings : IParametersTokenProvider {
        public string GetAccountId() => "account";
        public string GetGroupId() => "group";
        public string GetCollectionId() => "collection";
    }

    private sealed class Pages : HttpMessageHandler {
        public int Requests { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
            this.Requests++;
            return Task.FromResult(this.Requests == 1
                ? new HttpResponseMessage(HttpStatusCode.OK) {
                    Content = new StringContent("""{"results":[{"id":"first","name":"First"}],"pagination":{"totalResults":2}}""")
                }
                : new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = new StringContent("unavailable") });
        }
    }
}
