import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { parseAgentMd } from '../../parsers/agents-md.js';
import { basename } from 'path';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'to', 'for', 'and', 'or', 'in', 'of',
  'with', 'this', 'that', 'it', 'on', 'at', 'by', 'from', 'as', 'be',
  'was', 'were', 'been', 'has', 'have', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'can', 'not',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'but', 'about', 'above', 'after', 'again',
]);

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

interface AgentDesc {
  name: string;
  description: string;
  tokens: Set<string>;
  filePath: string;
  relativePath: string;
}

export const descriptionOverlapRule: LintRule = {
  id: 'agents/description-overlap',
  description: 'Detect agents with confusingly similar descriptions that could cause routing ambiguity',
  severity: 'warning',
  category: 'agents',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const threshold = (typeof options?.threshold === 'number' ? options.threshold : 0.7);
    const issues: LintIssue[] = [];

    const allAgents: FileInfo[] = [...inventory.projectAgents, ...inventory.userAgents];
    const agentDescs: AgentDesc[] = [];

    for (const agent of allAgents) {
      if (!agent.exists) continue;

      const parsed = parseAgentMd(agent.path);
      if (!parsed?.hasFrontmatter) continue;

      const description = parsed.frontmatter.description;
      if (typeof description !== 'string' || description.trim().length === 0) continue;

      agentDescs.push({
        name: basename(agent.path, '.md'),
        description,
        tokens: tokenize(description),
        filePath: agent.path,
        relativePath: agent.relativePath,
      });
    }

    // Compare all pairs
    const reported = new Set<string>();
    for (let i = 0; i < agentDescs.length; i++) {
      for (let j = i + 1; j < agentDescs.length; j++) {
        const a = agentDescs[i];
        const b = agentDescs[j];
        const similarity = jaccardSimilarity(a.tokens, b.tokens);

        if (similarity >= threshold) {
          const pairKey = [a.filePath, b.filePath].sort().join('|');
          if (reported.has(pairKey)) continue;
          reported.add(pairKey);

          issues.push({
            ruleId: 'agents/description-overlap',
            severity: 'warning',
            category: 'agents',
            message: `Agents "${a.name}" and "${b.name}" have similar descriptions (${(similarity * 100).toFixed(0)}% overlap). This may cause routing ambiguity.`,
            file: a.filePath,
            suggestion: `Differentiate the descriptions to make agent routing unambiguous. "${a.name}": "${a.description}" vs "${b.name}": "${b.description}".`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
