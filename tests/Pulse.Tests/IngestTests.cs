using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Pulse.Api;

namespace Pulse.Tests;

public class IngestTests
{
    static async Task<(PulseFactory F, HttpClient C)> Start()
    {
        var f = new PulseFactory();
        var c = f.CreateClient();
        await c.GetAsync("/healthz"); // boot the host
        return (f, c);
    }

    [Fact]
    public async Task Accepts_a_pageview_and_stores_only_path_and_referrer_host()
    {
        var (f, c) = await Start();
        using var _ = f;
        var res = await c.Send(
            TestExtensions.Pageview(url: "https://stacha.tech/blog/x?utm=secret&email=a@b.cz#frag", extra: new { referrer = "https://www.google.com/search?q=private", title = "Hello", screen = "1440x900", language = "cs-CZ" }),
            headers: [("CF-IPCountry", "CZ"), ("CF-Connecting-IP", "198.51.100.23")]);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("""{"ok":true}""", await res.Content.ReadAsStringAsync());
        var e = Assert.Single(f.Db.Events());
        Assert.Equal(Ids.Stacha, e.SiteId);
        Assert.Equal(1, e.Kind);
        Assert.Null(e.Name);
        Assert.Equal("/blog/x", e.Path);
        Assert.Equal("google.com", e.Referrer);
        Assert.Equal("Hello", e.Title);
        Assert.Equal("CZ", e.Country);
        Assert.Equal(("Chrome", "Windows", "desktop"), (e.Browser, e.Os, e.Device));
        Assert.Equal("1440x900", e.Screen);
        Assert.Equal("cs-CZ", e.Language);
        Assert.Equal(f.Clock.GetUtcNow().ToUnixTimeMilliseconds(), e.Ts);
    }

    [Fact]
    public async Task A_custom_event_has_kind_2_a_truncated_name_and_its_data()
    {
        var (f, c) = await Start();
        using var _ = f;
        var longName = new string('n', 80);
        await c.Send(TestExtensions.Pageview(extra: new { name = "cv_download", data = new { language = "en" } }));
        await c.Send(TestExtensions.Pageview(extra: new { name = longName }));

        var events = f.Db.Events();
        Assert.Equal([2L, 2L], events.Select(e => e.Kind));
        Assert.Equal("cv_download", events[0].Name);
        Assert.Equal("""{"language":"en"}""", events[0].Data);
        Assert.Equal(50, events[1].Name!.Length);
    }

    [Fact]
    public async Task Empty_or_non_string_name_means_pageview()
    {
        var (f, c) = await Start();
        using var _ = f;
        await c.Send(TestExtensions.Pageview(extra: new { name = "" }));
        await c.Send(TestExtensions.Pageview(extra: new { name = 5 }));
        await c.Send(TestExtensions.Pageview(extra: new { name = (string?)null }));
        Assert.All(f.Db.Events(), e => Assert.Equal(1, e.Kind));
        Assert.Equal(3, f.Db.Count("events"));
    }

    [Fact]
    public async Task Event_data_over_2kB_is_dropped_but_the_event_is_kept_and_non_objects_are_ignored()
    {
        var (f, c) = await Start();
        using var _ = f;
        await c.Send(TestExtensions.Pageview(extra: new { name = "big", data = new { blob = new string('x', 2100) } }));
        await c.Send(TestExtensions.Pageview(extra: new { name = "ok", data = new { blob = new string('x', 1900) } }));
        await c.Send(TestExtensions.Pageview(extra: new { name = "arr", data = new[] { 1, 2 } }));

        var events = f.Db.Events();
        Assert.Equal(3, events.Count);
        Assert.Null(events[0].Data);
        Assert.NotNull(events[1].Data);
        Assert.Null(events[2].Data);
    }

    [Fact]
    public async Task Field_limits_truncate()
    {
        var (f, c) = await Start();
        using var _ = f;
        await c.Send(TestExtensions.Pageview(url: "/" + new string('p', 700), extra: new { title = new string('t', 300), language = new string('l', 50), screen = new string('s', 40) }));
        var e = Assert.Single(f.Db.Events());
        Assert.Equal(500, e.Path.Length);
        Assert.Equal(200, e.Title!.Length);
        Assert.Equal(35, e.Language!.Length);
        Assert.Equal(20, e.Screen!.Length);
    }

    [Fact]
    public async Task Identify_is_ignored_with_204()
    {
        var (f, c) = await Start();
        using var _ = f;
        var res = await c.Send(new { type = "identify", payload = new { website = Ids.Stacha, hostname = "stacha.tech", id = "someone", data = new { email = "a@b.cz" } } });
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal(0, f.Db.Count("events"));
    }

