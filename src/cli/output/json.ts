import type { ConfigInventory, LintResult } from '../../types/index.js';
import type { RuntimeInfo } from '../../types/runtime.js';

export function printInventoryJson(inventory: ConfigInventory): void {
  console.log(JSON.stringify(inventory, null, 2));
}

export function printRuntimeInfoJson(info: RuntimeInfo): void {
  console.log(JSON.stringify(info, null, 2));
}

export function printLintResultJson(result: LintResult): void {
  const output = {
    ...result,
    stats: {
      ...result.stats,
      notes: result.stats.infos,
    },
  };
  console.log(JSON.stringify(output, null, 2));
}
