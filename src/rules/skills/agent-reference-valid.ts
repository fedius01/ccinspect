import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { basename } from 'path';
import { findAgentReferences } from '../../utils/references.js';

export const agentReferenceValidRule: LintRule = {
  id: 'skills/agent-reference-valid',
  description: 'Check that skills reference agents that actually exist',
  severity: 'error',
  category: 'skills',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    // Build set of known agent names
    const knownAgents = new Set<string>();
    const allAgents: FileInfo[] = [...inventory.projectAgents, ...inventory.userAgents];
    for (const agent of allAgents) {
      if (!agent.exists) continue;
      knownAgents.add(basename(agent.path, '.md').toLowerCase());
    }

    for (const skill of inventory.projectSkills) {
      if (!skill.exists) continue;

      const parsed = parseAgentMd(skill.path);
      if (!parsed) continue;

      const agentRefs = findAgentReferences(parsed.content);

      // Filter body text refs to only flag deliberate agent identifiers.
      // Real agent names are typically hyphenated (e.g., "code-reviewer",
      // "deploy-manager"). Single common words like "specialized", "framework"
      // are prose noise, not agent references.
      const filteredAgentRefs = new Set(
        [...agentRefs].filter(ref => ref.includes('-'))
      );

      const contentLines = parsed.content.split('\n');

      for (const ref of filteredAgentRefs) {
        if (!knownAgents.has(ref)) {
          const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const refPattern = new RegExp(`\\b${escaped}\\b`, 'i');
          const matchIdx = contentLines.findIndex(l => refPattern.test(l));
          issues.push({
            ruleId: 'skills/agent-reference-valid',
            severity: 'error',
            category: 'skills',
            message: `Skill ${skill.relativePath} references agent "${ref}" which does not exist.`,
            file: skill.path,
            suggestion: `Create the agent at .claude/agents/${ref}.md or remove the reference.`,
            autoFixable: false,
            evidence: matchIdx >= 0 ? [{
              file: skill.path,
              line: matchIdx + 1,
              content: contentLines[matchIdx].trim().slice(0, 120),
            }] : undefined,
          });
        }
      }
    }

    return issues;
  },
};
