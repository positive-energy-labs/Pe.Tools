using System.Drawing;
using System.Text;
using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class NoticeInboxTests {
    private static string Notice(string id, int revision) =>
        $$"""{"id":"{{id}}","revision":{{revision}},"title":"Revit start succeeded","body":"Done."}""";

    /** The host's `/host/notices` as the tray reads it: an SSE body, one `data:` line per item. */
    private static Stream Feed(params string[] notices) => new MemoryStream(Encoding.UTF8.GetBytes(
        ": open\n\n" + string.Concat(notices.Select(n => "data: " + n + "\n\n"))));

    private static async Task<List<string>> Read(NoticeInbox inbox, Stream feed) {
        var shown = new List<string>();
        await NoticeInbox.ReadFeedAsync(feed, json => shown.AddRange(inbox.Receive(json)), CancellationToken.None);
        return shown;
    }

    [Test]
    public async Task ANoticeBeforeThePageListensIsHeldThenShownOnceItReportsReady() {
        var inbox = new NoticeInbox();
        Assert.That(await Read(inbox, Feed(Notice("a", 1))), Is.Empty);
        Assert.That(inbox.PageReady(), Is.EqualTo(new[] { Notice("a", 1) }));
        // The host replays its last minute on every connect: shown once, and a successor revision is new.
        Assert.That(await Read(inbox, Feed(Notice("a", 1), Notice("a", 2))), Is.EqualTo(new[] { Notice("a", 2) }));
    }

    [Test]
    public async Task AReplayHeldTwiceBeforeTheFirstPageIsOneItem() {
        var inbox = new NoticeInbox();
        await Read(inbox, Feed(Notice("a", 1), Notice("b", 1)));
        await Read(inbox, Feed(Notice("a", 1), Notice("b", 1)));
        Assert.That(inbox.PageReady(), Is.EqualTo(new[] { Notice("a", 1), Notice("b", 1) }));
        Assert.That(inbox.PageReady(), Is.Empty);
    }

    [Test]
    public async Task ANavigationHoldsNoticesUntilTheNewPageListens() {
        var inbox = new NoticeInbox();
        inbox.PageReady();
        Assert.That(await Read(inbox, Feed(Notice("a", 1))), Is.EqualTo(new[] { Notice("a", 1) }));
        inbox.PageGone();
        Assert.That(await Read(inbox, Feed(Notice("b", 1))), Is.Empty);
        Assert.That(inbox.PageReady(), Is.EqualTo(new[] { Notice("b", 1) }));
    }

    [Test]
    public async Task AMalformedFrameIsSkippedAndTheFeedReadsOn() {
        var inbox = new NoticeInbox();
        inbox.PageReady();
        Assert.That(await Read(inbox, Feed("{not json", """{"id":"a"}""", Notice("c", 1))), Is.EqualTo(new[] { Notice("c", 1) }));
    }
}

public class NoticeCardWindowTests {
    [Test]
    public void TheCardIsPaddedFromTheScreenEdgeAndNeverOutgrowsTheWorkArea() {
        var work = new Rectangle(0, 0, 1920, 1032);
        Assert.That(TrayWindow.CardBoundsFor(work, 96, 300), Is.EqualTo(new Rectangle(1920 - 12 - 420, 1032 - 12 - 300, 420, 300)));
        Assert.That(TrayWindow.CardBoundsFor(work, 192, 300), Is.EqualTo(new Rectangle(1920 - 24 - 840, 1032 - 24 - 600, 840, 600)));
        Assert.That(TrayWindow.CardBoundsFor(new Rectangle(0, 0, 400, 300), 96, 900), Is.EqualTo(new Rectangle(12, 12, 376, 276)));
    }
}
