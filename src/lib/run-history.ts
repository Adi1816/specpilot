import { z } from "zod";
import {
  httpMethods,
  hybridMutationValues,
  riskMemoSourceValues,
  scenarioPriorityValues,
  testCaseSourceValues,
  testCategoryValues,
  testStatusValues,
} from "@/lib/types";
import type {
  CoverageSummary,
  NormalizedSpec,
  RunHistoryCase,
  RunHistoryCaseChange,
  RunHistoryDiff,
  RunHistoryEntry,
  RunSummary,
  StrategyMode,
  TestCase,
  TestPlan,
  TestResult,
} from "@/lib/types";

const STORAGE_KEY = "specpilot-run-history-v1";
export const MAX_RUN_HISTORY = 12;

const runSummarySchema = z.object({
  total: z.number(),
  pass: z.number(),
  fail: z.number(),
  error: z.number(),
  skipped: z.number(),
  averageLatencyMs: z.number(),
});

const coverageSummarySchema = z.object({
  operationsCovered: z.number(),
  totalCases: z.number(),
  categories: z.object({
    happy: z.number(),
    validation: z.number(),
    auth: z.number(),
    discovery: z.number(),
  }),
  sources: z.object({
    deterministic: z.number(),
    hybrid: z.number(),
  }),
});

const runHistoryCaseSchema = z.object({
  testCaseId: z.string(),
  operationId: z.string(),
  name: z.string(),
  method: z.enum(httpMethods),
  path: z.string(),
  category: z.enum(testCategoryValues),
  source: z.enum(testCaseSourceValues),
  priority: z.enum(scenarioPriorityValues).optional(),
  mutation: z.enum(hybridMutationValues).optional(),
  status: z.enum(testStatusValues),
  actualStatus: z.number().optional(),
  expectedStatusPatterns: z.array(z.string()),
  latencyMs: z.number().optional(),
});

const runHistoryEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  apiTitle: z.string(),
  apiVersion: z.string(),
  strategy: z.enum(["baseline", "enhanced"]),
  riskMemoSource: z.enum(riskMemoSourceValues),
  baseUrl: z.string(),
  selectedOperationIds: z.array(z.string()),
  coverage: coverageSummarySchema,
  summary: runSummarySchema,
  planSummary: z.string().optional(),
  cases: z.array(runHistoryCaseSchema),
});

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function createEntryId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function trimHistory(entries: RunHistoryEntry[]) {
  return entries.slice(0, MAX_RUN_HISTORY);
}

function toHistoryCase(testCase: TestCase, result: TestResult | undefined): RunHistoryCase {
  return {
    testCaseId: testCase.id,
    operationId: testCase.operationId,
    name: testCase.name,
    method: testCase.method,
    path: testCase.path,
    category: testCase.category,
    source: testCase.source,
    priority: testCase.priority,
    mutation: testCase.mutation,
    status: result?.status ?? "skipped",
    actualStatus: result?.actualStatus,
    expectedStatusPatterns: testCase.expectedStatusPatterns,
    latencyMs: result?.latencyMs,
  };
}

function toCaseChange({
  current,
  previous,
}: {
  current?: RunHistoryCase;
  previous?: RunHistoryCase;
}): RunHistoryCaseChange {
  const reference = current ?? previous;

  if (!reference) {
    throw new Error("A case change requires either a current or previous case.");
  }

  return {
    testCaseId: reference.testCaseId,
    name: reference.name,
    method: reference.method,
    path: reference.path,
    source: reference.source,
    priority: reference.priority,
    mutation: reference.mutation,
    previousStatus: previous?.status,
    currentStatus: current?.status,
    previousActualStatus: previous?.actualStatus,
    currentActualStatus: current?.actualStatus,
    previousLatencyMs: previous?.latencyMs,
    currentLatencyMs: current?.latencyMs,
  };
}

function sortCaseChanges(changes: RunHistoryCaseChange[]) {
  return [...changes].sort((left, right) => {
    if (left.path === right.path) {
      return left.name.localeCompare(right.name);
    }

    return left.path.localeCompare(right.path);
  });
}

export function insertRunHistoryEntry(entries: RunHistoryEntry[], entry: RunHistoryEntry) {
  return trimHistory([entry, ...entries.filter((current) => current.id !== entry.id)]);
}

