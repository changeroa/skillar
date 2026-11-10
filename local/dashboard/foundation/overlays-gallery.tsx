import { useState } from "preact/hooks";
import { Button, Input } from "./controls";
import { ConfirmDialog, Dialog, DropdownMenu, Sheet, Tooltip } from "./overlays";

export function OverlaysGallery() {
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [result, setResult] = useState("아직 선택하지 않았습니다.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const items = [
    { id: "alpha", label: "Alpha", onSelect: () => setResult("Alpha") },
    { id: "disabled", label: "Disabled", disabled: true, onSelect: () => setResult("잘못된 선택") },
    { id: "beta", label: "Beta", onSelect: () => setResult("Beta") },
    { id: "bravo", label: "Bravo", onSelect: () => setResult("Bravo") },
    { id: "delete", label: "Delete", destructive: true, onSelect: () => setConfirm(true) },
  ] as const;
  return <section id="overlays-gallery" aria-labelledby="overlays-title">
    <h2 id="overlays-title">오버레이</h2>
    <div class="lf-gallery__cluster">
      <Button id="open-dialog" text="대화상자 열기" onClick={() => setDialog(true)} />
      <Button id="open-confirm" text="삭제 확인" variant="outline" onClick={() => setConfirm(true)} />
      <Button id="open-sheet" text="사이드 패널 열기" variant="outline" onClick={() => setSheet(true)} />
      <DropdownMenu id="standalone-menu" label="메뉴 열기" items={items} />
      <DropdownMenu id="disabled-menu" label="비활성 메뉴" items={items} disabled />
      <DropdownMenu id="empty-menu" label="빈 메뉴" items={[]} />
      <Tooltip id="sample-tooltip" content="필터 옵션을 확인합니다.">
        <Button id="tooltip-trigger" text="도움말" variant="outline" />
      </Tooltip>
    </div>
    <output id="overlay-result" aria-live="polite">{result}</output>
    <Dialog id="sample-dialog" open={dialog} title="스킬 정보" onClose={() => setDialog(false)}
      initialFocusId="dialog-name" actions={<Button id="dialog-done" text="완료" onClick={() => setDialog(false)} />}>
      <Input id="dialog-name" label="이름" defaultValue="예시 스킬" />
      <DropdownMenu id="nested-menu" label="작업 메뉴" items={items} />
      <Button id="nested-confirm" text="삭제 확인" variant="outline" onClick={() => setConfirm(true)} />
      <Tooltip id="dialog-tooltip" content="기록된 이름을 수정합니다.">
        <Button text="필드 도움말" variant="ghost" />
      </Tooltip>
    </Dialog>
    <ConfirmDialog id="sample-confirm" open={confirm} title="스킬을 삭제할까요?"
      description="삭제한 스킬은 복구할 수 없습니다." confirmLabel="삭제"
      onClose={() => { setConfirm(false); setBusy(false); setError(false); }}
      busy={busy} error={error ? "삭제하지 못했습니다. 다시 시도하세요." : undefined}
      onConfirm={() => { setResult("삭제됨"); setConfirm(false); }} />
    <div class="lf-gallery__cluster">
      <Button id="confirm-loading" text="처리 중 상태" variant="outline" onClick={() => { setBusy(true); setConfirm(true); }} />
      <Button id="confirm-error" text="오류 상태" variant="outline" onClick={() => { setError(true); setConfirm(true); }} />
    </div>
    <Sheet id="sample-sheet" open={sheet} title="스킬 미리보기" onClose={() => setSheet(false)}
      actions={<Button id="sheet-done" text="완료" onClick={() => setSheet(false)} />}>
      <p>헤더와 작업 버튼을 유지하고 본문만 스크롤합니다.</p>
      <DropdownMenu id="sheet-menu" label="작업 메뉴" items={items} />
      {Array.from({ length: 24 }, (_, index) => <p key={index}>기록된 항목 {index + 1}</p>)}
    </Sheet>
  </section>;
}
