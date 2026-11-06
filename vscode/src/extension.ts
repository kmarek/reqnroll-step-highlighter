import * as vscode from 'vscode';
import { parseFeatureText, type ParsedFeature } from './gherkin';

interface StepResult {
  folderPath?: string;   // folder of the .feature file relative to the project, e.g. "Features/Orders" (FeatureInfo.FolderPath)
  feature: string;
  scenario: string;
  arguments: string;      // Examples row of a Scenario Outline, empty for a plain scenario
  index: number;          // step position: feature Background + Rule Background + Scenario
  stepType: string;
  text: string;
  status: string;         // OK, Skipped, TestError, UndefinedStep, BindingError, StepDefinitionPending, Running
  durationMs: number;
  error?: string | null;
  startedAt?: string;
}

/** One line of the .jsonl file written by the StepHighlighter.ReqnrollPlugin (format: docs/step-results-format.md). */
interface StepEvent extends Partial<StepResult> {
  event: 'runStarted' | 'scenarioStarted' | 'stepStarted' | 'stepFinished' | 'runFinished';
  at: string;
}

type Kind = 'passed' | 'failed' | 'undefined' | 'pending' | 'skipped' | 'running';
interface Verdict { kind: Kind | 'unknown'; label: string; }

const RESULTS_GLOB = '**/.reqnroll/step-results*.jsonl';
/** Worst first: a line shared by several runs (Scenario Outline rows) gets the first kind any run has. */
const KINDS_BY_SEVERITY: Kind[] = ['failed', 'running', 'undefined', 'pending', 'skipped', 'passed'];
/** Statuses that do not stop the scenario – any other status means the following steps were not run. */
const NON_BLOCKING = ['OK', 'Skipped', 'Running'];
const REFRESH_DEBOUNCE_MS = 150;

let decorations: Record<Kind, vscode.TextEditorDecorationType>;
let results: StepResult[] = [];

export function activate(context: vscode.ExtensionContext): void {
  decorations = {
    passed: createDecoration('✔', 'testing.iconPassed', 'diffEditor.insertedLineBackground'),
    failed: createDecoration('✘', 'testing.iconFailed', 'diffEditor.removedLineBackground'),
    undefined: createDecoration('?', 'editorWarning.foreground'),
    pending: createDecoration('…', 'editorWarning.foreground'),
    skipped: createDecoration('○', 'testing.iconSkipped'),
    running: createDecoration('▶', 'testing.iconQueued', 'editor.rangeHighlightBackground'),
  };

  const refresh = async () => {
    results = await loadResults();
    vscode.window.visibleTextEditors.filter(isFeature).forEach(decorate);
  };

  // The plugin appends a line per step event – fast tests produce dozens of changes per second.
  let timer: NodeJS.Timeout | undefined;
  const scheduleRefresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
  };

  const watcher = vscode.workspace.createFileSystemWatcher(RESULTS_GLOB);
  watcher.onDidCreate(scheduleRefresh);
  watcher.onDidChange(scheduleRefresh);
  watcher.onDidDelete(scheduleRefresh);

  context.subscriptions.push(
    watcher,
    ...Object.values(decorations),
    { dispose: () => clearTimeout(timer) },
    vscode.commands.registerCommand('reqnrollSteps.refresh', refresh),
    vscode.window.onDidChangeVisibleTextEditors(editors => editors.filter(isFeature).forEach(decorate)),
    vscode.workspace.onDidChangeTextDocument(e =>
      vscode.window.visibleTextEditors
        .filter(ed => ed.document === e.document && isFeature(ed))
        .forEach(decorate)),
  );

  void refresh();
}

export function deactivate(): void { /* decorations are disposed via subscriptions */ }

function createDecoration(icon: string, color: string, background?: string): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: background ? new vscode.ThemeColor(background) : undefined,
    overviewRulerColor: new vscode.ThemeColor(color),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    before: { contentText: `${icon} `, color: new vscode.ThemeColor(color) },
  });
}

function isFeature(editor: vscode.TextEditor): boolean {
  return editor.document.fileName.endsWith('.feature');
}

async function loadResults(): Promise<StepResult[]> {
  const files = await vscode.workspace.findFiles(RESULTS_GLOB, '**/node_modules/**');
  const all: StepResult[] = [];
  for (const file of files) {
    try {
      const raw = await vscode.workspace.fs.readFile(file);
      all.push(...parseEvents(Buffer.from(raw).toString('utf8')));
    } catch {
      // file deleted in the meantime – the next change triggers another refresh
    }
  }
  return all;
}

/**
 * Folds events into step states. The file holds many runs: scenarioStarted drops the previous result
 * of that scenario; stepStarted without stepFinished = step still running.
 */