    [Theory]
    [InlineData("00000000-0000-0000-0000-000000000000", "stacha.tech")] // unknown site
    [InlineData("not-a-uuid", "stacha.tech")]
    [InlineData(Ids.Stacha, "other.example")] // hostname is not the site's
    [InlineData(Ids.Stacha, "stacha.tech.evil.com")] // suffix trick
    [InlineData(Ids.Stacha, "evilstacha.tech")] // needs a dot before the domain
    [InlineData(Ids.Klettr, "stacha.tech")] // valid host of a different site
    public async Task Drops_with_204(string site, string hostname)
    {
        var (f, c) = await Start();
        using var _ = f;
        var res = await c.Send(TestExtensions.Pageview(site, hostname));
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal(0, f.Db.Count("events"));
    }

    [Fact]
    public async Task Missing_hostname_is_dropped()
    {
        var (f, c) = await Start();
        using var _ = f;
        var res = await c.SendRaw($$$"""{"type":"event","payload":{"website":"{{{Ids.Stacha}}}","url":"/"}}""");
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal(0, f.Db.Count("events"));
    }

    [Theory]
    [InlineData("stacha.tech")]
    [InlineData("www.stacha.tech")]
    [InlineData("WWW.Stacha.Tech")]
    [InlineData("anything.stacha.tech")]
    public async Task Accepts_the_domain_and_its_subdomains(string hostname)
    {
        var (f, c) = await Start();
        using var _ = f;
        var res = await c.Send(TestExtensions.Pageview(hostname: hostname));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(1, f.Db.Count("events"));
    }

    [Theory]
    [InlineData("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")]
    [InlineData("curl/8.4.0")]
    [InlineData("Wget/1.21")]
    [InlineData("python-requests/2.31")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36")]
    [InlineData("Mozilla/5.0 (Linux; Android 11; moto g power) AppleWebKit/537.36 Chrome/109 Mobile Safari/537.36 Chrome-Lighthouse")]
    [InlineData("Pingdom.com_bot_version_1.4")]
    [InlineData("UptimeRobot/2.0")]
    [InlineData("Go-http-client/1.1")]
    [InlineData("Apache-HttpClient/4.5 (Java/17)")]
    [InlineData("okhttp/4.9.0")]
    [InlineData("facebookexternalhit/1.1")]
    [InlineData("Slackbot-LinkExpanding 1.0")]
    [InlineData("Mozilla/5.0 (compatible; YandexBot/3.0)")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64) Gecko Slurp")]
    [InlineData("Mozilla/5.0 (compatible; SiteMonitor/1.0)")]
    [InlineData("Mozilla/5.0 (Macintosh) LinkPreview/1.0")]
    [InlineData("java/1.8")]
    [InlineData("Mozilla/5.0 (compatible; Baiduspider/2.0)")]
    [InlineData("Mozilla/5.0 (compatible; Crawler/1.0)")]
    [InlineData("   ")]
    public async Task Bot_and_blank_user_agents_are_dropped(string ua)
    {
        var (f, c) = await Start();
        using var _ = f;
        var res = await c.Send(TestExtensions.Pageview(), ua);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal(0, f.Db.Count("events"));
    }

    [Fact]
    public async Task A_missing_user_agent_is_dropped()
    {
        var (f, c) = await Start();
        using var _ = f;
        var res = await c.Send(TestExtensions.Pageview(), ua: null);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal(0, f.Db.Count("events"));
    }

    [Theory]
    [InlineData("{oops")]
    [InlineData("")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"text\"")]
    [InlineData("""{"type":"event"}""")] // no payload
    [InlineData("""{"type":"event","payload":"x"}""")]
    [InlineData("""{"type":"event","payload":{"hostname":"stacha.tech","url":"/"}}""")] // no website
    [InlineData("""{"type":"event","payload":{"website":"","hostname":"stacha.tech"}}""")]
    [InlineData("""{"type":"event","payload":{"website":5,"hostname":"stacha.tech"}}""")]
    public async Task Malformed_bodies_or_a_missing_website_are_400(string json)
    {
        var (f, c) = await Start();
        using var _ = f;
        var res = await c.SendRaw(json);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Equal(0, f.Db.Count("events"));
    }

