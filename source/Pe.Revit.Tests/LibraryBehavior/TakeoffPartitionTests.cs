using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior;

public sealed class TakeoffPartitionTests
{
    [Test]
    public void Propagation_is_connected_shared_and_deterministic()
    {
        const int width = 9, height = 5;
        var labels = new int[width * height];
        var ink = new bool[labels.Length];
        int At(int x, int y) => y * width + x;

        foreach (var (x, y) in new[] { (1, 1), (1, 2), (2, 2), (1, 3), (2, 3) }) labels[At(x, y)] = 1;
        foreach (var (x, y) in new[] { (5, 2), (6, 2), (5, 3), (6, 3) }) labels[At(x, y)] = 2;
        foreach (var (x, y) in new[] {
                     (3, 2), (4, 2), (3, 3), (4, 3),
                     (0, 1), (0, 2), (0, 3), (7, 2), (7, 3),
                     (2, 0), // diagonally near label 1, but disconnected from its ink domain
                 }) ink[At(x, y)] = true;

        var accepted = new HashSet<int> { 1, 2 };
        var first = PartitionRegularizer.Propagate(labels, accepted, ink, width, height, 1, out var stats);
        var second = PartitionRegularizer.Propagate(labels, accepted, ink, width, height, 1, out _);

        Assert.Multiple(() => {
            Assert.That(first, Is.EqualTo(second));
            Assert.That(first[At(3, 2)], Is.EqualTo(1));
            Assert.That(first[At(4, 2)], Is.EqualTo(2));
            Assert.That(first[At(2, 0)], Is.Zero);
            Assert.That(stats.ClaimedCells, Is.EqualTo(9));
            Assert.That(stats.SharedEdgeCells, Is.EqualTo(2));
            Assert.That(stats.UnclaimedInkCells, Is.EqualTo(1));
        });
    }
}
