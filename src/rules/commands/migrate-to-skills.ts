import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';

export const migrateToSkillsRule: LintRule = {
  id: 'commands/migrate-to-skills',
  description: 'Advise migrating legacy command files to skills',
  severity: 'info',
  category: 'commands',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const projectCount = inventory.projectCommands.filter(f => f.exists).length;
    const userCount = inventory.userCommands.filter(f => f.exists).length;

    if (projectCount > 0) {
      issues.push({
        ruleId: 'commands/migrate-to-skills',
        severity: 'info',
        category: 'commands',
        message: `Found ${projectCount} command file(s) in project. Commands are a legacy format — skills offer additional features and more reliable discovery.`,
        suggestion:
          'Consider migrating to .claude/skills/<name>/SKILL.md. Skills add auto-invocation, supporting files, and directory-level organization.',
        autoFixable: false,
      });
    }

    if (userCount > 0) {
      issues.push({
        ruleId: 'commands/migrate-to-skills',
        severity: 'info',
        category: 'commands',
        message: `Found ${userCount} command file(s) in user scope. Commands are a legacy format — skills offer additional features and more reliable discovery.`,
        suggestion:
          'Consider migrating to ~/.claude/skills/<name>/SKILL.md. Skills add auto-invocation, supporting files, and directory-level organization.',
        autoFixable: false,
      });
    }

    return issues;
  },
};
