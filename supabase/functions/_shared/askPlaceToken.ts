/**
 * Cross-turn place references that survive a browser without trusting one.
 *
 * Ask earns place identity within a single turn: a model may only point at ids
 * a place-bearing tool returned during that turn, checked against the
 * server-owned index. That rule is what makes a card trustworthy, and it is
 * also why "is the second one open late?" could not work — the second one was
 * established last turn, and nothing carried it forward.
 *
 * The obvious fix is to let the browser send the canonical id back. It is also
 * the wrong one: `canonicalPlaceId`, `provider` and `providerPlaceId` are three
 * strings a page can type, so accepting them would mean any script on the
 * origin could mint authority for any place in the database.
 *
 * So the browser carries a **token instead of an identity**. The server signs
 * the identity, the browser stores an opaque string it cannot alter without
 * invalidating, and on the next request the server reads its own signature back.
 * The traveller's device becomes a courier rather than a witness.
 *
 * ## What a signature does and does not buy
 *
 * A valid signature proves *this server issued this triple, for this user, on
 * this trip, recently*. It proves nothing about whether the triple is still
 * true — link tables get corrected, merged and repaired — so verification here
 * is necessary and never sufficient. The caller must re-resolve
 * `(provider, providerPlaceId)` against `place_provider_links` and require the
 * canonical id to still match, exactly as Smart Plan re-checks a reference it
 * recovered from stored JSON. See `verifyAskPlaceRefs` in the agent function.
 *
 * Authenticity, not secrecy: the payload is base64url, not encrypted. A
 * traveller reading their own token learns which place their own device is
 * holding, which they already knew. Hiding it would add a key-management
 * problem to buy nothing.
 *
 * No Deno-only APIs beyond Web Crypto, which vitest also provides, so every
 * rule here is exercised directly rather than through an Edge function.
 */

/** Bumped only when the payload shape changes incompatibly. */
export const ASK_PLACE_REF_VERSION = 1;

/**
 * Stamped into every payload and checked on the way back.
 *
 * A signing secret that ever gains a second use must not let a token minted
 * for one purpose be replayed as another. Cheap now, and the alternative is
 * discovering the coupling after both callers exist.
 */
export const ASK_PLACE_REF_PURPOSE = 'ask-place-ref';

/**
 * Thirty days.
 *
 * Chosen against what the token is attached to: a conversation this browser
 * keeps until the traveller starts a new chat. Shorter would expire references
 * inside a trip still being planned; longer would keep a signed assertion alive
 * long after the link table it describes has moved on. Expiry is a bound on
 * staleness, not the defence against it — the link re-check is.
 */
export const ASK_PLACE_REF_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Bounds on what may be signed, so a token cannot become a data channel. */
const MAX_FIELD_CHARS = 200;
export const MAX_ASK_PLACE_TOKEN_CHARS = 1_024;

/**
 * A short secret is a long secret's shape without its strength. Refusing one
 * outright beats signing with it: a deployment that mis-set this learns at
 * boot rather than by having tokens forged.
 */
export const MIN_SIGNING_SECRET_CHARS = 32;

/** The identity a token carries. Never presentation, never a name. */
export interface AskPlaceRef {
  userId: string;
  tripId: string;
  canonicalPlaceId: string;
  provider: string;
  providerPlaceId: string;
}

export type AskPlaceRefFailure =
  | 'no-secret'
  | 'malformed'
  | 'bad-version'
  | 'bad-purpose'
  | 'bad-signature'
  | 'wrong-user'
  | 'wrong-trip'
  | 'expired';

export type AskPlaceRefVerification =
  | { ok: true; ref: AskPlaceRef; expiresAt: number }
  | { ok: false; reason: AskPlaceRefFailure };

interface SignedPayload {
  v: number;
  p: string;
  u: string;
  t: string;
  c: string;
  pr: string;
  pp: string;
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();

const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlDecode = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
};

const importKey = (secret: string): Promise<CryptoKey> => crypto.subtle.importKey(
  'raw',
  encoder.encode(secret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);

/**
 * Compared without an early return.
 *
 * `crypto.subtle.verify` would do this too, but the key is imported for `sign`
 * only and a byte-wise `===` leaks the position of the first difference through
 * timing. Accumulating the difference costs nothing and removes the question.
 */
const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
};

const signBytes = async (secret: string, body: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.sign('HMAC', await importKey(secret), encoder.encode(body)));

const usableField = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_FIELD_CHARS;

/** A secret this module is willing to sign with. */
export const isUsableSigningSecret = (secret: string | undefined): secret is string =>
  typeof secret === 'string' && secret.trim().length >= MIN_SIGNING_SECRET_CHARS;

