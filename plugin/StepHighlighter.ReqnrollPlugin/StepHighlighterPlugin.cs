using Reqnroll.Events;
using Reqnroll.Infrastructure;
using Reqnroll.Plugins;
using Reqnroll.UnitTestProvider;
using StepHighlighter.ReqnrollPlugin;

[assembly: RuntimePlugin(typeof(StepHighlighterPlugin))]

namespace StepHighlighter.ReqnrollPlugin;

/// <summary>
/// Podpina <see cref="StepEventListener"/> pod zdarzenia wykonania każdego wątku testowego.
/// W projekcie testowym nie trzeba żadnego kodu – wystarczy referencja do paczki.
/// Konfiguracja: <see cref="StepHighlighterSettings"/> (domyślnie wyłączony na CI).
/// </summary>
public sealed class StepHighlighterPlugin : IRuntimePlugin
{
    public void Initialize(
        RuntimePluginEvents runtimePluginEvents,
        RuntimePluginParameters runtimePluginParameters,
        UnitTestProviderConfiguration unitTestProviderConfiguration)
    {
        var settings = StepHighlighterSettings.FromEnvironment();
        if (!settings.Enabled)
            return;

        runtimePluginEvents.CustomizeTestThreadDependencies += (_, args) =>
        {
            var container = args.ObjectContainer;
            var testAssembly = container.Resolve<ITestAssemblyProvider>().TestAssembly;
            var writer = StepEventWriter.For(testAssembly, settings.OutputPath);
            container.Resolve<ITestThreadExecutionEventPublisher>().AddListener(new StepEventListener(writer));
        };
    }
}
