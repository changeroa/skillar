import { useEffect, useMemo, useState } from "preact/hooks";
import type { HeatmapDto, SkillUri, SkillWeekDto } from "../../src/types.js";
import { api } from "../api";
import {
  AUTO_BUCKET_BELOW, BUCKET_OPTIONS, HeatLegend, HeatmapStyles, SkillWeekHeatmap, WeekdayHourHeatmap, autoBucket, buildGrid,
  buildSkillWeekGrid, cellLabel, extendSelection, formatShare, gridTotal, legendRanges, localTimeZone, localeWeekStart,
  selectionCount, selectionFromFilter, withSelection, withoutCellFilter, type BucketChoice, type HeatCell, type HourSelection,
} from "../charts/heatmap";
import { DOW_LABEL, isEmptyFilter, serializeFilter, type Route, type ViewProps } from "../state";

const LIVE_REFRESH_DEBOUNCE_MS = 300;
const NARROW_QUERY = "(max-width: 639.98px)";
const BUCKET_CHOICES: readonly BucketChoice[] = ["auto", ...BUCKET_OPTIONS];

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    setMatches(list.matches);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function BucketToggle({ choice, onChange }: { choice: BucketChoice; onChange: (next: BucketChoice) => void }) {
  return (
    <div class="seg" role="group" aria-label="시간 단위">
      {BUCKET_CHOICES.map((option) => (
        <button key={option} type="button" class="seg__b" aria-pressed={choice === option} onClick={() => onChange(option)}>
          {option === "auto" ? "자동" : `${option}시간`}
        </button>
      ))}
    </div>
  );
}

function SelectionBar({ selection, count, total, onShow, onClear }: { selection: HourSelection; count: number; total: number; onShow: () => void; onClear: () => void }) {
  return (
    <div class="hm__sel" role="status">
      <span>
        <strong>{cellLabel(selection, selection.hourSpan)}</strong>
        {" \u00b7 "}세션 {count}개{total > 0 && count > 0 ? ` (${formatShare(count, total)})` : ""}
      </span>
      <span class="hm__sel__actions">
        <button type="button" class="btn" onClick={onShow}>세션 보기</button>
        <button type="button" class="btn" onClick={onClear}>선택 해제</button>
      </span>
    </div>
  );
}

