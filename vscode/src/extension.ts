import * as vscode from 'vscode';
import { parseFeatureText, type ParsedFeature } from './gherkin';

interface StepResult {
  folderPath?: string;   // katalog .feature względem projektu, np. "Features/Orders" (FeatureInfo.FolderPath)
  feature: string;
  scenario: string;
  arguments: string;      // wiersz Examples dla Scenario Outline, pusty dla zwykłego scenariusza
  index: number;          // pozycja stepu: Background feature'a + Background reguły + Scenario
  stepType: string;
  text: string;
  status: string;         // OK, Skipped, TestError, UndefinedStep, BindingError, StepDefinitionPending, Running
  durationMs: number;
  error?: string | null;
  startedAt?: string;
}

/** Linia pliku .jsonl zapisywanego przez plugin StepHighlighter.ReqnrollPlugin (format: docs/step-results-format.md). */
interface StepEvent extends Partial<StepResult> {
  event: 'runStarted' | 'scenarioStarted' | 'stepStarted' | 'stepFinished' | 'runFinished';
  at: string;
}

type Kind = 'passed' | 'failed' | 'skipped' | 'running';
interface Verdict { kind: Kind | 'unknown'; label: string; }

const RESULTS_GLOB = '**/.reqnroll/step-results*.jsonl';
const KINDS: Kind[] = ['passed', 'failed', 'skipped', 'running'];
const REFRESH_DEBOUNCE_MS = 150;

let decorations: Record<Kind, vscode.TextEditorDecorationType>;
let results: StepResult[] = [];

export function activate(context: vscode.ExtensionContext): void {
  decorations = {
    passed: createDecoration('✔', 'testing.iconPassed', 'diffEditor.insertedLineBackground'),
    failed: createDecoration('✘', 'testing.iconFailed', 'diffEditor.removedLineBackground'),
    skipped: createDecoration('○', 'testing.iconSkipped'),
    running: createDecoration('▶', 'testing.iconQueued', 'editor.rangeHighlightBackground'),
  };

  const refresh = async () => {
    results = await loadResults();
    vscode.window.visibleTextEditors.filter(isFeature).forEach(decorate);
  };

  // Hook dopisuje linię po każdym stepie – przy szybkich testach to dziesiątki zmian na sekundę.
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

export function deactivate(): void { /* dekoracje są w subscriptions */ }

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
      // plik usunięty w międzyczasie – kolejna zmiana wywoła odświeżenie
    }
  }
  return all;
}

/**
 * Składa zdarzenia w stan stepów. Plik zawiera wiele runów: scenarioStarted kasuje poprzedni wynik
 * tego scenariusza, stepStarted bez stepFinished = step w trakcie.
 */
export function parseEvents(text: string): StepResult[] {
  const scenarios = new Map<string, Map<number, StepResult>>();
  const dropRunning = () => scenarios.forEach(steps =>
    steps.forEach((s, i) => { if (s.status === 'Running') steps.delete(i); }));

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: StepEvent;
    try { e = JSON.parse(line); } catch { continue; } // ostatnia linia może być w trakcie zapisu

    // Granica runu: step "w trakcie" z poprzedniego (przerwanego) albo zakończonego runu już nie trwa.
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

/** undefined = błąd składni (np. w trakcie pisania) – wtedy zostawiamy poprzednie dekoracje. */
function parseFeature(doc: vscode.TextDocument): ParsedFeature | null | undefined {
  try {
    return parseFeatureText(doc.getText()) ?? null;
  } catch {
    return undefined;
  }
}

function decorate(editor: vscode.TextEditor): void {
  const buckets: Record<Kind, vscode.DecorationOptions[]> = { passed: [], failed: [], skipped: [], running: [] };
  const parsed = parseFeature(editor.document);
  if (parsed === undefined) return; // VS Code sam przesuwa istniejące dekoracje przy edycji

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

        // najgorszy wynik wygrywa (ważne przy Scenario Outline z wieloma wierszami)
        const kind: Kind = verdicts.some(v => v.kind === 'failed') ? 'failed'
          : verdicts.some(v => v.kind === 'running') ? 'running'
          : verdicts.some(v => v.kind === 'skipped') ? 'skipped'
          : 'passed';

        const hover = new vscode.MarkdownString();
        verdicts.forEach(v => { hover.appendText(v.label); hover.appendMarkdown('\n\n'); });

        buckets[kind].push({ range: editor.document.lineAt(line).range, hoverMessage: hover });
      });
    }
  }

  for (const kind of KINDS) editor.setDecorations(decorations[kind], buckets[kind]);
}

function verdictFor(steps: StepResult[], idx: number, args: string): Verdict {
  const prefix = args ? `[${args}] ` : '';
  const step = steps.find(s => s.index === idx);

  if (!step) {
    // brak wpisu po wcześniejszym błędzie = step nie został wykonany
    const failedEarlier = steps.some(s => s.index < idx && !['OK', 'Skipped', 'Running'].includes(s.status));
    return failedEarlier
      ? { kind: 'skipped', label: `${prefix}pominięty (wcześniejszy step nie przeszedł)` }
      : { kind: 'unknown', label: '' };
  }

  switch (step.status) {
    case 'OK':
      return { kind: 'passed', label: `${prefix}OK (${step.durationMs} ms)` };
    case 'Running':
      return { kind: 'running', label: `${prefix}w trakcie (od ${formatTime(step.startedAt)})` };
    case 'Skipped':
      return { kind: 'skipped', label: `${prefix}pominięty` };
    default:
      return { kind: 'failed', label: `${prefix}${step.status}${step.error ? `: ${step.error}` : ''}` };
  }
}

/**
 * Czy plik leży w katalogu zgłoszonym przez Reqnroll (ścieżka względem projektu testowego).
 * Rozróżnia feature'y o tym samym tytule w różnych katalogach. Pusty folderPath (plik w katalogu
 * projektu) albo jego brak (stary format) – nie da się sprawdzić, więc akceptujemy.
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
