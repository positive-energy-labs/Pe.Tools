using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class TrayQuitTests {
    private static string Thread(string id, string state) =>
        $$$"""{"id":"{{{id}}}","title":"t","activity":{"state":"{{{state}}}","pending":0,"message":null,"lastSeq":3}}""";

    [Test]
    public void OnlyARunningOrAskingThreadIsATurnQuittingWouldCut() {
        var json = "[" + string.Join(",", Thread("a", "running"), Thread("b", "idle"), Thread("c", "waiting"), Thread("d", "failed")) + "]";
        Assert.That(TrayQuit.ActiveTurns(json), Is.EqualTo(2));
        Assert.That(TrayQuit.ActiveTurns("[]"), Is.EqualTo(0));
    }

    [Test]
    public void AListTheTrayCannotReadIsNotAReasonToHoldTheQuit() {
        Assert.That(TrayQuit.ActiveTurns("not json"), Is.EqualTo(0));
        Assert.That(TrayQuit.ActiveTurns("""{"error":"x"}"""), Is.EqualTo(0));
        Assert.That(TrayQuit.ActiveTurns("""[{"id":"a"}]"""), Is.EqualTo(0));
    }

    [Test]
    public void TheQuestionNamesWhatIsRunningAndWhatQuittingDoesToIt() {
        Assert.That(TrayQuit.Question(1), Does.Contain("1 Pea turn is running"));
        Assert.That(TrayQuit.Question(3), Does.Contain("3 Pea turns are running"));
        Assert.That(TrayQuit.Question(2), Does.Contain("stops"));
    }
}
