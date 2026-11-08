/** The parsed workflow spec fields compare reads (local workflow/spec.ts applies the defaults). */
export type CompareStep = { readonly id: string; readonly skills: readonly string[]; readonly together: boolean;
  readonly expectTools: readonly string[] };
export type CompareSpec = { readonly steps: readonly CompareStep[] };

export type StepStatus = "matched" | "partial" | "different" | "no_skill_used" | "not_run";

export type StepComparison = {
  stepId: string;
  panes: string[];
  intendedSkills: string[];
  usedSkills: string[];
  status: StepStatus;
  extraSkills: string[];
  missingSkills: string[];
  unexpectedTools: string[];
};

export type UnplannedPane = { paneId: string; usedSkills: string[] };
export type FlowComparison = { steps: StepComparison[]; unplanned: UnplannedPane[] };

export type CompareInput = {
  spec: CompareSpec;
  steps: { stepId: string; paneId: string }[];
  paneSkillUse: Record<string, string[]>;
  paneTools: Record<string, string[]>;
  /** Every pane known for the flow; a pane with no step mapping is reported as unplanned. */
  panes?: string[];
};

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/**
 * Status per step:
 * - `not_run`        no pane was mapped to the step
 * - `no_skill_used`  the step's panes used no skill at all although the step intends some
 * - `different`      skills were used but none of them was intended (or the step intends none)
 * - `partial`        a `together` step used some but not all of its intended skills
 * - `matched`        the intent is satisfied: all intended skills for `together`, any one of them otherwise
 *
 * `extraSkills` (used but not intended) are reported, not penalised - deviations are feedback data, never enforcement.
 * `unexpectedTools` stays empty while a step declares no `expectTools`, because nothing was expected to deviate from.
 */
export function compare(input: CompareInput): FlowComparison {
  const panesByStep = new Map<string, string[]>();
  const mapped = new Set<string>();
  for (const { stepId, paneId } of input.steps) {
    panesByStep.set(stepId, [...(panesByStep.get(stepId) ?? []), paneId]);
    mapped.add(paneId);
  }
  const skillsOf = (panes: string[]) => panes.flatMap((p) => input.paneSkillUse[p] ?? []);

  const steps = input.spec.steps.map((step): StepComparison => {
    const panes = sorted(panesByStep.get(step.id) ?? []);
    const intended = sorted(step.skills);
    const used = sorted(skillsOf(panes));
    const intendedSet = new Set(intended);
    const usedSet = new Set(used);
    const hit = intended.filter((s) => usedSet.has(s));
    const missingSkills = intended.filter((s) => !usedSet.has(s));
    const extraSkills = used.filter((s) => !intendedSet.has(s));
    const expected = new Set(step.expectTools);
    const unexpectedTools = expected.size === 0 ? [] : sorted(panes.flatMap((p) => input.paneTools[p] ?? [])).filter((t) => !expected.has(t));

    const status: StepStatus = panes.length === 0 ? "not_run"
      : used.length === 0 ? (intended.length === 0 ? "matched" : "no_skill_used")
      : hit.length === 0 ? "different"
      : step.together && missingSkills.length > 0 ? "partial"
      : "matched";

    return { stepId: step.id, panes, intendedSkills: intended, usedSkills: used, status, extraSkills, missingSkills, unexpectedTools };
  });

  const unplanned = sorted(input.panes ?? Object.keys(input.paneSkillUse))
    .filter((paneId) => !mapped.has(paneId))
    .map((paneId) => ({ paneId, usedSkills: sorted(input.paneSkillUse[paneId] ?? []) }));

  return { steps, unplanned };
}
