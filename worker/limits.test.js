import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LIMITS, validateRequest, rateLimitKey } from './limits.js';

const pdfPart = { inline_data: { mime_type: 'application/pdf', data: 'AAAA' } };

// Margin required above the client's slice to cover its instruction prompt
// (~410 chars) and CSV label (39 chars), plus room for either to grow.
const CLIENT_PROMPT_MARGIN = 15000;

describe('client/Worker text cap coupling (Docparse/index.html)', () => {
  it('keeps MAX_TEXT_CHARS comfortably above the client spreadsheet slice', () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const clientPath = join(__dirname, '..', 'Docparse', 'index.html');

    let html;
    try {
      html = readFileSync(clientPath, 'utf8');
    } catch (err) {
      throw new Error(
        `Could not read Docparse/index.html at ${clientPath} to verify the ` +
        `client's text slice against LIMITS.MAX_TEXT_CHARS: ${err.message}`
      );
    }

    const match = html.match(/lastPlainText\.slice\(0,\s*(\d+)\)/);
    if (!match) {
      throw new Error(
        'Could not find a `lastPlainText.slice(0, N)` call in Docparse/index.html. ' +
        'The client code changed shape — update this regex, then re-verify that ' +
        'LIMITS.MAX_TEXT_CHARS still exceeds the client slice with headroom.'
      );
    }

    const clientSliceChars = Number(match[1]);
    expect(LIMITS.MAX_TEXT_CHARS - clientSliceChars).toBeGreaterThanOrEqual(CLIENT_PROMPT_MARGIN);
  });

  it('accepts a request shaped exactly like the client worst case (prompt + sliced CSV)', () => {
    const body = {
      contents: [{
        parts: [
          { text: 'x'.repeat(420) }, // fixed instruction prompt
          { text: 'x'.repeat(39 + 200000) }, // CSV label + full 200k slice
        ],
      }],
    };
    expect(validateRequest(body)).toEqual({ ok: true });
  });
});

