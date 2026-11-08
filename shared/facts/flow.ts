import { loadSessions } from "./selection.js";
import { classifyTaskType } from "./classification.js";
import { skillMeta, metaFor, type FactContext } from "./base.js";
import type { Filter, FlowDto, FactStore } from "./types.js";
export function createFlowQuery(ctx: FactContext): Pick<FactStore,"flow"> { return { flow(f: Filter, unit: FlowDto["unit"], top = 7): FlowDto {
      const limit = Math.min(15, Math.max(1, Math.floor(top)));
      const sessions = loadSessions(ctx, f);
      const skills = skillMeta(ctx);
      type Path = { session: string; task: string; skill: string; state: FlowDto["links"][number]["state"] };
      const paths: Path[] = [];
      for (const s of sessions) {
        const primary = s.loaded[0] ?? s.firstTop;
        const task = classifyTaskType(primary ? metaFor(skills, primary) : undefined, s.firstPrompt ?? s.texts[0]);
        if (unit === "search_requests" || unit === "load_requests") {
          const operation = unit === "search_requests" ? "search" : "load";
          const statuses = operation === "search" ? f.searchStatus : f.loadStatus;
          for (const request of s.requestRecords.filter((r) => r.operation === operation
            && (!statuses?.length || statuses.includes(r.status))
            && (!f.skill?.length || r.uri !== undefined && f.skill.includes(r.uri))
            && (operation !== "search" || !f.searchResult?.length || r.result !== undefined && f.searchResult.includes(r.result)))) {
            paths.push({ session: `${s.id}:${request.id}`, task, skill: request.uri ?? "(none)", state: request.status });
          }
          continue;
        }
        const skillList = unit === "all_loads" && s.loaded.length > 0 ? s.loaded : primary ? [primary] : ["(none)"];
        for (const sk of skillList) paths.push({ session: s.id, task, skill: sk, state: s.state });
      }

      const OTHER = "__other__";
      const otherMembers: [Set<string>, Set<string>, Set<string>] = [new Set(), new Set(), new Set()];
      const keep = (values: string[], column: 0 | 1 | 2): Map<string, string> => {
        const sessionsBy = new Map<string, Set<string>>();
        paths.forEach((p, i) => {
          const v = values[i]!;
          const set = sessionsBy.get(v) ?? new Set<string>();
          set.add(p.session);
          sessionsBy.set(v, set);
        });
        const ranked = [...sessionsBy.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
        const map = new Map<string, string>();
        ranked.forEach(([v], i) => {
          if (i < limit) map.set(v, v);
          else { map.set(v, OTHER); otherMembers[column].add(v); }
        });
        return map;
      };
      const taskMap = keep(paths.map((p) => p.task), 0);
      const skillMap = keep(paths.map((p) => p.skill), 1);
      const stateMap = keep(paths.map((p) => p.state), 2);
      const mapped = paths.map((p) => ({ session: p.session, state: p.state, task: taskMap.get(p.task)!, skill: skillMap.get(p.skill)!, stateNode: stateMap.get(p.state)! }));

      const countLinks = () => {
        const left = new Map<string, Set<string>>();
        const right = new Map<string, Set<string>>();
        const add = (m: Map<string, Set<string>>, k: string, s: string) => { const set = m.get(k) ?? new Set<string>(); set.add(s); m.set(k, set); };
        for (const p of mapped) {
          add(left, `${p.task}\u0000${p.skill}\u0000${p.state}`, p.session);
          add(right, `${p.skill}\u0000${p.stateNode}\u0000${p.state}`, p.session);
        }
        return { left, right };
      };
      const before = countLinks();
      for (const p of mapped) {
        if (p.skill === OTHER || unit.endsWith("_requests")) continue;
        const weakLeft = (before.left.get(`${p.task}\u0000${p.skill}\u0000${p.state}`)?.size ?? 0) < 2;
        const weakRight = (before.right.get(`${p.skill}\u0000${p.stateNode}\u0000${p.state}`)?.size ?? 0) < 2;
        if (weakLeft || weakRight) { otherMembers[1].add(p.skill); p.skill = OTHER; }
      }
      const after = countLinks();

      const nodeId = (column: 0 | 1 | 2, v: string) => `${["t", "s", "a"][column]}:${v}`;
      const nodeSessions = new Map<string, { column: 0 | 1 | 2; value: string; sessions: Set<string> }>();
      const touch = (column: 0 | 1 | 2, v: string, s: string) => {
        const id = nodeId(column, v);
        const n = nodeSessions.get(id) ?? { column, value: v, sessions: new Set<string>() };
        n.sessions.add(s);
        nodeSessions.set(id, n);
      };
      for (const p of mapped) { touch(0, p.task, p.session); touch(1, p.skill, p.session); touch(2, p.stateNode, p.session); }
      const label = (column: 0 | 1 | 2, v: string) =>
        v === OTHER ? `Other (${otherMembers[column].size})` : column === 1 ? (v === "(none)" ? "(no skill)" : metaFor(skills, v).name) : v;
      const nodes: FlowDto["nodes"] = [...nodeSessions.entries()]
        .sort((a, b) => a[1].column - b[1].column || Number(a[1].value === OTHER) - Number(b[1].value === OTHER) || b[1].sessions.size - a[1].sessions.size)
        .map(([id, n]) => ({ id, column: n.column, label: label(n.column, n.value), count: n.sessions.size, ...(n.value === OTHER ? { other: true } : {}) }));
      const links: FlowDto["links"] = [];
      for (const [k, set] of after.left) {
        const [task, skill, state] = k.split("\u0000") as [string, string, FlowDto["links"][number]["state"]];
        links.push({ source: nodeId(0, task), target: nodeId(1, skill), count: set.size, state });
      }
      for (const [k, set] of after.right) {
        const [skill, stateNode, state] = k.split("\u0000") as [string, string, FlowDto["links"][number]["state"]];
        links.push({ source: nodeId(1, skill), target: nodeId(2, stateNode), count: set.size, state });
      }
      links.sort((a, b) => b.count - a.count);
      return { ...(unit.endsWith("_requests") ? { requestCount: paths.length } : {}), unit, columns: ["task_type", "skill", "state"], nodes, links, sessionCount: sessions.length };
    } }; }
