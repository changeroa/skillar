import { useEffect, useRef, useState } from "preact/hooks";
import {
  privatePackDefinitionSchema, privatePackCreateSchema, privatePackUpdateSchema, privatePackStatusSchema, privatePackUri,
} from "../../../shared/dist/private-packs.js";
import type {
  PrivatePackDefinition, PrivatePackCreate, PrivatePackUpdate, PrivatePackReceipt, PrivatePackSearchResult,
} from "../../../shared/dist/private-packs.js";
import { DashboardRequestError, describeFailure, isUnauthorized } from "./api";
import { publishPrivatePack, readPrivatePacks, readPrivatePackStatus } from "./pack-api";

type Draft = { action: "create"; body: PrivatePackCreate } | { action: "update"; body: PrivatePackUpdate };

function publicationSummary(receipt: PrivatePackReceipt): string {
  switch (receipt.status) {
    case "accepted": return "Accepted; publication is not complete.";
    case "published": return `${receipt.unchanged ? "Unchanged version" : "Published version"} ${receipt.revision}. ${receipt.searchable ? "Searchable now." : "Not currently searchable."}`;
    case "failed": return "Publication failed. Review the current pack digest and pinned member versions before starting a new request.";
  }
}

export function PrivatePacks({ signal: parentSignal, onUnauthorized }: {
  readonly signal: AbortSignal; readonly onUnauthorized: () => void;
}) {
  const [definition, setDefinition] = useState<PrivatePackDefinition | null>(null);
  const [filename, setFilename] = useState("");
  const [action, setAction] = useState<"create" | "update">("create");
  const [base, setBase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [receipt, setReceipt] = useState<PrivatePackReceipt | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [lookupReceipt, setLookupReceipt] = useState<PrivatePackReceipt | null>(null);
  const [catalog, setCatalog] = useState<PrivatePackSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [controller] = useState(() => new AbortController());
  const signal = controller.signal;
  const epoch = useRef(0);
  const authoring = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const abort = () => controller.abort();
    if (parentSignal.aborted) abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
    return () => {
      epoch.current++;
      controller.abort();
      parentSignal.removeEventListener("abort", abort);
    };
  }, [controller, parentSignal]);

  const run = async (task: () => Promise<void>) => {
    if (busy || signal.aborted) return;
    const current = epoch.current;
    setBusy(true);
    setFailure(null);
    try {
      await task();
    } catch (error) {
      if (current !== epoch.current || signal.aborted) return;
      if (isUnauthorized(error)) { onUnauthorized(); return; }
      setFailure(error instanceof DashboardRequestError && error.status === 404 ?
        "That private pack or request is unavailable." : describeFailure(error, "Private pack request"));
    } finally {
      if (current === epoch.current && !signal.aborted) setBusy(false);
    }
  };
  const publish = (request: Draft) => run(async () => {
    const result = await publishPrivatePack(request, signal);
    if (!signal.aborted) setReceipt(result);
  });
  const terminal = receipt !== null && receipt.status !== "accepted";

  return (
    <section class="panel private-packs" aria-labelledby="private-packs-title">
      <div class="panel__head">
        <h2 id="private-packs-title">Private packs</h2>
        <button class="button secondary" type="button" disabled={busy} onClick={() => void run(async () => {
          const result = await readPrivatePacks(signal);
          if (!signal.aborted) setCatalog(result);
        })}>Refresh packs</button>
      </div>
      <p class="note">Packs group explicitly published, pinned private skill versions. They do not upload local skill files or grant execution permission.</p>
      {catalog !== null && (
        <div class="status-block">
          <p>{catalog.totalMatches} published pack{catalog.totalMatches === 1 ? "" : "s"}. Showing up to five.</p>
          {catalog.packs.map(pack => <div class="source" key={pack.uri}>
            <h3>{pack.display_name}</h3>
            <dl class="account-status source__facts">
              <div><dt>Pack URI</dt><dd><code>{pack.uri}</code></dd></div>
              <div><dt>Digest</dt><dd><code>{pack.digest}</code></dd></div>
            </dl>
            {draft === null ?
              <button class="button secondary" type="button" disabled={busy}
                onClick={() => {
                  setAction("update"); setBase(pack.digest);
                  if (authoring.current !== null) {
                    authoring.current.open = true;
                    authoring.current.querySelector<HTMLInputElement>("input[type=file]")?.focus();
                  }
                }}>Use digest for update</button> :
              <p class="note">{terminal ? "Choose New pack request below before starting an update." :
                "Finish the current publication request below before starting an update."}</p>}
          </div>)}
        </div>
      )}
      <details class="consent" ref={authoring}>
        <summary>Publish a private pack</summary>
        <p class="note">Choose a pack definition JSON file with scope, investigate and verify members. Each skill version must already be pinned in your <a href="/skills/">private library</a>. The file stays in this browser until you confirm publication.</p>
        <form class="command-form" onSubmit={event => {
          event.preventDefault();
          if (definition === null || !acknowledged || busy || draft !== null) return;
          const requestId = crypto.randomUUID();
          const next: Draft = action === "create" ? {
            action, body: privatePackCreateSchema.parse({
              request_id: requestId, acknowledge_private_upload: true, definition,
            }),
          } : {
            action, body: privatePackUpdateSchema.parse({
              request_id: requestId, acknowledge_private_upload: true, definition,
              uri: privatePackUri(definition.name), expected_digest: base,
            }),
          };
          setDraft(next);
          setReceipt(null);
          setLookupReceipt(null);
          void publish(next);
        }}>
          <div class="command-form__fields">
            <label class="field-label">Operation<select class="text-field" value={action} disabled={busy || draft !== null}
              onChange={event => setAction(event.currentTarget.value === "update" ? "update" : "create")}>
              <option value="create">Create pack</option><option value="update">Update pack</option>
            </select></label>
            <label class="field-label">Definition JSON<input class="text-field" type="file" accept=".json,application/json"
              disabled={busy || draft !== null} onChange={event => {
              const file = event.currentTarget.files?.[0];
              setDefinition(null); setFilename(""); setFailure(null);
              if (file === undefined) return;
              const current = ++epoch.current;
              void (async () => {
                if (file.size > 256 * 1024) { setFailure("Choose a pack definition smaller than 256 KiB."); return; }
                try {
                  const parsed = privatePackDefinitionSchema.parse(JSON.parse(await file.text()));
                  if (current === epoch.current && !signal.aborted) { setDefinition(parsed); setFilename(file.name); }
                } catch {
                  if (current === epoch.current && !signal.aborted) setFailure("This file is not a valid pack definition. Check its members, phases and pinned version URIs.");
                }
              })();
            }} /></label>
            {action === "update" && <label class="field-label">Current digest<input class="text-field" value={base}
              disabled={busy || draft !== null} required pattern="[a-f0-9]{64}"
              spellcheck={false} onInput={event => setBase(event.currentTarget.value)} /></label>}
          </div>
          {definition !== null && <p class="note">{filename}: {definition.display_name}, {definition.members.length} pinned member references.</p>}
          <label class="choice"><input type="checkbox" checked={acknowledged} disabled={busy || draft !== null}
            onChange={event => setAcknowledged(event.currentTarget.checked)} /><span>I want to publish this pack definition to my private account.</span></label>
          {draft !== null ? <p class="note">{terminal ? "This request is complete. Choose New pack request below to edit again." :
            "This request's content is fixed. Check its status or retry the same request below."}</p> :
            (definition === null || !acknowledged) && <p class="note">Choose a valid definition and confirm publication to enable this action.</p>}
          <button class="button primary" type="submit" disabled={busy || draft !== null || definition === null || !acknowledged}>Publish private pack</button>
        </form>
      </details>
      {draft !== null && (
        <div class="status-block" aria-live="polite">
          <p>Request <code>{draft.body.request_id}</code></p>
          {receipt === null ? <p>Publication is not confirmed. Retry the same request or check its status.</p> :
            <p>{publicationSummary(receipt)}</p>}
          <div class="panel__head">
            <button class="button secondary" type="button" disabled={busy} onClick={() => void run(async () => {
              const result = await readPrivatePackStatus({ request_id: draft.body.request_id }, signal);
              if (!signal.aborted) setReceipt(result);
            })}>Check status</button>
            {!terminal && <button class="button secondary" type="button" disabled={busy}
              onClick={() => void publish(draft)}>Retry same request</button>}
            {terminal && <button class="button secondary" type="button" disabled={busy} onClick={() => {
              setDraft(null); setReceipt(null); setAcknowledged(false); setFailure(null);
            }}>New pack request</button>}
          </div>
        </div>
      )}
      {draft === null && (
        <form class="command-lookup" onSubmit={event => {
          event.preventDefault();
          if (busy) return;
          const parsed = privatePackStatusSchema.safeParse({ request_id: lookupId.trim() });
          if (!parsed.success) { setFailure("Enter a valid publication request ID."); return; }
          setLookupReceipt(null);
          void run(async () => {
            const result = await readPrivatePackStatus(parsed.data, signal);
            if (!signal.aborted) setLookupReceipt(result);
          });
        }}>
          <label class="field-label">Publication request ID<input class="text-field" value={lookupId}
            required maxLength={36} spellcheck={false} autoComplete="off" disabled={busy}
            onInput={event => { setLookupId(event.currentTarget.value); setLookupReceipt(null); }} /></label>
          <button class="button secondary" type="submit" disabled={busy}>Check a publication request</button>
        </form>
      )}
      {draft === null && lookupReceipt !== null && (
        <div class="status-block" aria-live="polite">
          <dl class="account-status source__facts">
            <div><dt>Publication request</dt><dd><code>{lookupReceipt.request_id}</code></dd></div>
            <div><dt>Pack URI</dt><dd><code>{lookupReceipt.uri}</code></dd></div>
            <div><dt>Digest</dt><dd><code>{lookupReceipt.digest}</code></dd></div>
          </dl>
          <p>{publicationSummary(lookupReceipt)}</p>
        </div>
      )}
      {busy && <p class="note" role="status">Checking private pack request…</p>}
      {failure !== null && <p class="note" role="alert">{failure}</p>}
    </section>
  );
}
