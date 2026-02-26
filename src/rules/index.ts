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
import { dangerousAllowRule } from './settings/dangerous-allow.js';
import { unknownFieldsRule } from './settings/unknown-fields.js';
import { denySensitivePathsRule } from './settings/deny-sensitive-paths.js';
import { startupLoadRule } from './budget/startup-load.js';
import { permissionConflictsRule } from './cross-level/permission-conflicts.js';
import { envShadowsRule } from './cross-level/env-shadows.js';
import { mcpConflictsRule } from './cross-level/mcp-conflicts.js';
import { pluginConflictsRule } from './cross-level/plugin-conflicts.js';
import { deadGlobsRule } from './rules-dir/dead-globs.js';
import { overlappingRulesRule } from './rules-dir/overlapping-rules.js';
import { frontmatterValidRule } from './rules-dir/frontmatter-valid.js';
import { emptyRuleFileRule } from './rules-dir/empty-rule-file.js';
import { agentFrontmatterPresentRule } from './agents/frontmatter-present.js';
import { agentFrontmatterValidRule } from './agents/frontmatter-valid.js';
import { skillFrontmatterPresentRule } from './skills/frontmatter-present.js';
import { skillFrontmatterValidRule } from './skills/frontmatter-valid.js';
import { commandFrontmatterValidRule } from './commands/frontmatter-valid.js';
import { localSettingsTrackedRule } from './git/local-settings-tracked.js';
import { redundantPermissionsRule } from './settings/redundant-permissions.js';
import { allowDenyConflictRule } from './settings/allow-deny-conflict.js';
import { staleImportsRule } from './memory/stale-imports.js';
import { sectionTooLargeRule } from './memory/section-too-large.js';
import { todoFixmeRule } from './memory/todo-fixme.js';
import { missingEnvVarsRule } from './mcp/missing-env-vars.js';
import { largeRuleFileRule } from './rules-dir/large-rule-file.js';

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
    dangerousAllowRule,
    unknownFieldsRule,
    denySensitivePathsRule,
    startupLoadRule,
    permissionConflictsRule,
    envShadowsRule,
    mcpConflictsRule,
    pluginConflictsRule,
    deadGlobsRule,
    overlappingRulesRule,
    frontmatterValidRule,
    emptyRuleFileRule,
    agentFrontmatterPresentRule,
    agentFrontmatterValidRule,
    skillFrontmatterPresentRule,
    skillFrontmatterValidRule,
    commandFrontmatterValidRule,
    localSettingsTrackedRule,
    redundantPermissionsRule,
    allowDenyConflictRule,
    staleImportsRule,
    sectionTooLargeRule,
    todoFixmeRule,
    missingEnvVarsRule,
    largeRuleFileRule,
  ];
}
