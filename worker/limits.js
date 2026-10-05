// Server-side hardcoded limits for the Docparse Gemini proxy.
//
// These exist because the Worker is reachable by anyone who reads
// SMART_ENDPOINT out of the distributed zip. Without them it is a free,
// unmetered, general-purpose Gemini proxy billed to our key.
//
// Every value here is hardcoded on purpose: the client never gets to
// raise a limit, same reasoning as the generationConfig in worker.js.

export const LIMITS = {
  // Raw JSON request body. The client's largest legitimate request is a
  // 15 MB PDF, which base64-encodes to ~20 MB (4/3 inflation); 22 MB is
  // that 15 MB x 4/3 plus a small margin — enough headroom for the request
  // envelope, no more.
  MAX_BODY_BYTES: 22 * 1024 * 1024,

  // AI_MAX_PAGES on the client is 15; allow some slack for a prompt part
  // and batch overlap, but not an unbounded image dump.
  MAX_INLINE_PARTS: 20,

  // The Docparse client (Docparse/index.html smartExtract) slices spreadsheet
  // text at 200,000 characters and sends it as a second text part, prefixed
  // with a ~410-char instruction prompt and a 39-char CSV label — a worst
  // case just over 200,000 chars total. This cap must stay above that sum
  // (with headroom for the prompt to grow) so the client can never build a
  // request its own Worker rejects, while still being far too small to make
  // this endpoint useful as a general-purpose text LLM.
  MAX_TEXT_CHARS: 220000,

  ALLOWED_MIME: [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
  ],
};

function fail(error, status = 400) {
  return { ok: false, status, error };
}

// The only Part shapes the Docparse client ever generates. Anything else
// (file_data, executableCode, videoMetadata, ...) is a Gemini Part field
// this worker never validates, so a key outside this set must be rejected
// outright rather than silently forwarded upstream. This matters because
// Gemini accepts a YouTube URL directly as file_data.file_uri on
// generateContent — no tools config or File API upload required — and
// bills video at a rate that dwarfs what MAX_BODY_BYTES assumes.
const ALLOWED_PART_KEYS = new Set(['text', 'inline_data', 'inlineData']);

// Gemini accepts both snake_case (inline_data/mime_type) and camelCase
// (inlineData/mimeType). The Docparse client sends snake_case, but accept
// and validate both so camelCase can't be used to bypass the whitelist.
function readInline(part) {
  const inline = part.inline_data || part.inlineData;
  if (!inline) return null;
  return { mime: inline.mime_type || inline.mimeType || null };
}

export function validateRequest(body) {
  if (!body || typeof body !== 'object') return fail('Invalid body');
  if (!Array.isArray(body.contents)) return fail('Missing contents');

  let inlineCount = 0;
  let textChars = 0;
  let partCount = 0;

  for (const content of body.contents) {
    if (!content || typeof content !== 'object') return fail('Invalid content entry');
    if (!Array.isArray(content.parts)) return fail('Missing parts');

    for (const part of content.parts) {
      if (!part || typeof part !== 'object') return fail('Invalid part');
      partCount++;

      const unknownKey = Object.keys(part).find((k) => !ALLOWED_PART_KEYS.has(k));
      if (unknownKey) return fail(`Unsupported part field: ${unknownKey}`);

      // text and inline_data are members of the same protobuf `oneof`, so
      // Gemini never actually accepts both on one Part, and the client
      // never generates that shape. Checking them independently below is
      // stricter than necessary but harmless — it exists so an over-length
      // text can't ride along on a valid attachment and skip the char cap
      // via an early `continue`.
      let recognized = false;

      const inline = readInline(part);
      if (inline) {
        recognized = true;
        inlineCount++;
        if (inlineCount > LIMITS.MAX_INLINE_PARTS) {
          return fail(`Too many attachments (max ${LIMITS.MAX_INLINE_PARTS})`);
        }
        if (!inline.mime) return fail('Attachment is missing a mime type');
        if (!LIMITS.ALLOWED_MIME.includes(inline.mime)) {
          return fail(`Unsupported attachment type: ${inline.mime}`);
        }
      }

      if (typeof part.text === 'string') {
        recognized = true;
        textChars += part.text.length;
        if (textChars > LIMITS.MAX_TEXT_CHARS) {
          return fail(`Text content too long (max ${LIMITS.MAX_TEXT_CHARS} characters)`);
        }
      }

      if (!recognized) return fail('Unsupported part type');
    }
  }

  if (partCount === 0) return fail('Request contains no content');

  return { ok: true };
}

