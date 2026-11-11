import './main';
import ky, { HTTPError, TimeoutError } from 'ky';
import { sessionResponseSchema } from '../lib/account';
import type { SessionUser } from '../lib/account';
import { KST_TIME_ZONE } from './time.ts';

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
const landingActions = document.querySelector<HTMLElement>('#landing-actions');
const landingStatus = document.querySelector<HTMLElement>('#landing-session-status');
const shellAccount = document.querySelector<HTMLElement>('[data-shell-account]');

// Landing and account pages share the existing read-only session check.
if (sessionStatus || accountLines.length || landingActions || shellAccount) {
  const authResult = document.querySelector<HTMLElement>('#auth-result');
  const authRecovery = document.querySelector<HTMLElement>('#auth-recovery');
  const callbackError = new URLSearchParams(window.location.search).get('error');
  if (authResult && callbackError !== null) {
    authResult.hidden = false;
    // Fixed copy per callback code; the query value itself is never rendered.
    authResult.textContent = callbackError === 'cancelled'
      ? '로그인이 취소되었습니다. 저장된 내용은 없습니다.'
      : '로그인하지 못했습니다. 다시 시도하세요.';
    if (authRecovery) authRecovery.hidden = false;
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
      text: `${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: KST_TIME_ZONE }).format(date)} KST`,
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
    for (const field of Array.from(document.querySelectorAll<HTMLElement>('[data-profile-name]'))) field.textContent = user.name || user.email;
    for (const field of Array.from(document.querySelectorAll<HTMLElement>('[data-profile-email]'))) field.textContent = user.email;
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
      case 'signed-in': return `${result.user.email} 계정으로 로그인했습니다.`;
      case 'signed-out': return '로그인하지 않았습니다.';
      case 'unreachable': return '계정 서비스에 연결할 수 없어 로그인 상태를 확인하지 못했습니다.';
      case 'unexpected': return '계정 서비스의 응답을 확인할 수 없어 로그인 상태를 알 수 없습니다.';
    }
  };

  const checking = '계정 확인 중…';
  if (sessionStatus) sessionStatus.textContent = checking;
  for (const line of accountLines) line.textContent = checking;

  void fetchSession().then(result => {
    if (shellAccount && result.kind === 'signed-in') {
      renderUser(result.user);
      shellAccount.hidden = false;
    }
    for (const line of accountLines) line.textContent = summary(result);
    if (landingActions) {
      const primary = document.querySelector<HTMLAnchorElement>('#landing-primary');
      const secondary = document.querySelector<HTMLAnchorElement>('#landing-secondary');
      if (primary && secondary && result.kind === 'signed-in') {
        primary.href = '/dashboard/';
        primary.textContent = '대시보드로 가기';
        secondary.href = '/skills/';
        secondary.textContent = '내 스킬';
      }
      if (landingStatus) landingStatus.textContent = result.kind === 'unreachable' || result.kind === 'unexpected'
        ? '로그인 상태를 확인하지 못했습니다. 계정 화면에서 다시 확인하세요.'
        : '';
      landingActions.hidden = false;
    }
    if (!sessionStatus) return;
    if (result.kind === 'signed-in') {
      renderUser(result.user);
      const signedOut = document.querySelector<HTMLElement>('#signed-out');
      const signedIn = document.querySelector<HTMLElement>('#signed-in');
      if (signedOut) signedOut.hidden = true;
      if (signedIn) signedIn.hidden = false;
      const title = document.querySelector<HTMLElement>('#account-title');
      if (title) title.textContent = '계정';
      document.title = '계정 — skillar';
      if (authResult) {
        authResult.textContent = '';
        authResult.hidden = true;
      }
      if (authRecovery) authRecovery.hidden = true;
      sessionStatus.textContent = '';
      return;
    }
    if (result.kind === 'signed-out') {
      sessionStatus.textContent = '로그인하지 않았습니다.';
    } else if (result.kind === 'unreachable') {
      sessionStatus.textContent = '계정 서비스에 연결할 수 없습니다. 연결을 확인하고 새로고침해 로그인 상태를 확인하세요.';
    } else {
      sessionStatus.textContent = '계정 서비스의 응답을 확인할 수 없습니다. 잠시 후 다시 시도하세요.';
    }
  });
}
