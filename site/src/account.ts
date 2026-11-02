import './main';
import ky, { HTTPError, TimeoutError } from 'ky';
import { sessionResponseSchema } from '../lib/account';
import type { SessionUser } from '../lib/account';

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
  const skipLink = document.querySelector<HTMLAnchorElement>('.skip');
  const main = document.querySelector<HTMLElement>('#main');
  if (skipLink && main) {
    skipLink.addEventListener('click', event => {
      event.preventDefault();
      main.focus();
    });
  }
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

type SessionResult =
  | { kind: 'signed-in'; user: SessionUser }
  | { kind: 'signed-out' }
  | { kind: 'unreachable' }
  | { kind: 'unexpected' };

const sessionStatus = document.querySelector<HTMLElement>('#session-status');
const accountLines = Array.from(document.querySelectorAll<HTMLElement>('[data-account-line]'));

// Only account routes carry these elements, so the landing page never asks for a session.
if (sessionStatus || accountLines.length) {
  const authResult = document.querySelector<HTMLElement>('#auth-result');
  const callbackError = new URLSearchParams(window.location.search).get('error');
  if (authResult && callbackError !== null) {
    // Fixed copy per callback code; the query value itself is never rendered.
    authResult.textContent = callbackError === 'cancelled'
      ? 'Sign-in was cancelled. Nothing was stored.'
      : "Sign-in didn't complete. You can try again.";
  }

  const readSession = (payload: unknown): SessionResult => {
    const parsed = sessionResponseSchema.safeParse(payload);
    if (!parsed.success) return { kind: 'unexpected' };
    const { user } = parsed.data;
    if (user === null) return { kind: 'signed-out' };
    return { kind: 'signed-in', user };
  };

  const fetchSession = async (): Promise<SessionResult> => {
    let response: Response;
    try {
      response = await ky.get('/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        timeout: 10_000,
        retry: 0,
      });
    } catch (error) {
      if (error instanceof HTTPError) return { kind: 'unexpected' };
      if (error instanceof TypeError || error instanceof TimeoutError) return { kind: 'unreachable' };
      throw error;
    }
    if (!response.ok) return { kind: 'unexpected' };
    try {
      return readSession(await response.json());
    } catch (error) {
      if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error;
      return { kind: 'unexpected' };
    }
  };

  const formatTime = (value: number): { iso: string; text: string } => {
    const date = new Date(value * 1000);
    return {
      iso: date.toISOString(),
      text: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date),
    };
  };

  const showTime = (time: HTMLTimeElement | null, value: number): boolean => {
    const row = time?.closest<HTMLElement>('div');
    if (!time || !row) return false;
    const formatted = formatTime(value);
    time.dateTime = formatted.iso;
    time.textContent = formatted.text;
    return true;
  };

  const renderUser = (user: SessionUser) => {
    const name = document.querySelector<HTMLElement>('#user-name');
    const email = document.querySelector<HTMLElement>('#user-email');
    const picture = document.querySelector<HTMLImageElement>('#user-picture');
    const times = document.querySelector<HTMLElement>('.account-times');
    if (name) name.textContent = user.name || user.email;
    if (email) email.textContent = user.name ? user.email : '';
    if (picture && user.picture.startsWith('https://')) {
      picture.addEventListener('error', () => { picture.hidden = true; }, { once: true });
      picture.src = user.picture;
      picture.hidden = false;
    }
    const created = showTime(document.querySelector<HTMLTimeElement>('#user-created'), user.createdAt);
    const last = showTime(document.querySelector<HTMLTimeElement>('#user-last'), user.lastLogin);
    if (times) times.hidden = !(created || last);
  };

  const summary = (result: SessionResult): string => {
    switch (result.kind) {
      case 'signed-in': return `Signed in as ${result.user.email}.`;
      case 'signed-out': return 'Not signed in.';
      case 'unreachable': return "Couldn't reach the account service, so sign-in status is unknown.";
      case 'unexpected': return "The account service didn't answer as expected, so sign-in status is unknown.";
    }
  };

  const checking = 'Checking your account…';
  if (sessionStatus) sessionStatus.textContent = checking;
  for (const line of accountLines) line.textContent = checking;

  void fetchSession().then(result => {
    for (const line of accountLines) line.textContent = summary(result);
    if (!sessionStatus) return;
    if (result.kind === 'signed-in') {
      renderUser(result.user);
      const signedOut = document.querySelector<HTMLElement>('#signed-out');
      const signedIn = document.querySelector<HTMLElement>('#signed-in');
      if (signedOut) signedOut.hidden = true;
      if (signedIn) signedIn.hidden = false;
      sessionStatus.textContent = '';
      return;
    }
    if (result.kind === 'signed-out') {
      sessionStatus.textContent = 'Not signed in.';
    } else if (result.kind === 'unreachable') {
      sessionStatus.textContent = "Couldn't reach the account service. Check your connection and reload to see whether you're signed in.";
    } else {
      sessionStatus.textContent = "The account service didn't answer as expected. Try again later.";
    }
  });
}
