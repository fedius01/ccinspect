import type { ConfigInventory } from '../types/inventory.js';
import type { HistoryConfig } from '../types/history.js';
import { reconstruct } from './history-reconstructor.js';

/**
 * Run history reconstruction after a scan, wrapped in try/catch so it
 * never blocks the primary command.
 *
 * Called from CLI command handlers after `scan()` completes and before
 * any analysis begins. Returns silently on failure.
 *
 * @param projectRoot - Absolute path to the project root
 * @param inventory - The scanner output
 * @param trigger - Which cci command triggered this (e.g., 'scan', 'lint')
 * @param historyConfig - Optional history config from .ccinspect.json
 */
export async function runHistoryReconstruction(
  projectRoot: string,
  inventory: ConfigInventory,
  trigger: string,
  historyConfig?: HistoryConfig,
): Promise<void> {
  // Skip if history is explicitly disabled
  if (historyConfig?.enabled === false) return;

  try {
    await reconstruct(projectRoot, inventory, {
      trigger,
      sources: {
        git: historyConfig?.sources?.git !== false,
        disk: historyConfig?.sources?.disk !== false,
        transcripts: historyConfig?.sources?.transcripts !== false,
      },
      maxVersions: historyConfig?.maxVersions ?? 200,
      coalesceWindowSeconds: historyConfig?.coalesceWindowSeconds ?? 60,
      includeUserScope: historyConfig?.includeUserScope ?? false,
    });
  } catch {
    // Non-fatal: reconstruction failure must never block the primary command
  }
}
