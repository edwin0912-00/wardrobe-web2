import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ConditioningError } from './errors.mjs';

export async function readInputBytes(input) {
  if (Buffer.isBuffer(input)) return Buffer.from(input);
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof URL) {
    if (input.protocol !== 'file:') {
      throw new ConditioningError(
        'REMOTE_INPUT_NOT_ALLOWED',
        `Conditioning only accepts local files; received ${input.protocol}`,
      );
    }
    return readFile(fileURLToPath(input));
  }
  if (typeof input === 'string' && input.length > 0) return readFile(input);
  throw new ConditioningError(
    'INVALID_INPUT',
    'Expected a local path, file URL, Buffer, or Uint8Array.',
  );
}
