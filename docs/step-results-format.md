# Step results format (v1)

Contract between the **writer** (`StepHighlighter.ReqnrollPlugin`, running inside the test process) and
**readers** (IDE extensions: VS Code today, possibly Visual Studio / Rider later).
A reader needs nothing but this file and a Gherkin parser.

## File

- Location: `<root>/.reqnroll/step-results.<TestAssemblyName>.jsonl`, where `<root>` is the nearest directory
  above the test assembly's output folder that contains a `*.sln` / `*.slnx` file or a `.git` directory.
  One file per test assembly. Override with `REQNROLL_STEP_RESULTS=<path>`.
- Encoding: UTF-8, [JSON Lines](https://jsonlines.org/) – one JSON object per line, `\n` separated.
- **Append-only, shared across runs.** The file is not truncated when a run starts, so running a single test
  keeps the results of all other scenarios. When it exceeds 10 MB it is deleted at the start of the next run.
- Written while tests run, one line at a time, opened with read/write sharing. A reader may see a partially
  written last line – it must skip lines that fail to parse.
- Several test threads write to the same file; events of different scenarios can interleave.

## Events

Every line has `event` and `at` (ISO 8601 timestamp with offset). Optional fields are omitted when null.

| `event` | Meaning | Extra fields |
|---|---|---|
| `runStarted` | A test run started (one per process). | – |
| `scenarioStarted` | A scenario (or one Scenario Outline example row) started. | scenario key |
| `stepStarted` | A step started executing. | scenario key, step fields |
| `stepFinished` | A step finished. | scenario key, step fields, `status`, `durationMs`, `error` |
| `runFinished` | The test run finished. | – |

### Scenario key

| Field | Example | Notes |
|---|---|---|
| `folderPath` | `Features/Orders` | Folder of the `.feature` file relative to the test project (`FeatureInfo.FolderPath`); `""` for the project root. |
| `feature` | `Order checkout` | Feature title. |
| `scenario` | `Pay with card` | Scenario / Scenario Outline title (placeholders not substituted). |
| `arguments` | `count=2, total=9` | Example row values for Scenario Outline, `""` otherwise. |

### Step fields

| Field | Example | Notes |
|---|---|---|
| `index` | `3` | 0-based position of the step in the executed sequence: feature `Background` steps, then the enclosing `Rule`'s `Background` steps, then the scenario steps. |
| `stepType` | `Given` / `When` / `Then` | Resolved type (`And`/`But` take the type of the previous step). |
| `text` | `I add todo "Buy milk"` | Step text without keyword, placeholders substituted. |
| `status` | see below | `stepFinished` only. |
| `durationMs` | `1532` | `stepFinished` only. |
| `error` | `Locator expected …` | `stepFinished` only; message for failing statuses. |

`status` values (Reqnroll `ScenarioExecutionStatus`): `OK`, `Skipped` (not executed because of an earlier
failure), `TestError`, `StepDefinitionPending`, `UndefinedStep`, `BindingError`.

## Reader rules

1. Group events by scenario key. A `scenarioStarted` **replaces** everything previously known about that key.
2. `stepStarted` without a matching `stepFinished` (same key + `index`) is a **running** step.
3. `runStarted` and `runFinished` end all running steps (a killed process leaves no `runFinished`;
   the next run's `runStarted` cleans up).
4. To locate step lines: parse the `.feature` file, check that its folder ends with `folderPath`
   and its title equals `feature`, find the scenario by title, then map `index` over
   *feature Background + Rule Background + scenario steps*.
5. Scenario Outline: one result set per `arguments` value; show the worst status per line
   (failed > running > skipped > passed).
6. Steps after a failure may have no event at all (e.g. a hook aborted the scenario) – treat them as skipped.

## Example

```jsonl
{"event":"runStarted","at":"2026-11-06T12:00:00.000+01:00"}
{"event":"scenarioStarted","at":"2026-11-06T12:00:00.100+01:00","folderPath":"Features","feature":"Todo list","scenario":"Add a single todo","arguments":""}
{"event":"stepStarted","at":"2026-11-06T12:00:00.110+01:00","folderPath":"Features","feature":"Todo list","scenario":"Add a single todo","arguments":"","index":0,"stepType":"Given","text":"I open the todo app"}
{"event":"stepFinished","at":"2026-11-06T12:00:00.190+01:00","folderPath":"Features","feature":"Todo list","scenario":"Add a single todo","arguments":"","index":0,"stepType":"Given","text":"I open the todo app","status":"OK","durationMs":80}
{"event":"runFinished","at":"2026-11-06T12:00:01.000+01:00"}
```

## Compatibility

New optional fields and new `event` types may be added; readers must ignore what they do not know.
Breaking changes would use a different file name.
