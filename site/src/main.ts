const themeSelect = document.querySelector<HTMLSelectElement>('#theme');

// Relocate the existing identity and native sign-out form, not their auth logic.
// Preact retains ownership of its account node and removes it on session expiry.
const sidebarAccount = document.querySelector<HTMLElement>('#sidebar-account');
const accountSource = document.querySelector<HTMLElement>('#dashboard-app, #skills-app, #signed-in');
if (sidebarAccount && accountSource) {
  const moveAccount = () => {
    const account = accountSource.querySelector<HTMLElement>('.dash-account');
    if (account) sidebarAccount.append(account);
    if (accountSource.id === 'signed-in' && !accountSource.hidden) {
      const identity = accountSource.querySelector<HTMLElement>('.account-user');
      const signout = accountSource.querySelector<HTMLFormElement>('form[action="/auth/logout"]');
      if (identity) sidebarAccount.append(identity);
      if (signout) sidebarAccount.append(signout);
    }
  };
  new MutationObserver(moveAccount).observe(accountSource, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'],
  });
  moveAccount();
}
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

const writeClipboard = async (text: string): Promise<boolean> => {
  // Insecure contexts and some browsers expose no clipboard API at all.
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return false;
  }
};

const selectContents = (element: HTMLElement) => {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
};

const copyButton = document.querySelector<HTMLButtonElement>('#copy');
const copyStatus = document.querySelector<HTMLElement>('#copy-status');
const installCommand = document.querySelector<HTMLElement>('#install-command');
if (copyButton && copyStatus && installCommand) {
  copyButton.addEventListener('click', async () => {
    if (await writeClipboard(installCommand.textContent ?? '')) {
      copyStatus.textContent = '설치 명령을 복사했습니다.';
      return;
    }
    selectContents(installCommand);
    copyStatus.textContent = "복사하지 못했습니다. 선택된 설치 명령을 직접 복사하세요.";
  });
}

const setupExample = document.querySelector<HTMLSelectElement>('#setup-example');
const dryCommand = document.querySelector<HTMLElement>('#dry-command');
const initCommand = document.querySelector<HTMLElement>('#init-command');
const foregroundCommand = document.querySelector<HTMLElement>('#foreground-command');
if (setupExample && dryCommand && initCommand && foregroundCommand) {
  setupExample.addEventListener('change', () => {
    const runtime = setupExample.value;
    const command = runtime === 'all' ? 'skillar init' : `skillar init --runtime ${runtime}`;
    dryCommand.textContent = `${command} --dry-run`;
    initCommand.textContent = command;
    foregroundCommand.textContent = `${command} --no-service`;
  });
}
