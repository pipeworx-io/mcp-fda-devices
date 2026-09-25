# mcp-fda-devices

FDA medical-device regulatory intelligence from keyless openFDA datasets.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1681+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `fda_device_510k_search` | Search FDA 510(k) premarket notifications by device, applicant, product code, K number, review panel, clearance type, decision, applicant location, or third-party review status. Covers IN VITRO DIAGNOSTIC (IVD) tests and diagnostic devices, not just implants/hardware -- includes cleared molecular, genomic and companion diagnostic tests. Clearance means FDA found substantial equivalence; it is not an FDA approval or endorsement. Unknown arguments are rejected, not ignored. The most recent decision available lags roughly 2 weeks behind FDA's own site (openFDA's publishing cadence, not ours) -- do not treat this as same-day. `total` can exceed the 100-row `limit` cap; page further rows with `skip`. |
| `fda_device_510k_summary` | Get the FDA 510(k) summary/statement document and FDA review (decision memo) for one clearance, by K number — the actual filing, not just the "a document exists" flag from fda_device_510k_search. Shows the predicate device claimed and the testing behind the equivalence finding. Older/paper-only clearances were never digitized; that returns summary_available:false with a reason, not an error. |
| `fda_device_pma_search` | Search FDA Premarket Approval (PMA) decisions and supplements by trade/generic name, applicant, product code, or PMA number. Which diagnostic tests are FDA-approved: covers high-risk IN VITRO DIAGNOSTIC (IVD) tests approved via PMA, including companion diagnostics and molecular residual disease (MRD) / ctDNA monitoring tests (e.g. Signatera, Guardant360 CDx) -- these are FDA-approved tests, not cleared devices, so this tool (not 510(k)) is the one that finds them. Supplements may represent manufacturing or labeling changes rather than new devices. |
| `fda_device_recalls` | Search FDA medical-device recall records by firm, product, product code, K number, status, or date. A recall record describes a correction/removal action and does not by itself establish patient harm. |
| `fda_device_adverse_events` | Search FDA MAUDE medical-device reports by manufacturer, brand/device, product code, event type, or PMA/510(k) number. MAUDE reports are unverified signals: they cannot establish causation, incidence, prevalence, or comparative safety. |
| `fda_device_event_counts` | Aggregate MAUDE reports for a device query by event type, manufacturer, product code, or receive date. Counts reflect reporting and database artifacts—not event rates or causal risk—and must not be compared without exposure denominators. |
| `fda_device_company_profile` | Build a bounded FDA regulatory snapshot for one device company across 510(k), PMA, recalls, and MAUDE. Dataset name matching is imperfect and MAUDE counts are signals, not safety rates. |
| `fda_device_classification` | Look up FDA device classification and regulatory context by product code, device name, or regulation number. Classification describes the product-code category, not a specific product’s clearance or approval. |
| `fda_device_udi_search` | Search FDA GUDID/UDI records by brand, company, device identifier, or product code. A UDI record describes an identified device in GUDID; it does not establish current sales, availability, clearance, approval, or safety. |
| `fda_device_establishment_search` | Search FDA device registration/listing data by firm, registration number, product code, or listing number. Registration/listing does not mean FDA approval, clearance, certification, or endorsement. |
| `fda_device_product_code_profile` | Build a bounded cross-dataset snapshot for one FDA product code: classification, recent 510(k)s, PMAs, recalls, and MAUDE reports. Dataset counts have different meanings; MAUDE counts are not event rates. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "fda-devices": {
      "url": "https://gateway.pipeworx.io/fda-devices/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/fda-devices/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1681+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/fda_device_510k_search \
  -H 'Content-Type: application/json' \
  -d '{"device":"glucose monitor","from_date":"2025-01-01","limit":10}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/fda_device_510k_search`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "fda-devices": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-fda-devices"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-fda-devices
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Fda Devices data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