/**
 * Mint one token.
 *
 * Returns `undefined` rather than throwing when there is nothing safe to sign:
 * a missing secret means the deployment has not enabled cross-turn references,
 * and Ask must keep working without them. A card with no token is a card the
 * next turn cannot follow up on — never a broken answer.
 */
export async function signAskPlaceRef(
  secret: string | undefined,
  ref: AskPlaceRef,
  now: Date = new Date(),
): Promise<string | undefined> {
  if (!isUsableSigningSecret(secret)) return undefined;
  if (
    !usableField(ref.userId) || !usableField(ref.tripId) || !usableField(ref.canonicalPlaceId)
    || !usableField(ref.provider) || !usableField(ref.providerPlaceId)
  ) return undefined;

  const issued = Math.floor(now.getTime() / 1_000);
  const payload: SignedPayload = {
    v: ASK_PLACE_REF_VERSION,
    p: ASK_PLACE_REF_PURPOSE,
    u: ref.userId,
    t: ref.tripId,
    c: ref.canonicalPlaceId,
    pr: ref.provider,
    pp: ref.providerPlaceId,
    iat: issued,
    exp: issued + ASK_PLACE_REF_TTL_SECONDS,
  };

  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await signBytes(secret, body));
  const token = `v${ASK_PLACE_REF_VERSION}.${body}.${signature}`;
  return token.length <= MAX_ASK_PLACE_TOKEN_CHARS ? token : undefined;
}

/**
 * Read one token back, or say why not.
 *
 * The order of checks is deliberate: the signature is verified *before* any
 * field is read as meaningful. Reading `u` or `t` from an unverified payload
 * and acting on it — even to reject — treats attacker-controlled bytes as
 * data, and the whole point of a signature is that nothing inside is data
 * until it has been checked.
 *
 * Every failure is a reason code for operator diagnostics. None of them is
 * ever shown to a traveller: "signature invalid" tells the person holding the
 * device nothing they can act on, and tells anyone probing exactly which of
 * their guesses was closest.
 */
export async function verifyAskPlaceRef(
  secret: string | undefined,
  token: unknown,
  expected: { userId: string; tripId: string; now?: Date },
): Promise<AskPlaceRefVerification> {
  if (!isUsableSigningSecret(secret)) return { ok: false, reason: 'no-secret' };
  if (typeof token !== 'string' || !token || token.length > MAX_ASK_PLACE_TOKEN_CHARS) {
    return { ok: false, reason: 'malformed' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [version, body, signature] = parts;
  if (version !== `v${ASK_PLACE_REF_VERSION}`) return { ok: false, reason: 'bad-version' };

  const offered = base64UrlDecode(signature);
  if (!offered) return { ok: false, reason: 'malformed' };
  if (!equalBytes(offered, await signBytes(secret, body))) return { ok: false, reason: 'bad-signature' };

  // Only past this line is the payload something other than bytes a caller sent.
  const decoded = base64UrlDecode(body);
  if (!decoded) return { ok: false, reason: 'malformed' };
  let payload: SignedPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(decoded)) as SignedPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };
  if (payload.v !== ASK_PLACE_REF_VERSION) return { ok: false, reason: 'bad-version' };
  if (payload.p !== ASK_PLACE_REF_PURPOSE) return { ok: false, reason: 'bad-purpose' };
  if (
    !usableField(payload.u) || !usableField(payload.t) || !usableField(payload.c)
    || !usableField(payload.pr) || !usableField(payload.pp)
    || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
  ) return { ok: false, reason: 'malformed' };

  if (payload.u !== expected.userId) return { ok: false, reason: 'wrong-user' };
  if (payload.t !== expected.tripId) return { ok: false, reason: 'wrong-trip' };

  const now = Math.floor((expected.now ?? new Date()).getTime() / 1_000);
  if (payload.exp <= now) return { ok: false, reason: 'expired' };

  return {
    ok: true,
    expiresAt: payload.exp,
    ref: {
      userId: payload.u,
      tripId: payload.t,
      canonicalPlaceId: payload.c,
      provider: payload.pr,
      providerPlaceId: payload.pp,
    },
  };
}

/**
 * How many previous-turn references one request may carry.
 *
 * Matches `MAX_PLACE_CARDS`: the referent of "the second one" is the answer
 * immediately above the question, and one answer can show at most that many
 * cards. Reaching further back would trade a real ambiguity — two answers
 * whose second place is a different place — for a case nobody asked for.
 */
export const MAX_ASK_PLACE_TOKENS_PER_REQUEST = 5;

/** The alias the model uses, and the only handle it ever needs for these. */
export const recentPlaceAlias = (index: number): string => `recent-place-${index + 1}`;
