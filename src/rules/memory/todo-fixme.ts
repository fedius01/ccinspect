import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig, FileInfo } from '../../types/index.js';
import { readFileSync } from 'fs';

const DEFAULT_MARKERS = ['TODO', 'FIXME', 'HACK', 'XXX', 'TEMP', 'PLACEHOLDER'];

function existingFiles(files: (FileInfo | null)[]): FileInfo[] {
  return files.filter((f): f is FileInfo => f !== null && f.exists);
}

/**
 * Build a regex that matches a marker as a standalone word (word boundary match).
 * Case-insensitive.
 */
function buildMarkerRegex(markers: string[]): RegExp {
  const escaped = markers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

/**
 * Given file content lines, return the set of line indices that are inside
 * fenced code blocks (``` ... ```).
 */
function getFencedLineIndices(lines: string[]): Set<number> {
  const fenced = new Set<number>();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trimStart())) {
      if (inFence) {
        // closing fence — mark it and exit
        fenced.add(i);
        inFence = false;
      } else {
        // opening fence
        fenced.add(i);
        inFence = true;
      }
    } else if (inFence) {
      fenced.add(i);
    }
  }
  return fenced;
}

function scanFileForMarkers(
  file: FileInfo,
  markerRegex: RegExp,
): LintIssue[] {
  const issues: LintIssue[] = [];

  let content: string;
  try {
    content = readFileSync(file.path, 'utf-8');
  } catch {
    return issues;
  }

  const lines = content.split('\n');
  const fencedLines = getFencedLineIndices(lines);

  for (let i = 0; i < lines.length; i++) {
    // Skip lines inside fenced code blocks
    if (fencedLines.has(i)) {
      continue;
    }

    const line = lines[i];
    const match = markerRegex.exec(line);
    if (match) {
      const marker = match[1].toUpperCase();
      issues.push({
        ruleId: 'memory/todo-fixme',
        severity: 'info',
        category: 'memory',
        message: `${file.relativePath} line ${i + 1}: Contains "${marker}" marker — stale ${marker}s in instructions may confuse Claude or indicate incomplete configuration.`,
        file: file.path,
        line: i + 1,
        suggestion: `Resolve the ${marker} and update the instruction, or remove it if no longer relevant.`,
        autoFixable: false,
      });
    }
  }

  return issues;
}

export const todoFixmeRule: LintRule = {
  id: 'memory/todo-fixme',
  description: 'Flag TODO, FIXME, HACK, XXX markers in CLAUDE.md and rule files',
  severity: 'info',
  category: 'memory',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];
    const extraMarkers = (options?.extraMarkers as string[] | undefined) ?? [];
    const markers = [...DEFAULT_MARKERS, ...extraMarkers];
    const markerRegex = buildMarkerRegex(markers);

    // Scan CLAUDE.md files
    const claudeMdFiles = existingFiles([
      inventory.globalClaudeMd,
      inventory.projectClaudeMd,
      inventory.localClaudeMd,
      ...inventory.subdirClaudeMds,
    ]);

    for (const file of claudeMdFiles) {
      issues.push(...scanFileForMarkers(file, markerRegex));
    }

    // Scan rule files
    for (const rule of inventory.rules) {
      if (!rule.exists) {
        continue;
      }
      issues.push(...scanFileForMarkers(rule, markerRegex));
    }

    return issues;
  },
};
