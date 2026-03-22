using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;

// --- Arg parsing helpers ---
string? Get(string prefix) =>
    args.Select(a => a.StartsWith(prefix + "=") ? a[(prefix.Length + 1)..] : null)
        .FirstOrDefault(v => v != null);
bool Has(string flag) => args.Any(a => a == flag);

if (Has("--help"))
{
    Console.WriteLine("Usage: exporter [options]");
    Console.WriteLine();
    Console.WriteLine("Options:");
    Console.WriteLine("  --in=PATH        Game/PAK source directory (default: Steam install path)");
    Console.WriteLine("  --out=PATH       Output directory (default: ~/IcarusExport)");
    Console.WriteLine("  --textures=PATH  Texture filter file — one uasset path per line.");
    Console.WriteLine("                   If omitted, uassets are exported as JSON only.");
    Console.WriteLine("  --log=PATH       Log file (default: ./export.log in working directory)");
    Console.WriteLine("  --max-size=N     Skip uassets larger than N MB (default: 1)");
    Console.WriteLine("  --no-clean       Do not delete the output directory before export");
    Console.WriteLine("  --help           Show this help and exit");
    return;
}

// --- Resolve paths ---
var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

var gamePath = Get("--in") is { } inArg
    ? Path.GetFullPath(inArg)
    : OperatingSystem.IsWindows()
        ? @"C:\Program Files (x86)\Steam\steamapps\common\Icarus"
        : Path.Combine(home, ".local/share/Steam/steamapps/common/Icarus");

var outputPath = Get("--out") is { } outArg
    ? Path.GetFullPath(outArg)
    : Path.Combine(home, "IcarusExport");

var textureListPath = Get("--textures") is { } texArg ? Path.GetFullPath(texArg) : null;

long maxUassetBytes = (long)(double.TryParse(Get("--max-size"), out var mbParsed) ? mbParsed : 1) * 1024 * 1024;

bool noClean = Has("--no-clean");

// Clean before opening the log writer — otherwise Directory.Delete would try to remove the open log file.
bool cleaned = false;
if (!noClean && Directory.Exists(outputPath))
{
    Console.WriteLine($"[{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ}] Cleaning output directory...");
    Directory.Delete(outputPath, recursive: true);
    cleaned = true;
}
Directory.CreateDirectory(outputPath);

var logPath = Get("--log") is { } logArg
    ? Path.GetFullPath(logArg)
    : Path.Combine(Directory.GetCurrentDirectory(), "export.log");

Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
using var logWriter = new StreamWriter(logPath, append: false, encoding: System.Text.Encoding.UTF8);

bool isInteractive = !Console.IsOutputRedirected;

void Log(string message)
{
    var line = $"[{DateTime.UtcNow:yyyy-MM-ddTHH:mm:ssZ}] {message}";
    Console.WriteLine(line);
    logWriter.WriteLine(line);
    logWriter.Flush();
}

// --- Startup config log ---
Log($"Input:    {gamePath}");
Log($"Output:   {outputPath}");
Log($"Log:      {logPath}");
Log($"Textures: {(textureListPath ?? "(none — JSON only)")}");
Log($"Max uasset size: {maxUassetBytes / 1024 / 1024} MB");
if (cleaned) Log("Output directory cleaned.");

// --- Progress bar state ---
var progressWindow = new Queue<(DateTime time, int count)>();
int lastHeartbeat = 0;

static string FormatEta(int seconds)
{
    if (seconds < 60) return $"{seconds}s";
    return $"{seconds / 60}m {seconds % 60}s";
}

void Progress(int current, int total, string currentFile)
{
    if (isInteractive)
    {
        var now = DateTime.UtcNow;
        progressWindow.Enqueue((now, current));
        while (progressWindow.Count > 1 && (now - progressWindow.Peek().time).TotalSeconds > 5)
            progressWindow.Dequeue();

        double filesPerSec = 0;
        if (progressWindow.Count >= 2)
        {
            var (oldestTime, oldestCount) = progressWindow.Peek();
            var span = (now - oldestTime).TotalSeconds;
            if (span > 0) filesPerSec = (current - oldestCount) / span;
        }

        int pct = total > 0 ? (int)(current * 100L / total) : 0;
        int filled = total > 0 ? (int)(current * 20L / total) : 0;
        var bar = new string('█', filled) + new string('░', 20 - filled);

        string eta = filesPerSec > 0.5 ? FormatEta((int)((total - current) / filesPerSec)) : "?";
        string fps = filesPerSec >= 1 ? $"{filesPerSec:N0} f/s" : "-- f/s";
        string prefix = $"[{bar}] {pct,3}% | {current:N0}/{total:N0} | {fps} | ETA {eta} | ";

        int consoleWidth = 120;
        try { consoleWidth = Console.WindowWidth; } catch { }
        int nameWidth = Math.Max(10, consoleWidth - prefix.Length - 1);
        string name = currentFile.Length > nameWidth
            ? currentFile[..nameWidth]
            : currentFile.PadRight(nameWidth);
        Console.Write($"\r{prefix}{name}");
    }
    else if (current - lastHeartbeat >= 1000)
    {
        lastHeartbeat = current;
        Log($"Progress: {current:N0}/{total:N0}");
    }
}

