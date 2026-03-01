import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scan } from '../../../src/core/scanner.js';
import { buildDependencyGraph } from '../../../src/core/graph-builder.js';
import type { DependencyGraph, GraphNode, GraphEdge } from '../../../src/types/index.js';
import {
  formatGraphMermaid,
  formatGraphHtml,
  formatGraphText,
  formatGraphJson,
} from '../../../src/cli/output/graph-formatters.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');

// ─── Test helper: build a simple graph for unit tests ───

function makeSimpleGraph(): DependencyGraph {
  const nodes: GraphNode[] = [
    {
      id: 'claude-md:CLAUDE.md',
      type: 'claude-md',
      label: 'CLAUDE.md (project)',
      filePath: '/test/CLAUDE.md',
      scope: 'project-shared',
      tokens: 390,
    },
    {
      id: 'agent:.claude/agents/reviewer.md',
      type: 'agent',
      label: 'reviewer',
      filePath: '/test/.claude/agents/reviewer.md',
      scope: 'project-shared',
      tokens: 180,
    },
    {
      id: 'skill:.claude/skills/code-review/SKILL.md',
      type: 'skill',
      label: 'code-review',
      filePath: '/test/.claude/skills/code-review/SKILL.md',
      scope: 'project-shared',
      tokens: 120,
    },
  ];

  const edges: GraphEdge[] = [
    { source: 'claude-md:CLAUDE.md', target: 'agent:.claude/agents/reviewer.md', type: 'reference', isBroken: false },
    { source: 'agent:.claude/agents/reviewer.md', target: 'skill:.claude/skills/code-review/SKILL.md', type: 'reference', isBroken: false },
    { source: 'agent:.claude/agents/reviewer.md', target: 'agent:.claude/agents/missing.md', type: 'delegation', isBroken: true },
  ];

  const orphans: GraphNode[] = [
    {
      id: 'command:.claude/commands/deploy.md',
      type: 'command',
      label: 'deploy',
      filePath: '/test/.claude/commands/deploy.md',
      scope: 'project-shared',
      tokens: 30,
    },
  ];

  return { nodes, edges, orphans };
}

function makeEmptyGraph(): DependencyGraph {
  return { nodes: [], edges: [], orphans: [] };
}

// ─── Mermaid output tests ───

describe('formatGraphMermaid', () => {
  it('starts with graph TD header', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toMatch(/^graph TD\n/);
  });

  it('includes all connected nodes with sanitized IDs', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toContain('claude_md_CLAUDE_md');
    expect(output).toContain('agent_claude_agents_reviewer_md');
    expect(output).toContain('skill_claude_skills_code_review_SKILL_md');
  });

  it('includes orphan nodes', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toContain('command_claude_commands_deploy_md');
  });

  it('uses --> for normal edges', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toContain('-->|reference|');
  });

  it('uses -.-> for broken edges', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toContain('-.->|broken: delegation|');
  });

  it('applies orphan dashed stroke style', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    // The orphan node should have dashed stroke style
    expect(output).toContain('stroke-dasharray: 5 5');
  });

  it('applies node type fill colors', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toContain('fill:#dbeafe'); // claude-md
    expect(output).toContain('fill:#ede9fe'); // agent
    expect(output).toContain('fill:#ffedd5'); // skill
  });

  it('includes token counts in node labels', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toContain('390 tokens');
    expect(output).toContain('180 tokens');
    expect(output).toContain('120 tokens');
  });

  it('node labels include type badge', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toContain('agent &middot;');
    expect(output).toContain('skill &middot;');
  });

  it('produces valid output for empty graph', () => {
    const graph = makeEmptyGraph();
    const output = formatGraphMermaid(graph);
    expect(output).toContain('graph TD');
    expect(output.length).toBeGreaterThan(0);
  });

  it('creates placeholder node for broken reference target', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphMermaid(graph);
    // The broken delegation target "agent:.claude/agents/missing.md" should create a placeholder
    expect(output).toContain('agent_claude_agents_missing_md');
    // Broken placeholder gets red styling
    expect(output).toContain('fill:#fecaca');
  });
});

// ─── HTML output tests ───

