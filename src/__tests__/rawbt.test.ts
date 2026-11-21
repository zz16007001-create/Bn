import {describe, expect, it} from 'vitest';
import {
  RAWBT_PACKAGE,
  buildRawBtIntentUrl,
  bytesToBase64,
} from '../services/rawbtPrinter';

describe('RawBT intent builder', () => {
  it('encodes bytes to base64 correctly, including large payloads', () => {
    expect(bytesToBase64(new Uint8Array([0x1b, 0x40, 0x41]))).toBe('G0BB');
    const big = new Uint8Array(100_000).fill(0xff);
    expect(atob(bytesToBase64(big)).length).toBe(100_000);
  });

  it('builds an Android intent URL targeting the RawBT package', () => {
    const url = buildRawBtIntentUrl(new Uint8Array([0x1b, 0x40]));
    expect(url.startsWith('intent:base64,G0A=#Intent;scheme=RawBT;')).toBe(true);
    expect(url).toContain(`package=${RAWBT_PACKAGE}`);
    expect(url).toContain('S.browser_fallback_url=');
    expect(url.endsWith('end;')).toBe(true);
  });

  it('rejects empty payloads', () => {
    expect(() => buildRawBtIntentUrl(new Uint8Array())).toThrow();
  });
});
