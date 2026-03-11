/**
 * Contradiction Keywords — Precision/Recall Evaluation Runner
 *
 * Standalone measurement script (NOT a vitest test).
 * Runs the contradiction-keywords rule against a labeled corpus of rule file pairs
 * and computes precision, recall, and F1 score.
 *
 * Usage: npx tsx tests/corpus/contradiction-keywords/eval.ts
 */

import { readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { ConfigInventory, RuleFileInfo } from '../../../src/types/index.js';
import type { ResolvedConfig } from '../../../src/types/resolved.js';
import { contradictionKeywordsRule } from '../../../src/rules/rules-dir/contradiction-keywords.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(__dirname, '.');

interface CorpusEntry {
  id: string;
  dir: string;
  expectedFire: boolean; // true = TP (should fire), false = TN (should not fire)
}

interface EvalResult {
  id: string;
  expectedFire: boolean;
  actualFire: boolean;
  issueCount: number;
  pass: boolean;
  category: 'TP' | 'FP' | 'TN' | 'FN';
  details?: string;
}

function discoverCorpus(): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  const dirs = readdirSync(CORPUS_DIR)
    .filter((d) => {
      const full = join(CORPUS_DIR, d);
      return statSync(full).isDirectory() && (d.startsWith('TP') || d.startsWith('TN'));
    })
    .sort();

  for (const dir of dirs) {
    entries.push({
      id: dir,
      dir: join(CORPUS_DIR, dir),
      expectedFire: dir.startsWith('TP'),
    });
  }
  return entries;
}

function makeRuleFileInfo(filePath: string, relativePath: string): RuleFileInfo {
  return {
    path: filePath,
    relativePath,
    exists: true,
    scope: 'project-shared',
    sizeBytes: 0,
    lineCount: 0,
    estimatedTokens: 0,
    gitTracked: false,
    lastModified: new Date(),
  };
}

function makeMinimalInventory(corpusDir: string, rules: RuleFileInfo[]): ConfigInventory {
  return {
    projectRoot: corpusDir,
    gitRoot: null,
    userSettings: null,
    projectSettings: null,
    localSettings: null,
    managedSettings: null,
    preferences: null,
    globalClaudeMd: null,
    projectClaudeMd: null,
    localClaudeMd: null,
    subdirClaudeMds: [],
    autoMemory: null,
    autoMemoryTopics: [],
    rules,
    projectAgents: [],
    userAgents: [],
    projectCommands: [],
    userCommands: [],
    projectSkills: [],
    projectMcp: null,
    managedMcp: null,
    plugins: [],
    pluginAgents: [],
    hooks: [],
    totalFiles: rules.length,
    totalStartupTokens: 0,
    totalOnDemandTokens: 0,
  };
}

function makeMinimalResolved(): ResolvedConfig {
  return {
    permissions: {
      effectiveAllow: [],
      effectiveDeny: [],
      effectiveAsk: [],
      conflicts: [],
      redundancies: [],
    },
    environment: {
      effective: new Map(),
      shadows: [],
    },
    mcpServers: {
      effective: [],
      conflicts: [],
    },
    model: {
      effectiveModel: { value: 'claude-sonnet-4-20250514', origin: '' },
      subagentModel: null,
      haikuModel: null,
      opusModel: null,
    },
    sandbox: {
      enabled: { value: false, origin: '' },
      autoAllowBashIfSandboxed: null,
      excludedCommands: null,
      networkConfig: {},
    },
    plugins: {
      effective: [],
      conflicts: [],
    },
  };
}

