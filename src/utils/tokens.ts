import { get_encoding, type Tiktoken } from 'tiktoken';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding('cl100k_base');
  }
  return encoder;
}

export function estimateTokens(text: string): number {
  try {
    const enc = getEncoder();
    return enc.encode(text).length;
  } catch {
    // Fallback: rough estimation (1 token ~ 4 chars)
    return Math.ceil(text.length / 4);
  }
}

export function freeEncoder(): void {
  if (encoder) {
    encoder.free();
    encoder = null;
  }
}
