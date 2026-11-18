import { CopyButton } from "./copy-button";

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function JsonNode({ name, value, depth }: { readonly name?: string; readonly value: JsonValue; readonly depth: number }) {
  const label = name === undefined ? "" : `${JSON.stringify(name)}: `;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value), array = Array.isArray(value);
    return <details className="json-branch" open={depth < 2}>
      <summary className="json-line"><code>{label}{array ? "[" : "{"}</code><span className="pe-muted">{entries.length}개</span></summary>
      <div className="json-children">{entries.map(([key, child]) => <JsonNode key={key} name={array ? undefined : key} value={child} depth={depth + 1} />)}</div>
      <div className="json-line"><code>{array ? "]" : "}"}</code></div>
    </details>;
  }
  const text = JSON.stringify(value);
  if (text.length > 160) return <details className="json-long">
    <summary className="json-line"><code>{label}<span className="json-value-preview" data-json-type={typeof value}>{text.slice(0, 160)}…</span></code></summary>
    <div className="json-line"><code className="json-value" data-json-type={typeof value}>{text}</code></div>
  </details>;
  return <div className="json-line"><code>{label}<span className="json-value" data-json-type={value === null ? "null" : typeof value}>{text}</span></code></div>;
}

export function JsonViewer({ value }: { readonly value: object }) {
  const serialized = JSON.stringify(value, null, 2);
  const snapshot: JsonValue = JSON.parse(serialized);
  return <section className="json-viewer" data-event-raw aria-label="이벤트 원본 JSON">
    <header className="json-viewer__head"><strong>이벤트 원본</strong><CopyButton value={serialized} label="이벤트 원본 JSON" /></header>
    <div className="json-viewer__tree"><JsonNode value={snapshot} depth={0} /></div>
  </section>;
}
