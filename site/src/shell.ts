import { mountCommandPalette } from "./command-palette";

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

const jump = document.querySelector<HTMLButtonElement>('#app-jump');
const crumb = document.querySelector<HTMLElement>('.app-breadcrumb');
if (crumb) {
  crumb.classList.add('lf-breadcrumb');
  crumb.setAttribute('role', 'navigation');
  crumb.setAttribute('aria-label', '현재 위치');
  const list = document.createElement('ol');
  let separator: Element | undefined;
  const children = Array.from(crumb.children);
  for (const [index, child] of children.entries()) {
    if (child.tagName === 'SPAN' && child.textContent?.trim() === '/') {
      child.setAttribute('aria-hidden', 'true');
      child.classList.add('lf-breadcrumb__separator');
      separator = child;
      continue;
    }
    const item = document.createElement('li');
    if (separator) { item.append(separator); separator = undefined; }
    if (index === children.length - 1) child.setAttribute('aria-current', 'page');
    item.append(child); list.append(item);
  }
  crumb.append(list);
}
if (jump) {
  let dispose: (() => void) | undefined;
  const mount = () => { dispose?.(); dispose = mountCommandPalette(jump); };
  window.addEventListener('pagehide', () => { dispose?.(); dispose = undefined; });
  window.addEventListener('pageshow', event => { if (event.persisted) mount(); });
  mount();
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
