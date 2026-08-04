# mcp-fda-devices

FDA medical-device regulatory intelligence from keyless openFDA datasets.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `fda_device_510k_search` | Search FDA 510(k) premarket notifications by device, applicant, product code, or K number. Clearance means FDA found substantial equivalence; it is not an FDA approval or endorsement. |
| `fda_device_pma_search` | Search FDA Premarket Approval (PMA) decisions and supplements by trade/generic name, applicant, product code, or PMA number. Supplements may represent manufacturing or labeling changes rather than new devices. |
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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Fda Devices data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
