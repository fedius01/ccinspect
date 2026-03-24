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
  | 'hooks'
  | 'plugins'
  | 'git'
  | 'naming';

export interface LintEvidence {
  file: string;          // File path where evidence was found
  line?: number;         // Line number (1-indexed), if applicable
  content: string;       // The matched text, value, or descriptive content
}

export type FixCategory = 'add' | 'remove' | 'edit' | 'rename' | 'restructure' | 'review';
export type FixComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

export interface LintIssue {
  ruleId: string;
  severity: Severity;
  category: IssueCategory;
  message: string;
  file?: string;
  line?: number;
  suggestion: string;
  autoFixable: boolean;
  evidence?: LintEvidence[];
  // LLM-friendly metadata (populated by JSON formatter from rule-metadata registry)
  fixCategory?: FixCategory;
  fixComplexity?: FixComplexity;
  ruleDescription?: string;
  docUrl?: string;
  fileRelativePath?: string;
  fileType?: string;
  scope?: string;
  fixCascadeCount?: number;
}

export interface LintRule {
  id: string;
  description: string;
  severity: Severity;
  category: IssueCategory;
  check(inventory: ConfigInventory, resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[];
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
