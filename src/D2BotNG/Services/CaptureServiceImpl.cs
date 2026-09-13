using D2BotNG.Capture;
using D2BotNG.Core.Protos.Captures;
// Aliased rather than importing the v1 namespace: it declares its own Character and SearchItems
// messages, so pulling it in whole makes every one of them ambiguous here.
using Event = D2BotNG.Core.Protos.Event;
using CaptureChanged = D2BotNG.Core.Protos.CaptureChanged;
using Google.Protobuf.WellKnownTypes;
using Grpc.Core;

namespace D2BotNG.Services;

/// <summary>
/// Read endpoints for captured character state. Its own service rather than methods on
/// <see cref="CharacterServiceImpl" />: captures are a separate stack with separate storage, and
/// unlike v1 character state they are not streamed — an inventory carries every item's stat
/// lists, which is far too much to push through the event stream on every change. Clients pull
/// instead.
///
/// Every endpoint is keyed by <see cref="CharacterKey" /> — profile AND character name — because
/// one profile can hold several captures (a mule profile, one per mule it logs into).
/// </summary>
public class CaptureServiceImpl : CaptureService.CaptureServiceBase
{
    private readonly CaptureStore _store;
    private readonly CaptureEngine _engine;
    private readonly EventBroadcaster _events;

    public CaptureServiceImpl(CaptureStore store, CaptureEngine engine, EventBroadcaster events)
    {
        _store = store;
        _engine = engine;
        _events = events;
    }

    public override Task<Character> GetCharacter(CharacterKey request, ServerCallContext context)
    {
        var character = _store.GetCharacter(Require(request));
        if (character == null)
            throw new RpcException(new Status(StatusCode.NotFound, $"No capture for {Describe(request)}"));

        return Task.FromResult(character);
    }

    public override Task<SearchItemsResponse> SearchItems(SearchItemsRequest request,
        ServerCallContext context)
    {
        try
        {
            return Task.FromResult(_store.SearchItems(request));
        }
        catch (InvalidSearchRequestException ex)
        {
            // The store rejects a request it cannot answer literally rather than repairing it,
            // so this is a caller error with a message naming the offending field.
            throw new RpcException(new Status(StatusCode.InvalidArgument, ex.Message));
        }
    }

    public override Task<Empty> ResetKills(CharacterKey request, ServerCallContext context)
    {
        Announce(_store.ResetKills(Require(request)));
        return Task.FromResult(new Empty());
    }

    public override Task<Empty> ResetAreaTime(CharacterKey request, ServerCallContext context)
    {
        Announce(_store.ResetAreaTime(Require(request)));
        return Task.FromResult(new Empty());
    }

    public override Task<Empty> ForgetCharacter(CharacterKey request, ServerCallContext context)
    {
        // Through the engine rather than the store, because forgetting changes the LIST and the
        // engine is what announces list changes. A capture that was not there is not an error:
        // the caller wanted it gone, and it is.
        _engine.ForgetCharacter(Require(request));
        return Task.FromResult(new Empty());
    }

    /// <summary>
    /// Tells every client the capture changed, the same way an ingested snapshot does.
    ///
    /// A reset is the one change to a capture that does not come from a bot reporting, so it is
    /// also the only one nothing else would announce. The client that issued it invalidates its own
    /// query, but a second window — or the same one after the profile has stopped, where no further
    /// snapshot is ever coming — would keep showing the totals that were just cleared.
    /// </summary>
    private void Announce(CharacterSummary? summary)
    {
        // Null means the store is disabled or the character is unknown, so nothing was deleted
        // and there is nothing to say.
        if (summary == null) return;

        _events.Broadcast(new Event
        {
            Timestamp = Timestamp.FromDateTime(DateTime.UtcNow),
            CaptureChanged = new CaptureChanged { Key = summary.Key, Summary = summary },
        });
    }

    /// <summary>A key with no profile names nothing; the name half may legitimately be empty.</summary>
    private static CharacterKey Require(CharacterKey request) =>
        string.IsNullOrEmpty(request.Profile)
            ? throw new RpcException(new Status(StatusCode.InvalidArgument, "profile is required"))
            : request;

    private static string Describe(CharacterKey key) => $"'{key.Name}' via profile '{key.Profile}'";
}
