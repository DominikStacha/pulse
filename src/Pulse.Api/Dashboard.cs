using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.Sqlite;

namespace Pulse.Api;

/// <summary>Sites and stats endpoints. All metrics are raw SQL over `events`; time-zone bucketing happens in C# (see Periods).</summary>
public static partial class Dashboard
{
    sealed class Hit { public long Ts { get; set; } public long Visitor { get; set; } public long Visit { get; set; } public long Kind { get; set; } }
    sealed class Agg { public string? K { get; set; } public long Visitors { get; set; } public long Cnt { get; set; } }

    static Site ToSite(SiteRow r) => new(r.Id, r.Name, r.Domain, Iso.Utc(r.CreatedAt));

    [GeneratedRegex(@"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$")]
    private static partial Regex HostName();

    const string TotalsSql = """
        WITH e AS (SELECT visitor, visit, kind, ts FROM events WHERE {where} AND ts >= @from AND ts < @to),
             v AS (SELECT COUNT(*) AS n, MAX(ts) - MIN(ts) AS dur FROM e GROUP BY visit)
        SELECT (SELECT COUNT(DISTINCT visitor) FROM e) AS Visitors,
               (SELECT COUNT(*) FROM v) AS Visits,
               (SELECT COUNT(*) FROM e WHERE kind = 1) AS Pageviews,
               (SELECT COUNT(*) FROM e WHERE kind = 2) AS Events,
               (SELECT COALESCE(AVG(n = 1), 0.0) FROM v) AS BounceRate,
               (SELECT COALESCE(AVG(dur), 0.0) / 1000.0 FROM v) AS AvgVisitSeconds
        """;

    static Totals QueryTotals(SqliteConnection c, string? site, long from, long to) =>
        c.QuerySingle<Totals>(TotalsSql.Replace("{where}", Q.SiteWhere(site)), new { site, from, to });

    /// <summary>One pass over the rows of the range; each row goes to its bucket by binary search over the DST-correct boundaries.</summary>
    static List<Point> Series(SqliteConnection c, string? site, Window w, long[] starts, long to)
    {
        var n = starts.Length - 1;
        var visitors = new HashSet<long>?[n];
        var visits = new HashSet<long>?[n];
        var pageviews = new long[n];
        var rows = c.Query<Hit>(
            $"SELECT ts AS Ts, visitor AS Visitor, visit AS Visit, kind AS Kind FROM events WHERE {Q.SiteWhere(site)} AND ts >= @from AND ts < @to",
            new { site, from = starts[0], to = Math.Min(starts[n], to) }, buffered: false);
        foreach (var r in rows)
        {
            var i = Array.BinarySearch(starts, 0, n, r.Ts);
            if (i < 0) i = ~i - 1;
            (visitors[i] ??= []).Add(r.Visitor);
            (visits[i] ??= []).Add(r.Visit);
            if (r.Kind == 1) pageviews[i]++;
        }
        return [.. Enumerable.Range(0, n).Select(i => new Point(Iso.Local(starts[i], w.Tz), visitors[i]?.Count ?? 0, visits[i]?.Count ?? 0, pageviews[i]))];
    }

    /// <summary>
    /// Rows per dimension. pages/countries/browsers/...: pageviews. entries/exits: first/last pageview of each visit.
    /// referrers: the first pageview of each visit (later pages of a visit have the own host as referrer, which would all read as "direct").
    /// events: custom events. sites: pageviews per site.
    /// </summary>
    static string? BreakdownSql(string dim, string where)
    {
        const string byVisitors = "visitors DESC, cnt DESC";
        string Simple(string col, int kind, string order) =>
            $"SELECT {col} AS k, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS cnt FROM events WHERE kind = {kind} AND {where} AND ts >= @from AND ts < @to GROUP BY {col} ORDER BY {order}, k LIMIT @limit";
        string PerVisit(string col, string dir) =>
            $"""
            SELECT {col} AS k, COUNT(DISTINCT visitor) AS visitors, COUNT(*) AS cnt FROM (
                SELECT path, referrer, visitor, ROW_NUMBER() OVER (PARTITION BY visit ORDER BY ts {dir}, id {dir}) AS rn
                FROM events WHERE kind = 1 AND {where} AND ts >= @from AND ts < @to) WHERE rn = 1
            GROUP BY {col} ORDER BY visitors DESC, cnt DESC, k LIMIT @limit
            """;
        return dim switch
        {
            "pages" => Simple("path", 1, byVisitors),
            "entries" => PerVisit("path", "ASC"),
            "exits" => PerVisit("path", "DESC"),
            "referrers" => PerVisit("referrer", "ASC"),
            "countries" => Simple("country", 1, byVisitors),
            "browsers" => Simple("browser", 1, byVisitors),
            "os" => Simple("os", 1, byVisitors),
            "devices" => Simple("device", 1, byVisitors),
            "languages" => Simple("language", 1, byVisitors),
            "screens" => Simple("screen", 1, byVisitors),
            "events" => Simple("name", 2, "cnt DESC, visitors DESC"),
            "sites" => Simple("site_id", 1, byVisitors),
            _ => null,
        };
    }

