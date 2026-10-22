
# @pipeworx/fda-devices

FDA medical-device regulatory intelligence: 510(k) premarket clearances (including De Novo classification requests), PMA approvals, recalls, MAUDE adverse-event reports, device classification, GUDID/UDI identifiers, and establishment registration/listing. Keyless.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1866+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `fda_device_510k_search(device?, indication?, applicant?, product_code?, k_number?, from_date?, to_date?, advisory_committee?, clearance_type?, decision?, applicant_country?, applicant_state?, third_party_review?, limit?, skip?)` — search 510(k) premarket notifications. Also covers De Novo classification requests (K numbers beginning `DEN`, e.g. `DEN250057`) — pass `clearance_type: "De Novo"` to find only these, or an exact `k_number`. A granted De Novo shows `decision: "Granted"`, `clearance_type: "De Novo"`, the FDA process variant in `de_novo_pathway` ("Direct" or "Post-NSE"), and the new device-classification `regulation_number` it created.
- `fda_device_510k_summary(k_number)` — the actual 510(k) summary/statement and FDA review (decision memo) document for one clearance, scraped off FDA's own detail page since openFDA does not expose the file itself. Older/paper-only filings return `summary_available: false` with a reason, not an error.
- `fda_device_pma_search(device?, indication?, applicant?, product_code?, pma_number?, from_date?, to_date?, limit?)` — search Premarket Approval (PMA) decisions and supplements, including by the FDA approval-order narrative text (`indication`) for high-risk IVD/companion-diagnostic claims.
- `fda_device_recalls(query?, firm?, product_code?, k_number?, status?, from_date?, limit?)` — medical-device recall (correction/removal) records.
- `fda_device_adverse_events(device?, manufacturer?, product_code?, event_type?, application_number?, from_date?, limit?)` — MAUDE adverse-event reports. Signals, not causal safety rates.
- `fda_device_event_counts(query?, count_field, limit?)` — aggregate MAUDE reports by device, manufacturer, event type, product code, or date.
- `fda_device_company_profile(company, limit_per_dataset?)` — bounded cross-dataset snapshot (510(k)/De Novo, PMA, recalls, MAUDE) for one company.
- `fda_device_classification(product_code?, device?, regulation_number?, limit?)` — FDA device classification/regulatory category lookup.
- `fda_device_udi_search(query?, company?, primary_di?, product_code?, limit?)` — GUDID/UDI device identifier records.
- `fda_device_establishment_search(firm?, registration_number?, product_code?, listing_number?, limit?)` — device registration/listing records.
- `fda_device_product_code_profile(product_code, limit_per_dataset?)` — bounded cross-dataset snapshot (classification, 510(k)/De Novo, PMA, recalls, MAUDE) for one product code.

Every call rejects unknown argument names rather than silently ignoring them.

## Auth

Keyless.

## Data sources

- U.S. Food and Drug Administration (FDA), openFDA device datasets — 510(k) premarket notification (which also carries De Novo classification requests), Premarket Approval (PMA), medical device recall enforcement reports, MAUDE adverse event reports, device classification, GUDID/UDI, and device registration & listing.
- U.S. FDA CDRH, 510(k) Premarket Notification database — the authoritative detail page for one clearance's summary/review document link, used only by `fda_device_510k_summary` because openFDA itself does not expose the document.

### Gotchas

- **De Novo records share the 510(k) endpoint, and openFDA's own decision/clearance-type text for them is wrong on its face.** A De Novo grant's K number begins `DEN` (e.g. `DEN250057`), and openFDA's `decision_code` for every one of them is `DENG` — but openFDA's own `decision_description` lookup for that code (and five older legacy 510(k) codes: Kit, Kit-With-Drugs, With-Drug, With-Limitations, Postmarket-Surveillance-Required) is the literal string `"Unknown"`, and its `clearance_type` for a De Novo record is `"Direct"` or `"Post-NSE"` — FDA's own PROCESS VARIANT for how the De Novo was handled, not a 510(k) clearance type. Confirmed live 2026-10-21 against FDA's own De Novo detail page, which labels the decision literally `"granted (DENG)"`. This pack maps `decision_code` through its own label table (`decision: "Granted"`) and remaps `clearance_type` to `"De Novo"` with the process variant preserved in `de_novo_pathway`, rather than passing openFDA's confusing raw text through. `clearance_type: "De Novo"` and `decision: "Granted"` as filter arguments are translated to the matching `decision_code`/`clearance_type` values server-side, since openFDA itself stores neither string literally.
- **`indication` on 510(k) is a best-effort device-category bridge, not a clinical-claim search** — 510(k) records carry no indication/intended-use text at all. It matches FDA's device classification category name/definition instead. For a real clinical-indication text search (useful for molecular/companion-diagnostic claims), use `fda_device_pma_search`'s `indication`, which searches FDA's actual approval-order narrative.
- **MAUDE's `manufacturer_name` field is populated on essentially no records** (25.7M rows, almost all empty string) while `device.manufacturer_d_name` is the real one — `fda_device_adverse_events`'s `manufacturer` argument searches the latter. A dead field 404s identically to "no matches", so every response names which fields were actually searched.
- **The most recent decision available lags roughly two weeks behind FDA's own site** — openFDA's publishing cadence, not ours.
- `fda_device_510k_summary`'s K-number PDF directory path is not derivable from the K number (year-segment naming is inconsistent, pre-2000 filings have no year segment at all) — the tool scrapes the actual link off FDA's detail page rather than guessing a path that could 404 for either "wrong guess" or "never digitized".

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

Both URLs reach the same gateway and the same 1866+ data sources. The
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
