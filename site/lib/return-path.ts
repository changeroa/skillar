import { z } from 'zod';

// 로그인 복귀 경로 허용 목록. 같은 출처의 내부 경로만 받는다.
// 독립 세션 화면 /sessions/는 해시 라우트(#/sessions 등)까지 보존할 수 있다.
// 구 읽기 근거 탭 경로(/skills/?tab=evidence, #/ 해시)는 /sessions/로 리다이렉트되므로
// 기존에 저장된 복귀 경로도 그대로 받는다.
export const loginReturnPathSchema = z.string().max(8192).refine(value => {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
  const url = new URL(value, 'https://return.invalid');
  if (url.origin !== 'https://return.invalid') return false;
  if (url.pathname === '/oauth/authorize') return url.search !== '' && url.hash === '';
  if (url.pathname === '/connections/' || url.pathname === '/dashboard/') {
    return url.search === '' && url.hash === '';
  }
  if (url.pathname === '/sessions/') {
    return url.search === '' && (url.hash === '' || url.hash.startsWith('#/'));
  }
  if (url.pathname === '/skills/') {
    // 구 읽기 근거 탭 경로는 /sessions/로 리다이렉트되므로 복귀 경로로 남아 있을 수 있다.
    if (url.search !== '' && url.search !== '?tab=evidence') return false;
    return url.hash === '' || url.hash.startsWith('#/');
  }
  return false;
}).transform(value => {
  const url = new URL(value, 'https://return.invalid');
  return url.pathname + url.search + url.hash;
}).pipe(z.string().max(8192));
