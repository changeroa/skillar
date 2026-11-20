/** Mounts the CLI pending-approval card on /connections when the URL carries ?code=. */
async function mount(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (code === null || code.trim() === "") return;
  // CLI가 [y/N]에 y라고 답해 연 경우에만 1. 체크를 미리 켤 뿐이며 동의는 여전히 이 페이지의 명시적 승인뿐.
  const uploadPreset = params.get("upload") === "1";
  const host = document.getElementById("pending-approval");
  if (host === null) return;
  const [{ createElement: h }, { render }, { PendingApproval }] = await Promise.all([
    import("react"), import("./react-mount"), import("./dashboard/pending-approval"),
  ]);
  render(h(PendingApproval, { code: code.trim(), uploadPreset }), host);
  host.hidden = false;
}
void mount();