export function parseEvents(text: string): StepResult[] {
  const scenarios = new Map<string, Map<number, StepResult>>();
  const dropRunning = () => scenarios.forEach(steps =>
    steps.forEach((s, i) => { if (s.status === 'Running') steps.delete(i); }));

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: StepEvent;
    try { e = JSON.parse(line); } catch { continue; } // the last line may still be being written

    // Run boundary: a "running" step from a previous (killed) or finished run is not running any more.
    if (e.event === 'runStarted' || e.event === 'runFinished') { dropRunning(); continue; }

    const key = [e.folderPath, e.feature, e.scenario, e.arguments].join('\u0000');
    if (e.event === 'scenarioStarted') { scenarios.set(key, new Map()); continue; }

    let steps = scenarios.get(key);
    if (!steps) scenarios.set(key, steps = new Map());
    const index = e.index ?? 0;

    if (e.event === 'stepStarted') {
      steps.set(index, {
        folderPath: e.folderPath, feature: e.feature ?? '', scenario: e.scenario ?? '', arguments: e.arguments ?? '',
        index, stepType: e.stepType ?? '', text: e.text ?? '',
        status: 'Running', durationMs: 0, startedAt: e.at,
      });
    } else if (e.event === 'stepFinished') {
      steps.set(index, { ...(steps.get(index) ?? {}), ...e } as StepResult);
    }
  }

  return [...scenarios.values()].flatMap(steps => [...steps.values()]);
}

/** undefined = syntax error (e.g. while typing) – the previous decorations are kept. */
function parseFeature(doc: vscode.TextDocument): ParsedFeature | null | undefined {
  try {
    return parseFeatureText(doc.getText()) ?? null;
  } catch {
    return undefined;
  }
}

function decorate(editor: vscode.TextEditor): void {
  const buckets = Object.fromEntries(KINDS_BY_SEVERITY.map(k => [k, []])) as unknown as Record<Kind, vscode.DecorationOptions[]>;
  const parsed = parseFeature(editor.document);
  if (parsed === undefined) return; // VS Code moves existing decorations along with edits

  if (parsed) {
    const featureResults = results.filter(r =>
      r.feature === parsed.title && isInFolder(editor.document.fileName, r.folderPath));

    for (const scenario of parsed.scenarios) {
      const runs = groupBy(featureResults.filter(r => r.scenario === scenario.title), r => r.arguments);
      if (runs.size === 0) continue;

      scenario.lines.forEach((line, idx) => {
        const verdicts = [...runs.entries()]
          .map(([args, steps]) => verdictFor(steps, idx, args))
          .filter(v => v.kind !== 'unknown');
        if (verdicts.length === 0) return;

        // the worst result wins (matters for Scenario Outlines with many rows)
        const kind = KINDS_BY_SEVERITY.find(k => verdicts.some(v => v.kind === k))!;

        const hover = new vscode.MarkdownString();
        verdicts.forEach(v => { hover.appendText(v.label); hover.appendMarkdown('\n\n'); });

        buckets[kind].push({ range: editor.document.lineAt(line).range, hoverMessage: hover });
      });
    }
  }

  for (const kind of KINDS_BY_SEVERITY) editor.setDecorations(decorations[kind], buckets[kind]);
}

function verdictFor(steps: StepResult[], idx: number, args: string): Verdict {
  const prefix = args ? `[${args}] ` : '';
  const step = steps.find(s => s.index === idx);

  if (!step) {
    // no entry after an earlier problem = the step was not executed
    const stoppedEarlier = steps.some(s => s.index < idx && !NON_BLOCKING.includes(s.status));
    return stoppedEarlier
      ? { kind: 'skipped', label: `${prefix}Skipped (an earlier step did not pass)` }
      : { kind: 'unknown', label: '' };
  }

  const error = step.error ? `: ${step.error}` : '';
  switch (step.status) {
    case 'OK':
      return { kind: 'passed', label: `${prefix}Passed (${step.durationMs} ms)` };
    case 'Running':
      return { kind: 'running', label: `${prefix}Running (since ${formatTime(step.startedAt)})` };
    case 'Skipped':
      return { kind: 'skipped', label: `${prefix}Skipped` };
    case 'UndefinedStep':
      return { kind: 'undefined', label: `${prefix}Undefined – no matching step definition` };
    case 'StepDefinitionPending':
      return { kind: 'pending', label: `${prefix}Pending – step definition not implemented yet` };
    case 'TestError':
      return { kind: 'failed', label: `${prefix}Failed${error}` };
    case 'BindingError':
      return { kind: 'failed', label: `${prefix}Binding error${error}` };
    default:
      return { kind: 'failed', label: `${prefix}${step.status}${error}` };
  }
}

/**
 * Whether the file lies in the folder reported by Reqnroll (path relative to the test project).
 * Tells apart features with the same title in different folders. An empty folderPath (file in the
 * project root) or a missing one (old format) cannot be checked, so it is accepted.
 */
function isInFolder(fileName: string, folderPath: string | undefined): boolean {
  if (!folderPath) return true;
  const dir = fileName.replace(/\\/g, '/').replace(/\/[^/]*$/, '').toLowerCase();
  const folder = folderPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return dir === folder || dir.endsWith('/' + folder);
}

function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleTimeString() : '?';
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item); else map.set(k, [item]);
  }
  return map;
}
