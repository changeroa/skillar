import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '../src/design/skillar-theme/dist/theme.css';
import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {TextField} from '@astryxdesign/core/TextInput';
import {skillarTheme} from '../src/design/skillar-theme/dist/skillar.js';

function Spike() {
  return (
    <Theme theme={skillarTheme}>
      <main style={{padding: 24, display: 'grid', gap: 16, maxWidth: 420}}>
        <h1>스킬라 Astryx 스파이크</h1>
        <Card>
          <p>브랜드 색 테마 적용 확인용 카드 본문입니다.</p>
          <Button variant="primary">Google로 시작하기</Button>
        </Card>
        <TextInput label="요청문 · 스킬 · 세션 ID" placeholder="검색어를 입력하세요" />
      </main>
    </Theme>
  );
}
createRoot(document.getElementById('root')!).render(<Spike />);
