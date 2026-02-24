import type { LintRule } from '../types/index.js';
import { lineCountRule } from './memory/line-count.js';
import { tokenBudgetRule } from './memory/token-budget.js';
import { sandboxRecommendedRule } from './settings/sandbox-recommended.js';
import { denyEnvFilesRule } from './settings/deny-env-files.js';
import { startupLoadRule } from './budget/startup-load.js';

export function getAllRules(): LintRule[] {
  return [
    lineCountRule,
    tokenBudgetRule,
    sandboxRecommendedRule,
    denyEnvFilesRule,
    startupLoadRule,
  ];
}
