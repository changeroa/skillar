import { CopyButton } from "./copy-button";

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function JsonNode({ name, value, depth }: { readonly name?: string; readonly value: JsonValue; readonly depth: number }) {
  const label = name === undefined ? "" : `${JSON.stringify(name)}: `;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value), array = Array.isArray(value);
    return <details class="json-branch" open={depth < 2}>
      <summary class="json-line"><code>{label}{array ? "[" : "{"}</code><span class="pe-muted">{entries.length}개</span></summary>
      <div class="json-children">{entries.map(([key, child]) => <JsonNode key={key} name={array ? undefined : key} value={child} depth={depth + 1} />)}</div>
      <div class="json-line"><code>{array ? "]" : "}"}</code></div>
    </details>;
  }
  const text = JSON.stringify(value);
  if (text.length > 160) return <details class="json-long">
    <summary class="json-line"><code>{label}{text.slice(0, 160)}…</code></summary>
    <div class="json-line"><code class="json-value" data-json-type={typeof value}>{text}</code></div>
  </details>;
  return <div class="json-line"><code>{label}<span class="json-value" data-json-type={typeof value}>{text}</span></code></div>;
}

export function JsonViewer({ value }: { readonly value: object }) {
  const serialized = JSON.stringify(value, null, 2);
  const snapshot: JsonValue = JSON.parse(serialized);
  return <section class="json-viewer" data-event-raw aria-label="이벤트 원본 JSON">
    <header class="json-viewer__head"><strong>이벤트 원본</strong><CopyButton value={serialized} label="이벤트 원본 JSON" /></header>
    <div class="json-viewer__tree"><JsonNode value={snapshot} depth={0} /></div>
  </section>;
}
