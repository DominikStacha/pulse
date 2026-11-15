using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.Sqlite;

namespace Pulse.Api;

public static class Iso
{
    public static string Utc(long ms) => DateTimeOffset.FromUnixTimeMilliseconds(ms).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    public static string Local(long ms, TimeZoneInfo tz) =>
        TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeMilliseconds(ms), tz).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture);
}

public enum Bucket { Hour, Day, Month }

/// <summary>
/// A resolved period: N buckets ending with the one that contains "now", and the N buckets right before them as "previous"
/// (for "today": yesterday from midnight, so 10:00 today compares with 00:00-10:00 yesterday).
/// Starts hold N+1 UTC ms boundaries (the last one is the end of the final bucket). PrevTo is exclusive.
/// </summary>
public sealed record Window(Bucket Bucket, TimeZoneInfo Tz, long NowMs, long[] Starts, long[] PrevStarts, long PrevTo)
{
    public long From => Starts[0];
    public long To => NowMs + 1; // exclusive; includes an event stored in this very millisecond
    public long PrevFrom => PrevStarts[0];
}

public static class Periods
{
    const long HourMs = 3_600_000;

    /// <summary>today | 24h | 7d | 30d | 90d | 12m in a time zone, DST-correct (days are 23/25 h long on switch days). Null for an unknown period.</summary>
    public static Window? Resolve(string period, TimeZoneInfo tz, DateTimeOffset now)
    {
        var nowMs = now.ToUnixTimeMilliseconds();
        var local = TimeZoneInfo.ConvertTime(now, tz);
        var hourStart = nowMs - (local.Minute * 60L + local.Second) * 1000 - local.Millisecond; // start of the current local hour
        Bucket bucket;
        int n;
        DateTime firstLocal = default;
        long firstUtc = 0;
        switch (period)
        {
            case "today":
                bucket = Bucket.Hour;
                firstUtc = ToUtc(local.Date, tz);
                n = (int)((hourStart - firstUtc) / HourMs) + 1;
                break;
            case "24h":
                bucket = Bucket.Hour;
                n = 24;
                firstUtc = hourStart - 23 * HourMs;
                break;
            case "7d" or "30d" or "90d":
                bucket = Bucket.Day;
                n = int.Parse(period[..^1], CultureInfo.InvariantCulture);
                firstLocal = local.Date.AddDays(1 - n);
                break;
            case "12m":
                bucket = Bucket.Month;
                n = 12;
                firstLocal = new DateTime(local.Year, local.Month, 1).AddMonths(-11);
                break;
            default:
                return null;
        }
        var starts = Grid(bucket, firstLocal, firstUtc, 0, n, tz);
        if (period == "today")
        {
            // Same hours of yesterday, up to the same clock time (not the hours just before midnight).
            var prevStarts = Grid(bucket, firstLocal, ToUtc(local.Date.AddDays(-1), tz), 0, n, tz);
            return new Window(bucket, tz, nowMs, starts, prevStarts, ToUtc(local.DateTime.AddDays(-1), tz) + 1);
        }
        return new Window(bucket, tz, nowMs, starts, Grid(bucket, firstLocal, firstUtc, -n, n, tz), starts[0]);
    }

    /// <summary>Boundaries of buckets shift..shift+n-1 (n+1 values). Hours step in UTC, days/months step on the local calendar.</summary>
    static long[] Grid(Bucket b, DateTime firstLocal, long firstUtc, int shift, int n, TimeZoneInfo tz) =>
        [.. Enumerable.Range(shift, n + 1).Select(i => b switch
        {
            Bucket.Hour => firstUtc + i * HourMs,
            Bucket.Day => ToUtc(firstLocal.AddDays(i), tz),
            _ => ToUtc(firstLocal.AddMonths(i), tz),
        })];

    static long ToUtc(DateTime local, TimeZoneInfo tz)
    {
        if (tz.IsInvalidTime(local)) local = local.AddHours(1); // midnight skipped by a DST jump (e.g. America/Havana)
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, tz)).ToUnixTimeMilliseconds();
    }
}

internal sealed class SiteRow { public string Id { get; set; } = ""; public string Name { get; set; } = ""; public string Domain { get; set; } = ""; public long CreatedAt { get; set; } }

public sealed record Site(string Id, string Name, string Domain, string CreatedAt);
public sealed record NewSite(string? Name, string? Domain);
public sealed record Totals(long Visitors, long Visits, long Pageviews, long Events, double BounceRate, double AvgVisitSeconds);
public sealed record RangeInfo(string From, string To, string PreviousFrom, string PreviousTo, string Bucket, string Tz);
public sealed record Summary(RangeInfo Range, Totals Current, Totals Previous);
public sealed record Point(string T, long Visitors, long Visits, long Pageviews);
public sealed record Timeseries(string Bucket, List<Point> Points, List<Point> Previous);
public sealed record BreakdownRow(string? Key, string Label, long Visitors, long Count, double Share);
public sealed record Breakdown(string Dim, long TotalVisitors, List<BreakdownRow> Rows);

/// <summary>Shared query-string handling for the dashboard endpoints.</summary>
public static partial class Q
{
    public sealed record SiteSel(string? Id); // Id null = all sites

    public static IResult Err(int status, string error) => Results.Json(new { error }, statusCode: status);

    /// <summary>`site` = a site id or `all` (default). Null when the id is unknown.</summary>
    public static SiteSel? Site(HttpRequest r, SqliteConnection c)
    {
        var s = r.Query["site"].ToString();
        if (s is "" or "all") return new SiteSel(null);
        return c.ExecuteScalar<long>("SELECT COUNT(*) FROM sites WHERE id = @s", new { s }) > 0 ? new SiteSel(s) : null;
    }

    /// <summary>Uses the (site_id, ts) index for "all" too; params: @site.</summary>
    public static string SiteWhere(string? id) => id is null ? "site_id IN (SELECT id FROM sites)" : "site_id = @site";

    [GeneratedRegex("^[A-Za-z0-9_+/-]{1,64}$")]
    private static partial Regex TzId();

    public static (Window? Window, string? Error) Period(HttpRequest r, TimeProvider clock)
    {
        var tzId = r.Query["tz"].ToString();
        if (tzId == "") tzId = "Europe/Prague";
        TimeZoneInfo tz;
        try
        {
            if (!TzId().IsMatch(tzId) || tzId.Contains("..")) return (null, "invalid tz");
            tz = TimeZoneInfo.FindSystemTimeZoneById(tzId);
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException) { return (null, "invalid tz"); }
        var period = r.Query["period"].ToString();
        var w = Periods.Resolve(period == "" ? "7d" : period, tz, clock.GetUtcNow());
        return w is null ? (null, "invalid period (today|24h|7d|30d|90d|12m)") : (w, null);
    }
}
