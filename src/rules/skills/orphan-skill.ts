import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';

/**
 * Extract skill names referenced in an agent's markdown body.
 */
function extractSkillReferences(content: string): string[] {
  const refs: string[] = [];
  const patterns = [
    /\bthe\s+([\w-]+)\s+skill\b/gi,
    /\buse\s+(?:the\s+)?([\w-]+)\s+skill\b/gi,
    /\bdelegate\s+to\s+(?:the\s+)?([\w-]+)(?:\s+skill)?\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      refs.push(match[1].toLowerCase());
    }
  }
  return refs;
}

export const orphanSkillRule: LintRule = {
  id: 'skills/orphan-skill',
  description: 'Detect skills with disable-model-invocation that are not referenced by any agent',
  severity: 'warning',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Collect all skill references from agents
    const referencedSkills = new Set<string>();
    const allAgents: FileInfo[] = [...inventory.projectAgents, ...inventory.userAgents];

    for (const agent of allAgents) {
      if (!agent.exists) continue;
      const parsed = parseAgentMd(agent.path);
      if (!parsed) continue;
      const refs = extractSkillReferences(parsed.content);
      for (const ref of refs) {
        referencedSkills.add(ref);
      }
    }

    for (const skill of inventory.projectSkills) {
      if (!skill.exists) continue;

      const parsed = parseAgentMd(skill.path);
      if (!parsed?.hasFrontmatter) continue;

      // Only check skills with disable-model-invocation set
      if (!parsed.frontmatter['disable-model-invocation']) continue;

      // Get skill name from frontmatter or directory
      let skillName: string | null = null;
      if (typeof parsed.frontmatter.name === 'string') {
        skillName = parsed.frontmatter.name.toLowerCase();
      } else {
        // Extract from path: .claude/skills/<name>/SKILL.md
        const parts = skill.path.split('/');
        const skillMdIdx = parts.lastIndexOf('SKILL.md');
        if (skillMdIdx > 0) {
          skillName = parts[skillMdIdx - 1].toLowerCase();
        }
      }

      if (skillName && !referencedSkills.has(skillName)) {
        issues.push({
          ruleId: 'skills/orphan-skill',
          severity: 'warning',
          category: 'skills',
          message: `Skill "${skillName}" (${skill.relativePath}) has disable-model-invocation set but is not referenced by any agent.`,
          file: skill.path,
          suggestion: 'This skill cannot be auto-invoked and no agent delegates to it, making it unreachable. Reference it from an agent or remove disable-model-invocation.',
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