describe('validateRequest', () => {
  it('accepts a minimal valid body', () => {
    const body = { contents: [{ parts: [{ text: 'extract fields' }, pdfPart] }] };
    expect(validateRequest(body)).toEqual({ ok: true });
  });

  it('rejects a missing contents array', () => {
    const r = validateRequest({});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects contents that is not an array', () => {
    const r = validateRequest({ contents: 'nope' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects more inline parts than the cap', () => {
    const parts = Array.from({ length: LIMITS.MAX_INLINE_PARTS + 1 }, () => pdfPart);
    const r = validateRequest({ contents: [{ parts }] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/attachment/i);
  });

  it('accepts exactly the inline part cap', () => {
    const parts = Array.from({ length: LIMITS.MAX_INLINE_PARTS }, () => pdfPart);
    expect(validateRequest({ contents: [{ parts }] })).toEqual({ ok: true });
  });

  it('rejects a disallowed mime type', () => {
    const body = {
      contents: [{ parts: [{ inline_data: { mime_type: 'video/mp4', data: 'AAAA' } }] }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/video\/mp4/);
  });

  it('rejects an inline part with no mime type', () => {
    const body = { contents: [{ parts: [{ inline_data: { data: 'AAAA' } }] }] };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
  });

  it('also validates camelCase inlineData', () => {
    const body = {
      contents: [{ parts: [{ inlineData: { mimeType: 'video/mp4', data: 'AAAA' } }] }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/video\/mp4/);
  });

  it('rejects text longer than the cap', () => {
    const body = {
      contents: [{ parts: [{ text: 'x'.repeat(LIMITS.MAX_TEXT_CHARS + 1) }] }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/text/i);
  });

  it('rejects a body with no parts at all', () => {
    const r = validateRequest({ contents: [{}] });
    expect(r.ok).toBe(false);
  });

  it('rejects a part carrying inline_data plus over-cap text', () => {
    const body = {
      contents: [{
        parts: [{
          inline_data: { mime_type: 'application/pdf', data: 'AAAA' },
          text: 'x'.repeat(LIMITS.MAX_TEXT_CHARS + 1),
        }],
      }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/text/i);
  });

  it('accepts a part carrying inline_data plus under-cap text', () => {
    const body = {
      contents: [{
        parts: [{
          inline_data: { mime_type: 'application/pdf', data: 'AAAA' },
          text: 'a caption',
        }],
      }],
    };
    expect(validateRequest(body)).toEqual({ ok: true });
  });

  it('rejects over-cap text accumulated across parts that each also carry inline_data', () => {
    const chunk = { mime_type: 'application/pdf', data: 'AAAA' };
    const parts = Array.from({ length: 3 }, () => ({
      inline_data: chunk,
      text: 'x'.repeat(Math.ceil(LIMITS.MAX_TEXT_CHARS / 2)),
    }));
    const r = validateRequest({ contents: [{ parts }] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/text/i);
  });

  it('rejects a part with neither inline_data nor text', () => {
    // 'foo' is outside the F3 key allowlist, so this is now caught by that
    // check first ("Unsupported part field") rather than falling through
    // to the recognized-but-empty case ("Unsupported part type"). Still
    // rejected either way — see the allowlist-specific rejections below
    // for the file_data/executableCode/videoMetadata cases this guards.
    const body = { contents: [{ parts: [{ foo: 'bar' }] }] };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/Unsupported part field/);
  });
});

describe('validateRequest — Part key allowlist (F3)', () => {
  // Gemini accepts a YouTube URL directly as file_data.file_uri on
  // generateContent (no tools config or File API upload needed) and bills
  // video at ~300 tokens/second with no length cap on a paid tier — a
  // ~300-byte request could buy input tokens near the context-window
  // ceiling, four orders of magnitude past what MAX_BODY_BYTES assumes.
  it('rejects a part with text plus file_data (video URL smuggling)', () => {
    const body = {
      contents: [{
        parts: [{
          text: 'summarize',
          file_data: { file_uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        }],
      }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/file_data/);
  });

  it('rejects a part with text plus executableCode', () => {
    const body = {
      contents: [{
        parts: [{ text: 'run this', executableCode: { language: 'PYTHON', code: 'print(1)' } }],
      }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/executableCode/);
  });

  it('rejects a part with inline_data plus videoMetadata', () => {
    const body = {
      contents: [{
        parts: [{
          inline_data: { mime_type: 'application/pdf', data: 'AAAA' },
          videoMetadata: { fps: 60 },
        }],
      }],
    };
    const r = validateRequest(body);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/videoMetadata/);
  });

  it('still accepts the client\'s real Part shapes (text, inline_data, camelCase inlineData)', () => {
    expect(validateRequest({ contents: [{ parts: [{ text: 'extract fields' }, pdfPart] }] })).toEqual({ ok: true });
    expect(validateRequest({
      contents: [{ parts: [{ inlineData: { mimeType: 'application/pdf', data: 'AAAA' } }] }],
    })).toEqual({ ok: true });
    expect(validateRequest({
      contents: [{ parts: [{ inline_data: { mime_type: 'application/pdf', data: 'AAAA' }, text: 'a caption' }] }],
    })).toEqual({ ok: true });
  });
});

describe('rateLimitKey (F6: IPv6 /64 bucketing)', () => {
  it('maps compressed and full-form IPv6 addresses in the same /64 to the same key', () => {
    const compressed = rateLimitKey('2001:db8::1');
    const full = rateLimitKey('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(compressed).toBe(full);
  });

  it('maps addresses in different /64s to different keys', () => {
    const a = rateLimitKey('2001:db8:0:0::1');
    const b = rateLimitKey('2001:db8:0:1::1');
    expect(a).not.toBe(b);
  });

  it('passes IPv4 addresses through unchanged', () => {
    expect(rateLimitKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('returns a stable fallback for missing or empty input', () => {
    expect(rateLimitKey(undefined)).toBe('unknown');
    expect(rateLimitKey(null)).toBe('unknown');
    expect(rateLimitKey('')).toBe('unknown');
    expect(rateLimitKey('   ')).toBe('unknown');
  });

  it('normalizes IPv4-mapped addresses (RFC 4291) instead of collapsing them into the shared unknown bucket', () => {
    const a = rateLimitKey('::ffff:203.0.113.7');
    const b = rateLimitKey('::ffff:198.51.100.9');
    expect(a).not.toBe('unknown');
    expect(b).not.toBe('unknown');
    expect(a).not.toBe(b);
  });

  it('normalizes ::1 to a stable, non-unknown key', () => {
    const a = rateLimitKey('::1');
    const b = rateLimitKey('0:0:0:0:0:0:0:1');
    expect(a).not.toBe('unknown');
    expect(a).toBe(b);
  });

  it('degrades an unparseable IPv6-shaped string to a key derived from the input, not the shared unknown bucket', () => {
    const r = rateLimitKey('2001:db8::1::2');
    expect(r).not.toBe('unknown');
    expect(r).toBe('2001:db8::1::2');
  });

  it('also normalizes IPv4-translated (RFC 2765) and NAT64 (RFC 6052) addresses to distinct, non-unknown keys', () => {
    const translatedA = rateLimitKey('::ffff:0:203.0.113.7');
    const translatedB = rateLimitKey('::ffff:0:198.51.100.9');
    expect(translatedA).not.toBe('unknown');
    expect(translatedA).not.toBe(translatedB);

    const nat64A = rateLimitKey('64:ff9b::203.0.113.7');
    const nat64B = rateLimitKey('64:ff9b::198.51.100.9');
    expect(nat64A).not.toBe('unknown');
    expect(nat64A).not.toBe(nat64B);
  });
});
