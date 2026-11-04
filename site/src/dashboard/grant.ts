export const DEFAULT_ORIGIN = "https://skillar.sh";

export function grantFileName(deviceId: string): string {
  const stem = deviceId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase() || "device";
  return `skillar-grant-${stem}.txt`;
}

export function grantFileText(grant: string): string {
  return `${grant}\n`;
}

export type ConnectStep = { readonly text: string; readonly command?: string };

export function connectSteps(fileName: string, origin: string): readonly ConnectStep[] {
  const originFlag = origin === DEFAULT_ORIGIN ? "" : ` --origin ${origin}`;
  return [
    { text: "기기에서 내려받은 파일로 연결하세요. 이 단계는 기기를 연결할 뿐 아무것도 업로드하지 않습니다.",
      command: `skillar sync connect --grant-file ~/Downloads/${fileName}${originFlag}` },
    { text: "선택 사항: 과거 스냅샷을 준비합니다. 이 명령은 동의를 저장할 때 입력할 스냅샷 ID와 저널 컷을 출력합니다.",
      command: "skillar sync prepare" },
    { text: "다시 이 페이지로 돌아와 기기의 업로드 동의를 저장하세요. 그때까지는 로컬 전용으로 유지됩니다." },
    { text: "기기에서 업로드를 시작하세요. 과거 기록 업로드는 동의한 스냅샷에만 사용하세요.",
      command: "skillar sync run" },
  ];
}

export function downloadTextFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
