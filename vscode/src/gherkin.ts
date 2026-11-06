import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type Background, type Step } from '@cucumber/messages';

/** Scenariusz z liniami (0-based) wszystkich wykonywanych stepów, w kolejności indeksów z hooka. */
export interface ParsedScenario { title: string; lines: number[]; }
export interface ParsedFeature { title: string; scenarios: ParsedScenario[]; }

/**
 * Parsuje .feature oficjalnym parserem Cucumbera: wszystkie języki (`# language: pl`), Rule,
 * doc stringi, tabele, tagi. Rzuca wyjątek przy błędzie składni (np. w trakcie edycji).
 *
 * Kolejność stepów odpowiada indeksom zapisywanym przez plugin (StepHighlighter.ReqnrollPlugin):
 * Background feature'a → Background reguły → stepy scenariusza.
 */
export function parseFeatureText(text: string): ParsedFeature | undefined {
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher());
  const feature = parser.parse(text).feature;
  if (!feature) return undefined;

  const scenarios: ParsedScenario[] = [];
  const featureBackground: number[] = [];

  for (const child of feature.children) {
    if (child.background) featureBackground.push(...stepLines(child.background));
    if (child.scenario) scenarios.push(toScenario(child.scenario.name, featureBackground, child.scenario.steps));

    if (child.rule) {
      const ruleBackground = [...featureBackground];
      for (const ruleChild of child.rule.children) {
        if (ruleChild.background) ruleBackground.push(...stepLines(ruleChild.background));
        if (ruleChild.scenario) scenarios.push(toScenario(ruleChild.scenario.name, ruleBackground, ruleChild.scenario.steps));
      }
    }
  }

  return { title: feature.name, scenarios };
}

function toScenario(title: string, background: number[], steps: readonly Step[]): ParsedScenario {
  return { title, lines: [...background, ...steps.map(lineOf)] };
}

function stepLines(background: Background): number[] {
  return background.steps.map(lineOf);
}

const lineOf = (step: Step) => step.location.line - 1;
