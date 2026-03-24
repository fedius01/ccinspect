import { relative } from 'path';
import type { ConfigInventory, LintIssue, LintResult } from '../../types/index.js';
import type { RuntimeInfo } from '../../types/runtime.js';
import { getRuleMetadata } from '../../rules/rule-metadata.js';
import { classifyConfigFile, inferScope } from '../../utils/file-classifier.js';

export function printInventoryJson(inventory: ConfigInventory): void {
  console.log(JSON.stringify(inventory, null, 2));
}

export function printRuntimeInfoJson(info: RuntimeInfo): void {
  console.log(JSON.stringify(info, null, 2));
}

/**
 * Enrich a single LintIssue with LLM-friendly metadata fields.
 * Mutates in place for performance (issues are about to be serialized and discarded).
 */
export function enrichLintIssues(issues: LintIssue[], projectRoot: string): void {
  for (const issue of issues) {
    enrichIssue(issue, projectRoot);
  }
}

function enrichIssue(issue: LintIssue, projectRoot: string): LintIssue {
  // Rule metadata from registry
  const meta = getRuleMetadata(issue.ruleId);
  if (meta) {
    issue.fixCategory = meta.fixCategory;
    issue.fixComplexity = meta.fixComplexity;
    issue.ruleDescription = meta.ruleDescription;
    issue.docUrl = meta.docUrl;
  }

  // File-derived fields
  if (issue.file) {
    issue.fileRelativePath = relative(projectRoot, issue.file) || issue.file;
    const fileType = classifyConfigFile(issue.file);
    if (fileType) {
      issue.fileType = fileType;
      issue.scope = inferScope(issue.file, fileType);
    }
  }

  return issue;
}

export function printLintResultJson(result: LintResult, projectRoot?: string): void {
  // Enrich issues when projectRoot is available
  if (projectRoot) {
    for (const issue of result.issues) {
      enrichIssue(issue, projectRoot);
    }
  }

  const output = {
    ...result,
    stats: {
      ...result.stats,
      notes: result.stats.infos,
    },
  };
  console.log(JSON.stringify(output, null, 2));
}
