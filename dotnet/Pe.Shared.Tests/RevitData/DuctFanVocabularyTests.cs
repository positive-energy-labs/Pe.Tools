using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

[TestFixture]
public sealed class DuctFanVocabularyTests {
    [Test]
    public void Catalog_vocabulary_contains_every_native_word_once_and_roundtrips() {
        var words = DuctFanVocabulary.All;
        foreach (var word in words.UnitKinds) Assert.That(JsonConvert.DeserializeObject<DuctUnitKind>(JsonConvert.SerializeObject(word)), Is.EqualTo(word));
        foreach (var word in words.BlockerKinds) Assert.That(JsonConvert.DeserializeObject<FanBlockerKind>(JsonConvert.SerializeObject(word)), Is.EqualTo(word));
        var wire = JObject.FromObject(words);
        Assert.Multiple(() => {
            Assert.That(words.UnitKinds, Has.Count.EqualTo(Enum.GetValues(typeof(DuctUnitKind)).Length));
            Assert.That(words.BlockerKinds, Has.Count.EqualTo(Enum.GetValues(typeof(FanBlockerKind)).Length));
            Assert.That(wire["UnitKinds"]!.Values<string>(), Is.Unique);
            Assert.That(wire["BlockerKinds"]!.Values<string>(), Is.Unique);
            Assert.That(new DuctReach([new DuctRef(1, 0)]).Complete, Is.False);
        });
    }
}
