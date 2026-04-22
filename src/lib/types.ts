import { z } from "zod";

export const httpMethods = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const;

export type HttpMethod = (typeof httpMethods)[number];

export const testCategoryValues = ["happy", "validation", "auth", "discovery"] as const;
export type TestCategory = (typeof testCategoryValues)[number];

export const testCaseSourceValues = ["deterministic", "hybrid"] as const;
export type TestCaseSource = (typeof testCaseSourceValues)[number];

export const testPackValues = ["security", "resilience"] as const;
export type TestPack = (typeof testPackValues)[number];

export const riskSeverityValues = ["critical", "high", "medium", "low"] as const;
export type RiskSeverity = (typeof riskSeverityValues)[number];

export const scenarioPriorityValues = ["high", "medium", "low"] as const;
export type ScenarioPriority = (typeof scenarioPriorityValues)[number];

export const hybridMutationValues = [
  "invalid_enum",
  "invalid_type",
  "boundary_violation",
  "unsupported_media_type",
  "nullability_violation",
  "unexpected_property",
  "auth_tamper",
] as const;
export type HybridMutationType = (typeof hybridMutationValues)[number];

export const hybridTargetLocationValues = ["body", "query", "contentType", "auth"] as const;
export type HybridTargetLocation = (typeof hybridTargetLocationValues)[number];

export const specLintCategoryValues = [
  "examples",
  "schema",
  "error_coverage",
  "security",
  "documentation",
] as const;
export type SpecLintCategory = (typeof specLintCategoryValues)[number];

export type JsonSchemaObject = {
  type?: string | string[];
  format?: string;
  description?: string;
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  nullable?: boolean;
  default?: unknown;
  example?: unknown;
  items?: JsonSchemaObject;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  oneOf?: JsonSchemaObject[];
  anyOf?: JsonSchemaObject[];
  allOf?: JsonSchemaObject[];
  additionalProperties?: boolean | JsonSchemaObject;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  $ref?: string;
};

export interface ApiSecurityScheme {
  name: string;
  type: string;
  in?: string;
  scheme?: string;
  description?: string;
}

export interface ApiParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  description?: string;
  required: boolean;
  schema?: JsonSchemaObject;
  example?: unknown;
}

export interface ApiRequestBody {
  required: boolean;
  contentType: string;
  description?: string;
  schema?: JsonSchemaObject;
  example?: unknown;
}

export interface ApiResponse {
  status: string;
  description?: string;
  contentType?: string;
  schema?: JsonSchemaObject;
}

export interface ApiOperation {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: ApiResponse[];
  securitySchemes: string[];
  requiresAuth: boolean;
}

export interface NormalizedSpec {
  metadata: {
    title: string;
    version: string;
    description?: string;
    servers: string[];
    format: "openapi" | "swagger";
    securitySchemes: ApiSecurityScheme[];
  };
  operations: ApiOperation[];
}

export interface AuthHint {
  placement: "header" | "query";
  name: string;
  prefix?: string;
}

export interface RequestBlueprint {
  pathParams: Record<string, string | number | boolean>;
  queryParams: Record<string, string | number | boolean>;
  headers: Record<string, string>;
  body?: unknown;
  contentType?: string;
  omitAuth?: boolean;
  authOverride?: {
    placement: "header" | "query";
    value: string;
    name?: string;
    prefix?: string;
  };
}

export interface TestCase {
  id: string;
  operationId: string;
  method: HttpMethod;
  path: string;
  name: string;
  category: TestCategory;
  rationale: string;
  expectedStatusPatterns: string[];
  request: RequestBlueprint;
  requiresAuth: boolean;
  authHint?: AuthHint;
  source: TestCaseSource;
  pack?: TestPack;
  priority?: ScenarioPriority;
  mutation?: HybridMutationType;
}

export interface CoverageSummary {
  operationsCovered: number;
  totalCases: number;
  categories: Record<TestCategory, number>;
  sources: Record<TestCaseSource, number>;
  packs: Record<TestPack, number>;
}

export type StrategyMode = "baseline" | "enhanced";
export const riskMemoSourceValues = ["gemini", "openai", "fallback", "disabled"] as const;
export type RiskMemoSource = (typeof riskMemoSourceValues)[number];

export interface RiskInsight {
  id: string;
  title: string;
  severity: RiskSeverity;
  reasoning: string;
  operationIds: string[];
  suggestedChecks: string[];
}

export interface SpecLintFinding {
  id: string;
  title: string;
  severity: RiskSeverity;
  category: SpecLintCategory;
  summary: string;
  suggestion: string;
  operationIds: string[];
}

