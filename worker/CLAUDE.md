# The Smart-extract Worker

Loaded when you touch `worker/`. Root rules are in `../CLAUDE.md`.

`worker.js` is a stateless POST-only proxy in front of the Gemini API.

**Design constraint, stated in the code — don't break it: every security
parameter (size limits, allowed MIME types, `generationConfig`) is hardcoded
server-side in `limits.js` and never accepts client overrides.** This exists
because `SMART_ENDPOINT` (the Worker's URL) sits in plaintext inside
`Docparse/index.html`, which ships in a distributed zip. Anyone who unzips it
can read the URL and call the Worker directly, so the Worker must defend itself
as a fully public, unauthenticated endpoint rather than trust its one
legitimate client.

Layers of defense, all in `limits.js` — pure functions with no Workers-runtime
dependency, so they run under plain Node/vitest:

1. Per-IP rate limiting via the Workers-native `[[ratelimits]]` binding
   (`wrangler.toml`). IPv6 addresses are bucketed by `/64` (see
   `ipv6ToPrefix64`) so one holder can't get one bucket per address.
2. `validateRequest(body)` whitelists Gemini `Part` shapes (`text` /
   `inline_data` / `inlineData` only), caps body size, attachment count and
   text length, and restricts MIME types to what the client actually sends
   (PDF/PNG/JPEG/WebP). This is what stops the Worker being used as a
   general-purpose Gemini proxy or as a video-billing vector.
3. Raw body size is checked twice — once from the `Content-Length` header
   (cheap pre-reject) and once from the actual byte count, *before* decoding or
   JSON-parsing, so decode cost is never paid on an oversize payload.

When touching `limits.js`, keep the numeric caps consistent with their callers:
`MAX_BODY_BYTES` must stay derived from the client's largest legitimate request
(a 15 MB PDF, base64-inflated), and `MAX_TEXT_CHARS` must stay above what
`Docparse/index.html`'s `smartExtract` can actually send. The comments in
`limits.js` spell out the exact arithmetic.

`npm test` here is the only automated test suite in the repo — run it.
