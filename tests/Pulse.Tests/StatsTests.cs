using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Pulse.Api;

namespace Pulse.Tests;

public class StatsTests
{
    static DateTimeOffset Utc(int d, int h, int mi = 0, int s = 0, int month = 11) => new(2026, month, d, h, mi, s, TimeSpan.Zero);

    /// <summary>
    /// "now" is 2026-11-14 12:00 UTC (13:00 Prague). 7d = 8-14 Nov, previous = 1-7 Nov. Hand-computed expectations in the tests below.
    /// Visitor 1: Chrome/Windows/desktop/CZ. Visitor 2: Safari/iOS/mobile/SK. Visitor 3: Firefox/Linux/desktop/US.
    /// </summary>
    static PulseFactory Fixture()
    {
        var f = new PulseFactory();
        f.CreateClient(); // boot
        var db = f.Db;
        void V1(DateTimeOffset at, long visit, int kind = 1, string? name = null, string path = "/", string? referrer = null) =>
            db.Add(Ids.Stacha, at, 1, visit, kind, name, path, referrer, "CZ", "Chrome", "Windows", "desktop", "1920x1080", "cs-CZ");
        void V2(DateTimeOffset at, string path, string? referrer = null) =>
            db.Add(Ids.Stacha, at, 2, 103, 1, null, path, referrer, "SK", "Safari", "iOS", "mobile", "390x844", "sk-SK");

        V1(Utc(14, 10), 101, referrer: "google.com"); // visit 101: pv /, pv /about, event cv_download = 180 s
        V1(Utc(14, 10, 1), 101, path: "/about");
        V1(Utc(14, 10, 3), 101, 2, "cv_download", "/about");
        V1(Utc(14, 11), 102); // visit 102: a bounce
        V2(Utc(13, 9), "/about", "seznam.cz"); // visit 103: 30 s
        V2(Utc(13, 9, 0, 30), "/contact");
        db.Add(Ids.Klettr, Utc(12, 20), 3, 104, 1, null, "/routes", "google.com", "US", "Firefox", "Linux", "desktop", "1440x900", "en-US"); // visit 104: a bounce

        db.Add(Ids.Stacha, Utc(5, 10), 4, 105); // previous window: visit 105, 10 s
        db.Add(Ids.Stacha, Utc(5, 10, 0, 10), 4, 105, path: "/x");
        db.Add(Ids.Klettr, Utc(3, 8), 5, 106); // previous window: visit 106, a bounce
        db.Add(Ids.Stacha, Utc(1, 10, month: 10), 6, 107, path: "/old"); // outside both windows
        return f;
    }

    static void AssertTotals(JsonElement t, long visitors, long visits, long pageviews, long events, double bounce, double avg)
    {
        Assert.Equal(visitors, t.GetProperty("visitors").GetInt64());
        Assert.Equal(visits, t.GetProperty("visits").GetInt64());
        Assert.Equal(pageviews, t.GetProperty("pageviews").GetInt64());
        Assert.Equal(events, t.GetProperty("events").GetInt64());
        Assert.Equal(bounce, t.GetProperty("bounceRate").GetDouble(), 9);
        Assert.Equal(avg, t.GetProperty("avgVisitSeconds").GetDouble(), 9);
    }

    [Fact]
    public async Task Summary_all_sites()
    {
        using var f = Fixture();
        var s = await f.CreateClient().Json("/api/stats/summary?period=7d");
        AssertTotals(s.GetProperty("current"), visitors: 3, visits: 4, pageviews: 6, events: 1, bounce: 0.5, avg: 52.5);
        AssertTotals(s.GetProperty("previous"), visitors: 2, visits: 2, pageviews: 3, events: 0, bounce: 0.5, avg: 5);
        var r = s.GetProperty("range");
        Assert.Equal("2026-11-08T00:00:00+01:00", r.GetProperty("from").GetString());
        Assert.Equal("2026-11-14T13:00:00+01:00", r.GetProperty("to").GetString());
        Assert.Equal("2026-11-01T00:00:00+01:00", r.GetProperty("previousFrom").GetString());
        Assert.Equal("2026-11-08T00:00:00+01:00", r.GetProperty("previousTo").GetString());
        Assert.Equal("day", r.GetProperty("bucket").GetString());
        Assert.Equal("Europe/Prague", r.GetProperty("tz").GetString());
    }

