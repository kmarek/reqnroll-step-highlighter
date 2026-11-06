# Reqnroll Step Highlighter

Live step results in `.feature` files for [Reqnroll](https://reqnroll.net) (C#) – like IntelliJ does for Cucumber/Java.
While tests run, each step gets ▶ (running), ✔ (passed), ✘ (failed) or ○ (skipped), with duration and error on hover.

Reqnroll turns each scenario into a single NUnit/xUnit/MSTest test, so test runners and IDEs only know
scenarios, not steps. This project adds the missing piece in two parts:

| Folder | What | Published as |
|---|---|---|
| [`plugin/`](plugin/StepHighlighter.ReqnrollPlugin) | Reqnroll runtime plugin – writes step events while tests run | NuGet `StepHighlighter.ReqnrollPlugin` |
| [`vscode/`](vscode) | VS Code extension – reads the events, decorates `.feature` files | VS Code Marketplace |
| [`docs/`](docs/step-results-format.md) | File format – the contract between the two | – |

## Quick start

1. In your Reqnroll test project: `dotnet add package StepHighlighter.ReqnrollPlugin`
2. Install the VS Code extension.
3. Add `.reqnroll/` to `.gitignore`, run tests, open a `.feature` file.

The plugin is disabled on CI by default – see the [plugin README](plugin/StepHighlighter.ReqnrollPlugin/README.md).

## Development

```bash
# plugin
cd plugin && dotnet build
dotnet pack -c Release -o ../artifacts

# VS Code extension – open vscode/ in VS Code and press F5,
# then open a folder with a Reqnroll test project in the debug window
cd vscode && npm install && npm run compile
```

To try the plugin locally, reference the project from your test project:
`<ProjectReference Include="path/to/plugin/StepHighlighter.ReqnrollPlugin/StepHighlighter.ReqnrollPlugin.csproj" />`

## License

MIT
