import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type Background, type Step } from '@cucumber/messages';

/** A scenario with the lines (0-based) of all executed steps, in the order of the plugin's step indexes. */
export interface ParsedScenario { title: string; lines: number[]; }
export interface ParsedFeature { title: string; scenarios: ParsedScenario[]; }

/**
 * Parses a .feature file with the official Cucumber parser: all languages (`# language: pl`), Rule,
 * doc strings, tables, tags. Throws on a syntax error (e.g. while editing).
 *
 * Step order matches the indexes written by the plugin (StepHighlighter.ReqnrollPlugin):
 * feature Background → Rule Background → scenario steps.
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
