import chalk from 'chalk';
import type { DependencyGraph, GraphEdge, GraphNodeType } from '../../types/index.js';
import { sanitizeMermaidId, escapeMermaidLabel } from '../../utils/graph-helpers.js';

// ─── Color / style constants ───

const NODE_FILL_COLORS: Record<GraphNodeType, string> = {
  'claude-md': '#dbeafe',
  'rule': '#d1fae5',
  'agent': '#ede9fe',
  'skill': '#ffedd5',
  'command': '#e0f2fe',
  'mcp-server': '#f3f4f6',
};

const NODE_EMOJI: Record<GraphNodeType, string> = {
  'claude-md': '\u{1F4C4}',
  'rule': '\u{1F4D0}',
  'agent': '\u{1F464}',
  'skill': '\u{1F527}',
  'command': '\u26A1',
  'mcp-server': '\u{1F50C}',
};

const NODE_TYPE_LABEL: Record<GraphNodeType, string> = {
  'claude-md': 'claude-md',
  'rule': 'rule',
  'agent': 'agent',
  'skill': 'skill',
  'command': 'command',
  'mcp-server': 'mcp',
};

const EDGE_TYPE_LABEL: Record<GraphEdge['type'], string> = {
  'import': 'imports',
  'delegation': 'delegates to',
  'reference': 'references',
  'fork': 'forks',
};

// ─── Token formatting ───

function formatTokens(tokens: number): string {
  if (tokens === 0) return '0 tokens';
  if (tokens < 1000) return `${tokens} tokens`;
  return `${(tokens / 1000).toFixed(1)}k tokens`;
}

// ─── Mermaid formatter ───

