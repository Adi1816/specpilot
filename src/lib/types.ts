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
}

export interface CoverageSummary {
  operationsCovered: number;
  totalCases: number;
  categories: Record<TestCategory, number>;
}

export type StrategyMode = "baseline" | "enhanced";
export type RiskMemoSource = "openai" | "fallback" | "disabled";

export interface TestPlan {
  selectedOperationIds: string[];
  testCases: TestCase[];
  coverage: CoverageSummary;
  riskMemo?: string;
  riskMemoSource: RiskMemoSource;
}

export interface RunConfig {
  baseUrl: string;
  authToken?: string;
  authHeaderName?: string;
  authPrefix?: string;
}

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