// --- Load texture filter list ---
HashSet<string>? textureList = null;
if (textureListPath != null)
{
    var lines = await File.ReadAllLinesAsync(textureListPath);
    textureList = new HashSet<string>(
        lines.Select(l => l.Trim()).Where(l => l.Length > 0),
        StringComparer.OrdinalIgnoreCase);
    Log($"Loaded {textureList.Count} texture paths from filter file.");
}

// --- Download dependencies ---
using var http = new HttpClient();
http.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0");

// zlib-ng2.dll is required by CUE4Parse to decompress zlib-compressed PAK entries.
var zlibDest = Path.Combine(AppContext.BaseDirectory, "zlib-ng2.dll");
if (!File.Exists(zlibDest))
{
    try
    {
        Log("Downloading zlib-ng2.dll...");
        var zipBytes = await http.GetByteArrayAsync(
            "https://github.com/zlib-ng/zlib-ng/releases/download/2.3.3/zlib-ng-win-x86-64.zip");
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(zipBytes));
        var entry = zip.Entries.FirstOrDefault(e =>
            e.FullName.Contains("bin/", StringComparison.OrdinalIgnoreCase) &&
            e.Name.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) &&
            e.Name.StartsWith("zlib", StringComparison.OrdinalIgnoreCase));
        if (entry != null)
        {
            using var src = entry.Open();
            using var dst = File.Create(zlibDest);
            await src.CopyToAsync(dst);
            Log($"zlib-ng2.dll downloaded (from {entry.FullName}).");
        }
        else Log("WARN: No zlib DLL found in release archive.");
    }
    catch (Exception ex) { Log($"WARN: zlib-ng2.dll download failed: {ex.Message}"); }
}
CUE4Parse.Compression.ZlibHelper.Initialize(zlibDest);
Log("Zlib initialized.");

// Oodle is needed for Oodle-compressed uassets (most game pak content).
var oodleDest = Path.Combine(AppContext.BaseDirectory, "oodle-data-shared.dll");
if (!File.Exists(oodleDest))
{
    try
    {
        Log("Downloading Oodle...");
        var zipBytes = await http.GetByteArrayAsync(
            "https://github.com/WorkingRobot/OodleUE/releases/download/2026-01-25-1223/clang-cl-x64-release.zip");
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(zipBytes));
        var entry = zip.Entries.FirstOrDefault(e =>
            e.FullName.Equals("bin/oodle-data-shared.dll", StringComparison.OrdinalIgnoreCase));
        if (entry != null)
        {
            using var src = entry.Open();
            using var dst = File.Create(oodleDest);
            await src.CopyToAsync(dst);
            Log("Oodle downloaded.");
        }
        else Log("WARN: oodle-data-shared.dll not found in release archive.");
    }
    catch (Exception ex) { Log($"WARN: Oodle download failed: {ex.Message}"); }
}
if (File.Exists(oodleDest))
{
    CUE4Parse.Compression.OodleHelper.Initialize(oodleDest);
    Log("Oodle initialized.");
}
else Log("WARN: Oodle unavailable — Oodle-compressed assets will fail.");

// --- Initialize provider ---
Log("Initializing provider...");

var provider = new DefaultFileProvider(
    gamePath,
    SearchOption.AllDirectories,
    isCaseInsensitive: true,
    versions: new VersionContainer(EGame.GAME_UE4_27)
);

provider.Initialize();

Log($"Loaded PAKs ({provider.UnloadedVfs.Count()} found):");
foreach (var vfs in provider.UnloadedVfs)
    Log($"  {vfs.Path}");

Log("Mounting PAKs...");
provider.Mount();

