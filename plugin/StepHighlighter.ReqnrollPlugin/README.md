# StepHighlighter.ReqnrollPlugin

Reqnroll runtime plugin for the **Reqnroll Step Highlighter** VS Code extension.
While tests run it appends step events (JSON Lines) to `.reqnroll/step-results.<TestAssembly>.jsonl`
next to your `.sln`/`.slnx` (or `.git`). The extension watches that file and marks each step in
`.feature` files as running / passed / failed / skipped — live, step by step.

## Usage

```bash
dotnet add package StepHighlighter.ReqnrollPlugin
```

No code needed. Add `.reqnroll/` to `.gitignore`.

Works the same no matter who runs the tests (VS Code, Visual Studio, Rider, `dotnet test`).
Without the extension the file is simply not read. Write errors are ignored and never fail a test.

## Configuration

Environment variable `REQNROLL_STEP_RESULTS`:

| Value | Effect |
|---|---|
| *(not set)* | Enabled locally, **disabled on CI** (detected via `CI`, `TF_BUILD`, `JENKINS_URL`, `TEAMCITY_VERSION`, `BUILDKITE`, `BITBUCKET_BUILD_NUMBER`) |
| `off` / `false` / `0` | Always disabled |
| `on` / `true` / `1` | Always enabled (also on CI), default path |
| any other value | Always enabled, value is the output file path |

Requires Reqnroll 3.0+. Uses only test-framework-independent Reqnroll APIs (tested with NUnit).
Source and file format: https://github.com/kmarek/reqnroll-step-highlighter
