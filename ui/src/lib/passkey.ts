// Face ID through WebAuthn. The hub sends options as JSON with binary
// fields in base64url; the browser wants ArrayBuffers, and gives back a
// credential the hub reads as JSON again. These turn one into the other.

/** Bytes as base64url, without padding. */
export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (const byte of view) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (or plain base64) to bytes. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = plain + '='.repeat((4 - (plain.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

type Json = Record<string, unknown>;

function object(value: unknown, what: string): Json {
  if (!value || typeof value !== 'object') {
    throw new Error(`The laptop's ${what} isn't what Face ID expects.`);
  }
  return value as Json;
}

function credentialList(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((item) => {
    const entry = object(item, 'credential list');
    return { type: 'public-key', id: fromBase64Url(String(entry.id)) };
  });
}

/** The hub's setup options as `navigator.credentials.create` takes them. */
export function creationOptions(answer: unknown): PublicKeyCredentialCreationOptions {
  const options = object(object(answer, 'setup').publicKey, 'setup');
  const user = object(options.user, 'setup');
  return {
    ...(options as unknown as PublicKeyCredentialCreationOptions),
    challenge: fromBase64Url(String(options.challenge)),
    user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: fromBase64Url(String(user.id)) },
    excludeCredentials: credentialList(options.excludeCredentials),
  };
}

/** The hub's unlock options as `navigator.credentials.get` takes them. */
export function requestOptions(answer: unknown): PublicKeyCredentialRequestOptions {
  const options = object(object(answer, 'unlock').publicKey, 'unlock');
  return {
    ...(options as unknown as PublicKeyCredentialRequestOptions),
    challenge: fromBase64Url(String(options.challenge)),
    allowCredentials: credentialList(options.allowCredentials),
  };
}

function asPublicKey(credential: Credential | null): PublicKeyCredential {
  if (!credential || credential.type !== 'public-key') {
    throw new Error('Face ID gave nothing back.');
  }
  return credential as PublicKeyCredential;
}

/** A new credential, as the hub reads it. */
export function registrationJson(credential: Credential | null): Json {
  const key = asPublicKey(credential);
  const response = key.response as AuthenticatorAttestationResponse;
  return {
    id: key.id,
    rawId: toBase64Url(key.rawId),
    type: key.type,
    response: {
      attestationObject: toBase64Url(response.attestationObject),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : undefined,
    },
    extensions: key.getClientExtensionResults(),
  };
}

/** An unlock answer, as the hub reads it. */
export function assertionJson(credential: Credential | null): Json {
  const key = asPublicKey(credential);
  const response = key.response as AuthenticatorAssertionResponse;
  return {
    id: key.id,
    rawId: toBase64Url(key.rawId),
    type: key.type,
    response: {
      authenticatorData: toBase64Url(response.authenticatorData),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      signature: toBase64Url(response.signature),
      userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
    },
    extensions: key.getClientExtensionResults(),
  };
}

export function passkeysAvailable(): boolean {
  return typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;
}

/** The words for a WebAuthn failure. Cancelling isn't an error worth shouting. */
export function passkeyFailure(error: unknown): string | null {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return null;
  return error instanceof Error ? error.message : String(error);
}
