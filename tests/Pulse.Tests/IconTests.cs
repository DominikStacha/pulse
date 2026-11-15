using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Api;

namespace Pulse.Tests;

sealed class FakeWeb : HttpMessageHandler
{
    public readonly Dictionary<string, (HttpStatusCode code, string type, byte[] body)> Pages = [];
    public readonly List<string> Requests = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var url = request.RequestUri!.ToString();
        lock (Requests) Requests.Add(url);
        var (code, type, body) = Pages.TryGetValue(url, out var p) ? p : (HttpStatusCode.NotFound, "text/html", "<h1>404</h1>"u8.ToArray());
        var res = new HttpResponseMessage(code) { Content = new ByteArrayContent(body), RequestMessage = request };
        res.Content.Headers.ContentType = new(type);
        return Task.FromResult(res);
    }
}

[Collection("icons")] // the icon cache is process-wide
public class IconTests
{
    static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 1, 2, 3];

    [Fact]
    public void Candidates_prefer_svg_then_apple_touch_icon_resolve_relative_hrefs_and_end_with_favicon_ico()
    {
        var page = new Uri("https://portal.example.cz/");
        var html = """
            <link rel="stylesheet" href="x.css">
            <link rel="icon" type="image/png" href="assets/images/logo.png">
            <link rel="apple-touch-icon" href="/assets/icons/icon-192.png">
            <link href="http://insecure.example/i.svg" rel="icon">
            <link rel="icon" href="https://elsewhere.example/evil.png">
            <link rel="icon" href="https://portal.example.cz.evil.com/x.png">
            <LINK REL="icon" TYPE="image/svg+xml" HREF="favicon.svg?v=2">
            """;
        Assert.Equal(
            ["https://portal.example.cz/favicon.svg?v=2", "https://portal.example.cz/assets/icons/icon-192.png",
             "https://portal.example.cz/assets/images/logo.png", "https://portal.example.cz/favicon.ico"],
            Icons.Candidates(html, page).Select(u => u.ToString()));
    }

    [Theory]
    [InlineData("127.0.0.1", false)]
    [InlineData("10.1.2.3", false)]
    [InlineData("172.16.0.1", false)]
    [InlineData("172.31.255.255", false)]
    [InlineData("192.168.0.5", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::1", false)]
    [InlineData("::", false)]
    [InlineData("fe80::1", false)]
    [InlineData("fd00::1", false)]
    [InlineData("::ffff:192.168.1.1", false)]
    [InlineData("64:ff9b::c0a8:105", false)]   // NAT64 of 192.168.1.5
    [InlineData("::c0a8:105", false)]          // IPv4-compatible
    [InlineData("2002:c0a8:105::1", false)]    // 6to4
    [InlineData("2001:0:4136:e378::1", false)] // Teredo
    [InlineData("2001:db8::1", false)]
    [InlineData("198.18.0.1", false)]
    [InlineData("192.0.2.1", false)]
    [InlineData("192.0.0.8", false)]
    [InlineData("198.51.100.7", false)]
    [InlineData("203.0.113.9", false)]
    [InlineData("172.32.0.1", true)]
    [InlineData("104.21.5.9", true)]
    [InlineData("2606:4700::6810:84e5", true)]
    public void Only_public_addresses_may_be_fetched(string ip, bool expected) =>
        Assert.Equal(expected, Icons.IsPublic(System.Net.IPAddress.Parse(ip)));

    static (PulseFactory f, HttpClient c, FakeWeb web) Start()
    {
        Icons.ClearCache();
        var web = new FakeWeb();
        var f = new PulseFactory { Configure = s => s.AddHttpClient("icons").ConfigurePrimaryHttpMessageHandler(() => web) };
        return (f, f.CreateClient(), web);
    }

    [Fact]
    public async Task Serves_the_icon_declared_in_the_homepage_sandboxed_and_cached()
    {
        var (f, c, web) = Start();
        using var _ = f;
        web.Pages["https://stacha.tech/"] = (HttpStatusCode.OK, "text/html", """<link rel="icon" type="image/png" href="/assets/logo.png">"""u8.ToArray());
        web.Pages["https://stacha.tech/assets/logo.png"] = (HttpStatusCode.OK, "image/png", Png);

        var r = await c.GetAsync($"/api/sites/{Ids.Stacha}/icon");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("image/png", r.Content.Headers.ContentType?.MediaType);
        Assert.Equal(Png, await r.Content.ReadAsByteArrayAsync());
        Assert.Contains("sandbox", string.Join(' ', r.Headers.GetValues("Content-Security-Policy")));

        var before = web.Requests.Count;
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync($"/api/sites/{Ids.Stacha}/icon")).StatusCode);
        Assert.Equal(before, web.Requests.Count); // served from the cache
    }

    [Fact]
    public async Task A_huge_prerendered_homepage_is_read_from_its_start()
    {
        var (f, c, web) = Start();
        using var _ = f;
        var html = """<head><link rel="icon" type="image/png" href="/logo.png"></head>""" + new string('x', 600_000);
        web.Pages["https://stacha.tech/"] = (HttpStatusCode.OK, "text/html", System.Text.Encoding.UTF8.GetBytes(html));
        web.Pages["https://stacha.tech/logo.png"] = (HttpStatusCode.OK, "image/png", Png);
        Assert.Equal(Png, await (await c.GetAsync($"/api/sites/{Ids.Stacha}/icon")).Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task A_non_image_answer_is_skipped_and_falls_back_to_favicon_ico()
    {
        var (f, c, web) = Start();
        using var _ = f;
        web.Pages["https://stacha.tech/"] = (HttpStatusCode.OK, "text/html", """<link rel="icon" href="/missing.png">"""u8.ToArray());
        web.Pages["https://stacha.tech/missing.png"] = (HttpStatusCode.OK, "text/html", "<html>spa fallback</html>"u8.ToArray());
        web.Pages["https://stacha.tech/favicon.ico"] = (HttpStatusCode.OK, "image/x-icon", Png);

        var r = await c.GetAsync($"/api/sites/{Ids.Stacha}/icon");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("image/x-icon", r.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task No_icon_and_unknown_sites_are_404_and_a_miss_is_not_refetched_at_once()
    {
        var (f, c, web) = Start();
        using var _ = f;
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/sites/{Ids.Stacha}/icon")).StatusCode);
        var before = web.Requests.Count;
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/sites/{Ids.Stacha}/icon")).StatusCode);
        Assert.Equal(before, web.Requests.Count);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/api/sites/00000000-0000-0000-0000-000000000000/icon")).StatusCode);
    }
}
