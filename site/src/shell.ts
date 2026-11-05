export function syncDashboardTabs(nav: HTMLElement, panel: HTMLElement | null, hash: string): void {
  const tabs = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a'));
  const view = hash.replace(/\?.*$/, '').replace(/^#\/?/, '').split('/')[0];
  const selected = tabs.find(tab => tab.getAttribute('href')?.split('?')[0] === `#/${view}`) ?? tabs[0];
  nav.setAttribute('role', 'tablist');
  for (const tab of tabs) {
    tab.removeAttribute('aria-current');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(tab === selected));
    tab.tabIndex = tab === selected ? 0 : -1;
  }
  if (panel && selected) {
    panel.id = 'dashboard-view-panel';
    panel.setAttribute('role', 'tabpanel');
    for (const [index, tab] of tabs.entries()) {
      tab.id = `dashboard-view-tab-${index}`;
      tab.setAttribute('aria-controls', panel.id);
    }
    panel.setAttribute('aria-labelledby', selected.id);
  }
}

const navigation = document.querySelector<HTMLElement>('#app-navigation');
const drawer = document.querySelector<HTMLDialogElement>('#app-drawer');
const menu = document.querySelector<HTMLButtonElement>('#app-menu');
const closeButton = document.querySelector<HTMLButtonElement>('#app-menu-close');
const desktop = window.matchMedia('(min-width: 1024px)');

if (navigation && drawer && menu && closeButton) {
  const header = navigation.parentElement;
  const links = Array.from(navigation.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const path = window.location.pathname.startsWith('/connect/') ? '/connections/' : window.location.pathname;
  const syncCurrent = () => {
    const session = path.startsWith('/dashboard/') && window.location.hash.startsWith('#/sessions');
    const current = links.find(link => path.startsWith(link.pathname) &&
      (session ? link.hash === '#/sessions' : link.hash === ''));
    for (const link of links) {
      if (link === current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const item = document.querySelector('[data-breadcrumb-item]');
    if (item) item.textContent = session ? '세션' : '대시보드';
  };
  syncCurrent();
  window.addEventListener('hashchange', syncCurrent);

  const closeDrawer = () => {
    drawer.close();
    menu.setAttribute('aria-expanded', 'false');
    menu.focus();
  };
  const syncLayout = () => {
    drawer.close();
    menu.setAttribute('aria-expanded', 'false');
    const theme = document.querySelector<HTMLElement>('.theme-label');
    if (desktop.matches || !document.body.classList.contains('app-shell')) {
      header?.append(navigation);
      if (theme) header?.insertBefore(theme, menu);
    } else {
      drawer.append(navigation);
      if (theme) navigation.insertBefore(theme, navigation.querySelector('.app-account'));
    }
  };
  menu.addEventListener('click', () => {
    drawer.close();
    drawer.showModal();
    menu.setAttribute('aria-expanded', 'true');
    closeButton.focus();
  });
  closeButton.addEventListener('click', closeDrawer);
  drawer.addEventListener('cancel', event => {
    event.preventDefault();
    closeDrawer();
  });
  drawer.addEventListener('click', event => {
    if (event.target === drawer) {
      const rect = drawer.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) closeDrawer();
    }
  });
  desktop.addEventListener('change', syncLayout);

  const signedIn = document.querySelector<HTMLElement>('#signed-in');
  if (document.body.classList.contains('account-route') && signedIn) {
    const syncAccount = () => {
      document.body.classList.toggle('app-shell', !signedIn.hidden);
      const heading = document.querySelector('h1');
      const title = signedIn.hidden ? '로그인' : '계정';
      if (heading) heading.textContent = title;
      document.title = `${title} — skillar`;
      syncLayout();
    };
    new MutationObserver(syncAccount).observe(signedIn, { attributes: true, attributeFilter: ['hidden'] });
    syncAccount();
  } else {
    syncLayout();
  }
}

export function bindCommandPalette(
  opener: HTMLButtonElement, dialog: HTMLDialogElement,
  input: HTMLInputElement, options: readonly HTMLAnchorElement[], close: HTMLButtonElement,
): () => void {
  let active = 0;
  let visible = [...options];
  const select = (index: number) => {
    active = visible.length ? (index + visible.length) % visible.length : 0;
    for (const option of options) option.setAttribute('aria-selected', String(option === visible[active]));
    const selected = visible[active];
    if (selected) input.setAttribute('aria-activedescendant', selected.id);
    else input.removeAttribute('aria-activedescendant');
  };
  const filter = () => {
    const query = input.value.trim().toLocaleLowerCase('ko');
    visible = options.filter(option => {
      option.hidden = !option.textContent?.toLocaleLowerCase('ko').includes(query);
      return !option.hidden;
    });
    select(0);
    const empty = dialog.querySelector<HTMLElement>('[data-command-empty]');
    if (empty) empty.hidden = visible.length !== 0;
  };
  const dismiss = () => { dialog.close(); opener.focus(); };
  const activate = (option: HTMLAnchorElement) => {
    dialog.close();
    window.location.assign(option.href);
  };
  const open = () => {
    if (!document.body.classList.contains('app-shell')) return;
    if (drawer?.open) {
      drawer.close();
      menu?.setAttribute('aria-expanded', 'false');
    }
    input.value = '';
    filter();
    if (!dialog.open) dialog.showModal();
    input.focus();
  };
  const shortcut = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' &&
        document.body.classList.contains('app-shell')) {
      event.preventDefault();
      if (dialog.open) dismiss();
      else open();
    }
  };
  opener.addEventListener('click', open);
  close.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  input.addEventListener('input', filter);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    switch (event.key) {
      case 'ArrowDown': select(active + 1); break;
      case 'ArrowUp': select(active - 1); break;
      case 'Home': select(0); break;
      case 'End': select(visible.length - 1); break;
      case 'Enter': {
        const option = visible[active];
        if (option) activate(option);
        break;
      }
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });
  for (const option of options) option.addEventListener('click', event => {
    if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    activate(option);
  });
  window.addEventListener('keydown', shortcut);
  return () => window.removeEventListener('keydown', shortcut);
}

