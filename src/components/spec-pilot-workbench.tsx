"use client";

import type { CSSProperties, ChangeEvent, PointerEvent, ReactNode } from "react";
import { useDeferredValue, useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Bug,
  CheckCheck,
  ClipboardList,
  FileCode2,
  Gauge,
  LoaderCircle,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";
import { demoSpecText } from "@/lib/demo-spec";
import {
  buildRunHistoryEntry,
  clearRunHistory,
  diffRunHistory,
  findDefaultBaseline,
  insertRunHistoryEntry,
  loadRunHistory,
  saveRunHistory,
} from "@/lib/run-history";
import type {
  HybridScenario,
  NormalizedSpec,
  RiskInsight,
  RiskMemoSource,
  RunHistoryDiff,
  RunHistoryEntry,
  RunSummary,
  StrategyMode,
  TestCase,
  TestCaseSource,
  TestPlan,
  TestResult,
} from "@/lib/types";

type AnalyzeResponse = {
  spec: NormalizedSpec;
  defaultBaseUrl: string;
};

type GenerateResponse = {
  plan: TestPlan;
};

type RunResponse = {
  results: TestResult[];
  summary: RunSummary;
};

type ReportResponse = {
  markdown: string;
};

type WorkflowState = "done" | "ready" | "locked";
type WorkflowStep = {
  id: string;
  label: string;
  meta: string;
  state: WorkflowState;
};
type ToastState = {
  id: number;
  title: string;
  detail: string;
  actionLabel?: string;
  actionTarget?: string;
};

const demoSpecTitle = "SpecPilot Demo Orders API";
const demoBasePath = "/api/demo/v1";
const demoToken = "demo-token";

async function requestJson<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "The request could not be completed.",
    );
  }

  return data as T;
}

function createEmptyRunSummary(): RunSummary {
  return {
    total: 0,
    pass: 0,
    fail: 0,
    error: 0,
    skipped: 0,
    averageLatencyMs: 0,
  };
}

function resolveSuggestedBaseUrl(defaultBaseUrl: string, specTitle: string) {
  if (typeof window === "undefined") {
    return defaultBaseUrl;
  }

  if (defaultBaseUrl.startsWith("/")) {
    return `${window.location.origin}${defaultBaseUrl}`;
  }

  if (specTitle === demoSpecTitle) {
    return `${window.location.origin}${demoBasePath}`;
  }

  return defaultBaseUrl;
}

function revealStyle(delay: number): CSSProperties {
  return {
    ["--reveal-delay" as string]: `${delay}ms`,
  };
}

function formatRiskSourceLabel(source: RiskMemoSource) {
  if (source === "gemini") {
    return "Gemini";
  }

  if (source === "openai") {
    return "OpenAI legacy";
  }

  if (source === "fallback") {
    return "Deterministic fallback";
  }

  return "Baseline deterministic";
}

function formatRiskSourceContext(source: RiskMemoSource) {
  if (source === "gemini" || source === "openai") {
    return "AI-prioritized";
  }

  if (source === "fallback") {
    return "Contract-ranked";
  }

  return "Core only";
}

