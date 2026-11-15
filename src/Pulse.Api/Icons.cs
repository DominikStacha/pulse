using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using Dapper;

namespace Pulse.Api;

/// <summary>
/// Site icons for the dashboard, fetched by the server and cached, so viewers' browsers never call the tracked
/// sites (no 404/ORB noise, CSP img-src stays 'self'). Order: the homepage's &lt;link rel="icon"&gt; (svg, then
/// apple-touch-icon, then any icon), then /favicon.ico. https only, images only, at most 256 kB.
/// </summary>
public static partial class Icons
{
    const int MaxBytes = 256 * 1024;
    static readonly TimeSpan Ttl = TimeSpan.FromHours(24), MissTtl = TimeSpan.FromHours(1);
    sealed record Entry(byte[]? Bytes, string? Type, DateTimeOffset At);
    static readonly ConcurrentDictionary<string, Entry> Cache = new();

    [GeneratedRegex("""<link\b[^>]*>""", RegexOptions.IgnoreCase)]
    private static partial Regex LinkTag();
    [GeneratedRegex("""\b(rel|href|type)\s*=\s*["']([^"']*)["']""", RegexOptions.IgnoreCase)]
    private static partial Regex Attr();

    /// <summary>
    /// HTTP handler for icon fetches: every connection (redirect hops included) goes only to a public address,
    /// checked after DNS resolution, so a site's HTML or a redirect can't point the server at the Pi's own network.
    /// </summary>
    public static SocketsHttpHandler Handler() => new()
    {
        MaxAutomaticRedirections = 3,
        ConnectCallback = async (ctx, ct) =>
        {
            var addresses = await Dns.GetHostAddressesAsync(ctx.DnsEndPoint.Host, ct);
            if (addresses.Length == 0 || !addresses.All(IsPublic)) throw new HttpRequestException("icon host is not public");
            var socket = new Socket(addresses[0].AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try { await socket.ConnectAsync(addresses[0], ctx.DnsEndPoint.Port, ct); return new NetworkStream(socket, ownsSocket: true); }
            catch { socket.Dispose(); throw; }
        },
    };

    /// <summary>False for loopback, private, link-local, CGNAT, multicast, reserved and unspecified addresses.</summary>
    public static bool IsPublic(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.Any) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.Broadcast)) return false;
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return !(b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224
                || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 169 && b[1] == 254)
                || (b[0] == 100 && b[1] >= 64 && b[1] <= 127));
        }
        var v6 = ip.GetAddressBytes();
        return !(ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6Multicast || (v6[0] & 0xFE) == 0xFC); // fc00::/7 ULA
    }

    /// <summary>Icon candidates from a homepage, best first, only on the site's own host or its subdomains. Exposed for tests.</summary>
    public static List<Uri> Candidates(string html, Uri page)
    {
        var found = new List<(int rank, Uri uri)>();
        foreach (Match tag in LinkTag().Matches(html))
        {
            var a = Attr().Matches(tag.Value).ToDictionary(m => m.Groups[1].Value.ToLowerInvariant(), m => m.Groups[2].Value);
            if (!a.TryGetValue("rel", out var rel) || !rel.Contains("icon", StringComparison.OrdinalIgnoreCase)) continue;
            if (!a.TryGetValue("href", out var href) || !Uri.TryCreate(page, href.Trim(), out var uri) || uri.Scheme != Uri.UriSchemeHttps) continue;
            if (uri.Host != page.Host && !uri.Host.EndsWith("." + page.Host, StringComparison.OrdinalIgnoreCase)) continue; // own site only
            var rank = a.GetValueOrDefault("type", "").Contains("svg", StringComparison.OrdinalIgnoreCase) || uri.AbsolutePath.EndsWith(".svg", StringComparison.OrdinalIgnoreCase) ? 0
                : rel.Contains("apple-touch-icon", StringComparison.OrdinalIgnoreCase) ? 1 : 2;
            found.Add((rank, uri));
        }
        var list = found.OrderBy(f => f.rank).Select(f => f.uri).ToList();
        list.Add(new Uri(page, "/favicon.ico"));
        return [.. list.Distinct()];
    }

    public static void MapIcons(this RouteGroupBuilder api) =>
        api.MapGet("/sites/{id}/icon", async (string id, Db db, IHttpClientFactory http, TimeProvider clock, HttpContext ctx) =>
        {
            string? domain;
            using (var c = db.Open()) domain = c.QueryFirstOrDefault<string>("SELECT domain FROM sites WHERE id = @id", new { id });
            if (domain is null) return Results.NotFound();
            if (!Cache.TryGetValue(id, out var e) || clock.GetUtcNow() - e.At > (e.Bytes is null ? MissTtl : Ttl))
                Cache[id] = e = await Fetch(http.CreateClient("icons"), domain, clock, ctx.RequestAborted);
            if (e.Bytes is null) return Results.NotFound();
            // An SVG opened directly must not run anything on this origin.
            ctx.Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
            ctx.Response.Headers.CacheControl = "private, max-age=86400";
            return Results.Bytes(e.Bytes, e.Type);
        });

    static async Task<Entry> Fetch(HttpClient http, string domain, TimeProvider clock, CancellationToken ct)
    {
        var home = new Uri($"https://{domain}/");
        var html = "";
        // Only the start of the homepage: icons live in <head>, and prerendered pages can be megabytes.
        try { html = await ReadCapped(http, home, ct, truncate: true) is { } page ? System.Text.Encoding.UTF8.GetString(page.bytes) : ""; }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { }
        foreach (var uri in Candidates(html, home))
        {
            try
            {
                if (await ReadCapped(http, uri, ct) is { } r && r.type?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) == true)
                    return new Entry(r.bytes, r.type, clock.GetUtcNow());
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { }
        }
        return new Entry(null, null, clock.GetUtcNow());
    }

    /// <summary>Body up to MaxBytes; a longer body is rejected, or cut to MaxBytes with truncate.</summary>
    static async Task<(byte[] bytes, string? type)?> ReadCapped(HttpClient http, Uri uri, CancellationToken ct, bool truncate = false)
    {
        using var res = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!res.IsSuccessStatusCode || res.RequestMessage?.RequestUri?.Scheme != Uri.UriSchemeHttps) return null; // no https -> http redirects
        if (!truncate && res.Content.Headers.ContentLength > MaxBytes) return null;
        await using var s = await res.Content.ReadAsStreamAsync(ct);
        var buf = new byte[MaxBytes + 1];
        int n = 0, r;
        while (n < buf.Length && (r = await s.ReadAsync(buf.AsMemory(n), ct)) > 0) n += r;
        if (n > MaxBytes && !truncate) return null;
        return (buf[..Math.Min(n, MaxBytes)], res.Content.Headers.ContentType?.MediaType);
    }

    /// <summary>For tests.</summary>
    internal static void ClearCache() => Cache.Clear();
}
