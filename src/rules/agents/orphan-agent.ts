import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { readFileSync } from 'fs';
import { basename } from 'path';

/**
 * Read raw markdown content from a file.
 * Used for skills and commands where we only need text content, not agent-specific parsing.
 */
function readMarkdownContent(filePath: string): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Scan text content for agent name references.
 * Returns lowercase agent names found in the text.
 */
function findAgentReferences(text: string): Set<string> {
  const refs = new Set<string>();
  // Match: "the <name> agent", "delegate to <name>", "use <name> agent"
  const patterns = [
    /\bthe\s+([\w-]+)\s+agent\b/gi,
    /\bdelegate\s+to\s+(?:the\s+)?([\w-]+)(?:\s+agent)?\b/gi,
    /\buse\s+(?:the\s+)?([\w-]+)\s+agent\b/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      refs.add(match[1].toLowerCase());
    }
  }
  return refs;
}

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
      try {
        const content = readFileSync(file.path, 'utf-8').toLowerCase();
        for (const agent of allAgents) {
          if (!agent.exists) continue;
          const agentName = basename(agent.path, '.md').toLowerCase();
          const escaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const pattern = new RegExp(`\\b${escaped}\\b`);
          if (pattern.test(content)) {
            referencedAgents.add(agentName);
          }
        }
      } catch {
        // skip unreadable files
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
