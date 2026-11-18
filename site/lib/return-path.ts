import { z } from 'zod';

// 로그인 복귀 경로 허용 목록. 같은 출처의 내부 경로만 받는다.
// /skills/는 읽기 근거 탭(?tab=evidence)과 구 대시보드 해시 라우트(#/sessions 등)까지
// 보존할 수 있다(원문82: /dashboard → /skills?tab=evidence 또는 동등 해시 redirect).
export const loginReturnPathSchema = z.string().max(8192).refine(value => {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
  const url = new URL(value, 'https://return.invalid');
  if (url.origin !== 'https://return.invalid') return false;
  if (url.pathname === '/oauth/authorize') return url.search !== '' && url.hash === '';
  if (url.pathname === '/connections/' || url.pathname === '/dashboard/') {
    return url.search === '' && url.hash === '';
  }
  if (url.pathname === '/skills/') {
    // 읽기 근거 탭은 ?tab=evidence 또는 #/ 해시 둘 다로 열린다(evidenceMode와 동일 기준).
    if (url.search !== '' && url.search !== '?tab=evidence') return false;
    return url.hash === '' || url.hash.startsWith('#/');
  }
  return false;
}).transform(value => {
  const url = new URL(value, 'https://return.invalid');
  return url.pathname + url.search + url.hash;
}).pipe(z.string().max(8192));