    [Fact]
    public async Task Bodies_over_16kB_are_413_whether_or_not_the_length_is_declared()
    {
        var (f, c) = await Start();
        using var _ = f;
        var padded = $$$"""{"type":"event","payload":{"website":"{{{Ids.Stacha}}}","hostname":"stacha.tech","url":"/","title":"{{{new string('a', 17_000)}}}"}}""";
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await c.SendRaw(padded)).StatusCode);

        // Chunked: no Content-Length, the handler must stop reading by itself.
        var chunked = new HttpRequestMessage(HttpMethod.Post, "/api/send") { Content = new StreamContent(new MemoryStream(Encoding.UTF8.GetBytes(padded))) };
        chunked.Headers.TryAddWithoutValidation("User-Agent", Uas.Chrome);
        chunked.Headers.TransferEncodingChunked = true;
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await c.SendAsync(chunked)).StatusCode);
        Assert.Equal(0, f.Db.Count("events"));
    }

    [Fact]
    public async Task A_body_of_exactly_16kB_is_accepted()
    {
        var (f, c) = await Start();
        using var _ = f;
        var head = $$$"""{"type":"event","payload":{"website":"{{{Ids.Stacha}}}","hostname":"stacha.tech","url":"/"}}""";
        var json = head + new string(' ', 16 * 1024 - head.Length);
        Assert.Equal(16 * 1024, Encoding.UTF8.GetByteCount(json));
        Assert.Equal(HttpStatusCode.OK, (await c.SendRaw(json)).StatusCode);
        Assert.Equal(1, f.Db.Count("events"));
    }

    [Fact]
    public async Task CORS_every_answer_allows_any_origin_and_OPTIONS_is_204_without_credentials()
    {
        var (f, c) = await Start();
        using var _ = f;
        foreach (var res in new[]
                 {
                     await c.Send(TestExtensions.Pageview()), // 200
                     await c.Send(TestExtensions.Pageview("00000000-0000-0000-0000-000000000000")), // 204
                     await c.SendRaw("{oops"), // 400
                 })
        {
            Assert.Equal("*", Assert.Single(res.Headers.GetValues("Access-Control-Allow-Origin")));
            Assert.False(res.Headers.Contains("Access-Control-Allow-Credentials"));
        }

        var pre = await c.SendAsync(new HttpRequestMessage(HttpMethod.Options, "/api/send"));
        Assert.Equal(HttpStatusCode.NoContent, pre.StatusCode);
        Assert.Equal("*", pre.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("POST, OPTIONS", pre.Headers.GetValues("Access-Control-Allow-Methods").Single());
        Assert.Equal("Content-Type", pre.Headers.GetValues("Access-Control-Allow-Headers").Single());
        Assert.False(pre.Headers.Contains("Access-Control-Allow-Credentials"));
    }

    [Fact]
    public async Task Send_does_not_accept_GET()
    {
        var (f, c) = await Start();
        using var _ = f;
        Assert.Contains((await c.GetAsync("/api/send")).StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.MethodNotAllowed });
    }

    [Theory]
    [InlineData("DE", "DE")]
    [InlineData("de", "DE")]
    [InlineData("XX", null)]
    [InlineData("T1", null)]
    [InlineData("ZZZ", null)]
    [InlineData("1A", null)]
    [InlineData("", null)]
    public async Task Country_comes_from_CF_IPCountry(string header, string? expected)
    {
        var (f, c) = await Start();
        using var _ = f;
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-IPCountry", header));
        Assert.Equal(expected, Assert.Single(f.Db.Events()).Country);
    }

    [Fact]
    public async Task Country_is_null_without_the_header()
    {
        var (f, c) = await Start();
        using var _ = f;
        await c.Send(TestExtensions.Pageview());
        Assert.Null(Assert.Single(f.Db.Events()).Country);
    }

    [Theory]
    [InlineData("https://stacha.tech/blog", null)] // own host
    [InlineData("https://www.stacha.tech/", null)] // own host with www
    [InlineData("https://www.google.com/search?q=x", "google.com")]
    [InlineData("http://news.ycombinator.com/item?id=1#c", "news.ycombinator.com")]
    [InlineData("https://t.co/abc", "t.co")]
    [InlineData("android-app://com.google.android.gm", null)]
    [InlineData("not a url", null)]
    [InlineData("", null)]
    public async Task Referrer_is_reduced_to_a_host_and_none_for_the_own_host(string referrer, string? expected)
    {
        var (f, c) = await Start();
        using var _ = f;
        await c.Send(TestExtensions.Pageview(extra: new { referrer }));
        Assert.Equal(expected, Assert.Single(f.Db.Events()).Referrer);
    }

    [Fact]
    public async Task A_site_added_through_the_API_accepts_hits_without_a_restart()
    {
        var (f, c) = await Start();
        using var _ = f;
        var site = await (await c.PostAsJsonAsync("/api/sites", new { name = "Demo", domain = "demo.example" })).Content.ReadFromJsonAsync<JsonElement>();
        var res = await c.Send(TestExtensions.Pageview(site.GetProperty("id").GetString()!, "demo.example"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(1, f.Db.Count("events"));
    }

    [Fact]
    public async Task Ingestion_is_public_even_when_the_dashboard_requires_Access()
    {
        using var f = new PulseFactory
        {
            Settings = new() { ["PULSE_ACCESS_TEAM_DOMAIN"] = "t.cloudflareaccess.com", ["PULSE_ACCESS_AUD"] = "aud" },
        };
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await c.Send(TestExtensions.Pageview())).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.SendAsync(new HttpRequestMessage(HttpMethod.Options, "/api/send"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/sites")).StatusCode);
    }
}
