import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { basename } from 'path';
import { findSkillReferences } from '../../utils/references.js';

export const skillReferenceValidRule: LintRule = {
  id: 'agents/skill-reference-valid',
  description: 'Check that agents reference skills that actually exist',
  severity: 'error',
  category: 'agents',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Build set of known skill names (from directory names)
    const knownSkills = new Set<string>();
    for (const skill of inventory.projectSkills) {
      if (!skill.exists) continue;
      // Skill path: .claude/skills/<skill-name>/SKILL.md — extract dir name
      const parts = skill.path.split('/');
      const skillDirIdx = parts.lastIndexOf('SKILL.md');
      if (skillDirIdx > 0) {
        knownSkills.add(parts[skillDirIdx - 1].toLowerCase());
      }
      // Also try parsing frontmatter for the name field
      const parsed = parseAgentMd(skill.path);
      if (parsed?.hasFrontmatter && typeof parsed.frontmatter.name === 'string') {
        knownSkills.add(parsed.frontmatter.name.toLowerCase());
      }
    }

    // Also add command names (skills can be slash commands too)
    const knownCommands = new Set<string>();
    for (const cmd of [...inventory.projectCommands, ...inventory.userCommands]) {
      if (!cmd.exists) continue;
      knownCommands.add(basename(cmd.path, '.md').toLowerCase());
    }

    const allAgents: FileInfo[] = [...inventory.projectAgents, ...inventory.userAgents];

    for (const agent of allAgents) {
      if (!agent.exists) continue;

      const parsed = parseAgentMd(agent.path);
      if (!parsed) continue;

      // Collect skill references from body text
      const bodyRefs = findSkillReferences(parsed.content);

      for (const ref of bodyRefs) {
        if (!knownSkills.has(ref) && !knownCommands.has(ref)) {
          issues.push({
            ruleId: 'agents/skill-reference-valid',
            severity: 'error',
            category: 'agents',
            message: `Agent ${agent.relativePath} references skill "${ref}" which does not exist.`,
            file: agent.path,
            suggestion: `Create the skill at .claude/skills/${ref}/SKILL.md or remove the reference.`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