Log($"Mounted PAKs ({provider.MountedVfs.Count()} mounted):");
foreach (var vfs in provider.MountedVfs)
    Log($"  {vfs.Path}");

var packages = provider.Files.Keys
    .Select(x => x.TrimStart('/').Split('/')[0])
    .Distinct()
    .OrderBy(x => x)
    .ToList();

Log($"Found top-level packages ({packages.Count}):");
foreach (var pkg in packages)
    Log($"  {pkg}");

// --- Build file lists ---

// Total asset size = .uasset + .uexp (the actual export data) + .ubulk (bulk binary data).
// The .uasset header alone is tiny; the real size is in .uexp/.ubulk.
long AssetTotalSize(string uassetKey)
{
    long total = 0;
    foreach (var ext in new[] { ".uasset", ".uexp", ".ubulk" })
    {
        var key = Path.ChangeExtension(uassetKey, ext);
        if (provider.Files.TryGetValue(key, out var gf)) total += gf.Size;
    }
    return total;
}

var uassets = new List<string>();
var skippedUassets = new List<string>();
var skippedByExt = new Dictionary<string, int>();

void TrackSkipped(string file)
{
    var ext = Path.GetExtension(file).ToLowerInvariant();
    if (string.IsNullOrEmpty(ext)) ext = "(no ext)";
    skippedByExt[ext] = skippedByExt.GetValueOrDefault(ext) + 1;
}

foreach (var file in provider.Files.Keys.Where(x => x.EndsWith(".uasset")))
{
    if (AssetTotalSize(file) > maxUassetBytes)
    {
        skippedUassets.Add(file);
        TrackSkipped(file);
    }
    else uassets.Add(file);
}

var rawFiles = provider.Files.Keys.Where(x =>
    !x.EndsWith(".uasset") &&
    !x.EndsWith(".uexp") &&
    !x.EndsWith(".ubulk") &&
    !x.EndsWith(".uptnl") &&
    !x.EndsWith(".umap") &&    // maps are never useful for data mining
    !x.EndsWith(".locmeta") && // handled separately → JSON
    !x.EndsWith(".locres")     // handled separately → JSON
).ToList();

var locFiles = provider.Files.Keys
    .Where(x => x.EndsWith(".locmeta") || x.EndsWith(".locres"))
    .ToList();

Log($"Skipping {skippedUassets.Count} oversized uassets (>{maxUassetBytes / 1024 / 1024} MB), {uassets.Count} remaining.");

int total = uassets.Count + rawFiles.Count + locFiles.Count;
int processed = 0;
int failed = 0;

var successByExt = new Dictionary<string, int>();
var failByExt = new Dictionary<string, int>();
var createdDirs = new HashSet<string>();

void Track(Dictionary<string, int> dict, string file)
{
    var ext = Path.GetExtension(file).ToLowerInvariant();
    if (string.IsNullOrEmpty(ext)) ext = "(no ext)";
    dict[ext] = dict.GetValueOrDefault(ext) + 1;
}

void EnsureDir(string dir)
{
    if (createdDirs.Add(dir))
        Directory.CreateDirectory(dir);
}

Log($"Found {uassets.Count} uassets, {rawFiles.Count} raw files, {locFiles.Count} localization files. Starting export...");
var exportTimer = System.Diagnostics.Stopwatch.StartNew();

// --- Export uassets ---
foreach (var file in uassets)
{
    processed++;
    Progress(processed, total, Path.GetFileName(file));

    try
    {
        var pkg = provider.LoadPackage(file);
        var exports = pkg.GetExports();

        var texture = textureList != null && textureList.Contains(file.TrimStart('/'))
            ? exports.OfType<UTexture2D>().FirstOrDefault()
            : null;
        if (texture != null)
        {
            var ctexture = texture.Decode(4096);
            if (ctexture != null)
            {
                using var ms = new MemoryStream();
                ctexture.Encode(ms, SkiaSharp.SKEncodedImageFormat.Png, 100);
                var relativePath = Path.ChangeExtension(file.TrimStart('/'), ".png");
                var outFile = Path.Combine(outputPath, relativePath);
                EnsureDir(Path.GetDirectoryName(outFile)!);
                File.WriteAllBytes(outFile, ms.ToArray());
                successByExt[".png (tex)"] = successByExt.GetValueOrDefault(".png (tex)") + 1;
                continue;
            }
        }

        var json = JsonConvert.SerializeObject(exports, Formatting.Indented);
        var jsonPath = Path.ChangeExtension(file.TrimStart('/'), ".json");
        var jsonOutFile = Path.Combine(outputPath, jsonPath);
        EnsureDir(Path.GetDirectoryName(jsonOutFile)!);
        File.WriteAllText(jsonOutFile, json);
        Track(successByExt, file);
    }
    catch (Exception ex)
    {
        if (isInteractive) Console.WriteLine();
        Log($"WARN: [{ex.GetType().Name}] {ex.Message} -- {file}");
        Track(failByExt, file);
        failed++;
    }
}

