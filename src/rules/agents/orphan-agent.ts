import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { basename } from 'path';
import { findAgentReferences, readMarkdownContent, nameMatchesInText } from '../../utils/references.js';

export const orphanAgentRule: LintRule = {
  id: 'agents/orphan-agent',
  description: 'Detect agent files never referenced by any other config component',
  severity: 'info',
  category: 'agents',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig): LintIssue[] {
    const issues: LintIssue[] = [];

    const allAgents: FileInfo[] = [...inventory.projectAgents, ...inventory.userAgents];
    if (allAgents.length === 0) return issues;

    // Build set of referenced agent names
    const referencedAgents = new Set<string>();

    // Scan other agents' bodies for delegation references
    for (const agent of allAgents) {
      if (!agent.exists) continue;
      const parsed = parseAgentMd(agent.path);
      if (!parsed) continue;
      const refs = findAgentReferences(parsed.content);
      for (const ref of refs) {
        referencedAgents.add(ref);
      }
    }

    // Scan skills for agent references
    for (const skill of inventory.projectSkills) {
      if (!skill.exists) continue;
      const content = readMarkdownContent(skill.path);
      if (!content) continue;
      const refs = findAgentReferences(content);
      for (const ref of refs) {
        referencedAgents.add(ref);
      }
    }

    // Scan CLAUDE.md files for agent name mentions
    const claudeMdFiles = [
      inventory.globalClaudeMd,
      inventory.projectClaudeMd,
      inventory.localClaudeMd,
      ...inventory.subdirClaudeMds,
    ].filter((f): f is FileInfo => f !== null && f.exists);

    for (const file of claudeMdFiles) {
      const content = readMarkdownContent(file.path);
      if (!content) continue;
      for (const agent of allAgents) {
        if (!agent.exists) continue;
        const agentName = basename(agent.path, '.md').toLowerCase();
        if (nameMatchesInText(content, agentName)) {
          referencedAgents.add(agentName);
        }
      }
    }

    // Scan commands for agent references
    for (const cmd of [...inventory.projectCommands, ...inventory.userCommands]) {
      if (!cmd.exists) continue;
      const content = readMarkdownContent(cmd.path);
      if (!content) continue;
      const refs = findAgentReferences(content);
      for (const ref of refs) {
        referencedAgents.add(ref);
      }
    }

    // Check each agent
    for (const agent of allAgents) {
      if (!agent.exists) continue;
      const agentName = basename(agent.path, '.md').toLowerCase();

      if (!referencedAgents.has(agentName)) {
        issues.push({
          ruleId: 'agents/orphan-agent',
          severity: 'info',
          category: 'agents',
          message: `Agent "${agentName}" (${agent.relativePath}) is not referenced by any other config component.`,
          file: agent.path,
          suggestion: 'This agent may be invoked directly by user prompts, which is fine. If it is unused, consider removing it.',
          autoFixable: false,
        });
      }
    }

    return issues;
  },
};
