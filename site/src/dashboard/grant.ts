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
    { text: "On the device, connect it with the downloaded file. This links the device and uploads nothing.",
      command: `skillar sync connect --grant-file ~/Downloads/${fileName}${originFlag}` },
    { text: "Optional: prepare a historical snapshot. The command prints the snapshot ID and journal cut you can enter when saving consent.",
      command: "skillar sync prepare" },
    { text: "Back here, save upload consent for the device. Until then it stays local only." },
    { text: "Start uploading from the device. Use backfill only for a snapshot you consented to.",
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