// --- Export raw files ---
foreach (var file in rawFiles)
{
    processed++;
    Progress(processed, total, Path.GetFileName(file));

    try
    {
        var data = provider.Files[file].Read();
        var outFile = Path.Combine(outputPath, file.TrimStart('/'));
        EnsureDir(Path.GetDirectoryName(outFile)!);
        File.WriteAllBytes(outFile, data);
        Track(successByExt, file);
    }
    catch (Exception ex)
    {
        if (isInteractive) Console.WriteLine();
        Log($"WARN: [{ex.GetType().Name}] {ex.Message} -- {file}");
        Track(failByExt, file);
        failed++;
    }
}

// --- Export localization files (.locmeta / .locres → .json) ---
foreach (var file in locFiles)
{
    processed++;
    Progress(processed, total, Path.GetFileName(file));

    try
    {
        if (!provider.TryCreateReader(file, out var reader))
            throw new Exception("TryCreateReader returned false");

        object data = file.EndsWith(".locmeta", StringComparison.OrdinalIgnoreCase)
            ? new CUE4Parse.UE4.Localization.FTextLocalizationMetaDataResource(reader)
            : (object)new CUE4Parse.UE4.Localization.FTextLocalizationResource(reader);

        var json = JsonConvert.SerializeObject(data, Formatting.Indented);
        var jsonPath = Path.ChangeExtension(file.TrimStart('/'), ".json");
        var jsonOutFile = Path.Combine(outputPath, jsonPath);
        EnsureDir(Path.GetDirectoryName(jsonOutFile)!);
        File.WriteAllText(jsonOutFile, json);
        Track(successByExt, file);
    }
    catch (Exception ex)
    {
        if (isInteractive) Console.WriteLine();
        Log($"WARN: [{ex.GetType().Name}] {ex.Message} -- {file}");
        Track(failByExt, file);
        failed++;
    }
}

if (isInteractive) Console.WriteLine();
var elapsed = exportTimer.Elapsed;
var elapsedStr = elapsed.TotalHours >= 1
    ? $"{(int)elapsed.TotalHours}h {elapsed.Minutes}m {elapsed.Seconds}s"
    : elapsed.TotalMinutes >= 1
        ? $"{(int)elapsed.TotalMinutes}m {elapsed.Seconds}s"
        : $"{elapsed.Seconds}s";
Log($"Export complete in {elapsedStr}. {processed - failed:N0}/{total:N0} succeeded, {failed} failed, {skippedUassets.Count:N0} skipped (oversized).");
Log("");
Log($"Output: {outputPath}");
Log("");

var allExts = successByExt.Keys
    .Union(failByExt.Keys)
    .Union(skippedByExt.Keys)
    .OrderBy(x => x)
    .ToList();

const int colW = 15;
Log($"{"Extension",colW} {"Success",8} {"Failed",8} {"Skipped",8} {"Total",8}");
Log($"{new string('-', colW + 36)}");

foreach (var ext in allExts)
{
    successByExt.TryGetValue(ext, out var s);
    failByExt.TryGetValue(ext, out var f);
    skippedByExt.TryGetValue(ext, out var sk);
    Log($"{ext,colW} {s,8} {f,8} {sk,8} {s + f + sk,8}");
}

Log($"{new string('-', colW + 36)}");
int totalSkipped = skippedByExt.Values.Sum();
Log($"{"TOTAL",colW} {processed - failed,8} {failed,8} {totalSkipped,8} {processed + totalSkipped,8}");
Log("");

double skippedPct = (uassets.Count + skippedUassets.Count) > 0
    ? skippedUassets.Count * 100.0 / (uassets.Count + skippedUassets.Count)
    : 0;
Log($"Size filter: {maxUassetBytes / 1024 / 1024} MB — {skippedUassets.Count:N0} uassets skipped ({skippedPct:F1}% of all uassets)");
