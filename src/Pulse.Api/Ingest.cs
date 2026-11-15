using System.Text;
using System.Text.Json;
using Dapper;

namespace Pulse.Api;

/// <summary>A validated event, ready to store. No IP, no user agent: those only feed the visitor hash.</summary>
public sealed record NewEvent(
    string SiteId, string? Name, string Path, string? Title, string? Referrer, string? Country,
    string Browser, string Os, string Device, string? Screen, string? Language, string? Data);

public sealed record LiveEvent(
    string SiteId, string Ts, string Kind, string? Name, string Path, string? Country,
    string Browser, string Os, string Device, string? Referrer);

/// <summary>Stores events: visitor hash, visit splitting (30 min gap), insert, live broadcast.</summary>
public sealed class Events(Db db, Salts salts, LiveHub hub, TimeProvider clock)
{
    public const long VisitGapMs = 30 * 60 * 1000;

    sealed class Last { public long Visit { get; set; } public long Ts { get; set; } }

    public void Store(NewEvent e, string ip, string userAgent)
    {
        var now = clock.GetUtcNow().ToUnixTimeMilliseconds();
        var visitor = salts.Visitor(e.SiteId, ip, userAgent);
        using var c = db.Open();
        var last = c.QueryFirstOrDefault<Last>(
            "SELECT visit AS Visit, ts AS Ts FROM events WHERE site_id = @SiteId AND visitor = @visitor ORDER BY ts DESC LIMIT 1", new { e.SiteId, visitor });
        var visit = last is not null && now - last.Ts < VisitGapMs ? last.Visit : Random.Shared.NextInt64();
        var kind = e.Name is null ? 1 : 2;
        c.Execute("""
            INSERT INTO events(site_id, ts, visitor, visit, kind, name, path, title, referrer, country, browser, os, device, screen, language, data)
            VALUES (@SiteId, @now, @visitor, @visit, @kind, @Name, @Path, @Title, @Referrer, @Country, @Browser, @Os, @Device, @Screen, @Language, @Data)
            """, new { e.SiteId, now, visitor, visit, kind, e.Name, e.Path, e.Title, e.Referrer, e.Country, e.Browser, e.Os, e.Device, e.Screen, e.Language, e.Data });
        hub.Publish(new LiveEvent(e.SiteId, Iso.Utc(now), kind == 1 ? "pageview" : "event", e.Name, e.Path, e.Country, e.Browser, e.Os, e.Device, e.Referrer));
    }
}

public static class Ingest
{
    const int MaxBody = 16 * 1024;

