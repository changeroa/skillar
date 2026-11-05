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
  const links = Array.from(navigation.querySelectorAll<HTMLAnchorElement>('nav a'));
  const path = window.location.pathname.startsWith('/connect/') ? '/connections/' : window.location.pathname;
  const current = links.find(link => path.startsWith(link.pathname));
  for (const link of links) {
    if (link === current) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const closeDrawer = () => {
    drawer.close();
    menu.setAttribute('aria-expanded', 'false');
    menu.focus();
  };
  const syncLayout = () => {
    drawer.close();
    menu.setAttribute('aria-expanded', 'false');
    if (desktop.matches || !document.body.classList.contains('app-shell')) header?.append(navigation);
    else drawer.append(navigation);
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