function formatRunTimestamp(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDelta(value: number) {
  if (value === 0) {
    return "0";
  }

  return `${value > 0 ? "+" : ""}${value}`;
}

function formatLatencyDelta(value: number) {
  if (value === 0) {
    return "0 ms";
  }

  return `${value > 0 ? "+" : ""}${value} ms`;
}

export function SpecPilotWorkbench() {
  const [rawSpec, setRawSpec] = useState(demoSpecText);
  const [analysis, setAnalysis] = useState<NormalizedSpec | null>(null);
  const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<StrategyMode>("enhanced");
  const [plan, setPlan] = useState<TestPlan | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [summary, setSummary] = useState<RunSummary>(createEmptyRunSummary());
  const [report, setReport] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [notice, setNotice] = useState(
    "Load the demo spec or paste your own OpenAPI document to generate a grounded test suite.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [activeStepId, setActiveStepId] = useState("step-1");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [, startTransition] = useTransition();
  const [runConfig, setRunConfig] = useState({
    baseUrl: "",
    authToken: "",
    authHeaderName: "Authorization",
    authPrefix: "Bearer",
  });
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setRunHistory(loadRunHistory());
      setHistoryReady(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!historyReady) {
      return;
    }

    saveRunHistory(runHistory);
  }, [historyReady, runHistory]);

  useEffect(() => {
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-step-panel]"));

    if (sections.length === 0) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter((entry) => entry.isIntersecting);

        if (visibleEntries.length === 0) {
          return;
        }

        visibleEntries.sort((left, right) => right.intersectionRatio - left.intersectionRatio);

        const nextActiveId = visibleEntries[0].target.getAttribute("id");
        if (nextActiveId) {
          setActiveStepId(nextActiveId);
        }
      },
      {
        threshold: [0.2, 0.38, 0.56],
        rootMargin: "-18% 0px -56% 0px",
      },
    );

    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, [analysis, plan, results.length, report.length]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 4600);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filteredOperations =
    analysis?.operations.filter((operation) => {
      const query = deferredSearch.trim().toLowerCase();
      if (!query) {
        return true;
      }

      return (
        operation.path.toLowerCase().includes(query) ||
        operation.summary.toLowerCase().includes(query) ||
        operation.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    }) ?? [];

  function clearOutputs() {
    setPlan(null);
    setResults([]);
    setSummary(createEmptyRunSummary());
    setReport("");
    setCurrentRunId(null);
  }

  function setBanner(message: string) {
    setErrorMessage("");
    setNotice(message);
  }

  function setFailure(message: string) {
    setNotice("");
    setErrorMessage(message);
  }

  function showToast({
    title,
    detail,
    actionLabel,
    actionTarget,
  }: Omit<ToastState, "id">) {
    setToast({
      id: Date.now(),
      title,
      detail,
      actionLabel,
      actionTarget,
    });
  }

  function jumpToStep(stepId: string) {
    const section = document.getElementById(stepId);
    if (!section) {
      return;
    }

    setActiveStepId(stepId);
    section.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function updateSelection(nextIds: string[]) {
    startTransition(() => {
      setSelectedOperationIds(nextIds);
      clearOutputs();
    });
  }

  async function handleAnalyze() {
    if (!rawSpec.trim()) {
      setFailure("Paste an OpenAPI or Swagger document before running the analysis.");
      return;
    }

    setIsAnalyzing(true);
    setBanner("Analyzing the spec. Step 2 will unlock as soon as parsing is complete.");

    try {
      const data = await requestJson<AnalyzeResponse>("/api/spec", {
        rawSpec,
      });

      startTransition(() => {
        const suggestedBaseUrl = resolveSuggestedBaseUrl(
          data.defaultBaseUrl,
          data.spec.metadata.title,
        );
        const isDemoSpec = data.spec.metadata.title === demoSpecTitle;

        setAnalysis(data.spec);
        setSelectedOperationIds(data.spec.operations.slice(0, 4).map((operation) => operation.id));
        setRunConfig((current) => ({
          ...current,
          baseUrl: current.baseUrl || suggestedBaseUrl,
          authToken: current.authToken || (isDemoSpec ? demoToken : ""),
        }));
        clearOutputs();
      });

      setBanner(
        data.spec.metadata.title === demoSpecTitle
          ? `Analyzed ${data.spec.operations.length} operations across ${data.spec.metadata.title}. I also prefilled the local demo base URL and token so you can run the suite immediately.`
          : `Analyzed ${data.spec.operations.length} operations across ${data.spec.metadata.title}. The first ${Math.min(
              4,
              data.spec.operations.length,
            )} endpoints are preselected for the first pass.`,
      );

      showToast({
        title: "Spec analyzed.",
        detail: "Step 2 is ready. Scroll down to inspect and select the endpoints for your first pass.",
        actionLabel: "Open step 2",
        actionTarget: "step-2",
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Spec analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleGeneratePlan() {
    if (!analysis || selectedOperationIds.length === 0) {
      setFailure("Select at least one operation before generating a test plan.");
      return;
    }

    setIsGenerating(true);
    setBanner("Generating your test plan. The generated suite will appear in Step 4.");

    try {
      const data = await requestJson<GenerateResponse>("/api/tests/generate", {
        spec: analysis,
        selectedOperationIds,
        strategy,
      });

      setPlan(data.plan);
      setResults([]);
      setSummary(createEmptyRunSummary());
      setReport("");
      setCurrentRunId(null);
      setSelectedBaselineId(null);

      const hybridCount = data.plan.coverage.sources.hybrid;
      const hybridLabel =
        hybridCount > 0
          ? ` Added ${hybridCount} promoted hybrid edge case${hybridCount === 1 ? "" : "s"}.`
          : " No extra hybrid cases were promoted for this selection.";

      setBanner(
        `Generated ${data.plan.testCases.length} test cases across ${data.plan.coverage.operationsCovered} operations. Risk prioritization source: ${formatRiskSourceLabel(data.plan.riskMemoSource)}.${hybridLabel}`,
      );

      showToast({
        title: "Test plan generated.",
        detail: "Step 4 now includes the structured planning summary, risk cards, and the promoted edge cases.",
        actionLabel: "Open suite",
        actionTarget: "step-4",
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Test generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRunSuite() {
    if (!analysis || !plan) {
      setFailure("Generate a test plan before running the suite.");
      return;
    }

    setIsRunning(true);
    setBanner("Running the suite and drafting the markdown handoff. Results will land in Steps 5 and 6.");

    try {
      const execution = await requestJson<RunResponse>("/api/tests/run", {
        spec: analysis,
        plan,
        runConfig,
      });

      const reportData = await requestJson<ReportResponse>("/api/reports", {
        spec: analysis,
        plan,
        results: execution.results,
        summary: execution.summary,
      });

      setResults(execution.results);
      setSummary(execution.summary);
      setReport(reportData.markdown);

      const executedBaseUrl = runConfig.baseUrl.trim() || analysis.metadata.servers[0] || "";
      const historyEntry = buildRunHistoryEntry({
        spec: analysis,
        plan,
        results: execution.results,
        summary: execution.summary,
        strategy,
        baseUrl: executedBaseUrl,
      });
      const defaultBaseline = findDefaultBaseline(runHistory, historyEntry);

      setRunHistory((current) => insertRunHistoryEntry(current, historyEntry));
      setCurrentRunId(historyEntry.id);
      setSelectedBaselineId(defaultBaseline?.id ?? null);

      setBanner(
        `Run complete: ${execution.summary.pass} passed, ${execution.summary.fail} failed, ${execution.summary.error} errored, ${execution.summary.skipped} skipped. This run is now saved in browser history for future diffing.`,
      );

      showToast({
        title: "Suite run complete.",
        detail: defaultBaseline
          ? "The execution board now includes a diff against the previous baseline, plus the saved run history."
          : "This first checkpoint has been saved. Run the suite again later and SpecPilot will diff the results for you.",
        actionLabel: "View results",
        actionTarget: "step-5",
      });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Test execution failed.");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    startTransition(() => {
      setRawSpec(text);
      setAnalysis(null);
      setSelectedOperationIds([]);
      clearOutputs();
    });
    setBanner(`Loaded ${file.name}. Analyze it when you are ready.`);
  }

  async function handleCopyReport() {
    if (!report) {
      return;
    }

    setIsCopying(true);
    try {
      await navigator.clipboard.writeText(report);
      setBanner("Execution report copied to your clipboard.");
      showToast({
        title: "Report copied to clipboard.",
        detail: "You can paste the markdown handoff directly into GitHub issues, PR comments, or QA notes.",
        actionLabel: "Open report",
        actionTarget: "step-6",
      });
    } catch {
      setFailure("Clipboard access failed. You can still copy the report manually from the panel.");
    } finally {
      setIsCopying(false);
    }
  }

  function handleClearHistory() {
    clearRunHistory();
    setRunHistory([]);
    setCurrentRunId(null);
    setSelectedBaselineId(null);
    setBanner("Saved run history was cleared from this browser.");
  }

  const selectedVisibleCount = filteredOperations.filter((operation) =>
    selectedOperationIds.includes(operation.id),
  ).length;
  const testCaseLookup = new Map(plan?.testCases.map((testCase) => [testCase.id, testCase]) ?? []);
  const currentRunEntry =
    currentRunId ? runHistory.find((entry) => entry.id === currentRunId) ?? null : null;
  const automaticBaselineEntry = currentRunEntry ? findDefaultBaseline(runHistory, currentRunEntry) : null;
  const selectedBaselineEntry =
    currentRunEntry && selectedBaselineId
      ? runHistory.find((entry) => entry.id === selectedBaselineId && entry.id !== currentRunId) ??
        automaticBaselineEntry
      : automaticBaselineEntry;
  const runDiff =
    currentRunEntry && selectedBaselineEntry
      ? diffRunHistory(currentRunEntry, selectedBaselineEntry)
      : null;
  const historyAvailable = runHistory.length > 0;
  const savedRunMeta =
    runHistory.length > 0
      ? `${runHistory.length} saved run${runHistory.length === 1 ? "" : "s"}`
      : "No saved runs";

  const workflowSteps = [
    {
      id: "step-1",
      label: "Load contract",
      meta: analysis ? "Spec analyzed and normalized" : "Paste a spec or load demo",
      state: analysis ? "done" : "ready",
    },
    {
      id: "step-2",
      label: "Select endpoints",
      meta: analysis
        ? `${selectedOperationIds.length} endpoint${selectedOperationIds.length === 1 ? "" : "s"} selected`
        : "Unlocks after analysis",
      state: analysis
        ? selectedOperationIds.length > 0
          ? "done"
          : "ready"
        : "locked",
    },
    {
      id: "step-3",
      label: "Configure run",
      meta: plan
        ? `Strategy locked: ${strategy === "enhanced" ? "enhanced" : "baseline"}`
        : "Base URL, auth, and suite generation",
      state: plan ? "done" : analysis && selectedOperationIds.length > 0 ? "ready" : "locked",
    },
    {
      id: "step-4",
      label: "Generated suite",
      meta: plan
        ? `${plan.testCases.length} cases ready, ${plan.coverage.sources.hybrid} hybrid`
        : "Appears after generation",
      state: plan ? "done" : "locked",
    },
    {
      id: "step-5",
      label: "Execution board",
      meta:
        results.length > 0
          ? `${summary.pass}/${summary.total} passing`
          : historyAvailable
            ? savedRunMeta
          : plan
            ? "Ready to execute"
            : "Unlocks after planning",
      state: results.length > 0 ? "done" : plan || historyAvailable ? "ready" : "locked",
    },
    {
      id: "step-6",
      label: "Markdown handoff",
      meta: report
        ? "Report drafted and ready to share"
        : results.length > 0
          ? "Generated after execution"
          : "Final artifact appears after the run",
      state: report ? "done" : results.length > 0 ? "ready" : "locked",
    },
  ] satisfies WorkflowStep[];

  const completedStepCount = workflowSteps.filter((step) => step.state === "done").length;
  const progressRatio =
    workflowSteps.length > 0 ? Math.round((completedStepCount / workflowSteps.length) * 100) : 0;
  const activeStepIndex = Math.max(
    0,
    workflowSteps.findIndex((step) => step.id === activeStepId),
  );
  const activeStep = workflowSteps[activeStepIndex] ?? workflowSteps[0];
  const nextStep =
    workflowSteps.slice(activeStepIndex + 1).find((step) => step.state !== "done") ?? null;

  return (
    <main className="mesh-background overflow-x-clip">
      <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(20rem,0.92fr)]">
          <div
            className="glass-card shine-border hero-panel min-w-0 rounded-[2.35rem] p-6 sm:p-8"
            data-reveal=""
            style={revealStyle(0)}
          >
            <div className="eyebrow-chip">
              <WandSparkles className="h-4 w-4" />
              GenAI QA flagship project
            </div>

            <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
              <div className="min-w-0">
                <p className="max-w-xs text-xs font-semibold uppercase tracking-[0.34em] text-copy-muted">
                  Contract-grounded testing. Execution evidence. Bug-ready reporting.
                </p>
                <h1 className="mt-4 max-w-4xl font-display text-[clamp(3.6rem,8vw,6.8rem)] leading-[0.9] tracking-[-0.08em] text-copy">
                  SpecPilot
                </h1>
                <p className="mt-5 max-w-3xl text-base leading-8 text-copy-muted sm:text-lg">
                  A cinematic, spec-grounded API copilot that walks the user from contract intake
                  to endpoint selection, suite generation, live execution, and markdown handoff
                  without losing the thread.
                </p>
              </div>

              <div className="grid gap-3">
                <a
                  className="inline-flex items-center justify-between rounded-full border border-accent/35 bg-accent-soft px-5 py-3 text-sm font-semibold text-copy transition hover:border-accent/55 hover:bg-accent-soft/80"
                  href="#step-1"
                >
                  Start the guided flow
                  <ArrowRight className="h-4 w-4 text-accent" />
                </a>
                <a
                  className="inline-flex items-center justify-between rounded-full border border-border bg-white/5 px-5 py-3 text-sm font-semibold text-copy transition hover:bg-white/8"
                  href="#step-5"
                >
                  Jump to run board
                  <ArrowRight className="h-4 w-4 text-copy-muted" />
                </a>
              </div>
            </div>

            <div className="mt-8 grid gap-3 md:grid-cols-3">
              <MetricCard
                icon={<FileCode2 className="h-4 w-4" />}
                label="Grounded"
                value="Requests, expectations, and paths stay anchored in the uploaded contract."
              />
              <MetricCard
                icon={<Bot className="h-4 w-4" />}
                label="Hybrid planner"
                value="Deterministic parsing stays in control while AI can prioritize extra edge-case coverage when available."
              />
              <MetricCard
                icon={<Bug className="h-4 w-4" />}
                label="Execution"
                value="Failures turn into explainable results and a shareable markdown artifact."
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <div
              className="glass-card min-w-0 rounded-[2.35rem] p-6 sm:p-7"
              data-reveal=""
              style={revealStyle(90)}
            >
              <PanelHeader
                eyebrow="Immersive preview"
                title="3D workflow object"
                description="A stacked, animated scene keeps the experience feeling current without stealing attention from the product flow."
              />
              <div className="mt-6">
                <HeroScene />
              </div>
            </div>

            <div
              className="glass-card min-w-0 rounded-[2.1rem] p-6"
              data-reveal=""
              style={revealStyle(150)}
            >
              <PanelHeader
                eyebrow="Flight path"
                title="One clear next action"
                description="The workbench now behaves like a guided sequence instead of a dashboard, so users always know what to do next."
              />
              <WorkflowRail steps={workflowSteps} />
            </div>
          </div>
        </section>

        <Banner message={notice} error={errorMessage} />

        <FlightControl
          activeStep={activeStep}
          activeStepId={activeStepId}
          nextStep={nextStep}
          progressRatio={progressRatio}
          steps={workflowSteps}
        />

        <section
          className={`glass-card workflow-panel workflow-shell min-w-0 rounded-[2.25rem] p-6 sm:p-8 ${
            activeStepId === "step-1" ? "workflow-panel--active" : ""
          }`}
          data-reveal=""
          data-step-panel=""
          id="step-1"
          style={revealStyle(0)}
        >
          <StepHeader
            description="Paste JSON or YAML, upload a file, or begin with the local demo commerce API."
            stage="01"
            status={analysis ? "Analyzed and ready" : "Waiting for contract"}
            title="Load the API contract"
          />

          <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_19rem]">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-3">
                <button
                  className="action-pill"
                  onClick={() => {
                    startTransition(() => {
                      setRawSpec(demoSpecText);
                      setAnalysis(null);
                      setSelectedOperationIds([]);
                      clearOutputs();
                    });
                    setBanner("Demo spec loaded. Analyze it to generate your first suite.");
                  }}
                  type="button"
                >
                  <FileCode2 className="h-4 w-4" />
                  Load demo spec
                </button>
                <label className="action-pill cursor-pointer">
                  <Upload className="h-4 w-4" />
                  Upload file
                  <input
                    accept=".json,.yaml,.yml"
                    className="hidden"
                    onChange={handleFileChange}
                    type="file"
                  />
                </label>
                <button
                  className="action-pill action-pill--accent"
                  disabled={isAnalyzing}
                  onClick={handleAnalyze}
                  type="button"
                >
                  {isAnalyzing ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCheck className="h-4 w-4" />
                  )}
                  Analyze spec
                </button>
              </div>

              <textarea
                className="mt-5 min-h-[24rem] w-full rounded-[1.6rem] border border-border bg-panel-strong px-5 py-5 font-mono text-sm leading-7 text-copy outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                onChange={(event) => setRawSpec(event.target.value)}
                placeholder="Paste an OpenAPI or Swagger document here..."
                spellCheck={false}
                value={rawSpec}
              />
            </div>

            <div className="grid gap-4">
              <SurfaceNote
                icon={<ShieldCheck className="h-4 w-4 text-accent" />}
                title="Accepted formats"
                text="OpenAPI 3.x and Swagger 2.0 in JSON or YAML. The parser normalizes servers, auth, payloads, and responses."
              />
              <SurfaceNote
                icon={<Sparkles className="h-4 w-4 text-accent" />}
                title="Demo mode"
                text="The sample spec is wired to a local mock API, so you can complete a real end-to-end run without any external service."
              />
              <SurfaceNote
                icon={<Gauge className="h-4 w-4 text-accent" />}
                title="Best workflow"
                text="Start with 3 to 5 endpoints for a clean first pass, then broaden coverage once the full flow feels stable."
              />
            </div>
          </div>
        </section>

        <section
          className={`glass-card workflow-panel workflow-shell min-w-0 rounded-[2.25rem] p-6 sm:p-8 ${
            activeStepId === "step-2" ? "workflow-panel--active" : ""
          }`}
          data-reveal=""
          data-step-panel=""
          id="step-2"
          style={revealStyle(40)}
        >
          <StepHeader
            description="Search operations, select the paths you want to exercise, and lock in the API surface for the suite."
            stage="02"
            status={
              analysis
                ? `${selectedOperationIds.length} of ${analysis.operations.length} selected`
                : "Locked until analysis"
            }
            title="Inspect and select the surface area"
          />

          {analysis ? (
            <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0">
                <div className="stats-fluid-grid">
                  <MetricStat label="Format" value={analysis.metadata.format.toUpperCase()} />
                  <MetricStat label="Version" value={analysis.metadata.version} />
                  <MetricStat label="Endpoints" value={String(analysis.operations.length)} />
                  <MetricStat
                    label="Security"
                    value={
                      analysis.metadata.securitySchemes.length > 0
                        ? analysis.metadata.securitySchemes.map((scheme) => scheme.name).join(", ")
                        : "Public"
                    }
                  />
                </div>

                <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-copy-muted" />
                    <input
                      className="w-full rounded-full border border-border bg-white/5 py-3 pl-11 pr-4 text-sm text-copy outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Filter by path, summary, or tag"
                      value={search}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="action-pill action-pill--quiet"
                      onClick={() =>
                        updateSelection(filteredOperations.map((operation) => operation.id))
                      }
                      type="button"
                    >
                      Select visible
                    </button>
                    <button
                      className="action-pill action-pill--quiet"
                      onClick={() => updateSelection([])}
                      type="button"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-1 text-sm text-copy-muted sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {selectedOperationIds.length} selected of {analysis.operations.length}
                  </span>
                  <span>{selectedVisibleCount} selected in current view</span>
                </div>

                <div className="mt-5 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                  {filteredOperations.map((operation) => {
                    const isSelected = selectedOperationIds.includes(operation.id);

                    return (
                      <button
                        className={`panel-hover min-w-0 w-full rounded-[1.5rem] border p-5 text-left ${
                          isSelected
                            ? "border-accent/35 bg-accent-soft/90"
                            : "border-border bg-white/5"
                        }`}
                        key={operation.id}
                        onClick={() =>
                          updateSelection(
                            isSelected
                              ? selectedOperationIds.filter((id) => id !== operation.id)
                              : [...selectedOperationIds, operation.id],
                          )
                        }
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <MethodBadge method={operation.method} />
                          <span className="min-w-0 break-all font-mono text-sm text-copy">
                            {operation.path}
                          </span>
                          {operation.requiresAuth ? (
                            <span className="rounded-full border border-accent/25 bg-accent-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                              Auth
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <p className="text-lg font-semibold text-copy">{operation.summary}</p>
                            <p className="mt-2 text-sm leading-7 text-copy-muted">
                              Expected responses:{" "}
                              {operation.responses.map((response) => response.status).join(", ")}
                            </p>
                          </div>
                          <div
                            className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] ${
                              isSelected
                                ? "border-accent/40 bg-accent text-slate-950"
                                : "border-border text-copy-muted"
                            }`}
                          >
                            {isSelected ? "Selected" : "Idle"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4">
                <SurfaceNote
                  icon={<ClipboardList className="h-4 w-4 text-accent" />}
                  title="Selection tip"
                  text="Choose a balanced first pass: one list route, one create route, one detail route, and one edge-case route such as refund or delete."
                />
                <SurfaceNote
                  icon={<FileCode2 className="h-4 w-4 text-accent" />}
                  title="Contract context"
                  text={analysis.metadata.description ?? "No top-level API description was included in the uploaded contract."}
                />
                <SurfaceNote
                  icon={<Bot className="h-4 w-4 text-accent" />}
                  title="Server target"
                  text={
                    analysis.metadata.servers[0]
                      ? `Default server: ${analysis.metadata.servers[0]}`
                      : "No server URL was present in the spec, so execution will rely on the base URL you enter in the next step."
                  }
                />
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<FileCode2 className="h-5 w-5 text-accent" />}
              title="Analyze a spec to unlock endpoint selection"
              body="Once the document is parsed, SpecPilot will show the normalized operations, response patterns, tags, and security model."
            />
          )}
        </section>

        <section
          className={`glass-card workflow-panel workflow-shell min-w-0 rounded-[2.25rem] p-6 sm:p-8 ${
            activeStepId === "step-3" ? "workflow-panel--active" : ""
          }`}
          data-reveal=""
          data-step-panel=""
          id="step-3"
          style={revealStyle(70)}
        >
          <StepHeader
            description="Configure the live target, pick deterministic or enhanced planning, and move into execution."
            stage="03"
            status={
              plan
                ? `${plan.testCases.length} cases ready, ${plan.coverage.sources.hybrid} hybrid`
                : analysis
                  ? "Ready to generate"
                  : "Locked until selection"
            }
            title="Generate the suite and prepare the run"
          />

          <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
              <div className="grid gap-4 lg:grid-cols-2">
                <label className="space-y-2 text-sm text-copy-muted">
                  <span className="font-semibold text-copy">Base URL</span>
                  <input
                    className="w-full rounded-[1.2rem] border border-border bg-white/5 px-4 py-3 text-copy outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                    onChange={(event) =>
                      setRunConfig((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    placeholder="https://api.yourapp.com/v1"
                    value={runConfig.baseUrl}
                  />
                </label>
                <label className="space-y-2 text-sm text-copy-muted">
                  <span className="font-semibold text-copy">Auth token</span>
                  <input
                    className="w-full rounded-[1.2rem] border border-border bg-white/5 px-4 py-3 text-copy outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                    onChange={(event) =>
                      setRunConfig((current) => ({
                        ...current,
                        authToken: event.target.value,
                      }))
                    }
                    placeholder="Optional unless protected routes are selected"
                    type="password"
                    value={runConfig.authToken}
                  />
                </label>
                <label className="space-y-2 text-sm text-copy-muted">
                  <span className="font-semibold text-copy">Auth header name</span>
                  <input
                    className="w-full rounded-[1.2rem] border border-border bg-white/5 px-4 py-3 text-copy outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                    onChange={(event) =>
                      setRunConfig((current) => ({
                        ...current,
                        authHeaderName: event.target.value,
                      }))
                    }
                    value={runConfig.authHeaderName}
                  />
                </label>
                <label className="space-y-2 text-sm text-copy-muted">
                  <span className="font-semibold text-copy">Auth prefix</span>
                  <input
                    className="w-full rounded-[1.2rem] border border-border bg-white/5 px-4 py-3 text-copy outline-none transition focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                    onChange={(event) =>
                      setRunConfig((current) => ({
                        ...current,
                        authPrefix: event.target.value,
                      }))
                    }
                    placeholder="Bearer"
                    value={runConfig.authPrefix}
                  />
                </label>
              </div>

              <div className="mt-6 grid gap-3 lg:grid-cols-2">
                <StrategyButton
                  active={strategy === "baseline"}
                  body="Purely contract-derived coverage with deterministic planning notes and no AI prioritization."
                  icon={<ClipboardList className="h-4 w-4" />}
                  onClick={() => setStrategy("baseline")}
                  title="Baseline suite"
                />
                <StrategyButton
                  active={strategy === "enhanced"}
                  body="Keeps the deterministic core, promotes advanced edge cases, and optionally lets AI rank the riskiest additions."
                  icon={<Bot className="h-4 w-4" />}
                  onClick={() => setStrategy("enhanced")}
                  title="Enhanced suite"
                />
              </div>
            </div>

            <div className="rounded-[1.65rem] border border-border bg-white/5 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.26em] text-copy-muted">
                Launch controls
              </div>
              <div className="mt-4 grid gap-3">
                <button
                  className="action-pill action-pill--wide"
                  disabled={!analysis || selectedOperationIds.length === 0 || isGenerating}
                  onClick={handleGeneratePlan}
                  type="button"
                >
                  {isGenerating ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate test plan
                </button>
                <button
                  className="action-pill action-pill--accent action-pill--wide"
                  disabled={!plan || isRunning}
                  onClick={handleRunSuite}
                  type="button"
                >
                  {isRunning ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Run suite
                </button>
              </div>

              <div className="mt-5 grid gap-3">
                <SurfaceNote
                  icon={<Gauge className="h-4 w-4 text-accent" />}
                  title="Selection snapshot"
                  text={`${selectedOperationIds.length} endpoint${selectedOperationIds.length === 1 ? "" : "s"} selected for this run.`}
                />
                <SurfaceNote
                  icon={<ShieldCheck className="h-4 w-4 text-accent" />}
                  title="Auth readiness"
                  text={
                    runConfig.authToken
                      ? "Auth token is present, so protected routes can run."
                      : "Protected routes will be skipped until an auth token is provided."
                  }
                />
              </div>
            </div>
          </div>
        </section>

        <section
          className={`glass-card workflow-panel workflow-shell min-w-0 rounded-[2.25rem] p-6 sm:p-8 ${
            activeStepId === "step-4" ? "workflow-panel--active" : ""
          }`}
          data-reveal=""
          data-step-panel=""
          id="step-4"
          style={revealStyle(100)}
        >
          <StepHeader
            description="Review the coverage mix, inspect the structured risk priorities, and verify which advanced edge cases were promoted into runnable tests."
            stage="04"
            status={
              plan
                ? `${plan.testCases.length} cases ready, ${plan.coverage.sources.hybrid} hybrid`
                : "Waiting for generated plan"
            }
            title="Inspect the generated suite"
          />

          {plan ? (
            <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <div className="grid gap-4">
                <div className="stats-fluid-grid">
                  <MetricStat label="Operations" value={String(plan.coverage.operationsCovered)} />
                  <MetricStat label="Cases" value={String(plan.coverage.totalCases)} />
                  <MetricStat label="Deterministic" value={String(plan.coverage.sources.deterministic)} />
                  <MetricStat label="Hybrid" value={String(plan.coverage.sources.hybrid)} />
                  <MetricStat label="Happy" value={String(plan.coverage.categories.happy)} />
                  <MetricStat label="Validation" value={String(plan.coverage.categories.validation)} />
                  <MetricStat label="Auth" value={String(plan.coverage.categories.auth)} />
                  <MetricStat label="Discovery" value={String(plan.coverage.categories.discovery)} />
                </div>

                <div className="rounded-[1.65rem] border border-border bg-white/5 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-copy-muted">
                        <Bot className="h-4 w-4 text-accent" />
                        Planning summary
                      </div>
                      <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-copy-muted">
                        Risk source: {formatRiskSourceLabel(plan.riskMemoSource)}
                      </p>
                    </div>
                    <span className="rounded-full border border-accent/25 bg-accent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                      {formatRiskSourceContext(plan.riskMemoSource)}
                    </span>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-copy-muted">
                    {plan.planSummary ??
                      "The generated plan is ready. Review the structured priorities and confirm the suite mix feels intentional before you run it."}
                  </p>
                </div>

                <div className="grid gap-3">
                  {plan.riskInsights.map((insight) => (
                    <RiskInsightCard
                      insight={insight}
                      key={insight.id}
                    />
                  ))}
                </div>

                <div className="rounded-[1.65rem] border border-border bg-white/5 p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-copy-muted">
                    <Sparkles className="h-4 w-4 text-accent" />
                    Promoted edge cases
                  </div>

                  {plan.hybridScenarios.length > 0 ? (
                    <div className="mt-4 grid gap-3">
                      {plan.hybridScenarios.map((scenario) => (
                        <HybridScenarioCard
                          key={scenario.id}
                          scenario={scenario}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-7 text-copy-muted">
                      No additional hybrid edge cases were promoted for this selection, so the suite stays on the deterministic core.
                    </p>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <div className="space-y-3 pr-1">
                  {plan.testCases.map((testCase) => (
                    <div
                      className="rounded-[1.55rem] border border-border bg-panel px-5 py-5"
                      key={testCase.id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <MethodBadge method={testCase.method} />
                        <SourceBadge source={testCase.source} />
                        {testCase.priority ? <PriorityBadge priority={testCase.priority} /> : null}
                        <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-copy-muted">
                          {testCase.category}
                        </span>
                        {testCase.mutation ? (
                          <span className="rounded-full border border-accent/20 bg-accent-soft px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-accent">
                            {testCase.mutation.replace(/_/g, " ")}
                          </span>
                        ) : null}
                        <span className="text-sm font-semibold text-copy">{testCase.name}</span>
                      </div>

                      <p className="mt-3 text-sm leading-7 text-copy-muted">{testCase.rationale}</p>

                      <div className="mt-4 grid gap-2 text-xs text-copy-muted sm:grid-cols-3">
                        <span className="rounded-full border border-border px-3 py-2">
                          Expected: {testCase.expectedStatusPatterns.join(", ")}
                        </span>
                        <span className="rounded-full border border-border px-3 py-2">
                          Path: <span className="font-mono">{testCase.path}</span>
                        </span>
                        <span className="rounded-full border border-border px-3 py-2">
                          Auth: {testCase.requiresAuth ? "required" : "public"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<ClipboardList className="h-5 w-5 text-accent" />}
              title="Generate a plan to inspect the suite"
              body="The workbench will show the planning summary, structured risk cards, promoted hybrid edge cases, and every runnable test case once the plan is created."
            />
          )}
        </section>

        <section
          className={`glass-card workflow-panel workflow-shell min-w-0 rounded-[2.25rem] p-6 sm:p-8 ${
            activeStepId === "step-5" ? "workflow-panel--active" : ""
          }`}
          data-reveal=""
          data-step-panel=""
          id="step-5"
          style={revealStyle(130)}
        >
          <StepHeader
            description="Run results now capture execution evidence, saved checkpoints, and diffing against prior baselines without breaking the main execution flow."
            stage="05"
            status={
              summary.total > 0
                ? `${summary.pass} / ${summary.total} passing`
                : historyAvailable
                  ? savedRunMeta
                  : "Awaiting first run"
            }
            title="Execution board"
          />

          <div className="mt-7 stats-fluid-grid">
            <MetricStat label="Total" value={String(summary.total)} />
            <MetricStat label="Pass" value={String(summary.pass)} />
            <MetricStat label="Fail" value={String(summary.fail)} />
            <MetricStat label="Error" value={String(summary.error)} />
            <MetricStat label="Skipped" value={String(summary.skipped)} />
            <MetricStat
              label="Avg latency"
              value={summary.averageLatencyMs > 0 ? `${summary.averageLatencyMs} ms` : "-"}
            />
          </div>

          {historyAvailable || currentRunEntry ? (
            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_22rem]">
              <div className="rounded-[1.65rem] border border-border bg-white/5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-copy-muted">
                      <Gauge className="h-4 w-4 text-accent" />
                      Run diff
                    </div>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">
                      {selectedBaselineEntry
                        ? `Baseline: ${formatRunTimestamp(selectedBaselineEntry.createdAt)}`
                        : "Baseline will appear after a comparable saved run exists"}
                    </p>
                  </div>
                  {runDiff ? (
                    <span className="rounded-full border border-accent/25 bg-accent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                      {runDiff.changedCount} changed
                    </span>
                  ) : null}
                </div>

                {runDiff ? (
                  <>
                    <p className="mt-4 text-sm leading-7 text-copy-muted">
                      Comparing the current execution against{" "}
                      <span className="font-semibold text-copy">{runDiff.baselineLabel}</span> from{" "}
                      <span className="font-semibold text-copy">
                        {formatRunTimestamp(runDiff.baselineCreatedAt)}
                      </span>
                      .
                    </p>

                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <DiffMetric
                        label="Pass"
                        tone={runDiff.passDelta > 0 ? "good" : runDiff.passDelta < 0 ? "bad" : "neutral"}
                        value={formatDelta(runDiff.passDelta)}
                      />
                      <DiffMetric
                        label="Fail"
                        tone={runDiff.failDelta > 0 ? "bad" : runDiff.failDelta < 0 ? "good" : "neutral"}
                        value={formatDelta(runDiff.failDelta)}
                      />
                      <DiffMetric
                        label="Error"
                        tone={runDiff.errorDelta > 0 ? "bad" : runDiff.errorDelta < 0 ? "good" : "neutral"}
                        value={formatDelta(runDiff.errorDelta)}
                      />
                      <DiffMetric
                        label="Skipped"
                        tone={runDiff.skippedDelta > 0 ? "bad" : runDiff.skippedDelta < 0 ? "good" : "neutral"}
                        value={formatDelta(runDiff.skippedDelta)}
                      />
                      <DiffMetric
                        label="Avg latency"
                        tone={
                          runDiff.averageLatencyDeltaMs < 0
                            ? "good"
                            : runDiff.averageLatencyDeltaMs > 0
                              ? "bad"
                              : "neutral"
                        }
                        value={formatLatencyDelta(runDiff.averageLatencyDeltaMs)}
                      />
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-2">
                      <DiffChangeList
                        emptyMessage="No fresh regressions versus the selected baseline."
                        items={runDiff.regressions}
                        title={`Regressions (${runDiff.regressions.length})`}
                        tone="bad"
                      />
                      <DiffChangeList
                        emptyMessage="No recovered tests yet in this comparison."
                        items={runDiff.recoveries}
                        title={`Recoveries (${runDiff.recoveries.length})`}
                        tone="good"
                      />
                    </div>

                    <div className="mt-4 rounded-[1.35rem] border border-border bg-panel px-4 py-4">
                      <div className="flex flex-wrap gap-2 text-xs text-copy-muted">
                        <span className="rounded-full border border-border px-3 py-2">
                          Status changes: {runDiff.statusChanges.length}
                        </span>
                        <span className="rounded-full border border-border px-3 py-2">
                          Added cases: {runDiff.addedCases.length}
                        </span>
                        <span className="rounded-full border border-border px-3 py-2">
                          Removed cases: {runDiff.removedCases.length}
                        </span>
                      </div>
                    </div>
                  </>
                ) : currentRunEntry ? (
                  <p className="mt-4 text-sm leading-7 text-copy-muted">
                    This run has been saved as a checkpoint. Once you generate another comparable run,
                    SpecPilot will show regressions, recoveries, suite changes, and metric deltas here.
                  </p>
                ) : (
                  <p className="mt-4 text-sm leading-7 text-copy-muted">
                    Saved checkpoints are available in this browser. Run the suite again to unlock a
                    live comparison against one of those baselines.
                  </p>
                )}
              </div>

              <div className="rounded-[1.65rem] border border-border bg-white/5 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-copy-muted">
                      <ClipboardList className="h-4 w-4 text-accent" />
                      Run history
                    </div>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">
                      Saved in this browser
                    </p>
                  </div>
                  {historyAvailable ? (
                    <button
                      className="action-pill action-pill--quiet px-3 py-2 text-xs"
                      onClick={handleClearHistory}
                      type="button"
                    >
                      Clear history
                    </button>
                  ) : null}
                </div>

                {historyAvailable ? (
                  <div className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                    {runHistory.map((entry) => {
                      const isCurrent = currentRunId === entry.id;
                      const isSelectedBaseline = selectedBaselineEntry?.id === entry.id && !isCurrent;

                      return (
                        <div
                          className="rounded-[1.35rem] border border-border bg-panel px-4 py-4"
                          key={entry.id}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-copy">{entry.apiTitle}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-copy-muted">
                                {formatRunTimestamp(entry.createdAt)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-copy-muted">
                                {entry.strategy}
                              </span>
                              {isCurrent ? (
                                <span className="rounded-full border border-accent/25 bg-accent-soft px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-accent">
                                  Current
                                </span>
                              ) : null}
                              {isSelectedBaseline ? (
                                <span className="rounded-full border border-accent/25 bg-accent-soft px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-accent">
                                  Baseline
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2 text-xs text-copy-muted">
                            <span className="rounded-full border border-border px-3 py-2">
                              Pass: {entry.summary.pass}
                            </span>
                            <span className="rounded-full border border-border px-3 py-2">
                              Fail: {entry.summary.fail}
                            </span>
                            <span className="rounded-full border border-border px-3 py-2">
                              Ops: {entry.coverage.operationsCovered}
                            </span>
                            <span className="rounded-full border border-border px-3 py-2">
                              Cases: {entry.coverage.totalCases}
                            </span>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs uppercase tracking-[0.16em] text-copy-muted">
                              Risk source: {formatRiskSourceLabel(entry.riskMemoSource)}
                            </p>
                            {currentRunEntry && !isCurrent ? (
                              <button
                                className="action-pill action-pill--quiet px-3 py-2 text-xs"
                                onClick={() => setSelectedBaselineId(entry.id)}
                                type="button"
                              >
                                {isSelectedBaseline ? "Baseline selected" : "Use as baseline"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-7 text-copy-muted">
                    Saved runs will appear here after the first suite execution.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="mt-6 max-h-[38rem] space-y-3 overflow-y-auto pr-1">
              {results.map((result) => {
                const linkedTestCase = testCaseLookup.get(result.testCaseId);

                return (
                  <div
                    className="min-w-0 rounded-[1.55rem] border border-border bg-panel px-5 py-5"
                    key={result.testCaseId}
                  >
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <StatusBadge status={result.status} />
                          {linkedTestCase ? <SourceBadge source={linkedTestCase.source} /> : null}
                          {linkedTestCase?.priority ? (
                            <PriorityBadge priority={linkedTestCase.priority} />
                          ) : null}
                          <span className="font-mono text-xs uppercase tracking-[0.2em] text-copy-muted">
                            {result.method.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-copy">
                          {linkedTestCase?.name ?? result.testCaseId}
                        </p>
                        <p className="min-w-0 break-all font-mono text-sm leading-7 text-copy">
                          {result.requestUrl}
                        </p>
                      </div>

                      <div className="grid gap-2 text-xs text-copy-muted sm:grid-cols-3">
                        <span className="rounded-full border border-border px-3 py-2">
                          Expected: {result.expectedStatusPatterns.join(", ")}
                        </span>
                        <span className="rounded-full border border-border px-3 py-2">
                          Actual: {result.actualStatus ?? "n/a"}
                        </span>
                        <span className="rounded-full border border-border px-3 py-2">
                          Latency: {result.latencyMs ?? 0} ms
                        </span>
                      </div>
                    </div>

                    <p className="mt-4 text-sm leading-7 text-copy-muted">
                      {result.mismatchReason ?? "Matched the expected contract."}
                    </p>

                    {result.responsePreview ? (
                      <pre className="report-block mt-4 text-xs text-copy-muted">
                        {result.responsePreview}
                      </pre>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Play className="h-5 w-5 text-accent" />}
              title="No results yet"
              body={
                historyAvailable
                  ? "Saved checkpoints are ready. Run the suite again to populate the live execution board and unlock run-to-run diffing."
                  : "Run the generated suite against a live API to populate this board with pass or fail evidence and latency snapshots."
              }
            />
          )}
        </section>

        <section
          className={`glass-card workflow-panel workflow-shell min-w-0 rounded-[2.25rem] p-6 sm:p-8 ${
            activeStepId === "step-6" ? "workflow-panel--active" : ""
          }`}
          data-reveal=""
          data-step-panel=""
          id="step-6"
          style={revealStyle(160)}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <StepHeader
              description="Copy the final markdown into GitHub issues, QA notes, portfolio walkthroughs, or PR discussions."
              stage="06"
              status={report ? "Report ready to share" : "Waiting for completed run"}
              title="Markdown handoff"
            />
            <button
              className="action-pill"
              disabled={!report || isCopying}
              onClick={handleCopyReport}
              type="button"
            >
              {isCopying ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Copy report
            </button>
          </div>

          {report ? (
            <pre className="report-prose report-block mt-7 max-h-[34rem] text-sm leading-7 text-copy-muted whitespace-pre-wrap break-words">
              {report}
            </pre>
          ) : (
            <EmptyState
              icon={<Bug className="h-5 w-5 text-accent" />}
              title="The report appears after a run"
              body="Once the suite completes, SpecPilot drafts a markdown artifact with coverage, risk notes, and bug-ready failure details."
            />
          )}
        </section>

        <footer
          className="pb-4 text-sm text-copy-muted"
          data-reveal=""
          style={revealStyle(180)}
        >
          <div className="glass-card rounded-[1.8rem] px-5 py-4">
            <span className="font-semibold text-copy">Presentation angle:</span> show how the
            interface guides the user through contract intake, scoping, plan generation, execution,
            and reporting without layout shifts or dashboard confusion. That story makes the product
            feel much closer to a real QA tool.
          </div>
        </footer>

        <FloatingToast
          onAction={(target) => {
            jumpToStep(target);
            setToast(null);
          }}
          onDismiss={() => setToast(null)}
          toast={toast}
        />
      </div>
    </main>
  );
}

function Banner({ message, error }: { message: string; error: string }) {
  if (!message && !error) {
    return null;
  }

  const isError = Boolean(error);
  return (
    <div
      className={`glass-card min-w-0 rounded-[1.65rem] px-5 py-4 text-sm ${
        isError ? "border-danger/30" : "border-border"
      }`}
      data-reveal=""
      style={revealStyle(20)}
    >
      <div className="flex items-start gap-3">
        {isError ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" />
        ) : (
          <Sparkles className="mt-0.5 h-4 w-4 text-accent" />
        )}
        <p className={isError ? "text-[#ffd7d7]" : "text-copy-muted"}>{error || message}</p>
      </div>
    </div>
  );
}

function FloatingToast({
  toast,
  onDismiss,
  onAction,
}: {
  toast: ToastState | null;
  onDismiss: () => void;
  onAction: (target: string) => void;
}) {
  if (!toast) {
    return null;
  }

  const actionTarget = toast.actionTarget;

  return (
    <div
      aria-live="polite"
      className="floating-toast-shell"
      role="status"
    >
      <div className="floating-toast">
        <div className="floating-toast__icon">
          <CheckCheck className="h-4 w-4" />
        </div>

        <div className="min-w-0">
          <p className="floating-toast__title">{toast.title}</p>
          <p className="floating-toast__detail">{toast.detail}</p>

          <div className="floating-toast__actions">
            {toast.actionLabel && actionTarget ? (
              <button
                className="toast-button toast-button--accent"
                onClick={() => onAction(actionTarget)}
                type="button"
              >
                {toast.actionLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}

            <button
              className="toast-button toast-button--quiet"
              onClick={onDismiss}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepHeader({
  stage,
  title,
  description,
  status,
}: {
  stage: string;
  title: string;
  description: string;
  status: string;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-[0.34em] text-copy-muted">
          Step {stage}
        </div>
        <h2 className="mt-3 font-display text-[clamp(2rem,4vw,3.2rem)] leading-[0.95] tracking-[-0.06em] text-copy">
          {title}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-8 text-copy-muted sm:text-base">
          {description}
        </p>
      </div>
      <div className="inline-flex items-center rounded-full border border-accent/20 bg-accent-soft px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-accent">
        {status}
      </div>
    </div>
  );
}

function FlightControl({
  steps,
  activeStepId,
  activeStep,
  nextStep,
  progressRatio,
}: {
  steps: WorkflowStep[];
  activeStepId: string;
  activeStep: WorkflowStep;
  nextStep: WorkflowStep | null;
  progressRatio: number;
}) {
  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === activeStepId),
  );

  return (
    <section
      className="glass-card shine-border min-w-0 rounded-[1.75rem] px-5 py-5"
      data-reveal=""
      style={revealStyle(30)}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(15rem,0.95fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-copy-muted">
            Flight control
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full border border-accent/20 bg-accent-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">
              Step {String(activeIndex + 1).padStart(2, "0")} of {String(steps.length).padStart(2, "0")}
            </span>
            <h3 className="min-w-0 font-display text-[clamp(1.5rem,3vw,2.2rem)] leading-none tracking-[-0.06em] text-copy">
              {activeStep.label}
            </h3>
          </div>
          <p className="mt-3 text-sm leading-7 text-copy-muted">{activeStep.meta}</p>
        </div>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-copy-muted">
            <span>{steps.filter((step) => step.state === "done").length} completed</span>
            <span>{progressRatio}%</span>
          </div>
          <div className="progress-meter mt-3">
            <span style={{ width: `${progressRatio}%` }} />
          </div>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-copy-muted">
            {nextStep ? `Next up: ${nextStep.label}` : "Final handoff ready"}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 xl:w-fit">
          {steps.map((step, index) => (
            <a
              aria-current={activeStepId === step.id ? "step" : undefined}
              className={`progress-chip progress-chip--${step.state} ${
                activeStepId === step.id ? "progress-chip--active" : ""
              }`}
              href={`#${step.id}`}
              key={step.id}
            >
              <span className="progress-chip__index">{String(index + 1).padStart(2, "0")}</span>
              <span className="progress-chip__label">{step.label}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function WorkflowRail({
  steps,
}: {
  steps: WorkflowStep[];
}) {
  return (
    <div className="mt-5 grid gap-3">
      {steps.map((step, index) => (
        <a
          className="workflow-link"
          href={`#${step.id}`}
          key={step.id}
        >
          <span className={`workflow-link__index workflow-link__index--${step.state}`}>
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="min-w-0">
            <span className="workflow-link__label">{step.label}</span>
            <span className="workflow-link__meta">{step.meta}</span>
          </span>
          <span className={`workflow-link__state workflow-link__state--${step.state}`}>
            {step.state === "done" ? "Done" : step.state === "ready" ? "Ready" : "Locked"}
          </span>
        </a>
      ))}
    </div>
  );
}

function HeroScene() {
  const [tiltStyle, setTiltStyle] = useState<CSSProperties>({
    ["--tilt-x" as string]: "0deg",
    ["--tilt-y" as string]: "0deg",
    ["--glow-x" as string]: "60%",
    ["--glow-y" as string]: "26%",
  });

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = (event.clientX - bounds.left) / bounds.width;
    const relativeY = (event.clientY - bounds.top) / bounds.height;
    const rotateY = (relativeX - 0.5) * 12;
    const rotateX = (0.5 - relativeY) * 10;

    setTiltStyle({
      ["--tilt-x" as string]: `${rotateY.toFixed(2)}deg`,
      ["--tilt-y" as string]: `${rotateX.toFixed(2)}deg`,
      ["--glow-x" as string]: `${Math.round(relativeX * 100)}%`,
      ["--glow-y" as string]: `${Math.round(relativeY * 100)}%`,
    });
  }

  function resetPointer() {
    setTiltStyle({
      ["--tilt-x" as string]: "0deg",
      ["--tilt-y" as string]: "0deg",
      ["--glow-x" as string]: "60%",
      ["--glow-y" as string]: "26%",
    });
  }

  return (
    <div
      className="hero-scene"
      onPointerLeave={resetPointer}
      onPointerMove={handlePointerMove}
      style={tiltStyle}
    >
      <div className="hero-scene__glow" />
      <div className="hero-scene__sheen" />
      <div className="hero-scene__grid" />
      <div className="hero-scene__ring hero-scene__ring--outer" />
      <div className="hero-scene__ring hero-scene__ring--inner" />
      <div className="hero-scene__orb" />

      <div className="hero-scene__tilt">
        <div className="hero-scene__stack">
          <div className="hero-scene__card hero-scene__card--back">
            <div className="hero-scene__eyebrow">Select</div>
            <div className="hero-scene__title">Surface area</div>
            <p className="hero-scene__copy">Choose the endpoints that define the first pass.</p>
          </div>

          <div className="hero-scene__card hero-scene__card--mid">
            <div className="hero-scene__eyebrow">Generate</div>
            <div className="hero-scene__title">Contract suite</div>
            <p className="hero-scene__copy">Build deterministic and AI-enhanced test coverage.</p>
          </div>

          <div className="hero-scene__card hero-scene__card--front">
            <div className="hero-scene__eyebrow">Report</div>
            <div className="hero-scene__title">Run evidence</div>
            <p className="hero-scene__copy">Turn failures into shareable markdown handoff.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.55rem] border border-border bg-white/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-copy">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-3 text-sm leading-7 text-copy-muted">{value}</p>
    </div>
  );
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[1.35rem] border border-border bg-white/5 px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-copy-muted">
        {label}
      </div>
      <div className="mt-3 break-words text-lg font-semibold text-copy">{value}</div>
    </div>
  );
}

function SurfaceNote({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-[1.45rem] border border-border bg-white/5 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-copy">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/6">
          {icon}
        </span>
        {title}
      </div>
      <p className="mt-3 text-sm leading-7 text-copy-muted">{text}</p>
    </div>
  );
}

function PanelHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase tracking-[0.28em] text-copy-muted">
        {eyebrow}
      </div>
      <h2 className="mt-2 font-display text-3xl leading-tight tracking-[-0.05em] text-copy">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-7 text-copy-muted">{description}</p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-6 rounded-[1.65rem] border border-dashed border-border bg-white/5 px-5 py-10 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
        {icon}
      </div>
      <h3 className="mt-4 text-xl font-semibold text-copy">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-copy-muted">{body}</p>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const tone =
    method === "get"
      ? "bg-emerald-400/15 text-emerald-200"
      : method === "post"
        ? "bg-sky-400/15 text-sky-200"
        : method === "delete"
          ? "bg-red-400/15 text-red-200"
          : "bg-amber-400/15 text-amber-200";

  return (
    <span
      className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${tone}`}
    >
      {method}
    </span>
  );
}

function StrategyButton({
  active,
  title,
  body,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  body: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`panel-hover rounded-[1.45rem] border px-5 py-5 text-left ${
        active ? "border-accent/40 bg-accent-soft/90" : "border-border bg-white/5"
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center gap-3 text-sm font-semibold text-copy">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-accent">
          {icon}
        </span>
        {title}
      </div>
      <p className="mt-3 text-sm leading-7 text-copy-muted">{body}</p>
    </button>
  );
}

function DiffMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "text-[#bff7d1]"
      : tone === "bad"
        ? "text-[#ffd3e8]"
        : "text-copy";

  return (
    <div className="rounded-[1.25rem] border border-border bg-panel px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-copy-muted">
        {label}
      </div>
      <div className={`mt-3 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function DiffChangeList({
  title,
  items,
  emptyMessage,
  tone,
}: {
  title: string;
  items: RunHistoryDiff["regressions"];
  emptyMessage: string;
  tone: "good" | "bad";
}) {
  const toneClass = tone === "good" ? "text-[#bff7d1]" : "text-[#ffd3e8]";

  return (
    <div className="rounded-[1.35rem] border border-border bg-panel px-4 py-4">
      <p className="text-sm font-semibold text-copy">{title}</p>

      {items.length > 0 ? (
        <div className="mt-4 space-y-3">
          {items.slice(0, 4).map((item) => (
            <div
              className="rounded-[1.05rem] border border-border bg-white/5 px-3 py-3"
              key={`${item.testCaseId}-${item.previousStatus ?? "none"}-${item.currentStatus ?? "none"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <MethodBadge method={item.method} />
                <SourceBadge source={item.source} />
                {item.priority ? <PriorityBadge priority={item.priority} /> : null}
              </div>
              <p className="mt-3 text-sm font-semibold text-copy">{item.name}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-copy-muted">
                {item.path}
              </p>
              <p className={`mt-3 text-sm font-semibold ${toneClass}`}>
                {item.previousStatus ?? "missing"}
                {" -> "}
                {item.currentStatus ?? "missing"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm leading-7 text-copy-muted">{emptyMessage}</p>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: TestCaseSource }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${
        source === "hybrid"
          ? "border border-accent/25 bg-accent-soft text-accent"
          : "border border-border text-copy-muted"
      }`}
    >
      {source === "hybrid" ? "Hybrid" : "Deterministic"}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: RiskInsight["severity"] }) {
  const tone =
    severity === "critical"
      ? "border-danger/30 bg-danger/10 text-[#ffd0eb]"
      : severity === "high"
        ? "border-warning/30 bg-warning/10 text-[#f9deb1]"
        : severity === "medium"
          ? "border-accent/25 bg-accent-soft text-accent"
          : "border-border text-copy-muted";

  return (
    <span
      className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${tone}`}
    >
      {severity}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: HybridScenario["priority"] | NonNullable<TestCase["priority"]> }) {
  const tone =
    priority === "high"
      ? "border-warning/30 bg-warning/10 text-[#f9deb1]"
      : priority === "medium"
        ? "border-accent/25 bg-accent-soft text-accent"
        : "border-border text-copy-muted";

  return (
    <span
      className={`rounded-full border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${tone}`}
    >
      {priority} priority
    </span>
  );
}

function RiskInsightCard({ insight }: { insight: RiskInsight }) {
  return (
    <div className="rounded-[1.55rem] border border-border bg-white/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-copy">{insight.title}</p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-copy-muted">
            Operations: {insight.operationIds.join(", ")}
          </p>
        </div>
        <SeverityBadge severity={insight.severity} />
      </div>

      <p className="mt-3 text-sm leading-7 text-copy-muted">{insight.reasoning}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {insight.suggestedChecks.map((check) => (
          <span
            className="rounded-full border border-border px-3 py-2 text-xs text-copy-muted"
            key={check}
          >
            {check}
          </span>
        ))}
      </div>
    </div>
  );
}

function HybridScenarioCard({ scenario }: { scenario: HybridScenario }) {
  return (
    <div className="rounded-[1.45rem] border border-border bg-panel px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={scenario.priority} />
        <span className="rounded-full border border-accent/20 bg-accent-soft px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-accent">
          {scenario.source === "fallback"
            ? "Fallback-picked"
            : scenario.source === "gemini"
              ? "Gemini-picked"
              : "OpenAI-picked"}
        </span>
        <span className="rounded-full border border-border px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-copy-muted">
          {scenario.mutation.replace(/_/g, " ")}
        </span>
      </div>

      <p className="mt-3 text-sm font-semibold text-copy">{scenario.title}</p>
      <p className="mt-2 text-sm leading-7 text-copy-muted">{scenario.rationale}</p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-copy-muted">
        <span className="rounded-full border border-border px-3 py-2">
          Operation: {scenario.operationId}
        </span>
        {scenario.fieldPath ? (
          <span className="rounded-full border border-border px-3 py-2">
            Field: <span className="font-mono">{scenario.fieldPath}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TestResult["status"] }) {
  const labels = {
    pass: "Pass",
    fail: "Fail",
    error: "Error",
    skipped: "Skipped",
  } as const;

  const indicatorClass =
    status === "pass"
      ? "status-pass"
      : status === "fail"
        ? "status-fail"
        : status === "error"
          ? "status-error"
          : "status-skip";

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-copy">
      <span className={`status-dot ${indicatorClass}`} />
      {labels[status]}
    </span>
  );
}
