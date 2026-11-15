using Microsoft.AspNetCore.RateLimiting;
using Dapper;
using Pulse.Api;

var builder = WebApplication.CreateBuilder(args);

// Container default: port 3000 (nginx and the Cloudflare tunnel address analytics-umami:3000). Any explicit setting wins.
if (new[] { "ASPNETCORE_URLS", "ASPNETCORE_HTTP_PORTS", "ASPNETCORE_HTTPS_PORTS", "urls" }.All(k => builder.Configuration[k] is null))
    builder.WebHost.UseUrls("http://+:3000");
builder.WebHost.ConfigureKestrel(o =>
{
    o.AddServerHeader = false;
    o.Limits.MaxRequestBodySize = 64 * 1024; // /api/send enforces 16 kB itself; this is the outer bound for everything else
});

// Settings are read lazily (inside factories / after Build) so test hosts and env vars all see the final configuration.
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp =>
{
    var cfg = sp.GetRequiredService<IConfiguration>();
    var isDev = sp.GetRequiredService<IHostEnvironment>().IsDevelopment();
    return new Db(cfg["Pulse:DbPath"] ?? (isDev ? "pulse-dev.db" : "/data/pulse.db"), cfg["PULSE_SEED_SITES"], sp.GetRequiredService<TimeProvider>());
});
builder.Services.AddSingleton<Salts>();
builder.Services.AddSingleton<LiveHub>();
builder.Services.AddSingleton<Events>();
builder.Services.AddSingleton<Access>();
builder.Services.AddHttpClient("jwks", c => c.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddHttpClient("icons", c =>
{
    c.Timeout = TimeSpan.FromSeconds(5);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("Pulse-icons/1.0");
}).ConfigurePrimaryHttpMessageHandler(Icons.Handler);
builder.Services.AddHostedService<Retention>();
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    var perSecond = builder.Configuration.GetValue("Pulse:IngestPerSecond", 30);
    // ponytail: one global window for all sites; per-site limits if one noisy site ever starves the others.
    o.AddFixedWindowLimiter(Ingest.RateLimit, w => { w.PermitLimit = perSecond; w.Window = TimeSpan.FromSeconds(1); w.QueueLimit = 0; });
});
var demo = args.Length > 0 && args[0] == "seed-demo";
if (demo && args.Contains("--live")) builder.Services.AddHostedService<Demo.Live>();

var app = builder.Build();
var dev = app.Environment.IsDevelopment();
var access = app.Services.GetRequiredService<Access>();
// Fail closed: outside Development the dashboard API must have Cloudflare Access configured, no matter what else is set.
if (!dev && !access.Configured)
    throw new InvalidOperationException("PULSE_ACCESS_TEAM_DOMAIN and PULSE_ACCESS_AUD are required outside Development; refusing to start.");
var authDisabled = dev && app.Configuration.GetValue<bool>("Pulse:Auth:Disabled"); // honoured in Development only
if (dev && !authDisabled && !access.Configured)
    app.Logger.LogWarning("Cloudflare Access is not configured: every /api request except /api/send will get 401. Set Pulse:Auth:Disabled=true for local work.");

var db = app.Services.GetRequiredService<Db>(); // creates the schema, seeds the sites

if (demo)
{
    if (!dev) throw new InvalidOperationException("seed-demo only runs in the Development environment.");
    int Arg(string name, int fallback) => Array.IndexOf(args, name) is >= 0 and var i && i + 1 < args.Length && int.TryParse(args[i + 1], out var v) ? v : fallback;
    var live = args.Contains("--live");
    var days = Arg("--days", live ? 0 : 120);
    if (days > 0) Demo.Seed(db, app.Services.GetRequiredService<TimeProvider>(), days, args.Contains("--reset"));
    if (!live) return;
}

// Defence in depth for the dashboard (no XSS sink is known): no inline script, no framing, favicons from https only.
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h.ContentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
                              "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'";
    h.XContentTypeOptions = "nosniff";
    h["Referrer-Policy"] = "no-referrer";
    await next();
});
app.UseRateLimiter();

// --- dashboard API: Cloudflare Access JWT, except the public ingestion endpoint ---
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path;
    if (path.StartsWithSegments("/api") && !path.Equals("/api/send", StringComparison.OrdinalIgnoreCase))
    {
        ctx.Response.Headers.CacheControl = "no-store";
        if (!authDisabled && !await access.IsValid(ctx.Request.Headers["Cf-Access-Jwt-Assertion"].ToString(), ctx.RequestAborted))
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await ctx.Response.WriteAsJsonAsync(new { error = "unauthorized" });
            return;
        }
    }
    await next();
});

var htmlNoCache = new StaticFileOptions
{
    OnPrepareResponse = c => { if (c.File.Name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)) c.Context.Response.Headers.CacheControl = "no-cache"; },
};
app.UseStaticFiles(htmlNoCache);

app.MapGet("/healthz", () =>
{
    try { using var c = db.Open(); c.ExecuteScalar<long>("SELECT 1"); return Results.Text("ok"); }
    catch (Exception) { return Results.Text("db unavailable", statusCode: 503); }
});

// The tracker is a plain file in /tracker, copied next to the dll by the csproj (and by the Docker build).
var scriptPath = Path.Combine(AppContext.BaseDirectory, "script.js");
app.MapGet("/script.js", (HttpContext ctx) =>
{
    if (!File.Exists(scriptPath)) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "public, max-age=3600";
    return Results.File(scriptPath, "text/javascript; charset=utf-8");
});

app.MapIngest();

var api = app.MapGroup("/api");
api.MapDashboard();
api.MapIcons();
api.MapLive();

// Pi health snapshots written by the collector (status.json, history.json), passed through verbatim.
var statusDir = app.Configuration["Pulse:StatusDir"] ?? "/status";
async Task<IResult> StatusFile(string name)
{
    try { return Results.Bytes(await File.ReadAllBytesAsync(Path.Combine(statusDir, name)), "application/json"); }
    catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException or UnauthorizedAccessException or IOException)
    {
        return Q.Err(503, $"{name} is not available");
    }
}
api.MapGet("/status", () => StatusFile("status.json"));
api.MapGet("/status/history", () => StatusFile("history.json"));

// SPA: every extension-less path that matched nothing falls back to index.html, except /api/* (404, never HTML).
// A missing file such as /assets/x.js stays a real 404.
api.MapFallback(() => Results.NotFound());
app.MapFallbackToFile("index.html", htmlNoCache);

app.Run();

public partial class Program;
