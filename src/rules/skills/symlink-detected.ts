import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { basename, dirname } from 'path';

function getSkillName(skill: FileInfo): string {
  // Extract from path: .claude/skills/<name>/SKILL.md
  const parts = skill.path.split('/');
  const skillMdIdx = parts.findIndex(p => p.toLowerCase() === 'skill.md');
  if (skillMdIdx > 0) {
    return parts[skillMdIdx - 1];
  }
  return basename(dirname(skill.path));
}

export const symlinkDetectedRule: LintRule = {
  id: 'skills/symlink-detected',
  description: 'Detects skills that are symlinks (e.g., installed via skills.sh)',
  severity: 'info',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const allSkills: FileInfo[] = [...inventory.projectSkills, ...inventory.userSkills];

    for (const skill of allSkills) {
      if (!skill.exists || !skill.isSymlink) {
        continue;
      }

      const skillName = getSkillName(skill);

      issues.push({
        ruleId: 'skills/symlink-detected',
        severity: 'info',
        category: 'skills',
        message: `Skill "${skillName}" is a symlink`,
        file: skill.path,
        suggestion: `This skill's source is at ${skill.symlinkTarget}. Edits there affect all agents sharing it, not just Claude Code.`,
        autoFixable: false,
        evidence: [
          {
            file: skill.path,
            content: `→ ${skill.symlinkTarget}`,
          },
        ],
      });
    }

    return issues;
  },
};