function runEntry(entry: CorpusEntry): EvalResult {
  const ruleAPath = join(entry.dir, 'rule-a.md');
  const ruleBPath = join(entry.dir, 'rule-b.md');

  const rules: RuleFileInfo[] = [
    makeRuleFileInfo(ruleAPath, 'rule-a.md'),
    makeRuleFileInfo(ruleBPath, 'rule-b.md'),
  ];

  const inventory = makeMinimalInventory(entry.dir, rules);
  const resolved = makeMinimalResolved();

  const issues = contradictionKeywordsRule.check(inventory, resolved);
  const actualFire = issues.length > 0;
  const pass = actualFire === entry.expectedFire;

  let category: EvalResult['category'];
  if (entry.expectedFire && actualFire) category = 'TP';
  else if (!entry.expectedFire && !actualFire) category = 'TN';
  else if (!entry.expectedFire && actualFire) category = 'FP';
  else category = 'FN';

  const details = issues.length > 0
    ? issues.map((i) => i.message).join('; ')
    : undefined;

  return { id: entry.id, expectedFire: entry.expectedFire, actualFire, issueCount: issues.length, pass, category, details };
}

function main(): void {
  const corpus = discoverCorpus();

  if (corpus.length === 0) {
    console.error('No corpus entries found. Check the directory structure.');
    process.exit(1);
  }

  console.log('Contradiction Keywords — Precision/Recall Evaluation');
  console.log('=====================================================\n');

  const results: EvalResult[] = [];
  for (const entry of corpus) {
    results.push(runEntry(entry));
  }

  // Print detailed results
  console.log('RESULTS:');
  const maxIdLen = Math.max(...results.map((r) => r.id.length));
  for (const r of results) {
    const expected = r.expectedFire ? 'FIRE  ' : 'SILENT';
    const actual = r.actualFire ? 'FIRE  ' : 'SILENT';
    const status = r.pass ? '\x1b[32m✅ PASS\x1b[0m' : '\x1b[31m❌ FAIL\x1b[0m';
    let failLabel = '';
    if (!r.pass) {
      failLabel = r.category === 'FP' ? ' (False Positive)' : ' (False Negative)';
    }
    console.log(`  ${r.id.padEnd(maxIdLen)}  Expected: ${expected}  Actual: ${actual}  ${status}${failLabel}`);
  }

  // Compute metrics
  const tp = results.filter((r) => r.category === 'TP').length;
  const tn = results.filter((r) => r.category === 'TN').length;
  const fp = results.filter((r) => r.category === 'FP').length;
  const fn = results.filter((r) => r.category === 'FN').length;

  const totalExpectedPositive = results.filter((r) => r.expectedFire).length;
  const totalExpectedNegative = results.filter((r) => !r.expectedFire).length;
  const totalFlagged = tp + fp;

  const precision = totalFlagged > 0 ? tp / totalFlagged : 0;
  const recall = totalExpectedPositive > 0 ? tp / totalExpectedPositive : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  console.log('\nSUMMARY:');
  const missedSuffix = fn > 0 ? ` (${fn} missed)` : '';
  console.log(`  True Positives:  ${tp}/${totalExpectedPositive}${missedSuffix}`);
  const fpSuffix = fp > 0 ? ` (${fp} false positives)` : '';
  console.log(`  True Negatives:  ${tn}/${totalExpectedNegative}${fpSuffix}`);
  console.log(`  Precision:       ${(precision * 100).toFixed(1)}% (${tp} / ${totalFlagged} flagged)`);
  console.log(`  Recall:          ${(recall * 100).toFixed(1)}% (${tp} / ${totalExpectedPositive} real contradictions)`);
  console.log(`  F1:              ${(f1 * 100).toFixed(1)}%`);

  // Print failures with details
  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log('\nFAILURES:');
    for (const f of failures) {
      if (f.category === 'FN') {
        console.log(`  ${f.id} — Expected FIRE but got SILENT`);
      } else if (f.category === 'FP') {
        console.log(`  ${f.id} — Expected SILENT but got FIRE: ${f.details}`);
      }
    }
  } else {
    console.log('\n  All entries matched expectations.');
  }

  // Exit with code 0 always — this is a measurement script, not an assertion
  console.log(`\nCorpus: ${corpus.length} pairs (${totalExpectedPositive} TP, ${totalExpectedNegative} TN)`);
}

main();
