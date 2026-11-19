-- core-minimum C (inbox170 조건부 승인): 기기 이름과 최근 사용 시각.
-- 둘 다 nullable additive. 기존 행은 NULL → UI는 "이름 없음 · id 앞6"/미측정으로 표시.
ALTER TABLE devices ADD COLUMN label TEXT;
ALTER TABLE devices ADD COLUMN last_used_at INTEGER;
