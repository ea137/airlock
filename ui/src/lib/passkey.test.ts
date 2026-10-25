import { describe, expect, it } from 'vitest';

import { creationOptions, fromBase64Url, requestOptions, toBase64Url } from './passkey';

describe('base64url', () => {
  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it('writes no padding and only URL-safe characters', () => {
    const text = toBase64Url(new Uint8Array([251, 255, 191]));
    expect(text).toBe('-_-_');
    expect(toBase64Url(new Uint8Array([1]))).toBe('AQ');
  });

  it('reads plain base64 too', () => {
    expect(fromBase64Url('+/+/')).toEqual(new Uint8Array([251, 255, 191]));
  });
});

describe('options from the hub', () => {
  it('turns setup options into what create() takes', () => {
    const options = creationOptions({
      publicKey: {
        rp: { id: 'laptop.example.ts.net', name: 'Airlock' },
        user: { id: 'AQID', name: 'iPhone', displayName: 'iPhone' },
        challenge: 'BAUG',
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        excludeCredentials: [{ type: 'public-key', id: 'Bwg' }],
      },
    });
    expect(options.challenge).toEqual(new Uint8Array([4, 5, 6]));
    expect(options.user.id).toEqual(new Uint8Array([1, 2, 3]));
    expect(options.user.name).toBe('iPhone');
    expect(options.rp.id).toBe('laptop.example.ts.net');
    expect(options.excludeCredentials?.[0]?.id).toEqual(new Uint8Array([7, 8]));
  });

  it('turns unlock options into what get() takes', () => {
    const options = requestOptions({
      publicKey: { challenge: 'BAUG', rpId: 'localhost', allowCredentials: [{ type: 'public-key', id: 'Bwg' }] },
    });
    expect(options.challenge).toEqual(new Uint8Array([4, 5, 6]));
    expect(options.rpId).toBe('localhost');
    expect(options.allowCredentials?.[0]?.id).toEqual(new Uint8Array([7, 8]));
  });

  it('refuses something that is not options', () => {
    expect(() => requestOptions({ nope: true })).toThrow("The laptop's unlock isn't what Face ID expects.");
  });
});
