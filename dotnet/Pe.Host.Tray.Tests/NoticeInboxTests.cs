using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class NoticeInboxTests {
    [Test]
    public async Task AttendedItemsAdvanceWithoutShowingOrSkippingAnEarlierHeldItem() {
        long saved = 0;
        var inbox = new NoticeInbox(0, id => saved = id);
        var attended = "{\"id\":\"t\",\"revision\":1,\"title\":\"Done\",\"body\":\"\",\"attended\":true}";
        Assert.That(await Read(inbox, Feed(Event(1, attended))), Is.Empty);
        Assert.That(saved, Is.EqualTo(1));
        Assert.That(await Read(inbox, Feed(Event(2, Notice("unattended")), Event(3, attended))), Is.Empty);
        Assert.That(saved, Is.EqualTo(1), "held items remain owed across a crash");
        Assert.That(inbox.Received, Is.EqualTo(3));
        Assert.That(inbox.PageReady(), Has.Count.EqualTo(1));
        Assert.That(saved, Is.EqualTo(3));
        Assert.That(await Read(inbox, Feed(Event(4, attended))), Is.Empty);
        Assert.That(saved, Is.EqualTo(4));
    }
    private static string Notice(string id, int revision = 1) =>
        $$"""{"id":"{{id}}","revision":{{revision}},"title":"Revit start succeeded","body":"Done."}""";

    /** One `notices` Reading frame as the host writes it: SSE `id:` and a JSON frame. */
    private static string Event(long id, string notice) =>
        $"id: {id}\ndata: {{\"kind\":\"event\",\"key\":\"k\",\"value\":{notice},\"id\":{id}}}\n\n";

    private static string Gap(long id) =>
        $"id: {id}\ndata: {{\"kind\":\"gap\",\"key\":\"k\",\"dropped\":null,\"id\":{id}}}\n\n";

    private static Stream Feed(params string[] frames) => new MemoryStream(Encoding.UTF8.GetBytes(": open\n\n" + string.Concat(frames)));

    private static async Task<List<string>> Read(NoticeInbox inbox, Stream feed) {
        var shown = new List<string>();
        await NoticeInbox.ReadFeedAsync(feed, frame => shown.AddRange(inbox.Receive(frame)), CancellationToken.None);
        return shown;
    }

    /** The host's log of items, and what it would stream after a cursor. */
    private sealed class Host {
        public readonly List<(long Id, string Notice)> Log = new();
        public void Announce(string id) => Log.Add((Log.Count + 1, Notice(id)));
        public Stream After(long? cursor) => cursor is null
            ? Feed(Gap(Log.Count))
            : Feed(Log.Where(e => e.Id > cursor).Select(e => Event(e.Id, e.Notice)).ToArray());
    }

    [Test]
    public async Task ATrayThatWasOfflineForThreeNoticesShowsEachOnceInOrderWhenItReconnects() {
        var host = new Host();
        long? saved = null;
        var inbox = new NoticeInbox(null, id => saved = id);
        inbox.PageReady();
        await Read(inbox, host.After(inbox.Received));      // first run: nothing is owed, follow from here
        host.Announce("a");
        Assert.That(await Read(inbox, host.After(inbox.Received)), Is.EqualTo(new[] { Notice("a") }));
        // The tray goes away; three notices pass; a new tray starts from the cursor it saved.
        host.Announce("b"); host.Announce("c"); host.Announce("d");
        var restarted = new NoticeInbox(saved, id => saved = id);
        restarted.PageReady();
        Assert.That(await Read(restarted, host.After(restarted.Received)), Is.EqualTo(new[] { Notice("b"), Notice("c"), Notice("d") }));
        // Reconnecting again, even to a host that repeats the lot, shows nothing twice.
        Assert.That(await Read(restarted, host.After(restarted.Received)), Is.Empty);
        Assert.That(await Read(restarted, host.After(0)), Is.Empty);
        Assert.That(saved, Is.EqualTo(4));
    }

    [Test]
    public async Task ANoticeIsOnlyDeliveredOnceThePageListensAndTheCursorMovesWithDelivery() {
        long? saved = 5;
        var inbox = new NoticeInbox(5, id => saved = id);
        Assert.That(await Read(inbox, Feed(Event(6, Notice("a")), Event(7, Notice("b")))), Is.Empty);
        Assert.That(saved, Is.EqualTo(5), "held is not delivered: a crash now must replay both");
        Assert.That(inbox.Received, Is.EqualTo(7), "a reconnect resumes after what arrived");
        Assert.That(inbox.PageReady(), Is.EqualTo(new[] { Notice("a"), Notice("b") }));
        Assert.That(saved, Is.EqualTo(7));
        Assert.That(inbox.PageReady(), Is.Empty);
    }

    [Test]
    public async Task ANavigationHoldsNoticesUntilTheNewPageListens() {
        var inbox = new NoticeInbox(0, _ => { });
        inbox.PageReady();
        Assert.That(await Read(inbox, Feed(Event(1, Notice("a")))), Is.EqualTo(new[] { Notice("a") }));
        inbox.PageGone();
        Assert.That(await Read(inbox, Feed(Event(2, Notice("b")))), Is.Empty);
        Assert.That(inbox.PageReady(), Is.EqualTo(new[] { Notice("b") }));
    }

    [Test]
    public async Task AQuestionAndResponseForOneThreadAreDeliveredAsDistinctItems() {
        var inbox = new NoticeInbox(0, _ => { });
        const string question = """{"id":"q","revision":1,"title":"Pea is asking","body":"Which next?","act":{"kind":"question","threadId":"t1","requestId":"r1","message":"Which next?","requestedSchema":{"type":"object"}}}""";
        const string response = """{"id":"turn","revision":1,"title":"Ducts","body":"Done","act":{"kind":"reply","threadId":"t1"}}""";
        Assert.That(await Read(inbox, Feed(Event(1, question), Event(2, response))), Is.Empty);
        Assert.That(inbox.PageReady(), Is.EqualTo(new[] { question, response }));
        Assert.That(await Read(inbox, Feed(Event(1, question), Event(2, response))), Is.Empty);
    }

    [Test]
    public async Task AGapFromAHostThatLostItsHistoryMovesTheCursorToTheLogAndShowsNothing() {
        long? saved = 90;
        var inbox = new NoticeInbox(90, id => saved = id);
        inbox.PageReady();
        Assert.That(await Read(inbox, Feed(Gap(12))), Is.Empty);
        Assert.That((inbox.Received, saved), Is.EqualTo((12L, 12L)));
    }

    [Test]
    public async Task AMalformedOrForeignFrameIsSkippedAndTheFeedReadsOn() {
        var inbox = new NoticeInbox(0, _ => { });
        inbox.PageReady();
        var presence = "data: {\"kind\":\"snapshot\",\"key\":\"k\",\"value\":{\"tray\":true}}\n\n";
        var shown = await Read(inbox, Feed("data: {not json\n\n", presence, Event(1, "{\"id\":\"a\"}"), Event(2, Notice("c"))));
        Assert.That(shown, Is.EqualTo(new[] { Notice("c") }));
    }

    [Test]
    public void TheStreamResumesAfterTheCursorOnlyWhenOneIsKnown() {
        Assert.That(NoticeInbox.StreamQuery(null), Does.Not.Contain("after="));
        Assert.That(NoticeInbox.StreamQuery(41), Does.EndWith("&after=41"));
        Assert.That(Uri.UnescapeDataString(NoticeInbox.StreamQuery(0)), Does.Contain("{\"kind\":\"notices\",\"as\":\"tray\"}"));
    }

    [Test]
    public void TheSavedCursorSurvivesARestartAndNothingSavedOrCorruptReadsAsNone() {
        var path = Path.Combine(Path.GetTempPath(), $"tray-notices-{Guid.NewGuid():N}.cursor");
        try {
            Assert.That(NoticeCursor.Load(path), Is.Null);
            NoticeCursor.Save(path, 17);
            Assert.That(NoticeCursor.Load(path), Is.EqualTo(17));
            File.WriteAllText(path, "not a number");
            Assert.That(NoticeCursor.Load(path), Is.Null);
        } finally { File.Delete(path); }
    }
}