    [Fact]
    public async Task Summary_per_site_and_the_default_is_all_sites_over_7d()
    {
        using var f = Fixture();
        var c = f.CreateClient();
        var stacha = await c.Json($"/api/stats/summary?site={Ids.Stacha}&period=7d");
        AssertTotals(stacha.GetProperty("current"), 2, 3, 5, 1, 1.0 / 3, 70);
        AssertTotals(stacha.GetProperty("previous"), 1, 1, 2, 0, 0, 10);
        var klettr = await c.Json($"/api/stats/summary?site={Ids.Klettr}");
        AssertTotals(klettr.GetProperty("current"), 1, 1, 1, 0, 1, 0);
        AssertTotals(klettr.GetProperty("previous"), 1, 1, 1, 0, 1, 0);
        var none = await c.Json($"/api/stats/summary?site={Ids.Spanel}");
        AssertTotals(none.GetProperty("current"), 0, 0, 0, 0, 0, 0);

        var byDefault = await c.Json("/api/stats/summary");
        Assert.Equal("day", byDefault.GetProperty("range").GetProperty("bucket").GetString());
        AssertTotals(byDefault.GetProperty("current"), 3, 4, 6, 1, 0.5, 52.5);
    }

    [Fact]
    public async Task Summary_for_today_and_24h_only_counts_inside_the_window()
    {
        using var f = Fixture();
        var c = f.CreateClient();
        AssertTotals((await c.Json("/api/stats/summary?period=today")).GetProperty("current"), 1, 2, 3, 1, 0.5, 90);
        AssertTotals((await c.Json("/api/stats/summary?period=24h")).GetProperty("current"), 1, 2, 3, 1, 0.5, 90); // visit 103 is 13 Nov 10:00 Prague, older than 13:00 -24h
        AssertTotals((await c.Json("/api/stats/summary?period=30d")).GetProperty("current"), 5, 6, 9, 1, 3.0 / 6, (180 + 0 + 30 + 0 + 10 + 0) / 6.0); // bounces: visits 102, 104, 106
    }

    [Fact]
    public async Task Events_after_now_are_not_counted()
    {
        using var f = Fixture();
        var c = f.CreateClient();
        f.Db.Add(Ids.Stacha, Utc(14, 12, 0, 1), 9, 999); // one second in the future
        AssertTotals((await c.Json("/api/stats/summary?period=7d")).GetProperty("current"), 3, 4, 6, 1, 0.5, 52.5);
        Assert.Equal(6, (await c.Json("/api/stats/timeseries?period=7d")).GetProperty("points").EnumerateArray().Sum(p => p.GetProperty("pageviews").GetInt64()));
    }

    [Fact]
    public async Task Timeseries_has_equal_length_series_with_zeros_and_counts_distinct_visitors_and_visits_per_bucket()
    {
        using var f = Fixture();
        var json = await f.CreateClient().Json("/api/stats/timeseries?period=7d");
        Assert.Equal("day", json.GetProperty("bucket").GetString());
        var points = json.GetProperty("points").EnumerateArray().ToArray();
        var previous = json.GetProperty("previous").EnumerateArray().ToArray();
        Assert.Equal(7, points.Length);
        Assert.Equal(7, previous.Length);

        (long Visitors, long Visits, long Pageviews) At(JsonElement[] a, int i) =>
            (a[i].GetProperty("visitors").GetInt64(), a[i].GetProperty("visits").GetInt64(), a[i].GetProperty("pageviews").GetInt64());
        Assert.Equal("2026-11-08T00:00:00+01:00", points[0].GetProperty("t").GetString());
        Assert.Equal("2026-11-14T00:00:00+01:00", points[6].GetProperty("t").GetString());
        Assert.Equal("2026-11-01T00:00:00+01:00", previous[0].GetProperty("t").GetString());
        Assert.Equal(new (long, long, long)[] { (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0), (1, 1, 1), (1, 1, 2), (1, 2, 3) }, Enumerable.Range(0, 7).Select(i => At(points, i)));
        Assert.Equal(new (long, long, long)[] { (0, 0, 0), (0, 0, 0), (1, 1, 1), (0, 0, 0), (1, 1, 2), (0, 0, 0), (0, 0, 0) }, Enumerable.Range(0, 7).Select(i => At(previous, i)));
    }

