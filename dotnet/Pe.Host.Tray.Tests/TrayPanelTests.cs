using System.Drawing;
using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class TrayPanelTests {
    [Test]
    public void PinDefaultsOffAndRoundTripsBesideTrayPrefs() {
        var directory = Path.Combine(Path.GetTempPath(), "tray-pin-" + Guid.NewGuid());
        var path = Path.Combine(directory, "pin.json");
        try {
            Assert.That(TrayPin.Load(path), Is.False);
            TrayPin.Save(path, true);
            Assert.That(TrayPin.Load(path), Is.True);
            TrayPin.Save(path, false);
            Assert.That(TrayPin.Load(path), Is.False);
            File.WriteAllText(path, "invalid");
            Assert.That(TrayPin.Load(path), Is.False);
        } finally { Directory.Delete(directory, true); }
    }

    [Test, Apartment(ApartmentState.STA)]
    public void NativePanelHasNoStoplightAndClampsBothResizeDirections() {
        using var panel = new TrayWindow();
        panel.Rehome();
        Assert.That(panel.TopMost, Is.False);
        Assert.That(panel.ControlBox || panel.MinimizeBox || panel.MaximizeBox, Is.False);
        panel.Size = new Size(1, 1);
        Assert.That(panel.Size, Is.EqualTo(panel.MinimumSize));
        panel.Size = new Size(10000, 10000);
        Assert.That(panel.Size, Is.EqualTo(panel.MaximumSize));
        panel.SetPinned(true);
        Assert.That(panel.TopMost, Is.True);
        panel.SetPinned(false);
        Assert.That(panel.TopMost, Is.False);
    }

    [TestCase(false, false, false, true)]
    [TestCase(true, false, false, false)]
    [TestCase(false, true, false, false)]
    [TestCase(false, false, true, false)]
    public void DismissPreservesPinFocusAndOwnedDialog(bool pinned, bool focused, bool dialog, bool expected) =>
        Assert.That(TrayWindow.ShouldDismiss(pinned, focused, dialog), Is.EqualTo(expected));

    [TestCase(96, 1920, 1080, 960, 560)]
    [TestCase(192, 3840, 2160, 1920, 1120)]
    [TestCase(96, 500, 400, 500, 400)]
    public void MaximumUsesHalfTheWorkAreaWithRoomForTheDefault(int dpi, int width, int height, int maxWidth, int maxHeight) =>
        Assert.That(TrayWindow.MaximumFor(new Size(width, height), dpi), Is.EqualTo(new Size(maxWidth, maxHeight)));
}