public class NoticeCardWindowTests {
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [Test, Apartment(ApartmentState.STA)]
    public void ShowingACardKeepsTheDraggedPanelVisibleAndUnchanged() {
        using var panel = new TrayWindow();
        using var card = new NoticeWindow();
        panel.Rehome();
        var bounds = new Rectangle(120, 80, 560, 560);
        panel.Bounds = bounds;
        panel.Show();
        var foreground = GetForegroundWindow();
        try {
            card.PositionCard(96);
            card.Show();
            System.Windows.Forms.Application.DoEvents();
            Assert.That(panel.Visible, Is.True, "a card must never hide the panel");
            Assert.That(panel.Bounds, Is.EqualTo(bounds), "the panel stays where it was dragged");
            Assert.That(card.Visible, Is.True);
            Assert.That(card.Handle, Is.Not.EqualTo(panel.Handle));
            Assert.That(GetForegroundWindow(), Is.EqualTo(foreground), "showing a card never activates it");
            var top = card.Top;
            var corner = card.Bounds;
            panel.Location = new Point(260, 140);
            card.PositionCard(300);
            Assert.That(card.Top, Is.EqualTo(top), "height grows down from the top edge");
            Assert.That(card.Right, Is.EqualTo(corner.Right));
            Assert.That(panel.Bounds, Is.EqualTo(new Rectangle(260, 140, 560, 560)));
            card.Hide();
            Assert.That(panel.Visible, Is.True);
            Assert.That(GetForegroundWindow(), Is.EqualTo(foreground));
            Assert.That(card.ShowInTaskbar, Is.False);
            Assert.That(card.TopMost, Is.True);
        } finally { card.Hide(); panel.Hide(); }
    }

    [Test, Apartment(ApartmentState.STA)]
    public void AHiddenPanelStaysHiddenWhileItsSeparateCardShows() {
        using var panel = new TrayWindow();
        using var card = new NoticeWindow();
        panel.Rehome();
        var bounds = panel.Bounds;
        card.PositionCard(96);
        card.Show();
        Assert.That(panel.Visible, Is.False);
        Assert.That(panel.Bounds, Is.EqualTo(bounds));
        card.Hide();
        Assert.That(panel.Visible, Is.False);
    }

    [Test]
    public void TheCardIsPaddedFromTheScreenEdgeAndNeverOutgrowsTheWorkArea() {
        var work = new Rectangle(0, 50, 1920, 1032);
        Assert.That(NoticeWindow.CardBoundsFor(work, 96, 300), Is.EqualTo(new Rectangle(1920 - 20 - 420, 70, 420, 300)));
        Assert.That(NoticeWindow.CardBoundsFor(work, 192, 300), Is.EqualTo(new Rectangle(1920 - 40 - 840, 90, 840, 600)));
        Assert.That(NoticeWindow.CardBoundsFor(new Rectangle(0, 0, 400, 300), 96, 900), Is.EqualTo(new Rectangle(20, 20, 360, 260)));
    }
}