    [Fact]
    public async Task Timeseries_per_site_and_hourly()
    {
        using var f = Fixture();
        var c = f.CreateClient();
        var klettr = await c.Json($"/api/stats/timeseries?period=7d&site={Ids.Klettr}");
        Assert.Equal(1, klettr.GetProperty("points").EnumerateArray().Sum(p => p.GetProperty("pageviews").GetInt64()));

        var today = await c.Json("/api/stats/timeseries?period=today");
        Assert.Equal("hour", today.GetProperty("bucket").GetString());
        var hours = today.GetProperty("points").EnumerateArray().ToArray();
        Assert.Equal(14, hours.Length); // 00:00 ... 13:00 Prague
        Assert.Equal("2026-11-14T11:00:00+01:00", hours[11].GetProperty("t").GetString());
        Assert.Equal(2, hours[11].GetProperty("pageviews").GetInt64()); // 11:00 and 11:01 (the 11:03 custom event is not a pageview)
        Assert.Equal(1, hours[12].GetProperty("pageviews").GetInt64());
        Assert.Equal(1, hours[11].GetProperty("visitors").GetInt64());
        Assert.Equal(1, hours[11].GetProperty("visits").GetInt64());
    }

    sealed record R(string? Key, string Label, long Visitors, long Count, double Share);

    static async Task<(long Total, R[] Rows)> Breakdown(HttpClient c, string query)
    {
        var json = await c.Json("/api/stats/breakdown?" + query);
        return (json.GetProperty("totalVisitors").GetInt64(),
            [.. json.GetProperty("rows").EnumerateArray().Select(r => new R(
                r.GetProperty("key").ValueKind == JsonValueKind.Null ? null : r.GetProperty("key").GetString(),
                r.GetProperty("label").GetString()!, r.GetProperty("visitors").GetInt64(), r.GetProperty("count").GetInt64(), r.GetProperty("share").GetDouble()))]);
    }

    static void AssertRows(R[] rows, params (string? Key, string Label, long Visitors, long Count)[] expected)
    {
        Assert.Equal(expected.Select(e => (e.Key, e.Label, e.Visitors, e.Count)), rows.Select(r => (r.Key, r.Label, r.Visitors, r.Count)));
    }

    [Fact]
    public async Task Breakdown_pages_entries_exits_referrers()
    {
        using var f = Fixture();
        var c = f.CreateClient();

        var (total, pages) = await Breakdown(c, "dim=pages&period=7d");
        Assert.Equal(3, total);
        AssertRows(pages, ("/about", "/about", 2, 2), ("/", "/", 1, 2), ("/contact", "/contact", 1, 1), ("/routes", "/routes", 1, 1));
        Assert.Equal([2.0 / 3, 1.0 / 3, 1.0 / 3, 1.0 / 3], pages.Select(r => r.Share));

        // First pageview of each visit (visits 101, 102 -> "/", 103 -> "/about", 104 -> "/routes").
        AssertRows((await Breakdown(c, "dim=entries&period=7d")).Rows, ("/", "/", 1, 2), ("/about", "/about", 1, 1), ("/routes", "/routes", 1, 1));
        // Last pageview of each visit: the 10:03 custom event of visit 101 is not a pageview, so its exit is "/about".
        AssertRows((await Breakdown(c, "dim=exits&period=7d")).Rows, ("/", "/", 1, 1), ("/about", "/about", 1, 1), ("/contact", "/contact", 1, 1), ("/routes", "/routes", 1, 1));
        // Referrer of the entry pageview of each visit; null = direct.
        AssertRows((await Breakdown(c, "dim=referrers&period=7d")).Rows, ("google.com", "google.com", 2, 2), (null, "Direct / none", 1, 1), ("seznam.cz", "seznam.cz", 1, 1));
    }