export interface SpecLintSummary {
  score: number;
  totalFindings: number;
  bySeverity: Record<RiskSeverity, number>;
  byCategory: Record<SpecLintCategory, number>;
}

export interface HybridScenario {
  id: string;
  candidateId: string;
  operationId: string;
  title: string;
  rationale: string;
  mutation: HybridMutationType;
  category: TestCategory;
  priority: ScenarioPriority;
  location: HybridTargetLocation;
  fieldPath?: string;
  source: Exclude<RiskMemoSource, "disabled">;
  testCaseId: string;
}

export interface TestPlan {
  selectedOperationIds: string[];
  testCases: TestCase[];
  coverage: CoverageSummary;
  specLintSummary: SpecLintSummary;
  specLintFindings: SpecLintFinding[];
  planSummary?: string;
  riskMemo?: string;
  riskMemoSource: RiskMemoSource;
  riskInsights: RiskInsight[];
  hybridScenarios: HybridScenario[];
}

export interface RunConfig {
  baseUrl: string;
  authToken?: string;
  authHeaderName?: string;
  authPrefix?: string;
}

export const testStatusValues = ["pass", "fail", "error", "skipped"] as const;
export type TestStatus = "pass" | "fail" | "error" | "skipped";

export interface TestResult {
  testCaseId: string;
  operationId: string;
  status: TestStatus;
  requestUrl: string;
  method: HttpMethod;
  expectedStatusPatterns: string[];
  actualStatus?: number;
  latencyMs?: number;
  responsePreview?: string;
  contentType?: string;
  mismatchReason?: string;
}

export interface RunSummary {
  total: number;
  pass: number;
  fail: number;
  error: number;
  skipped: number;
  averageLatencyMs: number;
}

export interface RunHistoryCase {
  testCaseId: string;
  operationId: string;
  name: string;
  method: HttpMethod;
  path: string;
  category: TestCategory;
  source: TestCaseSource;
  pack?: TestPack;
  priority?: ScenarioPriority;
  mutation?: HybridMutationType;
  status: TestStatus;
  actualStatus?: number;
  expectedStatusPatterns: string[];
  latencyMs?: number;
}

export interface RunHistoryEntry {
  id: string;
  createdAt: string;
  apiTitle: string;
  apiVersion: string;
  strategy: StrategyMode;
  riskMemoSource: RiskMemoSource;
  baseUrl: string;
  selectedOperationIds: string[];
  coverage: CoverageSummary;
  summary: RunSummary;
  planSummary?: string;
  cases: RunHistoryCase[];
}

export interface RunHistoryCaseChange {
  testCaseId: string;
  name: string;
  method: HttpMethod;
  path: string;
  source: TestCaseSource;
  pack?: TestPack;
  priority?: ScenarioPriority;
  mutation?: HybridMutationType;
  previousStatus?: TestStatus;
  currentStatus?: TestStatus;
  previousActualStatus?: number;
  currentActualStatus?: number;
  previousLatencyMs?: number;
  currentLatencyMs?: number;
}

export interface RunHistoryDiff {
  baselineId: string;
  baselineCreatedAt: string;
  baselineLabel: string;
  totalDelta: number;
  passDelta: number;
  failDelta: number;
  errorDelta: number;
  skippedDelta: number;
  averageLatencyDeltaMs: number;
  changedCount: number;
  regressions: RunHistoryCaseChange[];
  recoveries: RunHistoryCaseChange[];
  addedCases: RunHistoryCaseChange[];
  removedCases: RunHistoryCaseChange[];
  statusChanges: RunHistoryCaseChange[];
}

export const analyzeSpecInputSchema = z.object({
  rawSpec: z.string().min(1, "Please paste an OpenAPI or Swagger document."),
});

export const generatePlanInputSchema = z.object({
  spec: z.custom<NormalizedSpec>(),
  selectedOperationIds: z.array(z.string()).default([]),
  strategy: z.enum(["baseline", "enhanced"]).default("baseline"),
});

export const runPlanInputSchema = z.object({
  spec: z.custom<NormalizedSpec>(),
  plan: z.custom<TestPlan>(),
  runConfig: z.object({
    baseUrl: z.string().trim(),
    authToken: z.string().optional(),
    authHeaderName: z.string().default("Authorization"),
    authPrefix: z.string().default("Bearer"),
  }),
});

export const reportInputSchema = z.object({
  spec: z.custom<NormalizedSpec>(),
  plan: z.custom<TestPlan>(),
  results: z.array(z.custom<TestResult>()),
  summary: z.custom<RunSummary>(),
});
