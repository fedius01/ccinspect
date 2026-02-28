import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { basename } from 'path';

/**
 * Extract agent names referenced in a skill's markdown body.
 */
function extractAgentReferencesFromBody(content: string): string[] {
  const refs: string[] = [];
  const patterns = [
    /\bthe\s+([\w-]+)\s+agent\b/gi,
    /\bdelegates?\s+to\s+(?:the\s+)?([\w-]+)(?:\s+agent)?\b/gi,
    /\buse\s+(?:the\s+)?([\w-]+)\s+agent\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      refs.push(match[1].toLowerCase());
    }
  }
  return [...new Set(refs)];
}

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

      const agentRefs = extractAgentReferencesFromBody(parsed.content);

      for (const ref of agentRefs) {
        if (!knownAgents.has(ref)) {
          issues.push({
            ruleId: 'skills/agent-reference-valid',
            severity: 'error',
            category: 'skills',
            message: `Skill ${skill.relativePath} references agent "${ref}" which does not exist.`,
            file: skill.path,
            suggestion: `Create the agent at .claude/agents/${ref}.md or remove the reference.`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