    [Fact]
    public async Task Breakdown_countries_browsers_os_devices_languages_screens()
    {
        using var f = Fixture();
        var c = f.CreateClient();
        AssertRows((await Breakdown(c, "dim=countries&period=7d")).Rows, ("CZ", "Czechia", 1, 3), ("SK", "Slovakia", 1, 2), ("US", "United States", 1, 1));
        AssertRows((await Breakdown(c, "dim=browsers&period=7d")).Rows, ("Chrome", "Chrome", 1, 3), ("Safari", "Safari", 1, 2), ("Firefox", "Firefox", 1, 1));
        AssertRows((await Breakdown(c, "dim=os&period=7d")).Rows, ("Windows", "Windows", 1, 3), ("iOS", "iOS", 1, 2), ("Linux", "Linux", 1, 1));
        AssertRows((await Breakdown(c, "dim=devices&period=7d")).Rows, ("desktop", "desktop", 2, 4), ("mobile", "mobile", 1, 2));
        AssertRows((await Breakdown(c, "dim=languages&period=7d")).Rows, ("cs-CZ", "cs-CZ", 1, 3), ("sk-SK", "sk-SK", 1, 2), ("en-US", "en-US", 1, 1));
        AssertRows((await Breakdown(c, "dim=screens&period=7d")).Rows, ("1920x1080", "1920x1080", 1, 3), ("390x844", "390x844", 1, 2), ("1440x900", "1440x900", 1, 1));
    }

    [Fact]
    public async Task Breakdown_events_and_sites()
    {
        using var f = Fixture();
        var c = f.CreateClient();
        var (total, events) = await Breakdown(c, "dim=events&period=7d");
        Assert.Equal(3, total); // share is relative to all visitors of the range, not only to those who triggered events
        AssertRows(events, ("cv_download", "cv_download", 1, 1));
        Assert.Equal(1.0 / 3, events[0].Share);

        var (_, sites) = await Breakdown(c, "dim=sites&period=7d");
        AssertRows(sites, (Ids.Stacha, "stacha.tech", 2, 5), (Ids.Klettr, "klettr.com", 1, 1));

        AssertRows((await Breakdown(c, $"dim=sites&period=7d&site={Ids.Klettr}")).Rows, (Ids.Klettr, "klettr.com", 1, 1));
    }

    [Fact]
    public async Task Breakdown_respects_the_site_the_period_and_the_limit()
    {
        using var f = Fixture();
        var c = f.CreateClient();
        var (total, klettr) = await Breakdown(c, $"dim=pages&period=7d&site={Ids.Klettr}");
        Assert.Equal(1, total);
        AssertRows(klettr, ("/routes", "/routes", 1, 1));
        Assert.Equal(1.0, klettr[0].Share);

        Assert.Equal(2, (await Breakdown(c, "dim=pages&period=7d&limit=2")).Rows.Length);
        Assert.Single((await Breakdown(c, "dim=pages&period=7d&limit=0")).Rows); // clamped to 1
        Assert.Equal(4, (await Breakdown(c, "dim=pages&period=7d&limit=100000")).Rows.Length);
        Assert.Equal(4, (await Breakdown(c, "dim=pages&period=7d&limit=abc")).Rows.Length); // default 10

        var (prevTotal, none) = await Breakdown(c, "dim=pages&period=today&site=" + Ids.Klettr);
        Assert.Equal(0, prevTotal);
        Assert.Empty(none);
    }

