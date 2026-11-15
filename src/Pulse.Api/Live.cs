using System.Collections.Concurrent;
using System.Text.Json;
using System.Threading.Channels;
using Dapper;

namespace Pulse.Api;

/// <summary>In-process fan-out of stored events to SSE clients. Slow clients lose the oldest hits instead of blocking ingestion.</summary>
public sealed class LiveHub
{
    readonly ConcurrentDictionary<Channel<LiveEvent>, byte> _subs = new();

    public Channel<LiveEvent> Subscribe()
    {
        var ch = Channel.CreateBounded<LiveEvent>(new BoundedChannelOptions(100) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        _subs[ch] = 0;
        return ch;
    }

    public void Unsubscribe(Channel<LiveEvent> ch) => _subs.TryRemove(ch, out _);

    public void Publish(LiveEvent e)
    {
        foreach (var ch in _subs.Keys) ch.Writer.TryWrite(e);
    }
}

public sealed record SiteActive(string SiteId, long Active);
public sealed record Live(long ActiveVisitors, List<SiteActive> PerSite, List<LiveEvent> Recent);

public static class LiveEndpoints
{
    const long ActiveWindowMs = 5 * 60 * 1000;

    sealed class Row
    {
        public string SiteId { get; set; } = "";
        public long Ts { get; set; }
        public long Kind { get; set; }
        public string? Name { get; set; }
        public string Path { get; set; } = "";
        public string? Country { get; set; }
        public string Browser { get; set; } = "";
        public string Os { get; set; } = "";
        public string Device { get; set; } = "";
        public string? Referrer { get; set; }
    }

    sealed class Count { public string SiteId { get; set; } = ""; public long Active { get; set; } }

    public static void MapLive(this RouteGroupBuilder api)
    {
        api.MapGet("/live", (HttpContext ctx, Db db, TimeProvider clock) =>
        {
            using var c = db.Open();
            if (Q.Site(ctx.Request, c) is not { } site) return Q.Err(404, "unknown site");
            var since = clock.GetUtcNow().ToUnixTimeMilliseconds() - ActiveWindowMs;
            var where = Q.SiteWhere(site.Id);
            var active = c.ExecuteScalar<long>($"SELECT COUNT(DISTINCT visitor) FROM events WHERE {where} AND ts >= @since", new { site = site.Id, since });
            var perSite = c.Query<Count>($"SELECT site_id AS SiteId, COUNT(DISTINCT visitor) AS Active FROM events WHERE {where} AND ts >= @since GROUP BY site_id", new { site = site.Id, since })
                .ToDictionary(x => x.SiteId, x => x.Active);
            var sites = c.Query<SiteRow>("SELECT id AS Id, name AS Name FROM sites WHERE @site IS NULL OR id = @site", new { site = site.Id });
            // Newest first. All sites: rowid order is insertion order (cheap); one site: use the (site_id, ts) index.
            var recent = c.Query<Row>(
                $"""
                SELECT site_id AS SiteId, ts AS Ts, kind AS Kind, name AS Name, path AS Path, country AS Country, browser AS Browser, os AS Os, device AS Device, referrer AS Referrer
                FROM events WHERE {(site.Id is null ? "1=1 ORDER BY id DESC" : "site_id = @site ORDER BY ts DESC, id DESC")} LIMIT 50
                """, new { site = site.Id })
                .Select(r => new LiveEvent(r.SiteId, Iso.Utc(r.Ts), r.Kind == 1 ? "pageview" : "event", r.Name, r.Path, r.Country, r.Browser, r.Os, r.Device, r.Referrer))
                .ToList();
            return Results.Json(new Live(active,
                [.. sites.OrderByDescending(s => perSite.GetValueOrDefault(s.Id)).ThenBy(s => s.Name, StringComparer.Ordinal)
                    .Select(s => new SiteActive(s.Id, perSite.GetValueOrDefault(s.Id)))],
                recent));
        });

        // text/event-stream: `event: hit` per stored event, `event: ping` every 15 s. Ids of visitors/visits never leave the server.
        api.MapGet("/live/stream", async (HttpContext ctx, LiveHub hub) =>
        {
            var site = ctx.Request.Query["site"].ToString();
            var res = ctx.Response;
            res.Headers.ContentType = "text/event-stream";
            res.Headers.CacheControl = "no-cache";
            res.Headers["X-Accel-Buffering"] = "no";
            ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpResponseBodyFeature>()?.DisableBuffering();

            var ct = ctx.RequestAborted;
            var ch = hub.Subscribe();
            try
            {
                await res.WriteAsync("retry: 3000\n\n", ct);
                await res.Body.FlushAsync(ct);
                while (!ct.IsCancellationRequested)
                {
                    using var tick = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    tick.CancelAfter(TimeSpan.FromSeconds(15));
                    try
                    {
                        if (!await ch.Reader.WaitToReadAsync(tick.Token)) break;
                        while (ch.Reader.TryRead(out var e))
                            if (site is "" or "all" || e.SiteId == site)
                                await res.WriteAsync($"event: hit\ndata: {JsonSerializer.Serialize(e, JsonSerializerOptions.Web)}\n\n", ct);
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        await res.WriteAsync("event: ping\ndata: {}\n\n", ct);
                    }
                    await res.Body.FlushAsync(ct);
                }
            }
            catch (OperationCanceledException) { }
            finally { hub.Unsubscribe(ch); }
        });
    }
}
