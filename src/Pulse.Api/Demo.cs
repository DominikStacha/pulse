using System.Globalization;
using Dapper;

namespace Pulse.Api;

/// <summary>
/// Development-only demo data: `dotnet run -- seed-demo --days 120 [--reset]` fills the DB with SYNTHETIC history,
/// `dotnet run -- seed-demo --live` (add `--days N` to seed first) keeps adding a hit every few seconds while the API runs.
/// Everything here is invented: made-up user agents, documentation-range IPs (RFC 5737), random ids. Never real data.
/// </summary>
public static class Demo
{
    sealed record Profile(string Ua, string Screen, double Weight);
    sealed record DemoSite(string Domain, double PerDay, double Weekend, double CzFactor, bool Evening, (string Path, double W)[] Pages, string[] Events, (string? Host, double W)[] Refs);
    sealed class Persona(long id, Profile profile, string country, string language) { public long Id = id; public Profile Profile = profile; public string Country = country; public string Language = language; public long LastEnd; }
    sealed record Rec(string SiteId, long Ts, long Visitor, long Visit, int Kind, string? Name, string Path, string? Title, string? Referrer, string? Country,
        string Browser, string Os, string Device, string? Screen, string? Language, string? Data);

    const string Chrome = "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0";
    static readonly Profile[] Profiles =
    [
        new($"Mozilla/5.0 (Windows NT 10.0; Win64; x64) {Chrome} Safari/537.36", "1920x1080", 18),
        new($"Mozilla/5.0 (Windows NT 10.0; Win64; x64) {Chrome} Safari/537.36", "1536x864", 10),
        new($"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) {Chrome} Safari/537.36", "1440x900", 8),
        new("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "1512x982", 7),
        new("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0", "1920x1080", 6),
        new("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "1920x1200", 3),
        new($"Mozilla/5.0 (Windows NT 10.0; Win64; x64) {Chrome} Safari/537.36 Edg/130.0.0.0", "1920x1080", 6),
        new($"Mozilla/5.0 (X11; Linux x86_64) {Chrome} Safari/537.36", "2560x1440", 2),
        new($"Mozilla/5.0 (Windows NT 10.0; Win64; x64) {Chrome} Safari/537.36 OPR/115.0.0.0", "1920x1080", 1),
        new("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "390x844", 14),
        new("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "393x852", 8),
        new("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1", "390x844", 3),
        new($"Mozilla/5.0 (Linux; Android 14; Pixel 8) {Chrome} Mobile Safari/537.36", "412x915", 10),
        new($"Mozilla/5.0 (Linux; Android 14; SM-S918B) {Chrome} Mobile Safari/537.36", "360x800", 6),
        new("Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "360x780", 3),
        new("Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0", "393x851", 1),
        new("Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "820x1180", 3),
        new($"Mozilla/5.0 (Linux; Android 13; SM-X710) {Chrome} Safari/537.36", "800x1280", 1),
    ];

    static readonly (string Country, string[] Langs, double W)[] Geo =
    [
        ("CZ", ["cs-CZ", "cs", "en-US"], 62), ("SK", ["sk-SK", "cs-CZ"], 9), ("DE", ["de-DE", "en-US"], 7), ("US", ["en-US"], 6), ("GB", ["en-GB"], 3),
        ("AT", ["de-AT"], 3), ("PL", ["pl-PL"], 3), ("FR", ["fr-FR"], 2), ("NL", ["nl-NL"], 2), ("CH", ["de-CH"], 1), ("IT", ["it-IT"], 1), ("ES", ["es-ES"], 1),
        ("SE", ["sv-SE"], 1), ("JP", ["ja-JP"], 1), ("IN", ["en-IN"], 1), ("BR", ["pt-BR"], 1), ("CA", ["en-CA"], 1),
    ];

    static readonly (string? Host, double W)[] WebRefs =
        [(null, 40), ("google.com", 28), ("seznam.cz", 8), ("duckduckgo.com", 3), ("bing.com", 3), ("facebook.com", 4), ("instagram.com", 3), ("linkedin.com", 2), ("reddit.com", 1)];
    static readonly (string? Host, double W)[] DevRefs =
        [(null, 35), ("google.com", 25), ("github.com", 14), ("news.ycombinator.com", 6), ("duckduckgo.com", 4), ("linkedin.com", 5), ("reddit.com", 3), ("t.co", 2), ("bing.com", 2)];

    static readonly DemoSite[] Sites =
    [
        new("stacha.tech", 40, 0.8, 0.6, true, [("/", 30), ("/projects", 14), ("/projects/pulse", 8), ("/blog", 10), ("/blog/cloudflare-tunnel", 7), ("/blog/raspberry-pi-nvme", 6), ("/status", 9), ("/cv", 6), ("/contact", 4)], ["cv_download", "contact_click"], DevRefs),
        new("spanelstinadokapsy.cz", 62, 0.55, 1.4, false, [("/", 34), ("/cenik", 16), ("/galerie", 14), ("/kontakt", 10), ("/poptavka", 8), ("/o-nas", 6), ("/reference", 8), ("/materialy/pvc", 4)], ["poptavka_odeslana", "phone_click"], WebRefs),
        new("new.spanelstinadokapsy.cz", 14, 0.6, 1.4, false, [("/", 40), ("/cenik", 14), ("/galerie", 14), ("/kontakt", 10)], ["phone_click"], WebRefs),
        new("portal.spanelstinadokapsy.cz", 9, 0.15, 1.6, false, [("/login", 25), ("/dashboard", 30), ("/orders", 20), ("/orders/1042", 8), ("/orders/1043", 6), ("/profile", 4)], [], [(null, 85), ("google.com", 15)]),
        new("klettr.com", 28, 1.5, 0.35, true, [("/", 30), ("/routes", 22), ("/routes/12", 9), ("/routes/37", 8), ("/gear", 8), ("/download", 12), ("/privacy", 3)], ["app_store_click", "play_store_click", "route_saved"], WebRefs),
        new("saliny.stacha.tech", 12, 1.3, 1.0, true, [("/", 40), ("/mapa", 30), ("/saliny", 14), ("/o-projektu", 6)], ["map_open"], DevRefs),
    ];

    // Local-hour weights (Europe/Prague): daytime peak vs. evening peak.
    static readonly double[] Day = [.3, .2, .15, .12, .12, .2, .5, 1, 1.8, 2.4, 2.8, 3, 2.8, 2.6, 2.6, 2.7, 2.8, 2.6, 2.4, 2.6, 2.8, 2.4, 1.5, .8];
    static readonly double[] Night = [.8, .5, .3, .2, .15, .15, .25, .5, .9, 1.3, 1.6, 1.8, 2, 2, 2.1, 2.2, 2.4, 2.8, 3.2, 3.6, 3.8, 3.4, 2.4, 1.4];

    static readonly (Profile, double)[] ProfileWeights = [.. Profiles.Select(p => (p, p.Weight))];
    static readonly (int, double)[] DayWeights = [.. Day.Select((w, h) => (h, w))];
    static readonly (int, double)[] NightWeights = [.. Night.Select((w, h) => (h, w))];

    static T Pick<T>(Random rng, IReadOnlyList<(T Item, double W)> items)
    {
        var r = rng.NextDouble() * items.Sum(i => i.W);
        foreach (var (item, w) in items) if ((r -= w) < 0) return item;
        return items[^1].Item;
    }

    static int Poisson(Random rng, double mean)
    {
        var u1 = 1 - rng.NextDouble();
        var gauss = Math.Sqrt(-2 * Math.Log(u1)) * Math.Cos(2 * Math.PI * rng.NextDouble());
        return Math.Max(0, (int)Math.Round(mean + gauss * Math.Sqrt(mean)));
    }

    static string Title(string domain, string path) => path == "/" ? domain : $"{domain} {path.Trim('/').Replace('/', ' ')}";

    /// <summary>Writes `days` days of synthetic history up to now. Refuses a DB that already has events unless reset is set.</summary>
    public static void Seed(Db db, TimeProvider clock, int days, bool reset)
    {
        using var c = db.Open();
        if (c.ExecuteScalar<long>("SELECT COUNT(*) FROM events") > 0)
        {
            if (!reset) throw new InvalidOperationException("The database already has events. Use --reset to replace them with demo data.");
            c.Execute("DELETE FROM events");
        }
        var ids = c.Query<(string Id, string Domain)>("SELECT id, domain FROM sites").ToDictionary(s => s.Domain, s => s.Id);
        var prague = TimeZoneInfo.FindSystemTimeZoneById("Europe/Prague");
        var nowMs = clock.GetUtcNow().ToUnixTimeMilliseconds();
        var today = TimeZoneInfo.ConvertTime(clock.GetUtcNow(), prague).Date;
        var rng = new Random(42);
        var pools = new Dictionary<(string, string), List<Persona>>();
        var rows = new List<Rec>();

        for (var d = days - 1; d >= 0; d--)
        {
            var day = today.AddDays(-d);
            var dayStart = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(day, prague)).ToUnixTimeMilliseconds();
            var weekend = day.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday;
            foreach (var site in Sites)
            {
                if (!ids.TryGetValue(site.Domain, out var siteId)) continue;
                var trend = 1 + 0.35 * (days - 1 - d) / Math.Max(1, days - 1);
                var count = Poisson(rng, site.PerDay * (weekend ? site.Weekend : 1) * trend * (0.85 + 0.3 * rng.NextDouble()));
                var hours = site.Evening ? NightWeights : DayWeights;
                var starts = Enumerable.Range(0, count)
                    .Select(_ => dayStart + (long)((Pick(rng, hours) * 60 + rng.NextDouble() * 60) * 60_000))
                    .Where(t => t <= nowMs).Order().ToList();
                var month = day.ToString("yyyy-MM", CultureInfo.InvariantCulture);
                if (!pools.TryGetValue((site.Domain, month), out var pool)) pools[(site.Domain, month)] = pool = [];
                foreach (var start in starts) Visit(rng, rows, site, siteId, pool, start);
            }
        }
        rows.Sort((a, b) => a.Ts.CompareTo(b.Ts)); // insertion order = time order, which "recent" relies on
        using var tx = c.BeginTransaction();
        c.Execute("""
            INSERT INTO events(site_id, ts, visitor, visit, kind, name, path, title, referrer, country, browser, os, device, screen, language, data)
            VALUES (@SiteId, @Ts, @Visitor, @Visit, @Kind, @Name, @Path, @Title, @Referrer, @Country, @Browser, @Os, @Device, @Screen, @Language, @Data)
            """, rows, tx);
        tx.Commit();
        Console.WriteLine($"Seeded {rows.Count} synthetic events over {days} days for {ids.Count} sites.");
    }

    static void Visit(Random rng, List<Rec> rows, DemoSite site, string siteId, List<Persona> pool, long start)
    {
        // 35 % returning persona (if it is not still inside its previous visit), else a new one.
        var person = pool.Count > 0 && rng.NextDouble() < 0.35 ? pool[rng.Next(pool.Count)] : null;
        if (person is null || start - person.LastEnd < Events.VisitGapMs)
        {
            var geo = Pick(rng, Geo.Select(g => (g, g.W * (g.Country == "CZ" ? site.CzFactor : 1))).ToArray());
            person = new Persona(rng.NextInt64(), Pick(rng, ProfileWeights), geo.Country, geo.Langs[rng.Next(geo.Langs.Length)]);
            pool.Add(person);
        }
        var visit = rng.NextInt64();
        var (browser, os, device) = Ua.Parse(person.Profile.Ua, person.Profile.Screen);
        var r = rng.NextDouble();
        var pages = r < .55 ? 1 : r < .75 ? 2 : r < .87 ? 3 : r < .94 ? 4 : rng.Next(5, 9);
        var t = start;
        for (var i = 0; i < pages; i++)
        {
            var path = i == 0 && rng.NextDouble() < 0.45 ? "/" : Pick(rng, site.Pages);
            var referrer = i == 0 ? Pick(rng, site.Refs) : null;
            Rec Make(long ts, int kind, string? name, string? data) =>
                new(siteId, ts, person.Id, visit, kind, name, path, Title(site.Domain, path), referrer, person.Country, browser, os, device, person.Profile.Screen, person.Language, data);
            rows.Add(Make(t, 1, null, null));
            if (site.Events.Length > 0 && rng.NextDouble() < 0.1)
            {
                var name = site.Events[rng.Next(site.Events.Length)];
                rows.Add(Make(t + rng.Next(3_000, 40_000), 2, name, rng.NextDouble() < 0.5 ? $$"""{"source":"{{(rng.NextDouble() < 0.5 ? "hero" : "footer")}}"}""" : null));
            }
            t += rng.Next(8_000, 150_000);
        }
        person.LastEnd = t;
    }

    /// <summary>Stores a synthetic hit every few seconds through the normal ingest path, so the live view and SSE have something to show.</summary>
    public sealed class Live(Events events, Db db) : BackgroundService
    {
        sealed class Visitor
        {
            public required DemoSite Site; public required string SiteId; public required string Ip; public required Profile Profile;
            public required string Country; public required string Language; public DateTime LastHit;
        }

        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            var rng = new Random();
            using (var c = db.Open())
            {
                var ids = c.Query<(string Id, string Domain)>("SELECT id, domain FROM sites").ToDictionary(s => s.Domain, s => s.Id);
                var known = Sites.Where(s => ids.ContainsKey(s.Domain)).Select(s => (s, s.PerDay)).ToArray();
                // 30 invented visitors on documentation-range IPs (RFC 5737), spread over the sites by traffic.
                people = [.. Enumerable.Range(1, 30).Select(i =>
                {
                    var site = Pick(rng, known);
                    var g = Pick(rng, Geo.Select(g => (g, g.W)).ToArray());
                    return new Visitor { Site = site, SiteId = ids[site.Domain], Ip = $"203.0.113.{i}", Profile = Pick(rng, ProfileWeights), Country = g.Country, Language = g.Langs[0] };
                })];
            }
            try
            {
                while (true)
                {
                    await Task.Delay(rng.Next(1500, 5000), ct);
                    var v = people[rng.Next(people.Length)];
                    var returning = DateTime.UtcNow - v.LastHit < TimeSpan.FromMinutes(5);
                    v.LastHit = DateTime.UtcNow;
                    var path = rng.NextDouble() < (returning ? 0.2 : 0.5) ? "/" : Pick(rng, v.Site.Pages);
                    var name = returning && v.Site.Events.Length > 0 && rng.NextDouble() < 0.15 ? v.Site.Events[rng.Next(v.Site.Events.Length)] : null;
                    var (browser, os, device) = Ua.Parse(v.Profile.Ua, v.Profile.Screen);
                    var referrer = returning ? null : Pick(rng, v.Site.Refs);
                    events.Store(new NewEvent(v.SiteId, name, path, Title(v.Site.Domain, path), referrer, v.Country, browser, os, device, v.Profile.Screen, v.Language, null), v.Ip, v.Profile.Ua);
                }
            }
            catch (OperationCanceledException) { }
        }

        Visitor[] people = [];
    }
}
