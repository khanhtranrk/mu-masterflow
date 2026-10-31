import { parseDocument } from "yaml";
import { specIssues } from "./specModel";

export type YamlProblem = {
  kind: "syntax" | "configuration";
  severity: "error" | "warning";
  message: string;
  from?: number;
  to?: number;
};

/** Inspect one exact draft; don't mix syntax errors with a previous valid spec. */
export function yamlProblems(text: string): YamlProblem[] {
  const document = parseDocument(text);
  const problems: YamlProblem[] = [
    ...document.errors.map(issue => ({ issue, severity: "error" as const })),
    ...document.warnings.map(issue => ({ issue, severity: "warning" as const })),
  ].map(({ issue, severity }) => ({
    kind: "syntax", severity, message: issue.message,
    from: Math.max(0, Math.min(issue.pos[0], text.length)),
    to: Math.max(0, Math.min(issue.pos[1], text.length)),
  }));
  if (document.errors.length) return problems;
  try {
    problems.push(...specIssues(document.toJS()).map(message => ({
      kind: "configuration" as const, severity: "error" as const, message,
    })));
  } catch (error) {
    problems.push({ kind: "configuration", severity: "error", message: error instanceof Error ? error.message : "Could not inspect this spec." });
  }
  return problems;
}
