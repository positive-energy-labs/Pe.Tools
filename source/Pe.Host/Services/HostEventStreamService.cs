using Newtonsoft.Json;
using Pe.Host.Contracts.Protocol;
using System.Collections.Concurrent;
using System.Threading.Channels;

namespace Pe.Host.Services;

public sealed class HostEventStreamService {
    private readonly JsonSerializerSettings _serializerSettings = HostJson.CreateSerializerSettings();
    private readonly ConcurrentDictionary<Guid, Channel<HostEventStreamMessage>> _subscribers = new();

    public ChannelReader<HostEventStreamMessage> Subscribe(CancellationToken cancellationToken) {
        var subscriberId = Guid.NewGuid();
        var channel = Channel.CreateUnbounded<HostEventStreamMessage>(new UnboundedChannelOptions {
            SingleReader = true, SingleWriter = false
        });

        this._subscribers[subscriberId] = channel;
        _ = cancellationToken.Register(() => this.RemoveSubscriber(subscriberId));
        return channel.Reader;
    }

    public Task PublishDocumentChangedAsync(
        DocumentInvalidationEvent payload,
        CancellationToken cancellationToken = default
    ) => this.PublishAsync(SettingsHostEventNames.DocumentChanged, payload, cancellationToken);

    public Task PublishHostStatusChangedAsync(
        HostStatusChangedEvent payload,
        CancellationToken cancellationToken = default
    ) => this.PublishAsync(SettingsHostEventNames.HostStatusChanged, payload, cancellationToken);

    public Task PublishAsync<TPayload>(
        string eventName,
        TPayload payload,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();

        var message = new HostEventStreamMessage(
            eventName,
            JsonConvert.SerializeObject(payload, this._serializerSettings)
        );

        foreach (var subscriber in this._subscribers.ToArray()) {
            if (!subscriber.Value.Writer.TryWrite(message))
                this.RemoveSubscriber(subscriber.Key);
        }

        return Task.CompletedTask;
    }

    private void RemoveSubscriber(Guid subscriberId) {
        if (!this._subscribers.TryRemove(subscriberId, out var channel))
            return;

        channel.Writer.TryComplete();
    }
}

public readonly record struct HostEventStreamMessage(string EventName, string PayloadJson);