export function loadRunHistory() {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    const validated = z.array(runHistoryEntrySchema).safeParse(parsed);

    if (!validated.success) {
      return [];
    }

    return trimHistory(validated.data);
  } catch {
    return [];
  }
}

export function saveRunHistory(entries: RunHistoryEntry[]) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimHistory(entries)));
  } catch {
    // Ignore storage quota and serialization errors to keep the UI responsive.
  }
}

export function clearRunHistory() {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function buildRunHistoryEntry({
  spec,
  plan,
  results,
  summary,
  strategy,
  baseUrl,
}: {
  spec: NormalizedSpec;
  plan: TestPlan;
  results: TestResult[];
  summary: RunSummary;
  strategy: StrategyMode;
  baseUrl: string;
}) {
  const resultLookup = new Map(results.map((result) => [result.testCaseId, result]));

  return {
    id: createEntryId(),
    createdAt: new Date().toISOString(),
    apiTitle: spec.metadata.title,
    apiVersion: spec.metadata.version,
    strategy,
    riskMemoSource: plan.riskMemoSource,
    baseUrl,
    selectedOperationIds: plan.selectedOperationIds,
    coverage: structuredClone(plan.coverage) as CoverageSummary,
    summary: structuredClone(summary) as RunSummary,
    planSummary: plan.planSummary,
    cases: plan.testCases.map((testCase) => toHistoryCase(testCase, resultLookup.get(testCase.id))),
  } satisfies RunHistoryEntry;
}

export function findDefaultBaseline(
  entries: RunHistoryEntry[],
  currentEntry: RunHistoryEntry,
) {
  return (
    entries.find(
      (entry) =>
        entry.id !== currentEntry.id &&
        entry.apiTitle === currentEntry.apiTitle &&
        entry.apiVersion === currentEntry.apiVersion,
    ) ??
    entries.find((entry) => entry.id !== currentEntry.id) ??
    null
  );
}

export function diffRunHistory(
  current: RunHistoryEntry,
  baseline: RunHistoryEntry,
): RunHistoryDiff {
  const currentLookup = new Map(current.cases.map((testCase) => [testCase.testCaseId, testCase]));
  const baselineLookup = new Map(baseline.cases.map((testCase) => [testCase.testCaseId, testCase]));
  const regressions: RunHistoryCaseChange[] = [];
  const recoveries: RunHistoryCaseChange[] = [];
  const addedCases: RunHistoryCaseChange[] = [];
  const removedCases: RunHistoryCaseChange[] = [];
  const statusChanges: RunHistoryCaseChange[] = [];

  for (const currentCase of current.cases) {
    const previousCase = baselineLookup.get(currentCase.testCaseId);

    if (!previousCase) {
      addedCases.push(toCaseChange({ current: currentCase }));
      continue;
    }

    if (previousCase.status !== currentCase.status) {
      const change = toCaseChange({
        current: currentCase,
        previous: previousCase,
      });

      statusChanges.push(change);

      if (previousCase.status === "pass" && currentCase.status !== "pass") {
        regressions.push(change);
      }

      if (previousCase.status !== "pass" && currentCase.status === "pass") {
        recoveries.push(change);
      }
    }
  }

  for (const previousCase of baseline.cases) {
    if (!currentLookup.has(previousCase.testCaseId)) {
      removedCases.push(toCaseChange({ previous: previousCase }));
    }
  }

  return {
    baselineId: baseline.id,
    baselineCreatedAt: baseline.createdAt,
    baselineLabel: `${baseline.apiTitle} v${baseline.apiVersion}`,
    totalDelta: current.summary.total - baseline.summary.total,
    passDelta: current.summary.pass - baseline.summary.pass,
    failDelta: current.summary.fail - baseline.summary.fail,
    errorDelta: current.summary.error - baseline.summary.error,
    skippedDelta: current.summary.skipped - baseline.summary.skipped,
    averageLatencyDeltaMs: current.summary.averageLatencyMs - baseline.summary.averageLatencyMs,
    changedCount: statusChanges.length + addedCases.length + removedCases.length,
    regressions: sortCaseChanges(regressions),
    recoveries: sortCaseChanges(recoveries),
    addedCases: sortCaseChanges(addedCases),
    removedCases: sortCaseChanges(removedCases),
    statusChanges: sortCaseChanges(statusChanges),
  };
}
