using System;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace StepHighlighter.ReqnrollPlugin;

/// <summary>
/// Dopisuje zdarzenia (JSON Lines) do .reqnroll/step-results.{Assembly}.jsonl w katalogu z .sln/.slnx
/// albo .git. Każda linia jest zapisywana i zamykana od razu – rozszerzenie VS Code czyta plik w trakcie runu.
/// Plik nie jest czyszczony między runami (uruchomienie jednego testu nie kasuje wyników pozostałych);
/// powyżej <see cref="MaxFileSize"/> zaczyna się od nowa. Ścieżkę można nadpisać zmienną REQNROLL_STEP_RESULTS
/// (zob. <see cref="StepHighlighterSettings"/>).
/// </summary>
internal sealed class StepEventWriter
{
    private const long MaxFileSize = 10 * 1024 * 1024;

    private static readonly ConcurrentDictionary<string, StepEventWriter> Writers = new();

    /// <summary>Jeden writer (i plik) na assembly testowe.</summary>
    public static StepEventWriter For(Assembly testAssembly, string? outputPathOverride)
    {
        var path = outputPathOverride ?? DefaultOutputPath(testAssembly);
        return Writers.GetOrAdd(path, p => new StepEventWriter(p));
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private readonly object _lock = new();
    private readonly string _path;
    private bool _sizeChecked;

    private StepEventWriter(string path) => _path = path;

    public void Append(StepEvent stepEvent)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(stepEvent, JsonOptions) + "\n");
        try
        {
            lock (_lock)
            {
                if (!_sizeChecked)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
                    var file = new FileInfo(_path);
                    if (file.Exists && file.Length > MaxFileSize) file.Delete();
                    _sizeChecked = true;
                }

                using var stream = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
                stream.Write(bytes, 0, bytes.Length);
            }
        }
        catch (IOException)
        {
            // Podświetlanie to dodatek – problem z plikiem nie może wywalić testów.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private static string DefaultOutputPath(Assembly testAssembly)
    {
        var binDir = Path.GetDirectoryName(testAssembly.Location);
        if (string.IsNullOrEmpty(binDir)) binDir = AppContext.BaseDirectory;

        var dir = new DirectoryInfo(binDir);
        while (dir is not null
               && !dir.EnumerateFiles("*.sln*").Any()
               && !dir.EnumerateDirectories(".git").Any())
        {
            dir = dir.Parent;
        }

        var root = dir?.FullName ?? binDir!;
        return Path.Combine(root, ".reqnroll", $"step-results.{testAssembly.GetName().Name}.jsonl");
    }
}

internal sealed class StepEvent
{
    public StepEvent(string @event, DateTimeOffset at)
    {
        Event = @event;
        At = at;
    }

    public string Event { get; }
    public DateTimeOffset At { get; }
    public string? FolderPath { get; set; }
    public string? Feature { get; set; }
    public string? Scenario { get; set; }
    public string? Arguments { get; set; }
    public int? Index { get; set; }
    public string? StepType { get; set; }
    public string? Text { get; set; }
    public string? Status { get; set; }
    public long? DurationMs { get; set; }
    public string? Error { get; set; }
}
