import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';

const KNOWN_FIELDS = new Set(['description']);

export const commandFrontmatterValidRule: LintRule = {
  id: 'commands/frontmatter-valid',
  description: 'Validate YAML frontmatter in command definition files (if present)',
  severity: 'info',
  category: 'commands',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const allCommands: FileInfo[] = [...inventory.projectCommands, ...inventory.userCommands];

    for (const command of allCommands) {
      if (!command.exists) {
        continue;
      }

      const parsed = parseAgentMd(command.path);
      if (!parsed || !parsed.hasFrontmatter) {
        // Frontmatter is optional for commands — skip if not present
        continue;
      }

      // Warn on unknown fields
      for (const key of Object.keys(parsed.frontmatter)) {
        if (!KNOWN_FIELDS.has(key)) {
          issues.push({
            ruleId: 'commands/frontmatter-valid',
            severity: 'info',
            category: 'commands',
            message: `Command file ${command.relativePath} has unknown frontmatter field "${key}".`,
            file: command.path,
            suggestion: `Known fields are: ${[...KNOWN_FIELDS].join(', ')}. Remove or correct the unknown field.`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