export function HeatmapView({ route, navigate, live }: ViewProps) {
  const tz = useMemo(localTimeZone, []);
  const weekStart = useMemo(() => localeWeekStart(), []);
  const narrow = useMediaQuery(NARROW_QUERY);
  const dataFilter = useMemo(() => withoutCellFilter(route.filter), [route.filter]);
  const filterKey = serializeFilter(dataFilter);
  const [choice, setChoice] = useState<BucketChoice>("auto");
  const requestBucket = choice === "auto" ? 1 : choice;
  const [heat, setHeat] = useState<HeatmapDto>();
  const [skillWeek, setSkillWeek] = useState<SkillWeekDto>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<HourSelection | undefined>(() => selectionFromFilter(route.filter));

  useEffect(() => {
    setSelection(selectionFromFilter(route.filter));
  }, [route.filter.dow, route.filter.hour, route.filter.hourSpan]);

  useEffect(() => {
    if (live.seq === 0) return;
    const timer = setTimeout(() => setRefresh((n) => n + 1), LIVE_REFRESH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [live.seq]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.heatmap(dataFilter, { tz, weekStart, bucket: requestBucket }), api.skillWeek(dataFilter)])
      .then(([nextHeat, nextSkillWeek]) => {
        if (cancelled) return;
        setHeat(nextHeat);
        setSkillWeek(nextSkillWeek);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [filterKey, tz, weekStart, requestBucket, refresh]);

  const total = heat ? gridTotal(heat) : 0;
  const bucketHours = choice === "auto" ? autoBucket(total, narrow) : choice;
  const grid = useMemo(() => (heat ? buildGrid(heat, { bucketHours }) : undefined), [heat, bucketHours]);
  const skills = useMemo(() => (skillWeek ? buildSkillWeekGrid(skillWeek) : undefined), [skillWeek]);
  const selectedCount = grid && selection ? selectionCount(grid, selection) : 0;
  const activeSkills: readonly SkillUri[] = route.filter.skill ?? [];

  const onCellClick = (cell: HeatCell, event: MouseEvent) => {
    if (!grid) return;
    if (event.shiftKey) {
      setSelection((current) => extendSelection(current, cell, grid.bucketHours));
      return;
    }
    navigate({ view: "sessions", filter: withSelection(route.filter, { dow: cell.dow, hour: cell.hour, hourSpan: grid.bucketHours }) });
  };

  const showSelection = () => {
    if (selection) navigate({ view: "sessions", filter: withSelection(route.filter, selection) });
  };

  const clearSelection = () => {
    setSelection(undefined);
    if (route.filter.dow !== undefined || route.filter.hour !== undefined) navigate({ ...route, filter: dataFilter });
  };

  const toggleSkill = (uri: SkillUri) => {
    const next: Route = { ...route, filter: { ...route.filter } };
    if (activeSkills.includes(uri)) delete next.filter.skill; else next.filter.skill = [uri];
    navigate(next);
  };

  const clearFilters = () => navigate({ ...route, filter: {} });

  const weekStartLabel = grid ? DOW_LABEL[grid.weekStart] : DOW_LABEL[weekStart];
  const bucketLabel = grid ? `${grid.bucketHours}시간 단위${choice === "auto" ? " (자동)" : ""}` : "";
  const filtered = !isEmptyFilter(dataFilter);

  return (
    <section class="hm-stack" aria-busy={grid === undefined}>
      <HeatmapStyles />
      {error && <p class="notice" role="alert">활동 분포를 불러올 수 없습니다: {error}</p>}
      {!grid && !error && <p class="dim" role="status">활동 분포를 집계하는 중{"\u2026"}</p>}
      {grid && (
        <article class="hmc" aria-labelledby="hm-dow-title">
          <header class="hmc__head">
            <h2 class="hmc__title" id="hm-dow-title">요일·시간대별 세션</h2>
            <span class="hmc__meta">세션 {grid.total}개 {"\u00b7"} {heat?.tz ?? tz} {"\u00b7"} 주 시작 {weekStartLabel}요일 {"\u00b7"} {bucketLabel}</span>
            <BucketToggle choice={choice} onChange={setChoice} />
          </header>
          {grid.total === 0 && (
            <p class="hmc__empty" role="status">
              {filtered ? "이 필터에 맞는 세션이 없습니다." : "아직 세션이 없습니다."}
              {filtered && <button type="button" class="btn" onClick={clearFilters}>필터 지우기</button>}
            </p>
          )}
          <WeekdayHourHeatmap grid={grid} selection={selection} onCellClick={onCellClick} label="요일·시간대별 세션" />
          {selection && (
            <SelectionBar selection={selection} count={selectedCount} total={grid.total} onShow={showSelection} onClear={clearSelection} />
          )}
          <footer class="hmc__foot">
            <HeatLegend ranges={legendRanges(grid.level, grid.maxCount)} unit="session" />
            <p class="hmc__hint">
              칸을 클릭하면 해당 세션 목록으로 이동합니다 {"\u00b7"} Shift+클릭으로 시간 범위를 선택합니다
              {choice === "auto" && grid.total < AUTO_BUCKET_BELOW && !narrow ? ` \u00b7 세션 ${AUTO_BUCKET_BELOW}개 미만이면 2시간 단위` : ""}
            </p>
          </footer>
        </article>
      )}
      {skills && (
        <article class="hmc" aria-labelledby="hm-skill-title">
          <header class="hmc__head">
            <h2 class="hmc__title" id="hm-skill-title">주별 스킬 읽기</h2>
            <span class="hmc__meta">읽기 {skills.total}회 {"\u00b7"} 최근 {skills.weeks.length}주 (ISO 주 기준)</span>
          </header>
          {skills.rows.length === 0 ? (
            <p class="hmc__empty" role="status">최근 {skills.weeks.length}주 동안 읽은 스킬이 없습니다.</p>
          ) : (
            <SkillWeekHeatmap grid={skills} activeSkills={activeSkills} onRowClick={toggleSkill} label="ISO 주별 스킬 읽기" />
          )}
          <footer class="hmc__foot">
            <HeatLegend ranges={legendRanges(skills.level, skills.maxCount)} unit="load" />
            <p class="hmc__hint">스킬 행을 클릭하면 모든 화면을 그 스킬로 필터링합니다</p>
          </footer>
        </article>
      )}
    </section>
  );
}
