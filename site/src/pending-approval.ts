/** Mounts the CLI pending-approval card on /connections when the URL carries ?code=. */
async function mount(): Promise<void> {
  const code = new URLSearchParams(location.search).get("code");
  if (code === null || code.trim() === "") return;
  const host = document.getElementById("pending-approval");
  if (host === null) return;
  const [{ createElement: h }, { render }, { PendingApproval }] = await Promise.all([
    import("react"), import("./react-mount"), import("./dashboard/pending-approval"),
  ]);
  render(h(PendingApproval, { code: code.trim() }), host);
  host.hidden = false;
}
void mount();