// Convert a trailing IPv4 dotted-quad (e.g. "203.0.113.7") into the two
// hex groups it represents, per RFC 4291 §2.2 rule 3. Returns null if the
// text isn't a well-formed dotted-quad.
function expandDottedQuad(tail) {
  const octets = tail.split('.');
  if (octets.length !== 4) return null;

  const bytes = [];
  for (const o of octets) {
    if (!/^\d{1,3}$/.test(o)) return null;
    const n = Number(o);
    if (n > 255) return null;
    bytes.push(n);
  }

  const g1 = ((bytes[0] << 8) | bytes[1]).toString(16);
  const g2 = ((bytes[2] << 8) | bytes[3]).toString(16);
  return [g1, g2];
}

// Expand an IPv6 address (compressed or full, with an optional %zone
// suffix) into its 8 lowercase, zero-padded hex groups. Returns null if
// the input isn't a well-formed IPv6 address.
function expandIPv6(ip) {
  const addr = ip.split('%')[0];
  const doubleColonCount = (addr.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  let headParts;
  let tailParts;
  if (doubleColonCount === 1) {
    const [head, tail] = addr.split('::');
    headParts = head ? head.split(':') : [];
    tailParts = tail ? tail.split(':') : [];
  } else {
    headParts = addr.split(':');
    tailParts = [];
  }

  // A trailing dotted-quad — IPv4-mapped ("::ffff:203.0.113.7", RFC 4291),
  // IPv4-translated ("::ffff:0:203.0.113.7", RFC 2765), and NAT64
  // ("64:ff9b::203.0.113.7", RFC 6052) addresses all end in one — packs
  // two hex groups into one field, so it has to be split out before the
  // group-count math below, or these well-formed addresses get rejected.
  const lastArray = tailParts.length ? tailParts : headParts;
  const lastField = lastArray[lastArray.length - 1];
  if (lastField && lastField.includes('.')) {
    const quad = expandDottedQuad(lastField);
    if (!quad) return null;
    lastArray.splice(lastArray.length - 1, 1, ...quad);
  }

  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  if (doubleColonCount === 0 && missing !== 0) return null;

  const groups = [...headParts, ...Array(missing).fill('0'), ...tailParts];
  if (groups.length !== 8) return null;
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;

  return groups.map((g) => g.toLowerCase().padStart(4, '0'));
}

// High-order 96 bits of the three RFC-defined forms that embed a full
// IPv4 address in the low 32 bits (IPv4-mapped, IPv4-translated, NAT64
// Well-Known Prefix). All hosts behind the same gateway share these bits,
// so unlike a real allocation, they carry no per-holder information — the
// embedded IPv4 address is what actually varies per address holder.
const V4_EMBEDDED_PREFIXES = [
  ['0000', '0000', '0000', '0000', '0000', 'ffff'], // IPv4-mapped
  ['0000', '0000', '0000', '0000', 'ffff', '0000'], // IPv4-translated
  ['0064', 'ff9b', '0000', '0000', '0000', '0000'], // NAT64 Well-Known Prefix
];

// Reduce an IPv6 address to its /64 prefix. A /64 is a normal residential
// or cloud allocation, so without this an address holder gets 2^64
// distinct rate-limit buckets instead of one. Naively splitting on ':' and
// taking the first four groups gets this wrong for compressed notation
// (e.g. "2001:db8::1"), so the address is expanded first.
//
// For the IPv4-embedded forms above, a first-four-groups /64 would be
// constant across every address in the family (all the variation lives in
// the last 32 bits) — that would collapse every distinct embedded IPv4
// host onto one shared bucket, exactly the failure mode this function
// exists to avoid. Key those by the full expanded address instead.
export function ipv6ToPrefix64(ip) {
  const groups = expandIPv6(ip);
  if (!groups) return null;

  const isV4Embedded = V4_EMBEDDED_PREFIXES.some((prefix) =>
    prefix.every((g, i) => groups[i] === g));
  if (isV4Embedded) return groups.join(':');

  return groups.slice(0, 4).join(':') + '::/64';
}

// Cloudflare's rate-limit binding counts per colo, not globally (per
// Cloudflare's Rate Limiting docs) — the effective global ceiling across
// all colos is therefore higher than the configured limit implies. That's
// inherent to the binding, not something this normalization can fix; it
// just shouldn't be a surprise to the next reader.
export function rateLimitKey(rawIp) {
  const ip = typeof rawIp === 'string' ? rawIp.trim() : '';
  if (!ip) return 'unknown';
  // On parse failure, degrade to bucketing by the full raw address — the
  // behaviour before /64 normalization existed — rather than folding it
  // into 'unknown', which is also the fallback for a *missing* header.
  // That would put every unparseable address and every header-less caller
  // in one shared bucket, which is worse for availability than not
  // normalizing at all.
  if (ip.includes(':')) {
    return ipv6ToPrefix64(ip) || ip;
  }
  return ip;
}
