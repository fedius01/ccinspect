import type { ConfigInventory } from './inventory.js';
import type { ResolvedConfig } from './resolved.js';

export type Severity = 'error' | 'warning' | 'info';
export type IssueCategory =
  | 'memory'
  | 'settings'
  | 'rules'
  | 'agents'
  | 'skills'
  | 'commands'
  | 'cross-level'
  | 'budget'
  | 'mcp'
  | 'hooks';

export interface LintIssue {
  ruleId: string;
  severity: Severity;
  category: IssueCategory;
  message: string;
  file?: string;
  line?: number;
  suggestion: string;
  autoFixable: boolean;
}

export interface LintRule {
  id: string;
  description: string;
  severity: Severity;
  category: IssueCategory;
  check(inventory: ConfigInventory, resolved: ResolvedConfig): LintIssue[];
  fix?(inventory: ConfigInventory, issue: LintIssue): void;
}

export interface LintConfig {
  rules: Record<string, boolean | Record<string, unknown>>;
}

export interface LintResult {
  issues: LintIssue[];
  stats: {
    errors: number;
    warnings: number;
    infos: number;
    rulesRun: number;
    filesChecked: number;
    duration: number;
  };
}