    public static void MapIngest(this WebApplication app) =>
        app.MapMethods("/api/send", ["POST", "OPTIONS"], async (HttpContext ctx, Db db, Events events) =>
        {
            var res = ctx.Response;
            res.Headers.AccessControlAllowOrigin = "*"; // no credentials, ever
            if (HttpMethods.IsOptions(ctx.Request.Method))
            {
                res.Headers.AccessControlAllowMethods = "POST, OPTIONS";
                res.Headers.AccessControlAllowHeaders = "Content-Type";
                res.Headers.AccessControlMaxAge = "86400";
                return Results.NoContent();
            }

            if (ctx.Request.ContentLength > MaxBody) return Err(413, "payload too large");
            var buf = new byte[MaxBody + 1];
            int n = 0, r;
            while (n < buf.Length && (r = await ctx.Request.Body.ReadAsync(buf.AsMemory(n), ctx.RequestAborted)) > 0) n += r;
            if (n > MaxBody) return Err(413, "payload too large");

            JsonDocument doc;
            try { doc = JsonDocument.Parse(buf.AsMemory(0, n)); }
            catch (JsonException) { return Err(400, "invalid json"); }
            using var _ = doc;

            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("payload", out var p) || p.ValueKind != JsonValueKind.Object)
                return Err(400, "invalid payload");
            var website = Str(p, "website");
            if (string.IsNullOrWhiteSpace(website)) return Err(400, "missing website");

            // From here on every rejection is a silent 204: callers (and bots) learn nothing.
            if (Str(root, "type") != "event") return Results.NoContent(); // identify etc.: never store identities
            using var c = db.Open();
            var domain = website.Length <= 64 ? c.QueryFirstOrDefault<string>("SELECT domain FROM sites WHERE id = @website", new { website }) : null;
            if (domain is null) return Results.NoContent();
            var host = Str(p, "hostname")?.Trim().ToLowerInvariant();
            if (host is null || (host != domain && !host.EndsWith("." + domain, StringComparison.Ordinal))) return Results.NoContent();
            var ua = ctx.Request.Headers.UserAgent.ToString();
            if (Ua.IsBot(ua)) return Results.NoContent();

            var screen = Cut(Str(p, "screen"), 20);
            var (browser, os, device) = Ua.Parse(ua, screen);
            var name = Cut(Str(p, "name")?.Trim(), 50);
            string? data = null;
            if (p.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object)
            {
                var raw = d.GetRawText();
                if (Encoding.UTF8.GetByteCount(raw) <= 2048) data = raw; // larger: drop the data, keep the event
            }

            events.Store(new NewEvent(
                    website, name, PathOf(Str(p, "url")), Cut(Str(p, "title"), 200), RefHost(Str(p, "referrer"), host),
                    Countries.FromHeader(ctx.Request.Headers["CF-IPCountry"].ToString()),
                    browser, os, device, screen, Cut(Str(p, "language"), 35), data),
                ClientIp(ctx), ua);
            return Results.Json(new { ok = true });
        });

    static IResult Err(int status, string error) => Results.Json(new { error }, statusCode: status);

    static string? Str(JsonElement o, string name) => o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    /// <summary>Truncates to max chars (never inside a surrogate pair); empty becomes null.</summary>
    public static string? Cut(string? s, int max)
    {
        if (string.IsNullOrEmpty(s)) return null;
        if (s.Length <= max) return s;
        return char.IsHighSurrogate(s[max - 1]) ? s[..(max - 1)] : s[..max];
    }

    /// <summary>Path only: query and hash are dropped whatever the client sent, absolute URLs are reduced to their path.</summary>
    public static string PathOf(string? url)
    {
        var s = (url ?? "").Trim();
        if (s.IndexOfAny(['?', '#']) is >= 0 and var i) s = s[..i];
        if (s.StartsWith("//", StringComparison.Ordinal)) s = s.IndexOf('/', 2) is >= 0 and var slash ? s[slash..] : "/";
        else if (!s.StartsWith('/') && s.IndexOf("://", StringComparison.Ordinal) is >= 0 and var scheme)
            s = s.IndexOf('/', scheme + 3) is >= 0 and var slash2 ? s[slash2..] : "/";
        if (!s.StartsWith('/')) s = "/" + s;
        return Cut(s, 500)!;
    }

    /// <summary>Referrer reduced to its host name (no leading www.); null when empty, not http(s) or the page's own host.</summary>
    public static string? RefHost(string? referrer, string pageHost)
    {
        if (!Uri.TryCreate(referrer?.Trim(), UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return null;
        var h = NoWww(u.Host);
        return h == NoWww(pageHost) ? null : Cut(h, 255);
    }

    static string NoWww(string h) => h.StartsWith("www.", StringComparison.Ordinal) ? h[4..] : h;

    /// <summary>CF-Connecting-IP (set by nginx), else first X-Forwarded-For, else the socket. Used for the hash only.</summary>
    static string ClientIp(HttpContext ctx)
    {
        var h = ctx.Request.Headers;
        if (h["CF-Connecting-IP"].ToString() is { Length: > 0 } cf) return cf.Trim();
        if (h["X-Forwarded-For"].ToString().Split(',')[0].Trim() is { Length: > 0 } xff) return xff;
        return ctx.Connection.RemoteIpAddress?.ToString() ?? "";
    }
}