    public static void MapDashboard(this RouteGroupBuilder api)
    {
        api.MapGet("/sites", (Db db) =>
        {
            using var c = db.Open();
            return c.Query<SiteRow>("SELECT id AS Id, name AS Name, domain AS Domain, created_at AS CreatedAt FROM sites ORDER BY created_at, rowid").Select(ToSite).ToList();
        });

        api.MapPost("/sites", (NewSite? body, Db db, TimeProvider clock) =>
        {
            var name = body?.Name?.Trim();
            var domain = body?.Domain?.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(name) || name.Length > 100) return Q.Err(400, "name is required (max 100 characters)");
            if (domain is null || (domain != "localhost" && !HostName().IsMatch(domain))) return Q.Err(400, "domain must be a host name like example.com");
            var site = new SiteRow { Id = Guid.NewGuid().ToString(), Name = name, Domain = domain, CreatedAt = clock.GetUtcNow().ToUnixTimeMilliseconds() };
            using var c = db.Open();
            try { c.Execute("INSERT INTO sites(id, name, domain, created_at) VALUES (@Id, @Name, @Domain, @CreatedAt)", site); }
            catch (SqliteException e) when (e.SqliteErrorCode == 19) { return Q.Err(409, "a site with this domain already exists"); } // UNIQUE(domain)
            return Results.Json(ToSite(site), statusCode: 201);
        });

        api.MapGet("/stats/summary", (HttpRequest rq, Db db, TimeProvider clock) =>
        {
            using var c = db.Open();
            if (Q.Site(rq, c) is not { } site) return Q.Err(404, "unknown site");
            var (w, error) = Q.Period(rq, clock);
            if (w is null) return Q.Err(400, error!);
            return Results.Json(new Summary(
                new RangeInfo(Iso.Local(w.From, w.Tz), Iso.Local(w.NowMs, w.Tz), Iso.Local(w.PrevFrom, w.Tz), Iso.Local(w.PrevTo, w.Tz), w.Bucket.ToString().ToLowerInvariant(), w.Tz.Id),
                QueryTotals(c, site.Id, w.From, w.To),
                QueryTotals(c, site.Id, w.PrevFrom, w.PrevTo)));
        });

        api.MapGet("/stats/timeseries", (HttpRequest rq, Db db, TimeProvider clock) =>
        {
            using var c = db.Open();
            if (Q.Site(rq, c) is not { } site) return Q.Err(404, "unknown site");
            var (w, error) = Q.Period(rq, clock);
            if (w is null) return Q.Err(400, error!);
            return Results.Json(new Timeseries(w.Bucket.ToString().ToLowerInvariant(), Series(c, site.Id, w, w.Starts, w.To), Series(c, site.Id, w, w.PrevStarts, long.MaxValue)));
        });

        api.MapGet("/stats/breakdown", (HttpRequest rq, Db db, TimeProvider clock) =>
        {
            var dim = rq.Query["dim"].ToString();
            using var c = db.Open();
            if (Q.Site(rq, c) is not { } site) return Q.Err(404, "unknown site");
            var (w, error) = Q.Period(rq, clock);
            if (w is null) return Q.Err(400, error!);
            if (BreakdownSql(dim, Q.SiteWhere(site.Id)) is not { } sql)
                return Q.Err(400, "invalid dim (pages|entries|exits|referrers|countries|browsers|os|devices|languages|screens|events|sites)");
            var limit = int.TryParse(rq.Query["limit"], out var l) ? Math.Clamp(l, 1, 100) : 10;

            var p = new { site = site.Id, from = w.From, to = w.To, limit };
            var total = c.ExecuteScalar<long>($"SELECT COUNT(DISTINCT visitor) FROM events WHERE {Q.SiteWhere(site.Id)} AND ts >= @from AND ts < @to", p);
            var names = dim == "sites" ? c.Query<SiteRow>("SELECT id AS Id, name AS Name FROM sites").ToDictionary(s => s.Id, s => s.Name) : [];
            string Label(string? k) => k switch
            {
                null => dim == "referrers" ? "Direct / none" : "Unknown",
                _ => dim switch { "countries" => Countries.Name(k), "sites" => names.GetValueOrDefault(k, k), _ => k },
            };
            var rows = c.Query<Agg>(sql, p)
                .Select(a => new BreakdownRow(a.K, Label(a.K), a.Visitors, a.Cnt, total == 0 ? 0 : (double)a.Visitors / total))
                .ToList();
            return Results.Json(new Breakdown(dim, total, rows));
        });
    }
}