export function formatGraphMermaid(graph: DependencyGraph): string {
  const lines: string[] = ['graph TD'];

  const allNodes = [...graph.nodes, ...graph.orphans];

  // Emit node definitions
  for (const node of allNodes) {
    const mid = sanitizeMermaidId(node.id);
    const typeLabel = NODE_TYPE_LABEL[node.type];
    const label = escapeMermaidLabel(node.label);
    const tokenStr = formatTokens(node.tokens);
    lines.push(`    ${mid}["${label}<br/>${typeLabel} &middot; ${tokenStr}"]`);
  }

  lines.push('');

  // Emit edges
  for (const edge of graph.edges) {
    const srcId = sanitizeMermaidId(edge.source);
    const tgtId = sanitizeMermaidId(edge.target);
    const label = edge.type;

    if (edge.isBroken) {
      // Broken edges: dotted arrow with "broken" label
      // If target doesn't exist as a node, create a placeholder
      const targetExists = allNodes.some((n) => n.id === edge.target);
      if (!targetExists) {
        const placeholderId = sanitizeMermaidId(edge.target);
        const placeholderLabel = escapeMermaidLabel(extractNameFromId(edge.target));
        lines.push(`    ${placeholderId}["${placeholderLabel}"]`);
      }
      lines.push(`    ${srcId} -.->|broken: ${label}| ${tgtId}`);
    } else {
      lines.push(`    ${srcId} -->|${label}| ${tgtId}`);
    }
  }

  lines.push('');

  // Apply styles — node type colors
  for (const node of allNodes) {
    const mid = sanitizeMermaidId(node.id);
    const fill = NODE_FILL_COLORS[node.type];
    const isOrphan = graph.orphans.includes(node);
    if (isOrphan) {
      lines.push(`    style ${mid} fill:#f5f5f5,stroke:#ccc,stroke-dasharray: 5 5`);
    } else {
      lines.push(`    style ${mid} fill:${fill}`);
    }
  }

  // Style broken-reference placeholder nodes
  for (const edge of graph.edges) {
    if (edge.isBroken) {
      const targetExists = allNodes.some((n) => n.id === edge.target);
      if (!targetExists) {
        const tgtId = sanitizeMermaidId(edge.target);
        lines.push(`    style ${tgtId} fill:#fecaca,stroke:#ef4444,stroke-dasharray: 5 5`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

// ─── HTML formatter ───

export function formatGraphHtml(graph: DependencyGraph): string {
  const mermaidDef = formatGraphMermaid(graph);

  // Build legend items
  const legendItems = Object.entries(NODE_FILL_COLORS)
    .map(([type, color]) => {
      const label = NODE_TYPE_LABEL[type as GraphNodeType];
      return `<span style="display:inline-flex;align-items:center;margin-right:16px;"><span style="display:inline-block;width:16px;height:16px;background:${color};border:1px solid #888;border-radius:3px;margin-right:6px;"></span>${label}</span>`;
    })
    .join('\n          ');

  const totalNodes = graph.nodes.length + graph.orphans.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ccinspect \u2014 Dependency Graph</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; color: #333; }
    header { padding: 16px 24px; background: #fff; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; justify-content: space-between; }
    header h1 { font-size: 18px; font-weight: 600; }
    .stats { font-size: 13px; color: #6b7280; }
    .controls { padding: 8px 24px; background: #fff; border-bottom: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px; }
    .controls button { padding: 4px 12px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; font-size: 13px; }
    .controls button:hover { background: #f3f4f6; }
    .legend { padding: 8px 24px; background: #fff; border-bottom: 1px solid #e5e7eb; font-size: 13px; display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    .legend-label { font-weight: 600; margin-right: 8px; }
    #graph-container { width: 100%; height: calc(100vh - 140px); overflow: auto; display: flex; justify-content: center; padding: 24px; }
    #graph-container svg { max-width: none !important; }
    .zoom-level { font-size: 13px; color: #6b7280; min-width: 40px; text-align: center; }
  </style>
</head>
<body>
  <header>
    <h1>ccinspect \u2014 Dependency Graph</h1>
    <span class="stats">${totalNodes} nodes, ${graph.edges.length} edges, ${graph.orphans.length} orphans</span>
  </header>
  <div class="controls">
    <button id="zoom-in" title="Zoom in">+</button>
    <span class="zoom-level" id="zoom-display">100%</span>
    <button id="zoom-out" title="Zoom out">\u2212</button>
    <button id="zoom-reset" title="Reset zoom">Reset</button>
  </div>
  <div class="legend">
    <span class="legend-label">Legend:</span>
    ${legendItems}
    <span style="display:inline-flex;align-items:center;margin-right:16px;"><span style="display:inline-block;width:16px;height:16px;background:#f5f5f5;border:1px dashed #ccc;border-radius:3px;margin-right:6px;"></span>orphan</span>
    <span style="display:inline-flex;align-items:center;margin-right:16px;"><span style="display:inline-block;width:16px;height:16px;background:#fecaca;border:1px dashed #ef4444;border-radius:3px;margin-right:6px;"></span>broken ref</span>
  </div>
  <div id="graph-container">
    <pre class="mermaid">
${mermaidDef}
    </pre>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
    let scale = 1;
    const container = document.getElementById('graph-container');
    const display = document.getElementById('zoom-display');
    function updateZoom() {
      const svg = container.querySelector('svg');
      if (svg) { svg.style.transform = 'scale(' + scale + ')'; svg.style.transformOrigin = 'top center'; }
      display.textContent = Math.round(scale * 100) + '%';
    }
    document.getElementById('zoom-in').addEventListener('click', function() { scale = Math.min(scale + 0.2, 3); updateZoom(); });
    document.getElementById('zoom-out').addEventListener('click', function() { scale = Math.max(scale - 0.2, 0.2); updateZoom(); });
    document.getElementById('zoom-reset').addEventListener('click', function() { scale = 1; updateZoom(); });
  </script>
</body>
</html>
`;
}

// ─── Text tree formatter ───

export function formatGraphText(graph: DependencyGraph): string {
  const allNodes = [...graph.nodes, ...graph.orphans];
  const totalEdges = graph.edges.length;
  const lines: string[] = [];

  lines.push(`Dependency Graph (${allNodes.length} nodes, ${totalEdges} edges)`);
  lines.push('');

  // Build adjacency map: source → outgoing edges
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
  }

  // Print connected nodes with their outgoing edges
  for (const node of graph.nodes) {
    const emoji = NODE_EMOJI[node.type];
    const typeLabel = NODE_TYPE_LABEL[node.type];
    const tokenStr = formatTokens(node.tokens);
    lines.push(chalk.bold(`${emoji} ${node.label}`) + chalk.gray(` (${typeLabel}, ${node.scope}, ${tokenStr})`));

    const edges = outgoing.get(node.id) ?? [];
    if (edges.length === 0) {
      lines.push(chalk.gray('   (no outgoing references)'));
    } else {
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const isLast = i === edges.length - 1;
        const prefix = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
        const edgeLabel = edgeIcon(edge.type);
        const targetName = extractNameFromId(edge.target);

        if (edge.isBroken) {
          lines.push(chalk.red(`${prefix}${edgeLabel} ${targetName}`) + chalk.red(' (not found)'));
        } else {
          lines.push(`${prefix}${edgeLabel} ${targetName}`);
        }
      }
    }

    lines.push('');
  }

  // Broken references summary
  const brokenEdges = graph.edges.filter((e) => e.isBroken);
  if (brokenEdges.length > 0) {
    lines.push(chalk.red.bold('\u26A0\uFE0F  Broken References:'));
    for (let i = 0; i < brokenEdges.length; i++) {
      const edge = brokenEdges[i];
      const isLast = i === brokenEdges.length - 1;
      const prefix = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
      const sourceName = extractNameFromId(edge.source);
      const targetName = extractNameFromId(edge.target);
      const edgeType = edge.type;
      lines.push(chalk.red(`${prefix}${sourceName} \u2192 ${targetName} (${edgeType} not found)`));
    }
    lines.push('');
  }

  // Orphans section
  if (graph.orphans.length > 0) {
    lines.push(chalk.yellow.bold('\u{1F7E8} Orphans (no connections):'));
    for (let i = 0; i < graph.orphans.length; i++) {
      const node = graph.orphans[i];
      const isLast = i === graph.orphans.length - 1;
      const prefix = isLast ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
      const typeLabel = NODE_TYPE_LABEL[node.type];
      const tokenStr = formatTokens(node.tokens);
      lines.push(chalk.yellow(`${prefix}${node.label}`) + chalk.gray(` (${typeLabel}, ${tokenStr})`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── JSON formatter ───

export function formatGraphJson(graph: DependencyGraph): string {
  return JSON.stringify(graph, null, 2);
}

// ─── Internal helpers ───

function edgeIcon(type: GraphEdge['type']): string {
  switch (type) {
    case 'import':
      return '\u{1F4E5} imports:';
    case 'delegation':
      return '\u{1F500} delegates to:';
    case 'reference':
      return '\u{1F517} references:';
    case 'fork':
      return '\u{1F500} forks:';
    default:
      return `${EDGE_TYPE_LABEL[type]}:`;
  }
}

/**
 * Extract a human-readable name from a node ID like "agent:.claude/agents/reviewer.md".
 */
function extractNameFromId(nodeId: string): string {
  const colonIdx = nodeId.indexOf(':');
  if (colonIdx === -1) return nodeId;
  const path = nodeId.substring(colonIdx + 1);
  // For skill SKILL.md paths, take parent dir name
  if (path.endsWith('/SKILL.md')) {
    const parts = path.split('/');
    return parts[parts.length - 2] ?? path;
  }
  // For other paths, take basename without .md
  const base = path.split('/').pop() ?? path;
  if (base.endsWith('.md')) return base.slice(0, -3);
  // MCP server refs like ".mcp.json#github" → "github"
  const hashIdx = base.indexOf('#');
  if (hashIdx !== -1) return base.substring(hashIdx + 1);
  return base;
}
