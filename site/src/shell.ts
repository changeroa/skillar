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
