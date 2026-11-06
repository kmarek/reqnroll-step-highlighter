using System;
using System.Linq;

namespace StepHighlighter.ReqnrollPlugin;

/// <summary>
/// Konfiguracja przez zmienną środowiskową REQNROLL_STEP_RESULTS:
/// <list type="bullet">
/// <item>brak – włączony lokalnie, wyłączony na serwerze CI (wykrywanym po typowych zmiennych),</item>
/// <item><c>off</c> / <c>false</c> / <c>0</c> – wyłączony zawsze,</item>
/// <item><c>on</c> / <c>true</c> / <c>1</c> – włączony zawsze (także na CI), domyślna ścieżka pliku,</item>
/// <item>inna wartość – włączony zawsze, wartość to ścieżka pliku wynikowego.</item>
/// </list>
/// </summary>
internal sealed class StepHighlighterSettings
{
    public const string EnvironmentVariable = "REQNROLL_STEP_RESULTS";

    /// <summary>Zmienne ustawiane przez popularne systemy CI (GitHub Actions, GitLab, Azure DevOps, Jenkins, TeamCity, ...).</summary>
    private static readonly string[] CiVariables = ["CI", "TF_BUILD", "JENKINS_URL", "TEAMCITY_VERSION", "BUILDKITE", "BITBUCKET_BUILD_NUMBER"];

    private static readonly string[] OffValues = ["off", "false", "0", "disabled"];
    private static readonly string[] OnValues = ["on", "true", "1", "enabled"];

    public bool Enabled { get; }

    /// <summary>Ścieżka pliku z REQNROLL_STEP_RESULTS; null = domyślna.</summary>
    public string? OutputPath { get; }

    private StepHighlighterSettings(bool enabled, string? outputPath)
    {
        Enabled = enabled;
        OutputPath = outputPath;
    }

    public static StepHighlighterSettings FromEnvironment() =>
        Resolve(Environment.GetEnvironmentVariable(EnvironmentVariable), name => Environment.GetEnvironmentVariable(name));

    internal static StepHighlighterSettings Resolve(string? value, Func<string, string?> getVariable)
    {
        value = value?.Trim();

        if (string.IsNullOrEmpty(value))
            return new StepHighlighterSettings(enabled: !IsCi(getVariable), outputPath: null);

        if (OffValues.Contains(value, StringComparer.OrdinalIgnoreCase))
            return new StepHighlighterSettings(enabled: false, outputPath: null);

        if (OnValues.Contains(value, StringComparer.OrdinalIgnoreCase))
            return new StepHighlighterSettings(enabled: true, outputPath: null);

        return new StepHighlighterSettings(enabled: true, outputPath: value);
    }

    private static bool IsCi(Func<string, string?> getVariable) =>
        CiVariables.Any(name =>
        {
            var v = getVariable(name);
            return !string.IsNullOrWhiteSpace(v) && !OffValues.Contains(v!.Trim(), StringComparer.OrdinalIgnoreCase);
        });
}
