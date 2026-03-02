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

      // Filter body text refs to only flag deliberate skill identifiers.
      // Real skill names are typically hyphenated (e.g., "presentation-structure",
      // "vibe-to-agentic-framework"). Single common words like "framework",
      // "structure", "specialized" are prose noise, not skill references.
      // Frontmatter `skills` field (checked separately below) handles explicit refs.
      const filteredBodyRefs = new Set(
        [...bodyRefs].filter(ref => ref.includes('-'))
      );

      const contentLines = parsed.content.split('\n');
      for (const ref of filteredBodyRefs) {
        if (!knownSkills.has(ref) && !knownCommands.has(ref)) {
          const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const refPattern = new RegExp(`\\b${escaped}\\b`, 'i');
          const matchIdx = contentLines.findIndex(l => refPattern.test(l));
          issues.push({
            ruleId: 'agents/skill-reference-valid',
            severity: 'error',
            category: 'agents',
            message: `Agent ${agent.relativePath} references skill "${ref}" which does not exist.`,
            file: agent.path,
            suggestion: `Create the skill at .claude/skills/${ref}/SKILL.md or remove the reference.`,
            autoFixable: false,
            evidence: matchIdx >= 0 ? [{
              file: agent.path,
              line: matchIdx + 1,
              content: contentLines[matchIdx].trim().slice(0, 120),
            }] : undefined,
          });
        }
      }

      // Also validate frontmatter `skills` field if present (explicit references, always reliable)
      if (parsed.hasFrontmatter && parsed.frontmatter.skills) {
        let skillsList: string[];
        if (typeof parsed.frontmatter.skills === 'string') {
          skillsList = parsed.frontmatter.skills.split(',').map((s: string) => s.trim().toLowerCase());
        } else if (Array.isArray(parsed.frontmatter.skills)) {
          skillsList = (parsed.frontmatter.skills as string[]).map((s: string) => s.toLowerCase());
        } else {
          skillsList = [];
        }

        for (const ref of skillsList) {
          if (ref && !knownSkills.has(ref) && !knownCommands.has(ref)) {
            issues.push({
              ruleId: 'agents/skill-reference-valid',
              severity: 'error',
              category: 'agents',
              message: `Agent ${agent.relativePath} references skill "${ref}" in frontmatter which does not exist.`,
              file: agent.path,
              suggestion: `Create the skill at .claude/skills/${ref}/SKILL.md or remove it from the skills field.`,
              autoFixable: false,
            });
          }
        }
      }
    }

    return issues;
  },
};
