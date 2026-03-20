import { describe, it, expect } from 'vitest';
import { getAllRules } from '../../src/rules/index.js';
import { getRuleMetadata } from '../../src/rules/rule-metadata.js';

// Access the RULE_METADATA map keys via a re-export-free approach:
// Import the module and call getRuleMetadata for each known rule.
// For orphan detection, we need the map keys directly.
import { RULE_METADATA_KEYS } from '../../src/rules/rule-metadata.js';

describe('Rule metadata coverage', () => {
  it('every registered rule has LLM metadata', () => {
    const rules = getAllRules();
    const missing: string[] = [];

    for (const rule of rules) {
      const meta = getRuleMetadata(rule.id);
      if (!meta) {
        missing.push(rule.id);
      }
    }

    expect(missing, `Rules missing metadata: ${missing.join(', ')}`).toEqual([]);
  });

  it('no orphan metadata entries (every metadata key maps to a registered rule)', () => {
    const rules = getAllRules();
    const registeredIds = new Set(rules.map((r) => r.id));
    const orphans: string[] = [];

    for (const metaKey of RULE_METADATA_KEYS) {
      if (!registeredIds.has(metaKey)) {
        orphans.push(metaKey);
      }
    }

    expect(orphans, `Orphan metadata entries: ${orphans.join(', ')}`).toEqual([]);
  });
});
