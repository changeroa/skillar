import './main';

const clientSelect = document.querySelector<HTMLSelectElement>('#client-example');
const exampleConfig = document.querySelector<HTMLElement>('#example-config');
const configLabel = document.querySelector<HTMLElement>('#config-label');
const copyExample = document.querySelector<HTMLButtonElement>('#copy-example');
const exampleStatus = document.querySelector<HTMLElement>('#example-status');

if (clientSelect && exampleConfig && configLabel && copyExample && exampleStatus) {
  const codexConfig = exampleConfig.textContent;
  clientSelect.disabled = false;
  copyExample.hidden = false;
  clientSelect.addEventListener('change', () => {
    const claude = clientSelect.value === 'claude-code';
    exampleConfig.textContent = claude
      ? 'claude mcp add --transport http skillar-preview https://account.skillar.example/mcp'
      : codexConfig;
    configLabel.textContent = claude ? 'Claude Code CLI · illustrative command' : 'Codex plugin · .mcp.json';
    exampleStatus.textContent = '';
  });
  copyExample.addEventListener('click', async () => {
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(exampleConfig.textContent ?? '');
        exampleStatus.textContent = 'Example copied. It is not a working endpoint.';
        return;
      } catch (error) {
        if (!(error instanceof DOMException)) throw error;
      }
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(exampleConfig);
    selection?.removeAllRanges();
    selection?.addRange(range);
    exampleStatus.textContent = "Couldn't copy. The example is selected; copy it manually.";
  });
}

const emptyViews = Array.from(document.querySelectorAll<HTMLElement>('.empty-state'));
const viewLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.view-nav a'));
const recovery = document.querySelector<HTMLElement>('#view-recovery');

if (emptyViews.length && recovery) {
  const showView = (moveFocus: boolean) => {
    const hash = window.location.hash;
    const known = ['', '#sessions', '#workspaces', '#flow', '#heatmap'].includes(hash);
    const current = known && hash ? hash.slice(1) : 'sessions';
    recovery.textContent = known ? '' : 'Unknown view. Showing Sessions instead.';
    for (const view of emptyViews) {
      view.hidden = view.id !== current;
      if (!view.hidden && moveFocus) view.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    }
    for (const link of viewLinks) {
      if (link.hash === `#${current}`) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const currentLink = viewLinks.find(link => link.hash === `#${current}`);
    document.title = `${currentLink?.textContent ?? 'Sessions'} preview — skillar`;
  };
  showView(false);
  window.addEventListener('hashchange', () => showView(true));
}
