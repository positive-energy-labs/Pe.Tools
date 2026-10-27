using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

[TestFixture]
public sealed class DuctPortsRequestTests {
    [Test]
    public void Exact_port_request_is_bounded_and_deduplicates_without_reordering() {
        Assert.That(new DuctPortsRequest([6049638, 6894092, 6049638]).UniqueElementIds(),
            Is.EqualTo(new long[] { 6049638, 6894092 }));
        Assert.Multiple(() => {
            Assert.Throws<ArgumentException>(() => new DuctPortsRequest([]).UniqueElementIds());
            Assert.Throws<ArgumentException>(() => new DuctPortsRequest([0]).UniqueElementIds());
            Assert.Throws<ArgumentException>(() => new DuctPortsRequest(Enumerable.Range(1, 33)
                .Select(id => (long)id).ToArray()).UniqueElementIds());
        });
    }
}