describe('formatGraphHtml', () => {
  it('produces valid HTML structure', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphHtml(graph);
    expect(output).toContain('<!DOCTYPE html>');
    expect(output).toContain('<html');
    expect(output).toContain('</html>');
  });

  it('includes Mermaid CDN script tag', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphHtml(graph);
    expect(output).toContain('cdn.jsdelivr.net/npm/mermaid');
  });

  it('contains the Mermaid diagram definition', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphHtml(graph);
    expect(output).toContain('graph TD');
    expect(output).toContain('class="mermaid"');
  });

  it('has legend section', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphHtml(graph);
    expect(output).toContain('Legend:');
    expect(output).toContain('agent');
    expect(output).toContain('skill');
    expect(output).toContain('orphan');
    expect(output).toContain('broken ref');
  });

  it('has zoom controls', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphHtml(graph);
    expect(output).toContain('zoom-in');
    expect(output).toContain('zoom-out');
    expect(output).toContain('zoom-reset');
  });

  it('includes stats in header', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphHtml(graph);
    expect(output).toContain('4 nodes'); // 3 connected + 1 orphan
    expect(output).toContain('3 edges');
    expect(output).toContain('1 orphans');
  });

  it('has the page title', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphHtml(graph);
    expect(output).toContain('ccinspect');
    expect(output).toContain('Dependency Graph');
  });
});

// ─── Text output tests ───

describe('formatGraphText', () => {
  it('contains summary line with node and edge counts', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphText(graph);
    expect(output).toContain('4 nodes');
    expect(output).toContain('3 edges');
  });

  it('lists connected nodes with their edges', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphText(graph);
    expect(output).toContain('reviewer');
    expect(output).toContain('code-review');
  });

  it('shows broken references section', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphText(graph);
    expect(output).toContain('Broken References');
    expect(output).toContain('not found');
  });

  it('shows orphan section', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphText(graph);
    expect(output).toContain('Orphans');
    expect(output).toContain('deploy');
  });

  it('shows token counts', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphText(graph);
    expect(output).toContain('390 tokens');
    expect(output).toContain('180 tokens');
  });

  it('produces sensible output for empty graph', () => {
    const graph = makeEmptyGraph();
    const output = formatGraphText(graph);
    expect(output).toContain('0 nodes');
    expect(output).toContain('0 edges');
    expect(output).not.toContain('Broken References');
    expect(output).not.toContain('Orphans');
  });

  it('shows edge type indicators', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphText(graph);
    expect(output).toContain('references:');
  });

  it('uses tree characters for structure', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphText(graph);
    // Tree connectors
    expect(output).toMatch(/[├└]/);
  });
});

// ─── JSON output tests ───

describe('formatGraphJson', () => {
  it('produces valid JSON', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphJson(graph);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('parses back to matching structure', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphJson(graph);
    const parsed = JSON.parse(output) as DependencyGraph;
    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.edges).toHaveLength(3);
    expect(parsed.orphans).toHaveLength(1);
  });

  it('preserves node properties', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphJson(graph);
    const parsed = JSON.parse(output) as DependencyGraph;
    const reviewer = parsed.nodes.find((n) => n.label === 'reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer!.type).toBe('agent');
    expect(reviewer!.tokens).toBe(180);
    expect(reviewer!.scope).toBe('project-shared');
  });

  it('preserves edge properties', () => {
    const graph = makeSimpleGraph();
    const output = formatGraphJson(graph);
    const parsed = JSON.parse(output) as DependencyGraph;
    const brokenEdge = parsed.edges.find((e) => e.isBroken);
    expect(brokenEdge).toBeDefined();
    expect(brokenEdge!.type).toBe('delegation');
  });
});

// ─── Integration with real fixture ───

describe('formatters with graph-complex fixture', () => {
  const projectDir = join(FIXTURES, 'graph-complex');

  function getGraph(): DependencyGraph {
    const inventory = scan({ projectDir });
    return buildDependencyGraph(inventory, projectDir);
  }

  it('mermaid output includes all node types', () => {
    const output = formatGraphMermaid(getGraph());
    expect(output).toContain('agent');
    expect(output).toContain('skill');
    expect(output).toContain('claude-md');
  });

  it('text output includes orphan-bot', () => {
    const output = formatGraphText(getGraph());
    expect(output).toContain('orphan-bot');
  });

  it('json output produces valid parseable JSON', () => {
    const output = formatGraphJson(getGraph());
    const parsed = JSON.parse(output) as DependencyGraph;
    const allNodes = [...parsed.nodes, ...parsed.orphans];
    expect(allNodes.length).toBe(10);
  });
});
