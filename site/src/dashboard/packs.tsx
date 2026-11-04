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
    case "accepted": return "접수됨. 게시가 아직 완료되지 않았습니다.";
    case "published": return `버전 ${receipt.revision} ${receipt.unchanged ? "변경 없음" : "게시됨"}. ${receipt.searchable ? "지금 검색할 수 있습니다." : "현재 검색할 수 없습니다."}`;
    case "failed": return "게시에 실패했습니다. 새 요청을 시작하기 전에 현재 팩 다이제스트와 고정된 구성 항목 버전을 확인하세요.";
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
        "해당 비공개 팩이나 요청을 찾을 수 없습니다." : describeFailure(error, "비공개 팩 작업"));
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
        <h2 id="private-packs-title">비공개 팩</h2>
        <button class="button secondary" type="button" disabled={busy} onClick={() => void run(async () => {
          const result = await readPrivatePacks(signal);
          if (!signal.aborted) setCatalog(result);
        })}>팩 새로 고침</button>
      </div>
      <p class="note">팩은 명시적으로 게시하고 고정한 비공개 스킬 버전을 모아 놓은 것입니다. 로컬 스킬 파일을 업로드하거나 실행 권한을 부여하지는 않습니다.</p>
      {catalog !== null && (
        <div class="status-block">
          <p>게시된 팩 {catalog.totalMatches}개. 최대 5개까지 표시합니다.</p>
          {catalog.packs.map(pack => <div class="source" key={pack.uri}>
            <h3>{pack.display_name}</h3>
            <dl class="account-status source__facts">
              <div><dt>팩 URI</dt><dd><code>{pack.uri}</code></dd></div>
              <div><dt>다이제스트</dt><dd><code>{pack.digest}</code></dd></div>
            </dl>
            {draft === null ?
              <button class="button secondary" type="button" disabled={busy}
                onClick={() => {
                  setAction("update"); setBase(pack.digest);
                  if (authoring.current !== null) {
                    authoring.current.open = true;
                    authoring.current.querySelector<HTMLInputElement>("input[type=file]")?.focus();
                  }
                }}>이 다이제스트로 업데이트</button> :
              <p class="note">{terminal ? "업데이트를 시작하려면 먼저 아래에서 '새 팩 요청'을 선택하세요." :
                "업데이트를 시작하려면 먼저 아래의 현재 게시 요청을 마무리하세요."}</p>}
          </div>)}
        </div>
      )}
      <details class="consent" ref={authoring}>
        <summary>비공개 팩 게시</summary>
        <p class="note">scope, investigate, verify 구성 항목이 들어 있는 팩 정의 JSON 파일을 선택하세요. 각 스킬 버전은 <a href="/skills/">비공개 라이브러리</a>에 이미 고정되어 있어야 합니다. 게시를 확인하기 전까지 파일은 이 브라우저에만 남습니다.</p>
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
            <label class="field-label">작업<select class="text-field" value={action} disabled={busy || draft !== null}
              onChange={event => setAction(event.currentTarget.value === "update" ? "update" : "create")}>
              <option value="create">팩 만들기</option><option value="update">팩 업데이트</option>
            </select></label>
            <label class="field-label">정의 JSON<input class="text-field" type="file" accept=".json,application/json"
              disabled={busy || draft !== null} onChange={event => {
              const file = event.currentTarget.files?.[0];
              setDefinition(null); setFilename(""); setFailure(null);
              if (file === undefined) return;
              const current = ++epoch.current;
              void (async () => {
                if (file.size > 256 * 1024) { setFailure("256 KiB보다 작은 팩 정의 파일을 선택하세요."); return; }
                try {
                  const parsed = privatePackDefinitionSchema.parse(JSON.parse(await file.text()));
                  if (current === epoch.current && !signal.aborted) { setDefinition(parsed); setFilename(file.name); }
                } catch {
                  if (current === epoch.current && !signal.aborted) setFailure("이 파일은 올바른 팩 정의가 아닙니다. 구성 항목, 단계, 고정 버전 URI를 확인하세요.");
                }
              })();
            }} /></label>
            {action === "update" && <label class="field-label">현재 다이제스트<input class="text-field" value={base}
              disabled={busy || draft !== null} required pattern="[a-f0-9]{64}"
              spellcheck={false} onInput={event => setBase(event.currentTarget.value)} /></label>}
          </div>
          {definition !== null && <p class="note">{filename}: {definition.display_name}, 고정된 구성 항목 참조 {definition.members.length}개.</p>}
          <label class="choice"><input type="checkbox" checked={acknowledged} disabled={busy || draft !== null}
            onChange={event => setAcknowledged(event.currentTarget.checked)} /><span>이 팩 정의를 내 비공개 계정에 게시하겠습니다.</span></label>
          {draft !== null ? <p class="note">{terminal ? "이 요청은 완료되었습니다. 다시 편집하려면 아래에서 '새 팩 요청'을 선택하세요." :
            "이 요청의 내용은 고정되어 있습니다. 아래에서 상태를 확인하거나 같은 요청을 다시 시도하세요."}</p> :
            (definition === null || !acknowledged) && <p class="note">올바른 정의를 선택하고 게시를 확인하면 이 작업을 할 수 있습니다.</p>}
          <button class="button primary" type="submit" disabled={busy || draft !== null || definition === null || !acknowledged}>비공개 팩 게시</button>
        </form>
      </details>
      {draft !== null && (
        <div class="status-block" aria-live="polite">
          <p>요청 <code>{draft.body.request_id}</code></p>
          {receipt === null ? <p>게시가 확인되지 않았습니다. 같은 요청을 다시 시도하거나 상태를 확인하세요.</p> :
            <p>{publicationSummary(receipt)}</p>}
          <div class="panel__head">
            <button class="button secondary" type="button" disabled={busy} onClick={() => void run(async () => {
              const result = await readPrivatePackStatus({ request_id: draft.body.request_id }, signal);
              if (!signal.aborted) setReceipt(result);
            })}>상태 확인</button>
            {!terminal && <button class="button secondary" type="button" disabled={busy}
              onClick={() => void publish(draft)}>같은 요청 다시 시도</button>}
            {terminal && <button class="button secondary" type="button" disabled={busy} onClick={() => {
              setDraft(null); setReceipt(null); setAcknowledged(false); setFailure(null);
            }}>새 팩 요청</button>}
          </div>
        </div>
      )}
      {draft === null && (
        <form class="command-lookup" onSubmit={event => {
          event.preventDefault();
          if (busy) return;
          const parsed = privatePackStatusSchema.safeParse({ request_id: lookupId.trim() });
          if (!parsed.success) { setFailure("올바른 게시 요청 ID를 입력하세요."); return; }
          setLookupReceipt(null);
          void run(async () => {
            const result = await readPrivatePackStatus(parsed.data, signal);
            if (!signal.aborted) setLookupReceipt(result);
          });
        }}>
          <label class="field-label">게시 요청 ID<input class="text-field" value={lookupId}
            required maxLength={36} spellcheck={false} autoComplete="off" disabled={busy}
            onInput={event => { setLookupId(event.currentTarget.value); setLookupReceipt(null); }} /></label>
          <button class="button secondary" type="submit" disabled={busy}>게시 요청 확인</button>
        </form>
      )}
      {draft === null && lookupReceipt !== null && (
        <div class="status-block" aria-live="polite">
          <dl class="account-status source__facts">
            <div><dt>게시 요청</dt><dd><code>{lookupReceipt.request_id}</code></dd></div>
            <div><dt>팩 URI</dt><dd><code>{lookupReceipt.uri}</code></dd></div>
            <div><dt>다이제스트</dt><dd><code>{lookupReceipt.digest}</code></dd></div>
          </dl>
          <p>{publicationSummary(lookupReceipt)}</p>
        </div>
      )}
      {busy && <p class="note" role="status">비공개 팩 요청을 처리하는 중…</p>}
      {failure !== null && <p class="note" role="alert">{failure}</p>}
    </section>
  );
}
