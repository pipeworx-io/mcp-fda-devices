interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * FDA medical-device regulatory intelligence from keyless openFDA datasets.
 */

const BASE = 'https://api.fda.gov/device';
const MAX_BYTES = 3_000_000;

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
    description: 'Search FDA 510(k) premarket notifications by device, applicant, product code, or K number. Clearance means FDA found substantial equivalence; it is not an FDA approval or endorsement.',
    inputSchema: {
      type: 'object',
      properties: {
        device: { type: 'string', description: 'Device/trade name substring.' },
        applicant: { type: 'string', description: 'Applicant/company substring.' },
        product_code: { type: 'string', description: 'Exact three-letter FDA product code.' },
        k_number: { type: 'string', description: 'Exact K number, e.g. K241234.' },
        from_date: { type: 'string', description: 'Earliest decision date, YYYY-MM-DD.' },
        to_date: { type: 'string', description: 'Latest decision date, YYYY-MM-DD.' },
        limit: { type: 'number', description: 'Results (1-100, default 20).' },
      },
    },
    outputSchema: listSchema('clearances'),
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
        query: { type: 'string', description: 'Required raw openFDA MAUDE filter.' },
        count_field: { type: 'string', enum: ['event_type.exact', 'manufacturer_name.exact', 'device.device_report_product_code.exact', 'date_received'] },
        limit: { type: 'number', description: 'Buckets (1-100, default 20).' },
      },
      required: ['query', 'count_field'],
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
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'fda_device_510k_search': return search510k(args);
    case 'fda_device_pma_search': return searchPma(args);
    case 'fda_device_recalls': return searchRecalls(args);
    case 'fda_device_adverse_events': return searchEvents(args);
    case 'fda_device_event_counts': return countEvents(args);
    case 'fda_device_company_profile': return companyProfile(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

async function search510k(args: Record<string, unknown>) {
  const clauses = [
    textClause('device_name', stringArg(args.device)),
    textClause('applicant', stringArg(args.applicant)),
    exactClause('product_code', stringArg(args.product_code)?.toUpperCase()),
    exactClause('k_number', stringArg(args.k_number)?.toUpperCase()),
    rangeClause('decision_date', args.from_date, args.to_date),
  ].filter(Boolean) as string[];
  const data = await fda('510k', clauses.join('+AND+'), intArg(args.limit, 20, 1, 100), 'decision_date:desc');
  return listResult('clearances', data, project510k);
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
    textClause('manufacturer_name', stringArg(args.manufacturer)),
    exactClause('device.device_report_product_code', stringArg(args.product_code)?.toUpperCase()),
    exactClause('event_type', stringArg(args.event_type)),
    exactClause('pma_pmn_number', stringArg(args.application_number)?.toUpperCase()),
    rangeClause('date_received', args.from_date, null),
  ].filter(Boolean) as string[];
  if (!clauses.length) throw new Error('Provide at least one MAUDE filter.');
  const data = await fda('event', clauses.join('+AND+'), intArg(args.limit, 10, 1, 50), 'date_received:desc');
  const result = listResult('reports', data, projectEvent);
  return { ...result, interpretation: maudeWarning() };
}

async function countEvents(args: Record<string, unknown>) {
  const query = requiredString(args, 'query');
  const count = requiredString(args, 'count_field');
  const allowed = new Set(['event_type.exact', 'manufacturer_name.exact', 'device.device_report_product_code.exact', 'date_received']);
  if (!allowed.has(count)) throw new Error('Unsupported count_field.');
  const data = await fda('event', query, intArg(args.limit, 20, 1, 100), undefined, count);
  const buckets = (data.results ?? []).map((row) => compact({ term: row.term, count: row.count }));
  return { total: buckets.length, returned: buckets.length, buckets, source: source('event'), interpretation: maudeWarning() };
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

async function fda(endpoint: string, search: string, limit: number, sort?: string, count?: string): Promise<FdaResponse> {
  const url = new URL(`${BASE}/${endpoint}.json`);
  if (search) url.searchParams.set('search', search);
  if (count) url.searchParams.set('count', count);
  else {
    url.searchParams.set('limit', String(limit));
    if (sort) url.searchParams.set('sort', sort);
  }
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
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
  return { total: data.meta?.results?.total ?? rows.length, returned: rows.length, [key]: rows, source: source(key === 'clearances' ? '510k' : key === 'approvals' ? 'pma' : key === 'reports' ? 'event' : 'recall') };
}

const project510k = (r: Record<string, any>) => compact({
  k_number: r.k_number, device_name: r.device_name, applicant: r.applicant,
  decision_date: date(r.decision_date), decision: r.decision_description,
  clearance_type: r.clearance_type, product_code: r.product_code,
  advisory_committee: r.advisory_committee_description,
  statement_or_summary: r.statement_or_summary,
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
  event_type: r.event_type, manufacturer_name: r.manufacturer_name,
  received_date: date(r.date_received), event_date: date(r.date_of_event),
  application_number: r.pma_pmn_number,
  devices: (r.device ?? []).slice(0, 5).map((d: Record<string, any>) => compact({
    brand_name: d.brand_name, generic_name: d.generic_name,
    manufacturer: d.manufacturer_d_name, product_code: d.device_report_product_code,
    model_number: d.model_number, device_problem_codes: d.device_problem_code,
  })),
  patient_outcomes: (r.patient ?? []).slice(0, 5).flatMap((p: Record<string, any>) => p.sequence_number_outcome ?? []),
});

function textClause(field: string, value: string | null | undefined): string | null {
  return value ? `${field}:${quote(value)}` : null;
}
function exactClause(field: string, value: string | null | undefined): string | null {
  return value ? `${field}:${quote(value)}` : null;
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
