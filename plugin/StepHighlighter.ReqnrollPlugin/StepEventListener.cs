using System;
using System.Collections;
using System.Collections.Specialized;
using System.Linq;
using System.Threading.Tasks;
using Reqnroll;
using Reqnroll.Events;

namespace StepHighlighter.ReqnrollPlugin;

/// <summary>
/// Jedna instancja na wątek testowy – scenariusze w obrębie wątku idą sekwencyjnie,
/// więc licznik stepów może być zwykłym polem.
///
/// Zdarzenia Reqnrolla (w odróżnieniu od hooków) przychodzą dla każdego stepu: także niezdefiniowanego
/// i pominiętego po błędzie, a StepFinishedEvent jest publikowany przed [AfterStep], więc wyjątek
/// w hooku użytkownika nie gubi wyniku.
/// </summary>
internal sealed class StepEventListener : IAsyncExecutionEventListener
{
    private readonly StepEventWriter _writer;
    private int _stepIndex; // kolejność: Background feature'a, Background reguły, stepy scenariusza
    private DateTime _stepStartedAt;

    public StepEventListener(StepEventWriter writer) => _writer = writer;

    public Task OnEventAsync(IExecutionEvent executionEvent)
    {
        switch (executionEvent)
        {
            case TestRunStartedEvent:
                _writer.Append(new StepEvent("runStarted", DateTimeOffset.Now));
                break;

            case TestRunFinishedEvent:
                _writer.Append(new StepEvent("runFinished", DateTimeOffset.Now));
                break;

            case ScenarioStartedEvent e:
                _stepIndex = 0;
                _writer.Append(Create("scenarioStarted", e.FeatureContext, e.ScenarioContext));
                break;

            case StepStartedEvent e:
                _stepStartedAt = e.Timestamp;
                _writer.Append(WithStep(Create("stepStarted", e.FeatureContext, e.ScenarioContext), e.StepContext));
                break;

            case StepFinishedEvent e:
                var stepEvent = WithStep(Create("stepFinished", e.FeatureContext, e.ScenarioContext), e.StepContext);
                var status = e.StepContext.Status;
                stepEvent.Status = status.ToString();
                stepEvent.DurationMs = (long)(e.Timestamp - _stepStartedAt).TotalMilliseconds;
                stepEvent.Error = status switch
                {
                    ScenarioExecutionStatus.OK or ScenarioExecutionStatus.Skipped => null,
                    ScenarioExecutionStatus.UndefinedStep => "No matching step definition found",
                    _ => e.StepContext.StepError?.Message
                };
                _writer.Append(stepEvent);
                _stepIndex++;
                break;
        }

        return Task.CompletedTask;
    }

    private StepEvent Create(string name, IFeatureContext feature, IScenarioContext scenario) =>
        new(name, DateTimeOffset.Now)
        {
            FolderPath = feature.FeatureInfo.FolderPath ?? "",
            Feature = feature.FeatureInfo.Title,
            Scenario = scenario.ScenarioInfo.Title,
            Arguments = FormatArguments(scenario.ScenarioInfo.Arguments)
        };

    private StepEvent WithStep(StepEvent stepEvent, IScenarioStepContext step)
    {
        stepEvent.Index = _stepIndex;
        stepEvent.StepType = step.StepInfo.StepDefinitionType.ToString();
        stepEvent.Text = step.StepInfo.Text;
        return stepEvent;
    }

    private static string FormatArguments(IOrderedDictionary? arguments) =>
        arguments is null
            ? ""
            : string.Join(", ", arguments.Cast<DictionaryEntry>().Select(e => $"{e.Key}={e.Value}"));
}
