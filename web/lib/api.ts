// Typed client for the Quarry API, including the Server-Sent Events stream for /api/chat.

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface AgentEvent {
  type: string;
  run_id: string;
  ts: number;
  step: number | null;
  data: Record<string, any>;
}

export interface SourceRecord {
  id: string;
  kind: "sql" | "python";
  sql?: string;
  code?: string;
  purpose?: string;
  inputs?: string[];
  ok: boolean;
  columns: string[];
  types?: string[];
  rows: Json[][];
  row_count: number;
  truncated?: boolean;
  elapsed_ms: number;
  error: string | null;
}

export interface Citation {
  id: string;
  text: string;
  value: number;
  source_id: string;
}

export interface ChartRecord {
  id: string;
  source_id: string;
  title: string;
  spec: Record<string, any>;
}

export interface FinalData {
  status: "answered" | "refused";
  answer: string;
  citations: Citation[];
  result_query_id: string | null;
  chart_ids: string[];
  caveats: string[];
  unverified: string[];
  sources: Record<string, SourceRecord>;
  charts: ChartRecord[];
}

export class RateLimitError extends Error {
  constructor(
    public reason: string,
    public retryAfterS: number,
  ) {
    super(reason);
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/** POST a message and call onEvent for every SSE event until the stream ends. */
export async function streamChat(
  body: { message: string; session_id?: string | null },
  onEvent: (name: string, data: any) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    throw new RateLimitError(j.error ?? "rate_limited", Number(j.retry_after_s ?? 60));
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      let name = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) name = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (data) onEvent(name, JSON.parse(data));
    }
  }
}

export interface Health {
  ok: boolean;
  provider: string;
  model: string | null;
  error?: string;
  python_sandbox?: { enabled: boolean; isolation: string };
  rate_limit?: { remaining_hour: number; remaining_day: number; per_ip_hour: number; global_day: number };
}

export interface SchemaInfo {
  tables: {
    name: string;
    description: string;
    rows: number;
    columns: { name: string; type: string; description: string }[];
  }[];
  glossary: string;
  examples: string[];
}
