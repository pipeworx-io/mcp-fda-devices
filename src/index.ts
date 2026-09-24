interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * FDA medical-device regulatory intelligence from keyless openFDA datasets.
 */

// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'FDA Devices');
}


const BASE = 'https://api.fda.gov/device';
const MAX_BYTES = 3_000_000;

// accessdata.fda.gov is on the .gov UA-block list (memory reference_gov_site_ua_blocks):
// a plain fetch() User-Agent 403s while a full browser header set 200s. Mirrors
// BROWSER_HEADERS in workers/data-pipeline/src/datasets/dod-contracts.ts.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const listSchema = (key: string) => ({
  type: 'object',
  properties: {
    total: { type: 'number' },
    returned: { type: 'number' },
    [key]: { type: 'array', items: { type: 'object' } },
    source: { type: 'string' },
  },
  required: ['total', 'returned', key, 'source'],
});

const tools: McpToolExport['tools'] = [
  {
    name: 'fda_device_510k_search',
    description: 'Search FDA 510(k) premarket notifications by device, applicant, product code, K number, review panel, clearance type, decision, applicant location, or third-party review status. Clearance means FDA found substantial equivalence; it is not an FDA approval or endorsement. Unknown arguments are rejected, not ignored. The most recent decision available lags roughly 2 weeks behind FDA\'s own site (openFDA\'s publishing cadence, not ours) -- do not treat this as same-day. `total` can exceed the 100-row `limit` cap; page further rows with `skip`.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Device/trade name substring.' },
        applicant: { type: 'string', description: 'Applicant/company substring.' },
        product_code: { type: 'string', description: 'Exact three-letter FDA product code.' },
        k_number: { type: 'string', description: 'Exact K number, e.g. K241234.' },
        from_date: { type: 'string', description: 'Earliest decision date, YYYY-MM-DD.' },
        to_date: { type: 'string', description: 'Latest decision date, YYYY-MM-DD.' },
        advisory_committee: { type: 'string', description: 'FDA review panel name (exact), e.g. "Orthopedic" or "Microbiology".' },
        clearance_type: { type: 'string', description: 'Exact clearance type: Traditional, Special, or Abbreviated.' },
        decision: { type: 'string', description: 'Exact decision text, e.g. "Substantially Equivalent".' },
        applicant_country: { type: 'string', description: 'Applicant country, ISO 3166-1 alpha-2 code, e.g. "US" or "JP".' },
        applicant_state: { type: 'string', description: 'Applicant US state/territory code, e.g. "CA". Only populated for US applicants.' },
        third_party_review: { type: 'boolean', description: 'true to keep only 510(k)s reviewed under FDA\'s third-party review program; false to exclude them.' },
        limit: { type: 'number', description: 'Results (1-100, default 20).' },
        skip: { type: 'number', description: 'Row offset for paging past the 100-row limit cap (openFDA `skip`, max 25000), e.g. skip=100 with limit=100 returns rows 101-200.' },
      },
    },
    outputSchema: listSchema('clearances'),
  },
  {
    name: 'fda_device_510k_summary',
    description: 'Get the FDA 510(k) summary/statement document and FDA review (decision memo) for one clearance, by K number — the actual filing, not just the "a document exists" flag from fda_device_510k_search. Shows the predicate device claimed and the testing behind the equivalence finding. Older/paper-only clearances were never digitized; that returns summary_available:false with a reason, not an error.',
    inputSchema: {
      type: 'object',
      properties: {
        k_number: { type: 'string', description: 'Exact K number, e.g. K253470.' },
      },
      required: ['k_number'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        k_number: { type: 'string' },
        detail_page: { type: 'string' },
        summary_available: { type: 'boolean' },
        summary: {
          type: 'object',
          properties: {
            url: { type: 'string' }, document_type: { type: 'string' },
            content_type: { type: 'string' }, bytes: { type: 'number' },
          },
        },
        review_available: { type: 'boolean' },
        review: {
          type: 'object',
          properties: {
            url: { type: 'string' }, document_type: { type: 'string' },
            content_type: { type: 'string' }, bytes: { type: 'number' },
          },
        },
        reason: { type: 'string' },
        source: { type: 'string' },
      },
      required: ['k_number', 'detail_page', 'summary_available', 'review_available', 'source'],
    },
  },
  {
    name: 'fda_device_pma_search',
    description: 'Search FDA Premarket Approval (PMA) decisions and supplements by trade/generic name, applicant, product code, or PMA number. Supplements may represent manufacturing or labeling changes rather than new devices.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Trade or generic device name substring.' },
        applicant: { type: 'string', description: 'Applicant/company substring.' },
        product_code: { type: 'string', description: 'Exact FDA product code.' },
        pma_number: { type: 'string', description: 'Exact PMA number, optionally including supplement suffix.' },
        from_date: { type: 'string', description: 'Earliest decision date, YYYY-MM-DD.' },
        to_date: { type: 'string', description: 'Latest decision date, YYYY-MM-DD.' },
        limit: { type: 'number', description: 'Results (1-100, default 20).' },
      },
    },
    outputSchema: listSchema('approvals'),
  },
  {
    name: 'fda_device_recalls',
    description: 'Search FDA medical-device recall records by firm, product, product code, K number, status, or date. A recall record describes a correction/removal action and does not by itself establish patient harm.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product or reason text.' },
        firm: { type: 'string', description: 'Recalling firm substring.' },
        product_code: { type: 'string', description: 'Exact FDA product code.' },
        k_number: { type: 'string', description: 'Exact related K number.' },
        status: { type: 'string', description: 'Recall status, e.g. Ongoing or Terminated.' },
        from_date: { type: 'string', description: 'Earliest posted date, YYYY-MM-DD.' },
        limit: { type: 'number', description: 'Results (1-100, default 20).' },
      },
    },
    outputSchema: listSchema('recalls'),
  },
  {
    name: 'fda_device_adverse_events',
    description: 'Search FDA MAUDE medical-device reports by manufacturer, brand/device, product code, event type, or PMA/510(k) number. MAUDE reports are unverified signals: they cannot establish causation, incidence, prevalence, or comparative safety.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Brand or generic device name.' },
        manufacturer: { type: 'string', description: 'Manufacturer name.' },
        product_code: { type: 'string', description: 'Exact product code.' },
        event_type: { type: 'string', description: 'Death, Injury, Malfunction, or Other.' },
        application_number: { type: 'string', description: 'PMA or 510(k) number.' },
        from_date: { type: 'string', description: 'Earliest FDA receive date, YYYY-MM-DD.' },
        limit: { type: 'number', description: 'Results (1-50, default 10).' },
      },
    },
    outputSchema: listSchema('reports'),
  },
  {
    name: 'fda_device_event_counts',
    description: 'Aggregate MAUDE reports for a device query by event type, manufacturer, product code, or receive date. Counts reflect reporting and database artifacts—not event rates or causal risk—and must not be compared without exposure denominators.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional raw openFDA MAUDE filter, e.g. \'date_received:[20250101+TO+20261231]\'. Omit to rank across all reports.' },
        count_field: { type: 'string', enum: ['device.generic_name.exact', 'device.brand_name.exact', 'device.openfda.device_name.exact', 'device.manufacturer_d_name.exact', 'event_type.exact', 'device.device_report_product_code.exact', 'date_received'], description: 'What to rank by. For "which DEVICES had the most reports" use device.generic_name.exact (device type) or device.brand_name.exact (specific product).' },
        limit: { type: 'number', description: 'Buckets (1-100, default 20).' },
      },
      required: ['count_field'],
    },
    outputSchema: listSchema('buckets'),
  },
  {
    name: 'fda_device_company_profile',
    description: 'Build a bounded FDA regulatory snapshot for one device company across 510(k), PMA, recalls, and MAUDE. Dataset name matching is imperfect and MAUDE counts are signals, not safety rates.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Company/manufacturer name.' },
        limit_per_dataset: { type: 'number', description: 'Rows per dataset (1-20, default 5).' },
      },
      required: ['company'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        clearances_510k: { type: 'object' },
        pma_decisions: { type: 'object' },
        recalls: { type: 'object' },
        maude_reports: { type: 'object' },
        interpretation: { type: 'string' },
      },
      required: ['company', 'clearances_510k', 'pma_decisions', 'recalls', 'maude_reports', 'interpretation'],
    },
  },
  {
    name: 'fda_device_classification',
    description: 'Look up FDA device classification and regulatory context by product code, device name, or regulation number. Classification describes the product-code category, not a specific product’s clearance or approval.',
    inputSchema: { type: 'object', properties: {
      product_code: { type: 'string' }, device: { type: 'string' }, regulation_number: { type: 'string' },
      limit: { type: 'number', description: 'Rows (1-100, default 20).' },
    }},
    outputSchema: listSchema('classifications'),
  },
  {
    name: 'fda_device_udi_search',
    description: 'Search FDA GUDID/UDI records by brand, company, device identifier, or product code. A UDI record describes an identified device in GUDID; it does not establish current sales, availability, clearance, approval, or safety.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Brand or device description.' }, company: { type: 'string' },
      primary_di: { type: 'string' }, product_code: { type: 'string' }, limit: { type: 'number' },
    }},
    outputSchema: listSchema('devices'),
  },
  {
    name: 'fda_device_establishment_search',
    description: 'Search FDA device registration/listing data by firm, registration number, product code, or listing number. Registration/listing does not mean FDA approval, clearance, certification, or endorsement.',
    inputSchema: { type: 'object', properties: {
      firm: { type: 'string' }, registration_number: { type: 'string' },
      product_code: { type: 'string' }, listing_number: { type: 'string' }, limit: { type: 'number' },
    }},
    outputSchema: listSchema('establishments'),
  },
  {
    name: 'fda_device_product_code_profile',
    description: 'Build a bounded cross-dataset snapshot for one FDA product code: classification, recent 510(k)s, PMAs, recalls, and MAUDE reports. Dataset counts have different meanings; MAUDE counts are not event rates.',
    inputSchema: { type: 'object', properties: {
      product_code: { type: 'string' }, limit_per_dataset: { type: 'number' },
    }, required: ['product_code'] },
    outputSchema: { type: 'object', properties: {
      product_code: { type: 'string' }, classifications: { type: 'object' }, clearances_510k: { type: 'object' },
      pma_decisions: { type: 'object' }, recalls: { type: 'object' }, maude_reports: { type: 'object' },
      interpretation: { type: 'string' },
    }, required: ['product_code', 'classifications', 'clearances_510k', 'pma_decisions', 'recalls', 'maude_reports', 'interpretation'] },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'fda_device_510k_search': return search510k(args);
    case 'fda_device_510k_summary': return get510kSummary(args);
    case 'fda_device_pma_search': return searchPma(args);
    case 'fda_device_recalls': return searchRecalls(args);
    case 'fda_device_adverse_events': return searchEvents(args);
    case 'fda_device_event_counts': return countEvents(args);
    case 'fda_device_company_profile': return companyProfile(args);
    case 'fda_device_classification': return searchClassification(args);
    case 'fda_device_udi_search': return searchUdi(args);
    case 'fda_device_establishment_search': return searchEstablishments(args);
    case 'fda_device_product_code_profile': return productCodeProfile(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

async function searchClassification(args: Record<string, unknown>) {
  const clauses = [
    exactClause('product_code', stringArg(args.product_code)?.toUpperCase()),
    textClause('device_name', stringArg(args.device)),
    exactClause('regulation_number', stringArg(args.regulation_number)),
  ].filter(Boolean) as string[];
  if (!clauses.length) throw new Error('user_error: Provide product_code, device, or regulation_number.');
  const data = await fda('classification', clauses.join('+AND+'), intArg(args.limit, 20, 1, 100));
  return listResult('classifications', data, projectClassification);
}

async function searchUdi(args: Record<string, unknown>) {
  const query = stringArg(args.query);
  const clauses = [
    query ? `(brand_name:${quote(query)}+OR+device_description:${quote(query)})` : null,
    textClause('company_name', stringArg(args.company)),
    exactClause('primary_di', stringArg(args.primary_di)),
    exactClause('product_codes.code', stringArg(args.product_code)?.toUpperCase()),
  ].filter(Boolean) as string[];
  if (!clauses.length) throw new Error('user_error: Provide at least one UDI filter.');
  const data = await fda('udi', clauses.join('+AND+'), intArg(args.limit, 20, 1, 100), 'publish_date:desc');
  return listResult('devices', data, projectUdi);
}

async function searchEstablishments(args: Record<string, unknown>) {
  const clauses = [
    textClause('registration.name', stringArg(args.firm)),
    exactClause('registration.registration_number', stringArg(args.registration_number)),
    exactClause('products.product_code', stringArg(args.product_code)?.toUpperCase()),
    exactClause('listing_number', stringArg(args.listing_number)?.toUpperCase()),
  ].filter(Boolean) as string[];
  if (!clauses.length) throw new Error('user_error: Provide at least one registration/listing filter.');
  const data = await fda('registrationlisting', clauses.join('+AND+'), intArg(args.limit, 20, 1, 100));
  return listResult('establishments', data, projectEstablishment);
}

async function productCodeProfile(args: Record<string, unknown>) {
  const productCode = requiredString(args, 'product_code').toUpperCase();
  if (!/^[A-Z]{3}$/.test(productCode)) throw new Error('product_code must be three letters.');
  const limit = intArg(args.limit_per_dataset, 5, 1, 20);
  const [classifications, clearances, pmas, recalls, events] = await Promise.all([
    searchClassification({ product_code: productCode, limit }),
    search510k({ product_code: productCode, limit }),
    searchPma({ product_code: productCode, limit }),
    searchRecalls({ product_code: productCode, limit }),
    searchEvents({ product_code: productCode, limit }),
  ]);
  return {
    product_code: productCode, classifications, clearances_510k: clearances, pma_decisions: pmas,
    recalls, maude_reports: events,
    interpretation: 'Classification is category context; 510(k), PMA, recall, and MAUDE rows answer different regulatory questions. MAUDE has no exposure denominator and cannot support incidence or comparative-safety conclusions.',
  };
}

// Every field mapped below was verified live against the openFDA device/510k
// schema before being declared (fleet #1990) -- a sample record was pulled and
// each candidate field probed with a real search that narrowed `total`.
// advisory_committee_description (full panel name, e.g. "Orthopedic") is used
// rather than advisory_committee (a short code, often blank) because it is the
// field this tool already returns as `advisory_committee` in results, and it is
// what FDA's own form searches by panel name. country_code and state ARE both
// top-level fields on this endpoint (not nested under openfda), contrary to
// this task's expectation that they might be missing -- both narrowed `total`
// live. Nothing from the FDA form was left out; see the fleet-close note.
const SEARCH_510K_ARGS = [
  'device', 'applicant', 'product_code', 'k_number', 'from_date', 'to_date',
  'advisory_committee', 'clearance_type', 'decision', 'applicant_country',
  'applicant_state', 'third_party_review', 'limit', 'skip',
] as const;

async function search510k(args: Record<string, unknown>) {
  checkArgs(args, SEARCH_510K_ARGS);
  const skip = intArg(args.skip, 0, 0, 25000);
  const clauses = [
    textClause('device_name', stringArg(args.device)),
    textClause('applicant', stringArg(args.applicant)),
    exactClause('product_code', stringArg(args.product_code)?.toUpperCase()),
    exactClause('k_number', stringArg(args.k_number)?.toUpperCase()),
    rangeClause('decision_date', args.from_date, args.to_date),
    exactClause('advisory_committee_description', stringArg(args.advisory_committee)),
    exactClause('clearance_type', stringArg(args.clearance_type)),
    exactClause('decision_description', stringArg(args.decision)),
    exactClause('country_code', stringArg(args.applicant_country)?.toUpperCase()),
    exactClause('state', stringArg(args.applicant_state)?.toUpperCase()),
    thirdPartyClause(args.third_party_review),
  ].filter(Boolean) as string[];
  const data = await fda('510k', clauses.join('+AND+'), intArg(args.limit, 20, 1, 100), 'decision_date:desc', undefined, skip);
  const result = listResult('clearances', data, project510k);
  return skip ? { ...result, skip } : result;
}

// === 510(k) summary/review document lookup (fleet #1988) ===
//
// openFDA's `statement_or_summary` field on the search results ("Summary" /
// "Statement" / null) is a FLAG that a document TYPE was designated at filing
// time. It is NOT a link and NOT proof FDA ever posted a file — thousands of
// older records carry the flag with nothing behind it. openFDA itself does not
// expose the document; the only place it lives is FDA's own CDRH detail page.
//
// THE TRAP THIS AVOIDS: the PDF directory naming is not derivable from the
// K number — K25xxxxx lives under cdrh_docs/pdf25/, K15xxxxx under pdf15/,
// single-digit years (K08xxxxx) DROP the leading zero (pdf8/, not pdf08/), and
// pre-2000 records sit in a bare pdf/ with no year segment at all. A K number
// whose summary was genuinely never digitized 404s on every one of those paths
// while openFDA's flag still says "Summary" -- so constructing the URL cannot
// tell "wrong guess" apart from "no file exists", and either way it is the
// wrong thing to hand a caller. Scraping the actual link off FDA's own detail
// page sidesteps guessing the path entirely, and the presence/absence of the
// row on that page IS the "was this ever digitized" signal, not something we
// have to infer from a fetch failure.
const CDRH_DETAIL_BASE = 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm';

async function get510kSummary(args: Record<string, unknown>) {
  const kNumber = requiredString(args, 'k_number').toUpperCase();
  if (!/^K\d{6}$/.test(kNumber)) {
    throw new Error(`k_number must look like K253470 (the letter K plus six digits). Got "${kNumber}".`);
  }
  const detailUrl = `${CDRH_DETAIL_BASE}?ID=${kNumber}`;
  const res = await pwFetch(detailUrl, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`FDA CDRH detail page request failed (${res.status}) for ${kNumber}.`);
  const html = await res.text();

  // A K number CDRH has never heard of renders the page template with the
  // whole record table absent (no "510(k) Number" row at all) — distinct from
  // a real record that simply has no document rows. Catch the typo/bad-id case
  // here so it surfaces as an error, not as a false "not digitized".
  if (!html.includes(`>${kNumber}<`)) {
    throw new Error(`No 510(k) record found for ${kNumber} in FDA's CDRH PMN database. Verify the k_number with fda_device_510k_search first.`);
  }

  const summaryLink = extractCdrhDocLink(html, /cdrh_docs\/pdf\d*\//i);
  const reviewLink = extractCdrhDocLink(html, /cdrh_docs\/reviews\//i);

  const [summaryDoc, reviewDoc] = await Promise.all([
    summaryLink ? verifyCdrhDoc(summaryLink.url) : Promise.resolve(null),
    reviewLink ? verifyCdrhDoc(reviewLink.url) : Promise.resolve(null),
  ]);

  const result: Record<string, unknown> = {
    k_number: kNumber,
    detail_page: detailUrl,
    summary_available: !!summaryDoc,
    review_available: !!reviewDoc,
    source: 'FDA CDRH 510(k) Premarket Notification database (accessdata.fda.gov)',
  };
  if (summaryDoc) {
    result.summary = compact({
      url: summaryDoc.url,
      document_type: summaryLink?.label || 'Summary',
      content_type: summaryDoc.contentType,
      bytes: summaryDoc.bytes,
    });
  }
  if (reviewDoc) {
    result.review = compact({
      url: reviewDoc.url,
      document_type: 'FDA review (decision memo)',
      content_type: reviewDoc.contentType,
      bytes: reviewDoc.bytes,
    });
  }
  if (!summaryDoc && !reviewDoc) {
    result.reason = 'FDA has not posted a 510(k) summary or review document for this record. Many older clearances were filed on paper and never digitized -- the flag on fda_device_510k_search records that a document TYPE was designated at filing, not that a file exists to fetch. This is not a fetch error.';
  }
  // Full-text extraction is out of scope: these are scanned/typeset PDFs up to
  // several MB, and there is no lightweight, edge-compatible extraction path —
  // returning the verified URL (with confirmed size/content-type) is what's
  // practical here; callers fetch/parse the PDF themselves.
  return result;
}

function extractCdrhDocLink(html: string, hrefPattern: RegExp): { url: string; label: string } | null {
  const anchorRe = /<a[^>]*href=(["'])([^"']+)\1[^>]*>([^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html))) {
    const href = m[2];
    if (hrefPattern.test(href)) {
      return { url: normalizeCdrhUrl(href), label: m[3].trim() };
    }
  }
  return null;
}

function normalizeCdrhUrl(href: string): string {
  let url = href.trim();
  if (/^http:\/\//i.test(url)) url = `https://${url.slice('http://'.length)}`;
  if (!/^https?:\/\//i.test(url)) url = new URL(url, 'https://www.accessdata.fda.gov').toString();
  return url;
}

// A HEAD check (cheap — no body download) so a scraped link that turns out
// dead is reported as unavailable rather than handed back as a working URL.
// IIS on accessdata.fda.gov supports HEAD (verified live); if some future path
// doesn't, treat that as "not available" rather than crashing the whole call —
// one broken link must not take down the other document.
async function verifyCdrhDoc(url: string): Promise<{ url: string; contentType: string | null; bytes: number | null } | null> {
  try {
    const res = await pwFetch(url, { method: 'HEAD', headers: BROWSER_HEADERS });
    if (!res.ok) return null;
    const contentLength = res.headers.get('content-length');
    return {
      url,
      contentType: res.headers.get('content-type'),
      bytes: contentLength ? Number(contentLength) : null,
    };
  } catch {
    return null;
  }
}

async function searchPma(args: Record<string, unknown>) {
  const device = stringArg(args.device);
  const clauses = [
    device ? `(trade_name:${quote(device)}+OR+generic_name:${quote(device)})` : null,
    textClause('applicant', stringArg(args.applicant)),
    exactClause('product_code', stringArg(args.product_code)?.toUpperCase()),
    exactClause('pma_number', stringArg(args.pma_number)?.toUpperCase()),
    rangeClause('decision_date', args.from_date, args.to_date),
  ].filter(Boolean) as string[];
  const data = await fda('pma', clauses.join('+AND+'), intArg(args.limit, 20, 1, 100), 'decision_date:desc');
  return listResult('approvals', data, projectPma);
}

async function searchRecalls(args: Record<string, unknown>) {
  const query = stringArg(args.query);
  const clauses = [
    query ? `(product_description:${quote(query)}+OR+reason_for_recall:${quote(query)})` : null,
    textClause('recalling_firm', stringArg(args.firm)),
    exactClause('product_code', stringArg(args.product_code)?.toUpperCase()),
    exactClause('k_numbers', stringArg(args.k_number)?.toUpperCase()),
    exactClause('recall_status', stringArg(args.status)),
    rangeClause('event_date_posted', args.from_date, null),
  ].filter(Boolean) as string[];
  const data = await fda('recall', clauses.join('+AND+'), intArg(args.limit, 20, 1, 100), 'event_date_posted:desc');
  return listResult('recalls', data, projectRecall);
}

async function searchEvents(args: Record<string, unknown>) {
  const device = stringArg(args.device);
  const clauses = [
    device ? `(device.brand_name:${quote(device)}+OR+device.generic_name:${quote(device)})` : null,
    // NOT manufacturer_name. That field EXISTS on every MAUDE record — 25.7M of
    // them — and is an empty string on essentially all of them, so a schema check
    // passes and every company search returns openFDA's 404 NOT_FOUND, which this
    // pack's fetch helper turns into a clean total:0. Elekta reported 0 here while
    // device.manufacturer_d_name holds 1,080 ('ELEKTA INSTRUMENT AB', 'ELEKTA INC',
    // 'ELEKTA LTD'). A dead field is worse than a misspelt one: nothing errors.
    textClause('device.manufacturer_d_name', stringArg(args.manufacturer)),
    exactClause('device.device_report_product_code', stringArg(args.product_code)?.toUpperCase()),
    exactClause('event_type', stringArg(args.event_type)),
    exactClause('pma_pmn_number', stringArg(args.application_number)?.toUpperCase()),
    rangeClause('date_received', args.from_date, null),
  ].filter(Boolean) as string[];
  if (!clauses.length) throw new Error('Provide at least one MAUDE filter.');
  const query = clauses.join('+AND+');
  const data = await fda('event', query, intArg(args.limit, 10, 1, 50), 'date_received:desc');
  const result = listResult('reports', data, projectEvent);
  // WHY EVERY RESPONSE CARRIES THE QUERY, AND A ZERO CARRIES A WARNING:
  // openFDA answers "this field does not match anything" and "you searched a
  // field that is never populated" with the SAME 404 and a byte-identical body
  // ({"error":{"code":"NOT_FOUND","message":"No matches found!"}}), so the
  // upstream cannot tell a caller which one happened. This pack searched the
  // always-empty manufacturer_name for months and reported a confident 0 for
  // companies with a thousand reports. Since the difference cannot be detected,
  // it has to be made auditable: the fields searched are returned, so a wrong
  // one is visible in the answer instead of hiding behind a plausible zero.
  const searched = clauses.map((c) => c.split(':')[0].replace(/^\(/, ''));
  return {
    ...result,
    searched_fields: searched,
    query,
    ...(result.total === 0
      ? {
          zero_result_note: `No MAUDE reports matched. openFDA returns the same "no matches" response whether the value is absent or the FIELD is unpopulated, so check searched_fields above: this query looked at ${searched.join(', ')}. Manufacturer searches use device.manufacturer_d_name, which is the populated one.`,
        }
      : {}),
    interpretation: maudeWarning(),
  };
}

// The allowlist carried no way to count by DEVICE, so "which medical devices had
// the most adverse event reports" — the plainest question this endpoint answers —
// was rejected by us, not by openFDA. All four device-name fields below were
// verified against MAUDE live. `query` is optional too: an unscoped ranking is
// exactly what a superlative question wants, and requiring a filter forced the
// caller to invent one.
const COUNT_FIELDS = [
  'device.generic_name.exact', 'device.brand_name.exact', 'device.openfda.device_name.exact',
  'device.manufacturer_d_name.exact', 'event_type.exact',
  'device.device_report_product_code.exact', 'date_received',
];

async function countEvents(args: Record<string, unknown>) {
  const query = stringArg(args.query) ?? '';
  const count = requiredString(args, 'count_field');
  if (!COUNT_FIELDS.includes(count)) {
    throw new Error(`count_field must be one of: ${COUNT_FIELDS.join(', ')}. Got "${count}". To rank devices by report volume use device.generic_name.exact (device type) or device.brand_name.exact (specific product).`);
  }
  // A count query ignores `limit` upstream — openFDA returns its full bucket list
  // regardless — so honour the documented "Buckets (1-100)" here instead of
  // promising a bound we never applied.
  const limit = intArg(args.limit, 20, 1, 100);
  const data = await fda('event', query, limit, undefined, count);
  const every = (data.results ?? []).map((row) => compact({ term: row.term, count: row.count }));
  const buckets = every.slice(0, limit);
  return {
    total: every.length,
    returned: buckets.length,
    ...(every.length > buckets.length ? { truncated_by_limit: every.length - buckets.length } : {}),
    buckets,
    source: source('event'),
    interpretation: maudeWarning(),
  };
}

async function companyProfile(args: Record<string, unknown>) {
  const company = requiredString(args, 'company');
  const limit = intArg(args.limit_per_dataset, 5, 1, 20);
  const [clearances, pmas, recalls, events] = await Promise.all([
    search510k({ applicant: company, limit }),
    searchPma({ applicant: company, limit }),
    searchRecalls({ firm: company, limit }),
    searchEvents({ manufacturer: company, limit }),
  ]);
  return {
    company,
    clearances_510k: clearances,
    pma_decisions: pmas,
    recalls,
    maude_reports: events,
    interpretation: 'Names are matched independently in each FDA dataset and may omit subsidiaries or include similarly named firms. Clearance/approval, recall, and MAUDE records answer different questions; MAUDE reports are not causal safety rates.',
  };
}

interface FdaResponse { meta?: { results?: { total?: number } }; results?: Array<Record<string, any>> }

async function fda(endpoint: string, search: string, limit: number, sort?: string, count?: string, skip?: number): Promise<FdaResponse> {
  // openFDA's search syntax uses a LITERAL '+' as its separator — between AND/OR
  // operators and inside a [date TO date] range. URLSearchParams percent-encodes
  // '+' to %2B, which openFDA cannot parse, and it fails in two different ways
  // depending on the clause: a date range 500s with a parse_exception, while an
  // OR clause 404s and this function's own 404 handler turns that into a clean
  // "0 results". So every multi-clause device query was either erroring or
  // silently reporting nothing found — "insulin pump" recalls returned 0 where
  // the upstream holds 119. Encode the value, then put the separators back.
  const params = [`search=${encodeURIComponent(search).replaceAll('%2B', '+')}`];
  if (count) params.push(`count=${encodeURIComponent(count)}`);
  else {
    params.push(`limit=${limit}`);
    if (sort) params.push(`sort=${encodeURIComponent(sort)}`);
    if (skip) params.push(`skip=${skip}`);
  }
  const url = `${BASE}/${endpoint}.json?${params.join('&')}`;
  const response = await pwFetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 404) return { meta: { results: { total: 0 } }, results: [] };
  if (!response.ok) throw new Error(`openFDA ${endpoint} request failed (${response.status})`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new Error('openFDA response exceeded size limit');
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('openFDA response exceeded size limit');
  return JSON.parse(text) as FdaResponse;
}

function listResult(key: string, data: FdaResponse, project: (row: Record<string, any>) => unknown) {
  const rows = (data.results ?? []).map(project);
  const endpoints: Record<string, string> = {
    clearances: '510k', approvals: 'pma', reports: 'event', recalls: 'recall',
    classifications: 'classification', devices: 'udi', establishments: 'registrationlisting',
  };
  return { total: data.meta?.results?.total ?? rows.length, returned: rows.length, [key]: rows, source: source(endpoints[key] ?? key) };
}

const project510k = (r: Record<string, any>) => compact({
  k_number: r.k_number, device_name: r.device_name, applicant: r.applicant,
  decision_date: date(r.decision_date), decision: r.decision_description,
  clearance_type: r.clearance_type, product_code: r.product_code,
  advisory_committee: r.advisory_committee_description,
  statement_or_summary: r.statement_or_summary,
  applicant_country: r.country_code, applicant_state: r.state,
  third_party_review: yn(r.third_party_flag),
});
const projectPma = (r: Record<string, any>) => compact({
  pma_number: r.pma_number, supplement_number: r.supplement_number,
  trade_name: r.trade_name, generic_name: r.generic_name, applicant: r.applicant,
  decision_date: date(r.decision_date), decision_code: r.decision_code,
  product_code: r.product_code, supplement_type: r.supplement_type,
  supplement_reason: r.supplement_reason,
});
const projectRecall = (r: Record<string, any>) => compact({
  recall_number: r.product_res_number, event_number: r.res_event_number,
  recalling_firm: r.recalling_firm, product_description: r.product_description,
  reason_for_recall: r.reason_for_recall, action: r.action, status: r.recall_status,
  product_code: r.product_code, k_numbers: r.k_numbers,
  initiated_date: date(r.event_date_initiated), posted_date: date(r.event_date_posted),
  terminated_date: date(r.event_date_terminated), root_cause: r.root_cause_description,
});
const projectEvent = (r: Record<string, any>) => compact({
  event_key: r.event_key, report_number: r.report_number,
  event_type: r.event_type,
  received_date: date(r.date_received), event_date: date(r.date_of_event),
  application_number: r.pma_pmn_number,
  devices: (r.device ?? []).slice(0, 5).map((d: Record<string, any>) => compact({
    brand_name: d.brand_name, generic_name: d.generic_name,
    manufacturer: d.manufacturer_d_name, product_code: d.device_report_product_code,
    model_number: d.model_number, device_problem_codes: d.device_problem_code,
  })),
  patient_outcomes: (r.patient ?? []).slice(0, 5).flatMap((p: Record<string, any>) => p.sequence_number_outcome ?? []),
});
const projectClassification = (r: Record<string, any>) => compact({
  product_code: r.product_code, device_name: r.device_name, device_class: r.device_class,
  regulation_number: r.regulation_number, medical_specialty: r.medical_specialty_description,
  review_panel: r.review_panel, review_code: r.review_code, definition: r.definition,
  implant: r.implant_flag === 'Y', life_sustaining_or_supporting: r.life_sustain_support_flag === 'Y',
  submission_type: r.submission_type_id, gmp_exempt: r.gmp_exempt_flag === 'Y',
});
const projectUdi = (r: Record<string, any>) => compact({
  primary_di: r.primary_di, brand_name: r.brand_name, version_or_model: r.version_model_number,
  company_name: r.company_name, device_description: r.device_description,
  publish_date: date(r.publish_date), commercial_distribution_status: r.commercial_distribution_status,
  product_codes: (r.product_codes ?? []).slice(0, 10).map((p: Record<string, any>) =>
    compact({ code: p.code, name: p.name })),
  gmdn_terms: (r.gmdn_terms ?? []).slice(0, 10).map((g: Record<string, any>) =>
    compact({ name: g.name, definition: g.definition })),
});
const projectEstablishment = (r: Record<string, any>) => compact({
  registration_number: r.registration?.registration_number,
  firm_name: r.registration?.name, owner_operator_number: r.registration?.owner_operator_number,
  city: r.registration?.city, state: r.registration?.state_code, country: r.registration?.iso_country_code,
  status_code: r.registration?.status_code, initial_importer: r.registration?.initial_importer_flag === 'Y',
  listing_number: r.listing_number,
  products: (r.products ?? []).slice(0, 20).map((p: Record<string, any>) =>
    compact({ product_code: p.product_code, created_date: date(p.created_date), exempt: p.exempt })),
});

// A misspelled or invented argument used to be dropped on the floor: the
// caller got a clean 200 computed from the defaults (e.g. `device_name`
// instead of `device` silently returning an unfiltered pull of the whole
// database) and no way to tell. Say so instead. Gateway-injected arguments
// are all underscore-prefixed and are not the caller's. Mirrors the
// checkArgs pattern in mcps/sec-form-d/src/index.ts.
function checkArgs(args: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(args).filter((key) => !key.startsWith('_') && !allowed.includes(key));
  if (!unknown.length) return;
  throw new Error(
    `Unknown argument${unknown.length > 1 ? 's' : ''} ${unknown.map((key) => `"${key}"`).join(', ')} `
    + `for this tool. Accepted arguments: ${allowed.join(', ')}.`,
  );
}
function textClause(field: string, value: string | null | undefined): string | null {
  return value ? `${field}:${quote(value)}` : null;
}
function exactClause(field: string, value: string | null | undefined): string | null {
  return value ? `${field}:${quote(value)}` : null;
}
function thirdPartyClause(value: unknown): string | null {
  return typeof value === 'boolean' ? `third_party_flag:${quote(value ? 'Y' : 'N')}` : null;
}
function yn(value: unknown): boolean | undefined {
  return value === 'Y' ? true : value === 'N' ? false : undefined;
}
function rangeClause(field: string, from: unknown, to: unknown): string | null {
  const start = stringArg(from);
  const end = stringArg(to);
  if (!start && !end) return null;
  return `${field}:[${fdaDate(start ?? '1900-01-01')}+TO+${fdaDate(end ?? '2999-12-31')}]`;
}
function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}
function fdaDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('dates must use YYYY-MM-DD');
  return value.replaceAll('-', '');
}
function date(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : null;
}
function requiredString(args: Record<string, unknown>, key: string): string {
  const value = stringArg(args[key]);
  if (!value) throw new Error(`${key} is required`);
  return value;
}
function stringArg(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function intArg(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== '')) as T;
}
function source(endpoint: string): string {
  return `FDA openFDA device/${endpoint}`;
}
function maudeWarning(): string {
  return 'MAUDE contains mandatory and voluntary reports with duplicates, incomplete data, reporting bias, and no exposure denominator. A report does not prove the device caused an event; counts are not incidence or comparative safety rates.';
}

export default { tools, callTool, meter: { credits: 3 } } satisfies McpToolExport;
