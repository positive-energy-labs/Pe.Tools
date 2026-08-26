using Pe.Revit.Extensions.ProjDocument;

namespace Pe.Shared.Tests.RevitData;

public sealed class DocumentReadingTests {
    [Test]
    public void LocalFileAddressMatchesTheRawBrowserAddress() {
        const string browserAddress = @"C:\Models\Tower-A.rvt";

        Assert.That(DocumentReading.ResolveAddress(null, browserAddress), Is.EqualTo(browserAddress));
    }
}
