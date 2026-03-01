/**
 * Sanitize a graph node ID for use as a Mermaid node identifier.
 *
 * Mermaid node IDs only allow alphanumeric characters and underscores.
 * This function deterministically converts any string into a valid ID.
 *
 * Example: "agent:.claude/agents/reviewer.md" → "agent__claude_agents_reviewer_md"
 */
export function sanitizeMermaidId(nodeId: string): string {
  // Replace all non-alphanumeric characters with underscore
  let sanitized = nodeId.replace(/[^a-zA-Z0-9]/g, '_');

  // Collapse consecutive underscores to a single one
  sanitized = sanitized.replace(/_+/g, '_');

  // Remove trailing underscores
  sanitized = sanitized.replace(/_$/, '');

  // Ensure it starts with a letter (prefix with n_ if it starts with a digit)
  if (/^\d/.test(sanitized)) {
    sanitized = `n_${sanitized}`;
  }

  return sanitized;
}

/**
 * Escape special characters in a string for use inside Mermaid node labels.
 * Characters like <, >, ", {, } break Mermaid syntax.
 */
export function escapeMermaidLabel(label: string): string {
  return label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}