    [Fact]
    public async Task Missing_values_get_an_Unknown_label_and_a_null_key()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        f.Db.Add(Ids.Stacha, Utc(14, 10), 1, 1); // no country / language / screen
        foreach (var dim in new[] { "countries", "languages", "screens" })
        {
            var (_, rows) = await Breakdown(c, $"dim={dim}&period=7d");
            AssertRows(rows, (null, "Unknown", 1, 1));
        }
    }

    [Fact]
    public async Task Summary_numbers_agree_with_the_timeseries_and_breakdown_totals()
    {
        using var f = Fixture();
        var c = f.CreateClient();
        var summary = await c.Json("/api/stats/summary?period=30d");
        var series = (await c.Json("/api/stats/timeseries?period=30d")).GetProperty("points").EnumerateArray().ToArray();
        Assert.Equal(summary.GetProperty("current").GetProperty("pageviews").GetInt64(), series.Sum(p => p.GetProperty("pageviews").GetInt64()));
        Assert.Equal(summary.GetProperty("current").GetProperty("visits").GetInt64(), series.Sum(p => p.GetProperty("visits").GetInt64()));
        var (total, countries) = await Breakdown(c, "dim=countries&period=30d");
        Assert.Equal(summary.GetProperty("current").GetProperty("visitors").GetInt64(), total);
        Assert.Equal(summary.GetProperty("current").GetProperty("pageviews").GetInt64(), countries.Sum(r => r.Count));
    }

    // ---- sites ----

    [Fact]
    public async Task Sites_are_seeded_with_the_six_Umami_ids()
    {
        using var f = new PulseFactory();
        var sites = await f.CreateClient().Json("/api/sites");
        Assert.Equal(
            [("ac198dbf-3b47-41c5-ac40-8b92f6143b8d", "stacha.tech"), ("171ace70-dd73-4c05-a1d4-0c72761da28a", "spanelstinadokapsy.cz"),
             ("a48051f3-1dbf-4f3b-98ed-81f1df584e5e", "new.spanelstinadokapsy.cz"), ("4d7d4cb1-3ab9-4688-aa98-43c45d8e4067", "portal.spanelstinadokapsy.cz"),
             ("9f32713b-d1b8-4632-9793-bcbc561a97dd", "klettr.com"), ("15945b97-945d-4fc8-b287-dc092cfbac3f", "saliny.stacha.tech")],
            sites.EnumerateArray().Select(s => (s.GetProperty("id").GetString()!, s.GetProperty("domain").GetString()!)));
        Assert.All(sites.EnumerateArray(), s =>
        {
            Assert.Equal(s.GetProperty("domain").GetString(), s.GetProperty("name").GetString());
            Assert.True(DateTimeOffset.TryParse(s.GetProperty("createdAt").GetString(), out _));
        });
    }

    [Fact]
    public void Seeding_happens_once_and_PULSE_SEED_SITES_replaces_the_built_in_list()
    {
        var dir = Directory.CreateTempSubdirectory("pulse-seed-").FullName;
        try
        {
            var clock = new FakeClock(DateTimeOffset.UnixEpoch);
            Assert.Equal(6, new Db(Path.Combine(dir, "a.db"), null, clock).Count("sites"));
            var again = new Db(Path.Combine(dir, "a.db"), null, clock); // restart: no duplicates
            Assert.Equal(6, again.Count("sites"));

            var custom = new Db(Path.Combine(dir, "b.db"), """[{"id":"11111111-1111-1111-1111-111111111111","name":"Mine","domain":"MINE.example"}]""", clock);
            Assert.Equal(["mine.example"], custom.Rows<string>("SELECT domain FROM sites"));
            Assert.ThrowsAny<JsonException>(() => new Db(Path.Combine(dir, "c.db"), "{not json", clock));
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); Directory.Delete(dir, true); }
    }

    [Fact]
    public async Task Adding_a_site_validates_and_normalises_the_domain()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        var ok = await c.PostAsJsonAsync("/api/sites", new { name = "  My Blog ", domain = " Blog.Example.ORG " });
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        var site = await ok.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("My Blog", site.GetProperty("name").GetString());
        Assert.Equal("blog.example.org", site.GetProperty("domain").GetString());
        Assert.True(Guid.TryParse(site.GetProperty("id").GetString(), out _));
        Assert.Equal(7, (await c.Json("/api/sites")).GetArrayLength());

        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsJsonAsync("/api/sites", new { name = "Again", domain = "blog.example.org" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsJsonAsync("/api/sites", new { name = "Seeded", domain = "klettr.com" })).StatusCode);

        foreach (var bad in new[] { "https://x.com", "x.com/path", "x.com:8080", "localhost:3000", "single", "-bad.com", "bad-.com", "x..com", "with space.com", "", "x.123", "a@b.com", "*.x.com", new string('a', 64) + ".com" })
            Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/sites", new { name = "N", domain = bad })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/sites", new { name = "", domain = "ok.example" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/sites", new { name = new string('n', 101), domain = "ok.example" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/sites", new { domain = "ok.example" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/sites", new StringContent("", System.Text.Encoding.UTF8, "application/json"))).StatusCode);
        Assert.Equal(7, (await c.Json("/api/sites")).GetArrayLength());
    }

    // ---- live ----

    [Fact]
    public async Task Live_snapshot_counts_visitors_of_the_last_five_minutes_and_lists_the_newest_hits_first()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        f.Db.Add(Ids.Stacha, Utc(14, 11, 40), 9, 9, path: "/old"); // too old
        f.Db.Add(Ids.Stacha, Utc(14, 11, 54, 59), 8, 8, path: "/just-too-old");
        f.Db.Add(Ids.Stacha, Utc(14, 11, 55, 1), 1, 1, path: "/a", country: "CZ", referrer: "google.com");
        f.Db.Add(Ids.Stacha, Utc(14, 11, 57), 1, 1, 2, "cv_download", "/a"); // same visitor again: counted once
        f.Db.Add(Ids.Stacha, Utc(14, 11, 58), 2, 2, path: "/b");
        f.Db.Add(Ids.Klettr, Utc(14, 11, 59), 3, 3, path: "/routes", browser: "Safari", os: "iOS", device: "mobile");
        f.Db.Add(Ids.Klettr, Utc(14, 12, 1), 4, 4, path: "/future"); // not yet "now": still counted, the window is open-ended

        var live = await c.Json("/api/live");
        Assert.Equal(4, live.GetProperty("activeVisitors").GetInt64());
        var perSite = live.GetProperty("perSite").EnumerateArray().Select(s => (s.GetProperty("siteId").GetString()!, s.GetProperty("active").GetInt64())).ToArray();
        Assert.Equal(6, perSite.Length);
        Assert.Equal((Ids.Klettr, 2), perSite[0]); // visitors 3 and 4
        Assert.Equal((Ids.Stacha, 2), perSite[1]); // visitors 1 and 2
        Assert.All(perSite.Skip(2), s => Assert.Equal(0, s.Item2));

        var recent = live.GetProperty("recent").EnumerateArray().ToArray();
        Assert.Equal(["/future", "/routes", "/b", "/a", "/a", "/just-too-old", "/old"], recent.Select(r => r.GetProperty("path").GetString()));
        var hit = recent[4]; // the pageview; recent[3] is the custom event of the same visitor
        Assert.Equal(["siteId", "ts", "kind", "name", "path", "country", "browser", "os", "device", "referrer"], hit.EnumerateObject().Select(p => p.Name));
        Assert.Equal("pageview", hit.GetProperty("kind").GetString());
        Assert.Equal("2026-11-14T11:55:01.000Z", hit.GetProperty("ts").GetString());
        Assert.Equal("google.com", hit.GetProperty("referrer").GetString());
        Assert.Equal("event", recent[3].GetProperty("kind").GetString());
        Assert.Equal("cv_download", recent[3].GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, recent[1].GetProperty("name").ValueKind);
    }

    [Fact]
    public async Task Live_recent_is_capped_at_50_and_can_be_limited_to_one_site()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        for (var i = 0; i < 60; i++) f.Db.Add(i % 2 == 0 ? Ids.Stacha : Ids.Klettr, Utc(14, 11, 0, i), i, i, path: "/p" + i);

        var all = (await c.Json("/api/live")).GetProperty("recent").EnumerateArray().ToArray();
        Assert.Equal(50, all.Length);
        Assert.Equal("/p59", all[0].GetProperty("path").GetString());
        Assert.Equal("/p10", all[^1].GetProperty("path").GetString());

        var klettr = await c.Json("/api/live?site=" + Ids.Klettr);
        Assert.Equal(30, klettr.GetProperty("recent").GetArrayLength());
        Assert.All(klettr.GetProperty("recent").EnumerateArray(), r => Assert.Equal(Ids.Klettr, r.GetProperty("siteId").GetString()));
        Assert.Equal("/p59", klettr.GetProperty("recent")[0].GetProperty("path").GetString());
        Assert.Equal(Ids.Klettr, Assert.Single(klettr.GetProperty("perSite").EnumerateArray()).GetProperty("siteId").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/api/live?site=nope")).StatusCode);
    }

    [Fact]
    public async Task Live_stream_pushes_a_hit_event_for_every_stored_event_without_visitor_or_visit_ids()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var res = await c.GetAsync("/api/live/stream", HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal("text/event-stream", res.Content.Headers.ContentType!.MediaType);
        Assert.Contains("no-cache", res.Headers.CacheControl!.ToString());
        using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(cts.Token));
        Assert.Equal("retry: 3000", await reader.ReadLineAsync(cts.Token));

        await c.Send(TestExtensions.Pageview(url: "/live-test", extra: new { referrer = "https://www.google.com/" }), Uas.IPhone, ("CF-IPCountry", "SK"));
        await c.Send(TestExtensions.Pageview(extra: new { name = "cv_download" }));

        var events = new List<string>();
        var data = new List<JsonElement>();
        while (data.Count < 2)
        {
            var line = await reader.ReadLineAsync(cts.Token);
            if (line is null) break;
            if (line.StartsWith("event: ")) events.Add(line[7..]);
            if (line.StartsWith("data: ")) data.Add(JsonDocument.Parse(line[6..]).RootElement.Clone());
        }
        Assert.Equal(["hit", "hit"], events);
        Assert.Equal(["siteId", "ts", "kind", "name", "path", "country", "browser", "os", "device", "referrer"], data[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal("/live-test", data[0].GetProperty("path").GetString());
        Assert.Equal("pageview", data[0].GetProperty("kind").GetString());
        Assert.Equal("SK", data[0].GetProperty("country").GetString());
        Assert.Equal("iOS", data[0].GetProperty("os").GetString());
        Assert.Equal("google.com", data[0].GetProperty("referrer").GetString());
        Assert.Equal("event", data[1].GetProperty("kind").GetString());
        Assert.Equal("cv_download", data[1].GetProperty("name").GetString());
    }

    [Fact]
    public async Task Live_stream_can_be_limited_to_one_site_and_dropped_hits_are_not_broadcast()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var res = await c.GetAsync("/api/live/stream?site=" + Ids.Klettr, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(cts.Token));
        await reader.ReadLineAsync(cts.Token); // retry

        await c.Send(TestExtensions.Pageview(url: "/stacha")); // other site
        await c.Send(TestExtensions.Pageview(url: "/bot"), "curl/8"); // dropped
        await c.Send(TestExtensions.Pageview(Ids.Klettr, "klettr.com", "/klettr"));

        string? line;
        do line = await reader.ReadLineAsync(cts.Token); while (line is not null && !line.StartsWith("data: "));
        Assert.Equal("/klettr", JsonDocument.Parse(line![6..]).RootElement.GetProperty("path").GetString());
    }
}
