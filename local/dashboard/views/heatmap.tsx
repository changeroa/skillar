import { useEffect, useMemo, useState } from "preact/hooks";
import type { SkillUri } from "../../src/types.js";
import { api } from "../api";
import {
  AUTO_BUCKET_BELOW, BUCKET_OPTIONS, HeatLegend, HeatmapStyles, SkillWeekHeatmap, WeekdayHourHeatmap, autoBucket, buildGrid,
  buildSkillWeekGrid, cellLabel, extendSelection, formatShare, gridTotal, legendRanges, localTimeZone, localeWeekStart,
  selectionCount, selectionFromFilter, withSelection, withoutCellFilter, type BucketChoice, type HeatCell, type HourSelection,
} from "../charts/heatmap";
import { DOW_LABEL, isEmptyFilter, serializeFilter, type Route, type ViewProps } from "../state";
import { AnalysisEmpty, AnalysisError, AnalysisToolbar, conditions, useAnalysisReport } from "../components/analysis";
import { observedRequests, requestsInRange, requestsSkillWeek, sessionsHeatmap } from "./analysis-data";

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

export function HeatmapView({ route, navigate, live, embedded }: ViewProps) {
  const tz = useMemo(localTimeZone, []);
  const weekStart = useMemo(() => localeWeekStart(), []);
  const narrow = useMediaQuery(NARROW_QUERY);
  const dataFilter = useMemo(() => withoutCellFilter(route.filter), [route.filter]);
  const filterKey = serializeFilter(dataFilter);
  const [choice, setChoice] = useState<BucketChoice>("auto");
  const requestBucket = choice === "auto" ? 1 : choice;
  const report = useAnalysisReport(`${filterKey}|${tz}|${weekStart}|${requestBucket}`, async () => {
    const [sourceHeat, rows] = await Promise.all([api.heatmap(dataFilter, { tz, weekStart, bucket: requestBucket }), api.sessions(dataFilter)]);
    const traces = await observedRequests(rows);
    return { heat: api.mode === "fixtures" ? sessionsHeatmap(rows, tz, weekStart) : sourceHeat,
      skillWeek: requestsSkillWeek(requestsInRange(traces.results.flatMap(result => result.requests), dataFilter), dataFilter.skill),
      filter: dataFilter, choice, weekMeasured: rows.length === 0 || traces.results.length > 0,
      coverage: `조회한 세션 추적의 성공 읽기 요청 · 추적 있는 세션 ${traces.results.filter(result => result.events > 0).length}/${rows.length}개 · 조회 실패 ${traces.failed.length}개` };
  }, embedded || api.mode === "cloud" ? live.seq : 0);
  const { heat, skillWeek, filter: resultFilter, choice: resultChoice, coverage, weekMeasured } = report.snapshot?.value ?? { filter: dataFilter, choice };
  const [rangeMode, setRangeMode] = useState(false), [rangeStart, setRangeStart] = useState<HeatCell>();
  const [selection, setSelection] = useState<HourSelection | undefined>(() => selectionFromFilter(route.filter));

  useEffect(() => {
    setSelection(selectionFromFilter(route.filter));
  }, [route.filter.dow, route.filter.hour, route.filter.hourSpan]);

  const total = heat ? gridTotal(heat) : 0;
  const bucketHours = resultChoice === "auto" ? autoBucket(total, narrow) : resultChoice;
  const grid = useMemo(() => (heat ? buildGrid(heat, { bucketHours }) : undefined), [heat, bucketHours]);
  const skills = useMemo(() => (skillWeek ? buildSkillWeekGrid({ ...skillWeek, rows: skillWeek.rows.filter(row => !resultFilter.skill?.length || resultFilter.skill.includes(row.uri)) }) : undefined), [skillWeek, resultFilter]);
  const selectedCount = grid && selection ? selectionCount(grid, selection) : 0;
  const activeSkills: readonly SkillUri[] = route.filter.skill ?? [];

  const onCellClick = (cell: HeatCell, event: MouseEvent) => {
    if (!grid) return;
    if (rangeMode) {
      if (!rangeStart) { setRangeStart(cell); setSelection({ dow: cell.dow, hour: cell.hour, hourSpan: grid.bucketHours }); }
      else { setSelection(extendSelection({ dow: rangeStart.dow, hour: rangeStart.hour, hourSpan: grid.bucketHours }, cell, grid.bucketHours)); setRangeStart(undefined); }
      return;
    }
    if (event.shiftKey) {
      setSelection((current) => extendSelection(current, cell, grid.bucketHours));
      return;
    }
    navigate({ view: "sessions", filter: withSelection(resultFilter, { dow: cell.dow, hour: cell.hour, hourSpan: grid.bucketHours }) });
  };

  const showSelection = () => {
    if (selection) navigate({ view: "sessions", filter: withSelection(resultFilter, selection) });
  };

  const clearSelection = () => {
    setSelection(undefined);
    setRangeStart(undefined);
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
  const timezoneLabel = (heat?.tz ?? tz) === "Asia/Seoul" ? "한국 시간" : heat?.tz ?? tz;

  return (
    <section class="hm-stack analysis pe-console" aria-busy={report.busy} onKeyDown={event => {
      if (event.key === "Escape") {
        if (event.target instanceof HTMLElement && event.target.hasAttribute("data-tip")) event.target.dataset.tooltipDismissed = "true";
        clearSelection(); setRangeMode(false); event.stopPropagation();
      }
    }} onMouseOver={event => { if (event.target instanceof HTMLElement) delete event.target.dataset.tooltipDismissed; }}
      onFocusIn={event => { if (event.target instanceof HTMLElement) delete event.target.dataset.tooltipDismissed; }}>
      <HeatmapStyles />
      <header class="page-title">{embedded ? <h2>활동</h2> : <h1>활동</h1>}<p>세션의 시작 시간과 주별 스킬 읽기를 확인합니다.</p></header>
      <AnalysisToolbar route={route} navigate={navigate} refresh={report.refresh} busy={report.busy} />
      {report.busy && <p class="dim" role="status">{grid ? `갱신 중: ${conditions(dataFilter)} · ${requestBucket}시간` : "활동 분포를 집계하는 중…"}</p>}
      <AnalysisError error={report.error} title="활동 분포를 불러올 수 없습니다" retry={report.refresh} />
      {grid && <p class="analysis-scope" data-result-conditions>{conditions(resultFilter)} · {bucketHours}시간 · {timezoneLabel}</p>}
      <button class="pe-button" data-range-toggle aria-pressed={rangeMode} onClick={() => { setRangeMode(!rangeMode); clearSelection(); }}>범위 선택{rangeMode ? " · 켜짐" : ""}</button>
      {rangeMode && <p role="status">{rangeStart ? "끝 칸을 누르세요. 같은 요일의 시간 범위를 선택합니다." : "시작 칸을 누른 뒤 끝 칸을 누르세요."}</p>}
      {grid && (
        <article class="hmc" aria-labelledby="hm-dow-title">
          <header class="hmc__head">
            <h2 class="hmc__title" id="hm-dow-title">요일·시간대별 세션</h2>
            <span class="hmc__meta">세션 {grid.total}개 {"\u00b7"} {timezoneLabel} {"\u00b7"} 주 시작 {weekStartLabel}요일 {"\u00b7"} {bucketLabel}</span>
            <BucketToggle choice={choice} onChange={setChoice} />
          </header>
          {grid.total === 0 && (
            <p class="hmc__empty" role="status">
              {filtered ? "이 필터에 맞는 세션이 없습니다." : "아직 세션이 없습니다."}
              {filtered && <button type="button" class="btn" onClick={clearFilters}>필터 지우기</button>}
            </p>
          )}
          {grid.total === 0 && <AnalysisEmpty route={route} navigate={navigate} />}
          <p class="analysis-scope">← 가로로 더 보기 →</p>
          <div class="analysis-scroll" tabIndex={0} role="region" aria-label="요일·시간대별 세션 표"><WeekdayHourHeatmap grid={grid} selection={selection} onCellClick={onCellClick} label="요일·시간대별 세션" /></div>
          {selection && (
            <SelectionBar selection={selection} count={selectedCount} total={grid.total} onShow={showSelection} onClear={clearSelection} />
          )}
          <footer class="hmc__foot">
            <HeatLegend ranges={legendRanges(grid.level, grid.maxCount)} unit="session" />
            <p class="hmc__hint">
              칸을 클릭하면 세션 목록으로 이동합니다 · 방향키로 칸 이동 · 범위 선택 또는 ⇧+클릭으로 범위 선택
              {choice === "auto" && grid.total < AUTO_BUCKET_BELOW && !narrow ? ` \u00b7 세션 ${AUTO_BUCKET_BELOW}개 미만이면 2시간 단위` : ""}
            </p>
          </footer>
        </article>
      )}
      {skills && (
        <article class="hmc" aria-labelledby="hm-skill-title" data-week-measured={weekMeasured}>
          <header class="hmc__head">
            <h2 class="hmc__title" id="hm-skill-title">주별 스킬 읽기</h2>
            <span class="hmc__meta">{weekMeasured ? `읽기 ${skills.total}회 · 표시 ${skills.weeks.length}주 (한국 시간 · ISO 주)` : "읽기 미측정"}</span>
          </header>
          {skills.rows.length === 0 ? (
            <p class="hmc__empty" role="status">{weekMeasured ? "표시한 기간에 기록된 성공 읽기 요청이 없습니다." : "미측정 · 세션 추적을 불러올 수 없습니다."}{!weekMeasured && <button class="pe-button" onClick={report.refresh}>다시 시도</button>}</p>
          ) : (
            <div class="analysis-scroll" tabIndex={0} role="region" aria-label="주별 스킬 읽기 표"><SkillWeekHeatmap grid={skills} activeSkills={activeSkills} onRowClick={toggleSkill} label="ISO 주별 스킬 읽기" /></div>
          )}
          {coverage && <p class="analysis-scope">{coverage} · 요청 시각 기준 · 한국 시간</p>}
          <footer class="hmc__foot">
            {weekMeasured && <HeatLegend ranges={legendRanges(skills.level, skills.maxCount)} unit="load" />}
            <p class="hmc__hint">스킬 행을 클릭하면 모든 화면을 그 스킬로 필터링합니다</p>
          </footer>
        </article>
      )}
    </section>
  );
}
