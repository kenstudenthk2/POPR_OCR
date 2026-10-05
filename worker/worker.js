// Docparse smart-extraction proxy.
// Holds the Gemini API key as a server-side secret — the key never reaches
// the browser, and end users see nothing about Gemini or API keys.
//
// Deploy (from this folder):
//   npx wrangler deploy
//   npx wrangler secret put GEMINI_API_KEY   <- paste your key when prompted
//
// Then put the deployed URL into SMART_ENDPOINT in index.html.

import { LIMITS, validateRequest, rateLimitKey } from './limits.js';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

const CORS = {
  'Access-Control-Allow-Origin': '*',            // file:// pages send Origin: null
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405);
    }

    // Rate-limit before reading the body: the point is to shed load, and
    // reading a 22 MB body just to reject it defeats that. IPv6 is bucketed
    // by /64 — see rateLimitKey's comment for why.
    const ip = request.headers.get('CF-Connecting-IP');
    const { success } = await env.RATE_LIMITER.limit({ key: rateLimitKey(ip) });
    if (!success) {
      return json({ error: 'Too many requests — please wait a moment and try again.' }, 429);
    }

    // Cheap pre-read reject: if the client is honest about Content-Length
    // and it's already over the limit, don't even read the body.
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > LIMITS.MAX_BODY_BYTES) {
      return json({ error: 'Request too large' }, 413);
    }

    // Read the body as bytes exactly once, so its size can be measured and
    // capped BEFORE decoding or parsing. This only pays off on the reject
    // path: an oversize body is refused after allocating just this buffer,
    // without also decoding it to a string and running JSON.parse on it —
    // itself a denial-of-service on a huge body. The accept path still
    // ends up holding four full-size representations (this buffer, the
    // decoded string, the parsed object, and the re-serialized upstream
    // payload); the memory headroom for that comes from capping
    // MAX_BODY_BYTES at 22 MB, not from this read-as-bytes ordering.
    const buf = await request.arrayBuffer();
    if (buf.byteLength > LIMITS.MAX_BODY_BYTES) {
      return json({ error: 'Request too large' }, 413);
    }
    const raw = new TextDecoder().decode(buf);

    let body;
    try {
      body = JSON.parse(raw);
    } catch (e) {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const check = validateRequest(body);
    if (!check.ok) {
      return json({ error: check.error }, check.status);
    }

    // Forward ONLY the expected fields — this worker cannot be used as an
    // open proxy to other Google endpoints or with other options.
    const payload = {
      contents: body.contents,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
      },
    };

    const upstream = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