const jump = document.querySelector<HTMLButtonElement>('#app-jump');
if (jump) {
  const command = document.createElement('dialog');
  command.id = 'app-command';
  command.className = 'app-command';
  command.setAttribute('aria-labelledby', 'app-command-title');
  command.innerHTML = `<div class="app-command-head"><h2 id="app-command-title">화면 이동</h2><button class="button secondary" type="button" data-command-close>닫기 · Esc</button></div>
    <label class="app-command-input">이동할 화면<input type="search" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="app-command-options" autocomplete="off" placeholder="화면 이름 검색"></label>
    <div id="app-command-options" role="listbox" aria-label="이동할 화면">
      <a id="jump-dashboard" href="/dashboard/" role="option" tabindex="-1">대시보드</a>
      <a id="jump-sessions" href="/dashboard/#/sessions" role="option" tabindex="-1">세션</a>
      <a id="jump-skills" href="/skills/" role="option" tabindex="-1">스킬</a>
      <a id="jump-connections" href="/connections/" role="option" tabindex="-1">연결</a>
      <a id="jump-account" href="/login/" role="option" tabindex="-1">계정</a>
    </div><p data-command-empty hidden>일치하는 화면이 없습니다.</p>
    <p class="note app-command-help">화면 이동 전용 · ↑ ↓ 선택 · Enter 이동 · Esc 닫기</p>`;
  document.body.append(command);
  const input = command.querySelector('input');
  const close = command.querySelector<HTMLButtonElement>('[data-command-close]');
  if (input && close) bindCommandPalette(jump, command, input, Array.from(command.querySelectorAll('a')), close);
}

const breadcrumb = document.querySelector<HTMLElement>('#skill-breadcrumb');
const skills = document.querySelector<HTMLElement>('#skills-app');
if (breadcrumb && skills) {
  const updateBreadcrumb = () => {
    const title = skills.querySelector('#skill-title');
    const revision = Array.from(skills.querySelectorAll('.skill__facts dt'))
      .find(label => label.textContent === '현재 리비전')?.nextElementSibling;
    const name = title?.textContent?.trim();
    breadcrumb.hidden = !window.location.hash.startsWith('#skill/') || !name;
    const entity = breadcrumb.querySelector('[data-skill-name]');
    const version = breadcrumb.querySelector<HTMLElement>('[data-skill-version]');
    if (entity) entity.textContent = name ?? '';
    if (version) {
      version.hidden = !revision;
      version.textContent = revision ? `v${revision.textContent}` : '';
    }
  };
  new MutationObserver(updateBreadcrumb).observe(skills, { childList: true, subtree: true, characterData: true });
  window.addEventListener('hashchange', updateBreadcrumb);
  updateBreadcrumb();
}

const dashboard = document.querySelector<HTMLElement>('#dashboard-app');
if (dashboard) {
  const syncTabs = () => {
    const nav = dashboard.querySelector<HTMLElement>('nav.tabs');
    if (nav) syncDashboardTabs(nav, dashboard.querySelector<HTMLElement>('.page'), window.location.hash);
  };
  new MutationObserver(syncTabs).observe(dashboard, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'],
  });
  window.addEventListener('hashchange', syncTabs);
  dashboard.addEventListener('keydown', event => {
    if (!(event.target instanceof HTMLAnchorElement) || event.target.getAttribute('role') !== 'tab') return;
    const nav = dashboard.querySelector<HTMLElement>('[role="tablist"]');
    if (!nav) return;
    const tabs = Array.from(nav.querySelectorAll<HTMLAnchorElement>('[role="tab"]'));
    const index = tabs.indexOf(event.target);
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % tabs.length; break;
      case 'ArrowLeft': next = (index - 1 + tabs.length) % tabs.length; break;
      case 'Home': next = 0; break;
      case 'End': next = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const nextTab = tabs[next];
    if (nextTab) {
      for (const tab of tabs) tab.tabIndex = tab === nextTab ? 0 : -1;
      nextTab.focus();
    }
  });
  syncTabs();
}
