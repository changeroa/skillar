const themeSelect = document.querySelector<HTMLSelectElement>('#theme');
if (themeSelect) {
  themeSelect.value = document.documentElement.dataset['theme'] || 'system';
  themeSelect.addEventListener('change', () => {
    document.documentElement.dataset['theme'] = themeSelect.value;
    try {
      localStorage.setItem('skillar-theme', themeSelect.value);
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      // The theme remains usable when browser storage is blocked.
    }
  });
}

const copyButton = document.querySelector<HTMLButtonElement>('#copy');
const copyStatus = document.querySelector<HTMLElement>('#copy-status');
const installCommand = document.querySelector<HTMLElement>('#install-command');
if (copyButton && copyStatus && installCommand) {
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(installCommand.textContent);
      copyStatus.textContent = 'Install command copied.';
    } catch (error) {
      if (!(error instanceof DOMException)) throw error;
      copyStatus.textContent = 'Select the install command above to copy it.';
    }
  });
}

const setupExample = document.querySelector<HTMLSelectElement>('#setup-example');
const dryCommand = document.querySelector<HTMLElement>('#dry-command');
const initCommand = document.querySelector<HTMLElement>('#init-command');
if (setupExample && dryCommand && initCommand) {
  setupExample.addEventListener('change', () => {
    const runtime = setupExample.value;
    const command = runtime === 'all' ? 'skillar init' : `skillar init --runtime ${runtime}`;
    dryCommand.textContent = `${command} --dry-run`;
    initCommand.textContent = command;
  });
}
