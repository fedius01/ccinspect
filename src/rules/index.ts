import type { LintRule } from '../types/index.js';
import { lineCountRule } from './memory/line-count.js';
import { tokenBudgetRule } from './memory/token-budget.js';
import { genericInstructionsRule } from './memory/generic-instructions.js';
import { missingSectionsRule } from './memory/missing-sections.js';
import { importDepthRule } from './memory/import-depth.js';
import { autoMemorySizeRule } from './memory/auto-memory-size.js';
import { sandboxRecommendedRule } from './settings/sandbox-recommended.js';
import { denyEnvFilesRule } from './settings/deny-env-files.js';
import { hookScriptsExistRule } from './settings/hook-scripts-exist.js';
import { permissionPatternsRule } from './settings/permission-patterns.js';
import { startupLoadRule } from './budget/startup-load.js';
import { permissionConflictsRule } from './cross-level/permission-conflicts.js';
import { envShadowsRule } from './cross-level/env-shadows.js';
import { mcpConflictsRule } from './cross-level/mcp-conflicts.js';
import { pluginConflictsRule } from './cross-level/plugin-conflicts.js';
import { deadGlobsRule } from './rules-dir/dead-globs.js';
import { overlappingRulesRule } from './rules-dir/overlapping-rules.js';
import { frontmatterValidRule } from './rules-dir/frontmatter-valid.js';
import { agentFrontmatterPresentRule } from './agents/frontmatter-present.js';
import { agentFrontmatterValidRule } from './agents/frontmatter-valid.js';
import { skillFrontmatterPresentRule } from './skills/frontmatter-present.js';
import { skillFrontmatterValidRule } from './skills/frontmatter-valid.js';
import { commandFrontmatterValidRule } from './commands/frontmatter-valid.js';

export function getAllRules(): LintRule[] {
  return [
    lineCountRule,
    tokenBudgetRule,
    genericInstructionsRule,
    missingSectionsRule,
    importDepthRule,
    autoMemorySizeRule,
    sandboxRecommendedRule,
    denyEnvFilesRule,
    hookScriptsExistRule,
    permissionPatternsRule,
    startupLoadRule,
    permissionConflictsRule,
    envShadowsRule,
    mcpConflictsRule,
    pluginConflictsRule,
    deadGlobsRule,
    overlappingRulesRule,
    frontmatterValidRule,
    agentFrontmatterPresentRule,
    agentFrontmatterValidRule,
    skillFrontmatterPresentRule,
    skillFrontmatterValidRule,
    commandFrontmatterValidRule,
  ];
}
