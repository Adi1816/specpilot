import { z } from "zod";
import { generateOptionalAiJson } from "@/lib/ai";
import { generateSampleValue } from "@/lib/openapi";
import type {
  ApiOperation,
  ApiParameter,
  AuthHint,
  CoverageSummary,
  HybridMutationType,
  HybridScenario,
  HybridTargetLocation,
  JsonSchemaObject,
  NormalizedSpec,
  RiskMemoSource,
  RiskInsight,
  RunConfig,
  RunSummary,
  ScenarioPriority,
  StrategyMode,
  TestCase,
  TestCategory,
  TestPlan,
  TestResult,
  TestStatus,
} from "@/lib/types";

type PathSegment = string | number;
type CandidateLocation = Extract<HybridTargetLocation, "body" | "query" | "contentType">;

interface SchemaPathMatch {
  segments: PathSegment[];
  schema: JsonSchemaObject;
  label: string;
}

interface ScenarioCandidate {
  id: string;
  operationId: string;
  title: string;
  rationale: string;
  category: TestCategory;
  mutation: HybridMutationType;
  location: CandidateLocation;
  fieldPath?: string;
  segments?: PathSegment[];
  schema?: JsonSchemaObject;
  expectedStatusPatterns: string[];
  score: number;
}

interface ScenarioSelection {
  candidateId: string;
  title: string;
  rationale: string;
  priority: ScenarioPriority;
  source: Exclude<RiskMemoSource, "disabled">;
}

interface HybridPlanningOutcome {
  planSummary: string;
  riskInsights: RiskInsight[];
  riskSource: Exclude<RiskMemoSource, "disabled">;
  selectedScenarios: ScenarioSelection[];
}

const aiHybridPlanSchema = z.object({
  planSummary: z.string().min(1).max(220),
  riskInsights: z.array(
    z.object({
      title: z.string().min(1).max(120),
      severity: z.enum(["critical", "high", "medium", "low"]),
      reasoning: z.string().min(1).max(260),
      operationIds: z.array(z.string().min(1)).min(1).max(6),
      suggestedChecks: z.array(z.string().min(1).max(120)).min(1).max(4),
    }),
  ).min(2).max(4),
  selectedScenarios: z.array(
    z.object({
      candidateId: z.string().min(1),
      title: z.string().min(1).max(120),
      rationale: z.string().min(1).max(220),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ).max(8).default([]),
});

type AiHybridPlan = z.infer<typeof aiHybridPlanSchema>;

function makeTestId(operation: ApiOperation, suffix: string) {
  return `${operation.method}-${operation.path}-${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pickPatterns(operation: ApiOperation, predicate: (status: string) => boolean, fallback: string[]) {
  const matched = operation.responses.map((response) => response.status).filter(predicate);
  return matched.length > 0 ? matched : fallback;
}

function createParameterMap(parameters: ApiParameter[], location: ApiParameter["in"]) {
  const result: Record<string, string | number | boolean> = {};

  for (const parameter of parameters.filter((entry) => entry.in === location)) {
    const value =
      parameter.example ??
      generateSampleValue(parameter.schema, parameter.name) ??
      (parameter.required ? parameter.name : undefined);

    if (
      value !== undefined &&
      value !== null &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    ) {
      result[parameter.name] = value;
    }
  }

  return result;
}

function getObjectKeys(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function normalizeSchemaType(schema: JsonSchemaObject | undefined) {
  if (!schema?.type) {
    return undefined;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.find((entry) => entry !== "null") ?? schema.type[0];
  }

  return schema.type;
}

function formatFieldPath(segments: PathSegment[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === "number") {
      return `${path}[${segment}]`;
    }

    return path ? `${path}.${segment}` : segment;
  }, "");
}

function findLastStringSegment(segments: PathSegment[]): string {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (typeof segment === "string") {
      return segment;
    }
  }

  return "field";
}

function walkSchemaFields(
  schema: JsonSchemaObject | undefined,
  predicate: (candidate: JsonSchemaObject, segments: PathSegment[]) => boolean,
  trail: PathSegment[] = [],
  depth = 0,
): SchemaPathMatch | null {
  if (!schema || depth > 4) {
    return null;
  }

  const type = normalizeSchemaType(schema);

  if ((type === "object" || schema.properties) && schema.properties) {
    for (const [name, value] of Object.entries(schema.properties)) {
      const nextTrail = [...trail, name];

      if (predicate(value, nextTrail)) {
        return {
          segments: nextTrail,
          schema: value,
          label: String(name),
        };
      }

      const nested = walkSchemaFields(value, predicate, nextTrail, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  if (type === "array" && schema.items) {
    const nextTrail = [...trail, 0];

    if (predicate(schema.items, nextTrail)) {
      return {
        segments: nextTrail,
        schema: schema.items,
        label: findLastStringSegment(nextTrail),
      };
    }

    return walkSchemaFields(schema.items, predicate, nextTrail, depth + 1);
  }

  return null;
}

function isEnumSchema(schema: JsonSchemaObject | undefined) {
  return Boolean(schema?.enum && schema.enum.length > 0);
}

function isBoundarySchema(schema: JsonSchemaObject | undefined) {
  const type = normalizeSchemaType(schema);
  if (!type || !schema) {
    return false;
  }

  if (type === "string") {
    return typeof schema.minLength === "number" || typeof schema.maxLength === "number";
  }

  if (type === "number" || type === "integer") {
    return typeof schema.minimum === "number" || typeof schema.maximum === "number";
  }

  return false;
}

function isScalarSchema(schema: JsonSchemaObject | undefined) {
  const type = normalizeSchemaType(schema);
  return type === "string" || type === "number" || type === "integer" || type === "boolean";
}

function detectAuthHint(spec: NormalizedSpec, operation: ApiOperation): AuthHint | undefined {
  const schemeName = operation.securitySchemes[0];
  const scheme = spec.metadata.securitySchemes.find((entry) => entry.name === schemeName);

  if (!scheme) {
    return operation.requiresAuth
      ? {
          placement: "header",
          name: "Authorization",
          prefix: "Bearer",
        }
      : undefined;
  }

  if (scheme.type === "http" && scheme.scheme === "bearer") {
    return {
      placement: "header",
      name: "Authorization",
      prefix: "Bearer",
    };
  }

  if (scheme.type === "apiKey" && scheme.in === "query") {
    return {
      placement: "query",
      name: scheme.name,
    };
  }

  return {
    placement: "header",
    name: scheme.in === "header" ? scheme.name : "Authorization",
    prefix: scheme.scheme === "bearer" ? "Bearer" : undefined,
  };
}

function buildHappyPathCase(spec: NormalizedSpec, operation: ApiOperation): TestCase {
  const authHint = detectAuthHint(spec, operation);
  const requestBody = operation.requestBody
    ? cloneValue(
        operation.requestBody.example ??
          generateSampleValue(operation.requestBody.schema, "payload"),
      )
    : undefined;

  return {
    id: makeTestId(operation, "happy"),
    operationId: operation.id,
    method: operation.method,
    path: operation.path,
    name: `${operation.summary} happy path`,
    category: "happy",
    rationale: "Confirms the main flow returns an expected success response for a valid request.",
    expectedStatusPatterns: pickPatterns(
      operation,
      (status) => /^2\d\d$/i.test(status) || /^[23]xx$/i.test(status),
      ["200"],
    ),
    request: {
      pathParams: createParameterMap(operation.parameters, "path"),
      queryParams: createParameterMap(operation.parameters, "query"),
      headers: Object.fromEntries(
        operation.parameters
          .filter((parameter) => parameter.in === "header")
          .map((parameter) => [
            parameter.name,
            String(parameter.example ?? generateSampleValue(parameter.schema, parameter.name) ?? "demo"),
          ]),
      ),
      body: requestBody,
      contentType: operation.requestBody?.contentType,
    },
    requiresAuth: operation.requiresAuth,
    authHint,
    source: "deterministic",
  };
}

function createValidationCase(operation: ApiOperation, happyPath: TestCase): TestCase | null {
  const expected = pickPatterns(
    operation,
    (status) => status === "400" || status === "422" || /^[45]xx$/i.test(status),
    ["400"],
  );

  const request = cloneValue(happyPath.request);
  const requiredBodyFields = operation.requestBody?.schema?.required ?? [];

  if (request.body && getObjectKeys(request.body).length > 0) {
    const fieldToRemove = requiredBodyFields[0] ?? getObjectKeys(request.body)[0];
    if (fieldToRemove && typeof request.body === "object" && request.body !== null) {
      delete (request.body as Record<string, unknown>)[fieldToRemove];
      return {
        ...happyPath,
        id: makeTestId(operation, "validation"),
        name: `${operation.summary} validation guard`,
        category: "validation",
        rationale: `Removes \`${fieldToRemove}\` to verify schema validation and helpful 4xx handling.`,
        expectedStatusPatterns: expected,
        request,
      };
    }
  }

  const requiredQuery = operation.parameters.find(
    (parameter) => parameter.in === "query" && parameter.required,
  );
  if (requiredQuery) {
    delete request.queryParams[requiredQuery.name];
    return {
      ...happyPath,
      id: makeTestId(operation, "validation"),
      name: `${operation.summary} missing ${requiredQuery.name}`,
      category: "validation",
      rationale: `Drops required query parameter \`${requiredQuery.name}\` to confirm 4xx behavior.`,
      expectedStatusPatterns: expected,
      request,
    };
  }

  return null;
}

function createAuthCase(operation: ApiOperation, happyPath: TestCase): TestCase | null {
  if (!operation.requiresAuth) {
    return null;
  }

  return {
    ...happyPath,
    id: makeTestId(operation, "auth"),
    name: `${operation.summary} unauthorized request`,
    category: "auth",
    rationale: "Ensures protected routes reject requests without valid credentials.",
    expectedStatusPatterns: pickPatterns(
      operation,
      (status) => status === "401" || status === "403" || /^[45]xx$/i.test(status),
      ["401"],
    ),
    request: {
      ...cloneValue(happyPath.request),
      omitAuth: true,
    },
  };
}

function createNotFoundCase(operation: ApiOperation, happyPath: TestCase): TestCase | null {
  const hasPathParams = Object.keys(happyPath.request.pathParams).length > 0;
  const hasNotFoundResponse = operation.responses.some((response) => response.status === "404");

  if (!hasPathParams || !hasNotFoundResponse) {
    return null;
  }

  const request = cloneValue(happyPath.request);
  const [firstParam] = Object.keys(request.pathParams);
  request.pathParams[firstParam] = `missing-${String(request.pathParams[firstParam])}`;

  return {
    ...happyPath,
    id: makeTestId(operation, "not-found"),
    name: `${operation.summary} resource lookup miss`,
    category: "discovery",
    rationale: "Uses a non-existent identifier to confirm missing-resource handling.",
    expectedStatusPatterns: ["404"],
    request,
  };
}

function buildCoverageSummary(operations: ApiOperation[], testCases: TestCase[]): CoverageSummary {
  return {
    operationsCovered: operations.length,
    totalCases: testCases.length,
    categories: {
      happy: testCases.filter((testCase) => testCase.category === "happy").length,
      validation: testCases.filter((testCase) => testCase.category === "validation").length,
      auth: testCases.filter((testCase) => testCase.category === "auth").length,
      discovery: testCases.filter((testCase) => testCase.category === "discovery").length,
    },
    sources: {
      deterministic: testCases.filter((testCase) => testCase.source === "deterministic").length,
      hybrid: testCases.filter((testCase) => testCase.source === "hybrid").length,
    },
  };
}

function buildValidationExpectedPatterns(operation: ApiOperation) {
  return pickPatterns(
    operation,
    (status) => status === "400" || status === "422" || /^[45]xx$/i.test(status),
    ["400"],
  );
}

function buildUnsupportedMediaExpectedPatterns(operation: ApiOperation) {
  return pickPatterns(
    operation,
    (status) => status === "415" || status === "400" || status === "422" || /^[45]xx$/i.test(status),
    ["415", "400"],
  );
}

function findQueryParameter(
  parameters: ApiParameter[],
  predicate: (parameter: ApiParameter) => boolean,
) {
  const queryParameters = parameters
    .filter((parameter) => parameter.in === "query")
    .sort((left, right) => Number(right.required) - Number(left.required));

  return queryParameters.find(predicate) ?? null;
}

function scoreCandidate(
  operation: ApiOperation,
  mutation: HybridMutationType,
  location: CandidateLocation,
) {
  const mutationWeight =
    mutation === "invalid_enum"
      ? 96
      : mutation === "boundary_violation"
        ? 90
        : mutation === "invalid_type"
          ? 84
          : 78;

  const methodWeight =
    operation.method === "post"
      ? 10
      : operation.method === "put" || operation.method === "patch"
        ? 8
        : operation.method === "delete"
          ? 6
          : 4;

  const bodyWeight = operation.requestBody?.required ? 4 : 0;
  const authWeight = operation.requiresAuth ? 4 : 0;
  const pathWeight = operation.path.includes("{") ? 3 : 0;
  const locationWeight = location === "body" ? 3 : location === "query" ? 2 : 1;

  return mutationWeight + methodWeight + bodyWeight + authWeight + pathWeight + locationWeight;
}

function buildBodyCandidate(
  operation: ApiOperation,
  mutation: Exclude<HybridMutationType, "unsupported_media_type">,
): ScenarioCandidate | null {
  const predicate =
    mutation === "invalid_enum"
      ? (schema: JsonSchemaObject) => isEnumSchema(schema)
      : mutation === "boundary_violation"
        ? (schema: JsonSchemaObject) => isBoundarySchema(schema)
        : (schema: JsonSchemaObject) => isScalarSchema(schema);

  const match = walkSchemaFields(
    operation.requestBody?.schema,
    (schema) => predicate(schema),
  );

  if (!match) {
    return null;
  }

  const fieldPath = formatFieldPath(match.segments);
  const label = fieldPath || match.label;

  return {
    id: makeTestId(operation, `hybrid-${mutation}-body-${label}`),
    operationId: operation.id,
    title:
      mutation === "invalid_enum"
        ? `${operation.summary} invalid enum guard`
        : mutation === "boundary_violation"
          ? `${operation.summary} contract boundary probe`
          : `${operation.summary} wrong-type rejection`,
    rationale:
      mutation === "invalid_enum"
        ? `Pushes \`${label}\` outside its documented enum to confirm out-of-contract values are rejected.`
        : mutation === "boundary_violation"
          ? `Violates the documented bounds on \`${label}\` to check contract enforcement before bad data reaches business logic.`
          : `Sends a mismatched type for \`${label}\` to verify schema coercion does not silently mask invalid payloads.`,
    category: "validation",
    mutation,
    location: "body",
    fieldPath,
    segments: match.segments,
    schema: match.schema,
    expectedStatusPatterns: buildValidationExpectedPatterns(operation),
    score: scoreCandidate(operation, mutation, "body"),
  };
}

function buildQueryCandidate(
  operation: ApiOperation,
  mutation: Exclude<HybridMutationType, "unsupported_media_type">,
): ScenarioCandidate | null {
  const parameter = findQueryParameter(operation.parameters, (entry) => {
    if (mutation === "invalid_enum") {
      return isEnumSchema(entry.schema);
    }

    if (mutation === "boundary_violation") {
      return isBoundarySchema(entry.schema);
    }

    return isScalarSchema(entry.schema);
  });

  if (!parameter) {
    return null;
  }

  return {
    id: makeTestId(operation, `hybrid-${mutation}-query-${parameter.name}`),
    operationId: operation.id,
    title:
      mutation === "invalid_enum"
        ? `${operation.summary} invalid query enum`
        : mutation === "boundary_violation"
          ? `${operation.summary} query boundary probe`
          : `${operation.summary} query type mismatch`,
    rationale:
      mutation === "invalid_enum"
        ? `Breaks the allowed enum for query parameter \`${parameter.name}\` to confirm contract validation at the edge.`
        : mutation === "boundary_violation"
          ? `Violates the declared bounds for query parameter \`${parameter.name}\` to ensure filtering and pagination inputs stay contract-safe.`
          : `Sends a deliberately wrong type for query parameter \`${parameter.name}\` to verify the route rejects malformed input early.`,
    category: "validation",
    mutation,
    location: "query",
    fieldPath: parameter.name,
    schema: parameter.schema,
    expectedStatusPatterns: buildValidationExpectedPatterns(operation),
    score: scoreCandidate(operation, mutation, "query"),
  };
}

function buildUnsupportedMediaCandidate(operation: ApiOperation): ScenarioCandidate | null {
  if (!operation.requestBody || operation.method === "get" || operation.method === "head") {
    return null;
  }

  return {
    id: makeTestId(operation, "hybrid-unsupported-media"),
    operationId: operation.id,
    title: `${operation.summary} content-type guard`,
    rationale: "Switches the request to an unsupported media type to make sure the endpoint does not accept malformed transport envelopes.",
    category: "validation",
    mutation: "unsupported_media_type",
    location: "contentType",
    expectedStatusPatterns: buildUnsupportedMediaExpectedPatterns(operation),
    score: scoreCandidate(operation, "unsupported_media_type", "contentType"),
  };
}

function buildHybridCandidates(operation: ApiOperation) {
  const candidates = [
    buildBodyCandidate(operation, "invalid_enum"),
    buildBodyCandidate(operation, "boundary_violation"),
    buildBodyCandidate(operation, "invalid_type"),
    buildQueryCandidate(operation, "invalid_enum"),
    buildQueryCandidate(operation, "boundary_violation"),
    buildQueryCandidate(operation, "invalid_type"),
    buildUnsupportedMediaCandidate(operation),
  ].filter((candidate): candidate is ScenarioCandidate => Boolean(candidate));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) {
      return false;
    }

    seen.add(candidate.id);
    return true;
  });
}

function takeOperationIds(operations: ApiOperation[], limit = 3) {
  return [...new Set(operations.map((operation) => operation.id))].slice(0, limit);
}

function takeOperationIdsFromCandidates(
  candidates: ScenarioCandidate[],
  predicate: (candidate: ScenarioCandidate) => boolean,
  limit = 3,
) {
  return [
    ...new Set(candidates.filter(predicate).map((candidate) => candidate.operationId)),
  ].slice(0, limit);
}

function createRiskInsight(
  id: string,
  title: string,
  severity: RiskInsight["severity"],
  reasoning: string,
  operationIds: string[],
  suggestedChecks: string[],
): RiskInsight {
  return {
    id,
    title,
    severity,
    reasoning,
    operationIds,
    suggestedChecks,
  };
}

function buildFallbackRiskInsights(operations: ApiOperation[], candidates: ScenarioCandidate[]) {
  const insights: RiskInsight[] = [];

  const writeOperations = operations.filter((operation) =>
    operation.method === "post" ||
    operation.method === "put" ||
    operation.method === "patch" ||
    operation.method === "delete",
  );

  if (
    candidates.some(
      (candidate) =>
        candidate.mutation === "invalid_enum" ||
        candidate.mutation === "boundary_violation" ||
        candidate.mutation === "invalid_type",
    )
  ) {
    insights.push(
      createRiskInsight(
        "contract-validation",
        "Contract validation drift",
        writeOperations.length > 0 ? "high" : "medium",
        "Typed request surfaces are the fastest path to visible regressions, especially when enums, bounds, or scalar types silently loosen after backend changes.",
        takeOperationIdsFromCandidates(
          candidates,
          (candidate) => candidate.location === "body" || candidate.location === "query",
        ).length > 0
          ? takeOperationIdsFromCandidates(
              candidates,
              (candidate) => candidate.location === "body" || candidate.location === "query",
            )
          : takeOperationIds(operations),
        [
          "Probe out-of-contract enum values",
          "Push numeric and string bounds",
          "Send wrong scalar types on critical inputs",
        ],
      ),
    );
  }

  if (operations.some((operation) => operation.requiresAuth)) {
    insights.push(
      createRiskInsight(
        "auth-guardrails",
        "Protected-route auth guardrails",
        "high",
        "Protected endpoints need tight auth rejection paths so healthy traffic is allowed while missing or malformed credentials still fail cleanly.",
        takeOperationIds(operations.filter((operation) => operation.requiresAuth)),
        [
          "Keep unauthorized requests failing fast",
          "Verify auth headers are not over-trusted",
        ],
      ),
    );
  }

  if (writeOperations.length > 0) {
    insights.push(
      createRiskInsight(
        "mutation-safety",
        "Mutation safety on write flows",
        "high",
        "Create, update, and delete routes are where schema drift becomes data corruption, so their negative coverage should stay intentionally stronger than simple read routes.",
        takeOperationIds(writeOperations),
        [
          "Stress invalid payload shapes on write routes",
          "Reject malformed transport envelopes before business logic",
        ],
      ),
    );
  }

  if (operations.some((operation) => operation.path.includes("{"))) {
    insights.push(
      createRiskInsight(
        "resource-addressing",
        "Resource addressing reliability",
        "medium",
        "Identifier-based routes are sensitive to routing, lookup, and stale-reference issues, so negative path handling remains a common source of production bugs.",
        takeOperationIds(operations.filter((operation) => operation.path.includes("{"))),
        [
          "Exercise malformed and stale identifiers",
          "Keep 404 and 4xx responses contract-aligned",
        ],
      ),
    );
  }

  if (insights.length === 0) {
    insights.push(
      createRiskInsight(
        "response-consistency",
        "Response consistency across the surface",
        "medium",
        "The selected API surface is compact, so the most likely regressions are still contract mismatches rather than deep orchestration failures.",
        takeOperationIds(operations),
        [
          "Watch response shape consistency",
          "Track latency outliers alongside status mismatches",
        ],
      ),
    );
  }

  return insights.slice(0, 4);
}

function priorityFromScore(score: number): ScenarioPriority {
  if (score >= 96) {
    return "high";
  }

  if (score >= 86) {
    return "medium";
  }

  return "low";
}

function rankCandidates(candidates: ScenarioCandidate[]) {
  return [...candidates].sort((left, right) => right.score - left.score);
}

function selectFallbackScenarios(candidates: ScenarioCandidate[], limit: number): ScenarioSelection[] {
  const ranked = rankCandidates(candidates);
  const selected: ScenarioCandidate[] = [];
  const selectedIds = new Set<string>();
  const representedOperations = new Set<string>();

  for (const candidate of ranked) {
    if (selected.length >= limit) {
      break;
    }

    if (representedOperations.has(candidate.operationId)) {
      continue;
    }

    selected.push(candidate);
    selectedIds.add(candidate.id);
    representedOperations.add(candidate.operationId);
  }

  for (const candidate of ranked) {
    if (selected.length >= limit) {
      break;
    }

    if (selectedIds.has(candidate.id)) {
      continue;
    }

    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  return selected.map((candidate) => ({
    candidateId: candidate.id,
    title: candidate.title,
    rationale: candidate.rationale,
    priority: priorityFromScore(candidate.score),
    source: "fallback",
  }));
}

function sanitizeRiskInsights(
  aiInsights: AiHybridPlan["riskInsights"],
  validOperationIds: Set<string>,
  fallbackOperationIds: string[],
) {
  return aiInsights.map((insight, index) => {
    const operationIds = [
      ...new Set(insight.operationIds.filter((operationId) => validOperationIds.has(operationId))),
    ];

    return {
      id: `risk-${index + 1}`,
      title: insight.title.trim(),
      severity: insight.severity,
      reasoning: insight.reasoning.trim(),
      operationIds: operationIds.length > 0 ? operationIds : fallbackOperationIds,
      suggestedChecks: [...new Set(insight.suggestedChecks.map((entry) => entry.trim()).filter(Boolean))].slice(0, 4),
    } satisfies RiskInsight;
  });
}

function sanitizeAiScenarioSelections(
  aiSelections: AiHybridPlan["selectedScenarios"],
  candidateLookup: Map<string, ScenarioCandidate>,
) {
  const selectedIds = new Set<string>();
  const selections: ScenarioSelection[] = [];

  for (const selection of aiSelections) {
    if (!candidateLookup.has(selection.candidateId) || selectedIds.has(selection.candidateId)) {
      continue;
    }

    selectedIds.add(selection.candidateId);
    selections.push({
      candidateId: selection.candidateId,
      title: selection.title.trim(),
      rationale: selection.rationale.trim(),
      priority: selection.priority,
      source: "gemini",
    });
  }

  return selections;
}

function buildHybridPrompt(
  spec: NormalizedSpec,
  operations: ApiOperation[],
  candidates: ScenarioCandidate[],
  limit: number,
) {
  const rankedCandidates = rankCandidates(candidates).slice(0, Math.min(candidates.length, 20));
  const operationSnapshot = operations
    .map((operation) => {
      const auth = operation.requiresAuth ? "auth=required" : "auth=public";
      const responses = operation.responses.map((response) => response.status).join(", ");
      return `- ${operation.id}: ${operation.method.toUpperCase()} ${operation.path}; ${operation.summary}; ${auth}; responses=${responses}`;
    })
    .join("\n");

  const candidateSnapshot = rankedCandidates
    .map((candidate) => {
      const field = candidate.fieldPath ? `; field=${candidate.fieldPath}` : "";
      return `- ${candidate.id}: operation=${candidate.operationId}; mutation=${candidate.mutation}; location=${candidate.location}${field}; default_title=${candidate.title}`;
    })
    .join("\n");

  return [
    "You are a senior API QA planner.",
    "The deterministic contract parser has already created the core suite.",
    "Your job is to prioritise the most valuable additional edge cases from the candidate list only.",
    `Choose at most ${limit} candidateIds.`,
    "Return only one JSON object with this exact shape:",
    '{"planSummary":"string","riskInsights":[{"title":"string","severity":"critical|high|medium|low","reasoning":"string","operationIds":["operationId"],"suggestedChecks":["short check"]}],"selectedScenarios":[{"candidateId":"candidateId","title":"string","rationale":"string","priority":"high|medium|low"}]}',
    "Rules:",
    "- Use only the provided operationIds and candidateIds.",
    "- Keep the planSummary to one sentence.",
    "- Focus on materially different risks, not minor variations of the same test.",
    "- Keep the language concise, grounded, and specific to the contract.",
    "",
    `API: ${spec.metadata.title} v${spec.metadata.version}`,
    "",
    "Operations:",
    operationSnapshot,
    "",
    "Candidate edge cases:",
    candidateSnapshot,
  ].join("\n");
}

async function planHybridCoverage(
  spec: NormalizedSpec,
  operations: ApiOperation[],
  candidates: ScenarioCandidate[],
): Promise<HybridPlanningOutcome> {
  const limit = Math.min(Math.max(operations.length + 1, 2), 6, Math.max(candidates.length, 1));
  const fallbackSelections = selectFallbackScenarios(candidates, limit);
  const fallbackInsights = buildFallbackRiskInsights(operations, candidates);
  const candidateLookup = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const validOperationIds = new Set(operations.map((operation) => operation.id));
  const fallbackOperationIds = takeOperationIds(operations, 1);

  if (candidates.length === 0) {
    return {
      planSummary:
        "The deterministic core already covers the highest-signal contract paths, so no additional hybrid edge cases were promoted from this selection.",
      riskInsights: fallbackInsights,
      riskSource: "fallback",
      selectedScenarios: [],
    };
  }

  const aiPlan = await generateOptionalAiJson({
    prompt: buildHybridPrompt(spec, operations, candidates, limit),
    schema: aiHybridPlanSchema,
    label: "hybrid planner",
  });

  if (!aiPlan) {
    return {
      planSummary:
        "SpecPilot used deterministic risk ranking to expand the suite because the AI planner was unavailable for this run.",
      riskInsights: fallbackInsights,
      riskSource: "fallback",
      selectedScenarios: fallbackSelections,
    };
  }

  const selectedScenarios = sanitizeAiScenarioSelections(aiPlan.selectedScenarios, candidateLookup);

  return {
    planSummary: aiPlan.planSummary.trim(),
    riskInsights: sanitizeRiskInsights(aiPlan.riskInsights, validOperationIds, fallbackOperationIds),
    riskSource: "gemini",
    selectedScenarios: selectedScenarios.length > 0 ? selectedScenarios : fallbackSelections,
  };
}

function formatRiskProviderName(source: TestPlan["riskMemoSource"]) {
  if (source === "gemini") {
    return "Gemini";
  }

  if (source === "openai") {
    return "OpenAI";
  }

  return "deterministic fallback";
}

function composePlanSummary(
  baseSummary: string,
  coreCount: number,
  operationsCovered: number,
  candidateCount: number,
  addedCount: number,
  riskSource: TestPlan["riskMemoSource"],
  strategy: StrategyMode,
) {
  const parts = [baseSummary.trim().replace(/\.+$/, "")];

  parts.push(
    `The deterministic core covers ${coreCount} runnable case${coreCount === 1 ? "" : "s"} across ${operationsCovered} operation${operationsCovered === 1 ? "" : "s"}.`,
  );

  if (strategy === "baseline") {
    parts.push("Baseline mode keeps prioritisation fully deterministic and leaves AI guidance turned off.");
    return parts.join(" ");
  }

  if (candidateCount === 0) {
    parts.push("No additional contract-derived hybrid candidates were available for the selected surface.");
  } else if (addedCount > 0) {
    parts.push(
      `SpecPilot promoted ${addedCount} higher-risk edge case${addedCount === 1 ? "" : "s"} from ${candidateCount} advanced contract candidates.`,
    );
  } else {
    parts.push("No additional hybrid edge cases were materialized, so execution stays on the deterministic core.");
  }

  parts.push(
    `Risk prioritisation source: ${formatRiskProviderName(riskSource)}.`,
  );

  return parts.join(" ");
}

function buildRiskMemo(planSummary: string, riskInsights: RiskInsight[]) {
  const bullets = riskInsights.map(
    (insight) => `- [${insight.severity.toUpperCase()}] ${insight.title}: ${insight.reasoning}`,
  );

  return [planSummary, "", ...bullets].join("\n").trim();
}

function buildEnumViolationValue(schema: JsonSchemaObject | undefined, fieldName: string) {
  const fallbackValue = generateSampleValue(schema, fieldName);
  const [firstEnum] = schema?.enum ?? [];

  if (typeof firstEnum === "string") {
    return `${firstEnum}_outside_contract`;
  }

  if (typeof firstEnum === "number") {
    return firstEnum + 999;
  }

  if (typeof firstEnum === "boolean") {
    return !firstEnum;
  }

  if (typeof fallbackValue === "string") {
    return `${fallbackValue}_outside_contract`;
  }

  if (typeof fallbackValue === "number") {
    return fallbackValue + 999;
  }

  if (typeof fallbackValue === "boolean") {
    return !fallbackValue;
  }

  return "outside_contract";
}

function buildBoundaryViolationValue(schema: JsonSchemaObject | undefined, fieldName: string) {
  const type = normalizeSchemaType(schema);

  if (type === "string") {
    if (typeof schema?.minLength === "number" && schema.minLength > 0) {
      return "x".repeat(Math.max(0, schema.minLength - 1));
    }

    if (typeof schema?.maxLength === "number") {
      return "x".repeat(schema.maxLength + 2);
    }
  }

  if (type === "integer" || type === "number") {
    if (typeof schema?.minimum === "number") {
      return type === "integer" ? Math.trunc(schema.minimum - 1) : schema.minimum - 0.5;
    }

    if (typeof schema?.maximum === "number") {
      return type === "integer" ? Math.trunc(schema.maximum + 1) : schema.maximum + 0.5;
    }
  }

  return typeof generateSampleValue(schema, fieldName) === "number" ? -1 : "";
}

function buildInvalidTypeValue(schema: JsonSchemaObject | undefined) {
  const type = normalizeSchemaType(schema);

  if (type === "string") {
    return 999;
  }

  if (type === "number" || type === "integer") {
    return "not-a-number";
  }

  if (type === "boolean") {
    return "not-a-boolean";
  }

  return "invalid-type";
}

function coerceQueryValue(value: unknown): string | number | boolean {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return JSON.stringify(value);
}

function getPathContainer(target: unknown, segments: PathSegment[]) {
  if (!target || segments.length === 0) {
    return null;
  }

  let cursor: unknown = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];

    if (typeof segment === "number") {
      if (!Array.isArray(cursor) || segment >= cursor.length) {
        return null;
      }

      cursor = cursor[segment];
      continue;
    }

    if (!isRecord(cursor) || !(segment in cursor)) {
      return null;
    }

    cursor = cursor[segment];
  }

  return {
    container: cursor,
    key: segments[segments.length - 1],
  };
}

function setValueAtPath(target: unknown, segments: PathSegment[], value: unknown) {
  const cursor = getPathContainer(target, segments);
  if (!cursor) {
    return false;
  }

  if (typeof cursor.key === "number") {
    if (!Array.isArray(cursor.container) || cursor.key >= cursor.container.length) {
      return false;
    }

    cursor.container[cursor.key] = value;
    return true;
  }

  if (!isRecord(cursor.container)) {
    return false;
  }

  cursor.container[cursor.key] = value;
  return true;
}

function materializeHybridTestCase(
  operation: ApiOperation,
  happyPath: TestCase,
  candidate: ScenarioCandidate,
  selection: ScenarioSelection,
): TestCase | null {
  const request = cloneValue(happyPath.request);

  switch (candidate.mutation) {
    case "invalid_enum": {
      const invalidValue = buildEnumViolationValue(candidate.schema, candidate.fieldPath ?? "field");

      if (candidate.location === "body") {
        if (!candidate.segments || request.body === undefined) {
          return null;
        }

        if (!setValueAtPath(request.body, candidate.segments, invalidValue)) {
          return null;
        }
      } else if (candidate.location === "query" && candidate.fieldPath) {
        request.queryParams[candidate.fieldPath] = coerceQueryValue(invalidValue);
      } else {
        return null;
      }

      break;
    }

    case "boundary_violation": {
      const boundaryValue = buildBoundaryViolationValue(candidate.schema, candidate.fieldPath ?? "field");

      if (candidate.location === "body") {
        if (!candidate.segments || request.body === undefined) {
          return null;
        }

        if (!setValueAtPath(request.body, candidate.segments, boundaryValue)) {
          return null;
        }
      } else if (candidate.location === "query" && candidate.fieldPath) {
        request.queryParams[candidate.fieldPath] = coerceQueryValue(boundaryValue);
      } else {
        return null;
      }

      break;
    }

    case "invalid_type": {
      const invalidTypeValue = buildInvalidTypeValue(candidate.schema);

      if (candidate.location === "body") {
        if (!candidate.segments || request.body === undefined) {
          return null;
        }

        if (!setValueAtPath(request.body, candidate.segments, invalidTypeValue)) {
          return null;
        }
      } else if (candidate.location === "query" && candidate.fieldPath) {
        request.queryParams[candidate.fieldPath] = coerceQueryValue(invalidTypeValue);
      } else {
        return null;
      }

      break;
    }

    case "unsupported_media_type": {
      request.contentType = "text/plain";
      request.body =
        typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body ?? { probe: "plain-text" });
      break;
    }
  }

  return {
    ...happyPath,
    id: makeTestId(
      operation,
      `hybrid-${candidate.mutation}-${candidate.location}-${candidate.fieldPath ?? candidate.id}`,
    ),
    name: selection.title,
    category: candidate.category,
    rationale: selection.rationale,
    expectedStatusPatterns: candidate.expectedStatusPatterns,
    request,
    source: "hybrid",
    priority: selection.priority,
    mutation: candidate.mutation,
  };
}

export async function generateTestPlan(
  spec: NormalizedSpec,
  selectedOperationIds: string[],
  strategy: StrategyMode,
): Promise<TestPlan> {
  const operationIds = selectedOperationIds.length > 0
    ? selectedOperationIds
    : spec.operations.map((operation) => operation.id);
  const operations = spec.operations.filter((operation) => operationIds.includes(operation.id));

  const deterministicCases: TestCase[] = [];
  const happyPathLookup = new Map<string, TestCase>();
  const hybridCandidates: ScenarioCandidate[] = [];

  for (const operation of operations) {
    const happyPath = buildHappyPathCase(spec, operation);
    deterministicCases.push(happyPath);
    happyPathLookup.set(operation.id, happyPath);

    const validation = createValidationCase(operation, happyPath);
    if (validation) {
      deterministicCases.push(validation);
    }

    const authCase = createAuthCase(operation, happyPath);
    if (authCase) {
      deterministicCases.push(authCase);
    }

    const notFoundCase = createNotFoundCase(operation, happyPath);
    if (notFoundCase) {
      deterministicCases.push(notFoundCase);
    }

    if (strategy === "enhanced") {
      hybridCandidates.push(...buildHybridCandidates(operation));
    }
  }

  const fallbackInsights = buildFallbackRiskInsights(operations, hybridCandidates);

  if (strategy === "baseline") {
    const planSummary = composePlanSummary(
      "Baseline planning locked the suite to contract-derived core coverage.",
      deterministicCases.length,
      operations.length,
      0,
      0,
      "disabled",
      strategy,
    );

    return {
      selectedOperationIds: operationIds,
      testCases: deterministicCases,
      coverage: buildCoverageSummary(operations, deterministicCases),
      planSummary,
      riskMemo: buildRiskMemo(planSummary, fallbackInsights),
      riskMemoSource: "disabled",
      riskInsights: fallbackInsights,
      hybridScenarios: [],
    };
  }

  const hybridPlan = await planHybridCoverage(spec, operations, hybridCandidates);
  const hybridScenarios: HybridScenario[] = [];
  const allTestCases = [...deterministicCases];
  const seenTestIds = new Set(allTestCases.map((testCase) => testCase.id));
  const candidateLookup = new Map(hybridCandidates.map((candidate) => [candidate.id, candidate]));

  for (const selection of hybridPlan.selectedScenarios) {
    const candidate = candidateLookup.get(selection.candidateId);
    if (!candidate) {
      continue;
    }

    const operation = operations.find((entry) => entry.id === candidate.operationId);
    const happyPath = happyPathLookup.get(candidate.operationId);

    if (!operation || !happyPath) {
      continue;
    }

    const hybridCase = materializeHybridTestCase(operation, happyPath, candidate, selection);
    if (!hybridCase || seenTestIds.has(hybridCase.id)) {
      continue;
    }

    seenTestIds.add(hybridCase.id);
    allTestCases.push(hybridCase);
    hybridScenarios.push({
      id: makeTestId(operation, `scenario-${candidate.id}`),
      candidateId: candidate.id,
      operationId: candidate.operationId,
      title: selection.title,
      rationale: selection.rationale,
      mutation: candidate.mutation,
      category: candidate.category,
      priority: selection.priority,
      location: candidate.location,
      fieldPath: candidate.fieldPath,
      source: selection.source,
      testCaseId: hybridCase.id,
    });
  }

  const planSummary = composePlanSummary(
    hybridPlan.planSummary,
    deterministicCases.length,
    operations.length,
    hybridCandidates.length,
    hybridScenarios.length,
    hybridPlan.riskSource,
    strategy,
  );

  return {
    selectedOperationIds: operationIds,
    testCases: allTestCases,
    coverage: buildCoverageSummary(operations, allTestCases),
    planSummary,
    riskMemo: buildRiskMemo(planSummary, hybridPlan.riskInsights),
    riskMemoSource: hybridPlan.riskSource,
    riskInsights: hybridPlan.riskInsights,
    hybridScenarios,
  };
}

function ensureTrailingSlash(url: string) {
  return url.endsWith("/") ? url : `${url}/`;
}

function buildRequestUrl(testCase: TestCase, runConfig: RunConfig) {
  const url = new URL(testCase.path.replace(/^\//, ""), ensureTrailingSlash(runConfig.baseUrl));

  for (const [name, value] of Object.entries(testCase.request.pathParams)) {
    url.pathname = url.pathname.replace(
      `{${name}}`,
      encodeURIComponent(String(value)),
    );
  }

  for (const [name, value] of Object.entries(testCase.request.queryParams)) {
    url.searchParams.set(name, String(value));
  }

  if (
    testCase.requiresAuth &&
    !testCase.request.omitAuth &&
    testCase.authHint?.placement === "query" &&
    runConfig.authToken
  ) {
    url.searchParams.set(testCase.authHint.name, runConfig.authToken);
  }

  return url;
}

function matchesExpectedStatus(expectedPatterns: string[], actualStatus: number) {
  if (expectedPatterns.length === 0) {
    return actualStatus >= 200 && actualStatus < 300;
  }

  return expectedPatterns.some((pattern) => {
    const normalized = pattern.toLowerCase();

    if (normalized === "default") {
      return true;
    }

    if (/^[1-5]xx$/.test(normalized)) {
      return Math.floor(actualStatus / 100) === Number(normalized[0]);
    }

    return /^\d{3}$/.test(normalized) ? actualStatus === Number(normalized) : false;
  });
}

function formatPreview(text: string, contentType: string | null) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "Empty response body";
  }

  if (contentType?.includes("application/json")) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2).slice(0, 1200);
    } catch {
      return trimmed.slice(0, 1200);
    }
  }

  return trimmed.slice(0, 1200);
}

function buildHeaders(testCase: TestCase, runConfig: RunConfig) {
  const headers = new Headers({
    Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    ...testCase.request.headers,
  });

  if (testCase.request.contentType && testCase.request.body !== undefined) {
    headers.set("Content-Type", testCase.request.contentType);
  }

  if (testCase.requiresAuth && !testCase.request.omitAuth && runConfig.authToken) {
    const hint = testCase.authHint;
    if (hint?.placement === "header") {
      const headerName = runConfig.authHeaderName?.trim() || hint.name;
      const prefix = runConfig.authPrefix?.trim() || hint.prefix;
      headers.set(headerName, prefix ? `${prefix} ${runConfig.authToken}` : runConfig.authToken);
    }
  }

  return headers;
}

async function runSingleTestCase(testCase: TestCase, runConfig: RunConfig): Promise<TestResult> {
  const needsToken = testCase.requiresAuth && !testCase.request.omitAuth;
  if (needsToken && !runConfig.authToken) {
    return {
      testCaseId: testCase.id,
      operationId: testCase.operationId,
      status: "skipped",
      requestUrl: buildRequestUrl(testCase, runConfig).toString(),
      method: testCase.method,
      expectedStatusPatterns: testCase.expectedStatusPatterns,
      mismatchReason: "Skipped because the endpoint needs an auth token and none was provided.",
    };
  }

  const requestUrl = buildRequestUrl(testCase, runConfig);
  const startedAt = performance.now();

  try {
    const response = await fetch(requestUrl, {
      method: testCase.method.toUpperCase(),
      headers: buildHeaders(testCase, runConfig),
      body:
        testCase.method === "get" || testCase.method === "head"
          ? undefined
          : testCase.request.body !== undefined
            ? typeof testCase.request.body === "string" && !testCase.request.contentType?.includes("json")
              ? testCase.request.body
              : JSON.stringify(testCase.request.body)
            : undefined,
      signal: AbortSignal.timeout(12_000),
    });

    const text = await response.text();
    const latencyMs = Math.round(performance.now() - startedAt);
    const passed = matchesExpectedStatus(testCase.expectedStatusPatterns, response.status);
    const status: TestStatus = passed ? "pass" : "fail";

    return {
      testCaseId: testCase.id,
      operationId: testCase.operationId,
      status,
      requestUrl: requestUrl.toString(),
      method: testCase.method,
      expectedStatusPatterns: testCase.expectedStatusPatterns,
      actualStatus: response.status,
      latencyMs,
      contentType: response.headers.get("content-type") ?? undefined,
      responsePreview: formatPreview(text, response.headers.get("content-type")),
      mismatchReason: passed
        ? undefined
        : `Expected ${testCase.expectedStatusPatterns.join(", ")} but received ${response.status}.`,
    };
  } catch (error) {
    return {
      testCaseId: testCase.id,
      operationId: testCase.operationId,
      status: "error",
      requestUrl: requestUrl.toString(),
      method: testCase.method,
      expectedStatusPatterns: testCase.expectedStatusPatterns,
      mismatchReason:
        error instanceof Error ? error.message : "Unknown network or execution error.",
    };
  }
}

export async function runTestPlan(spec: NormalizedSpec, plan: TestPlan, runConfig: RunConfig) {
  const baseUrl = runConfig.baseUrl.trim() || spec.metadata.servers[0];

  if (!baseUrl) {
    throw new Error("A base URL is required to execute the generated test plan.");
  }

  const normalizedConfig: RunConfig = {
    ...runConfig,
    baseUrl,
  };

  const results: TestResult[] = [];

  for (const testCase of plan.testCases) {
    results.push(await runSingleTestCase(testCase, normalizedConfig));
  }

  const timed = results.filter((result) => typeof result.latencyMs === "number");
  const summary: RunSummary = {
    total: results.length,
    pass: results.filter((result) => result.status === "pass").length,
    fail: results.filter((result) => result.status === "fail").length,
    error: results.filter((result) => result.status === "error").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    averageLatencyMs:
      timed.length > 0
        ? Math.round(
            timed.reduce((total, result) => total + (result.latencyMs ?? 0), 0) / timed.length,
          )
        : 0,
  };

  return {
    results,
    summary,
  };
}

function formatInsightSource(source: TestPlan["riskMemoSource"]) {
  if (source === "gemini") {
    return "gemini";
  }

  if (source === "openai") {
    return "openai (legacy)";
  }

  if (source === "fallback") {
    return "deterministic fallback";
  }

  return "baseline deterministic";
}

function buildFailureTicket(testCase: TestCase | undefined, result: TestResult) {
  if (!testCase) {
    return null;
  }

  return [
    `### ${testCase.name}`,
    `- Endpoint: \`${testCase.method.toUpperCase()} ${testCase.path}\``,
    `- Source: ${testCase.source === "hybrid" ? `hybrid ${testCase.mutation ?? "edge case"}` : "deterministic core"}`,
    `- Expected: ${testCase.expectedStatusPatterns.join(", ")}`,
    `- Actual: ${result.actualStatus ?? "no response"}`,
    `- Repro: ${result.requestUrl}`,
    `- Notes: ${result.mismatchReason ?? "Execution failed without a detailed mismatch reason."}`,
  ].join("\n");
}

export function buildMarkdownReport(
  spec: NormalizedSpec,
  plan: TestPlan,
  results: TestResult[],
  summary: RunSummary,
) {
  const timestamp = new Date().toISOString();
  const failingResults = results.filter((result) => result.status === "fail" || result.status === "error");
  const operationLookup = new Map(spec.operations.map((operation) => [operation.id, operation]));
  const testLookup = new Map(plan.testCases.map((testCase) => [testCase.id, testCase]));

  const detailBlocks = results.map((result) => {
    const testCase = testLookup.get(result.testCaseId);
    return [
      `### [${result.status.toUpperCase()}] ${testCase?.name ?? result.testCaseId}`,
      `- Request: \`${result.method.toUpperCase()} ${result.requestUrl}\``,
      `- Case source: ${testCase?.source === "hybrid" ? `hybrid ${testCase.mutation ?? "edge case"}` : "deterministic core"}`,
      `- Expected: ${result.expectedStatusPatterns.join(", ")}`,
      `- Actual: ${result.actualStatus ?? "no status"}`,
      `- Latency: ${result.latencyMs ?? 0} ms`,
      `- Reason: ${result.mismatchReason ?? "Matched the expected contract."}`,
      "",
      "```txt",
      result.responsePreview ?? "No response body captured.",
      "```",
    ].join("\n");
  });

  const tickets = failingResults
    .map((result) => buildFailureTicket(testLookup.get(result.testCaseId), result))
    .filter((ticket): ticket is string => Boolean(ticket));

  const selectedOps = plan.selectedOperationIds
    .map((operationId) => operationLookup.get(operationId))
    .filter((operation): operation is ApiOperation => Boolean(operation))
    .map((operation) => `- ${operation.method.toUpperCase()} ${operation.path} - ${operation.summary}`)
    .join("\n");

  const riskBlocks = plan.riskInsights.length > 0
    ? plan.riskInsights
      .map((insight) =>
        [
          `### ${insight.title} [${insight.severity}]`,
          `- Operations: ${insight.operationIds.join(", ")}`,
          `- Why it matters: ${insight.reasoning}`,
          ...insight.suggestedChecks.map((check) => `- Check: ${check}`),
        ].join("\n"),
      )
      .join("\n\n")
    : "- No structured risk insights were generated for this run.";

  const hybridBlocks = plan.hybridScenarios.length > 0
    ? plan.hybridScenarios
      .map(
        (scenario) =>
          `- ${scenario.title} (${scenario.priority}, ${scenario.source}) -> \`${scenario.mutation}\`${scenario.fieldPath ? ` on \`${scenario.fieldPath}\`` : ""}`,
      )
      .join("\n")
    : "- No hybrid edge cases were added to this run.";

  return [
    `# SpecPilot execution report`,
    "",
    `Generated at: ${timestamp}`,
    `API: ${spec.metadata.title} v${spec.metadata.version}`,
    "",
    `## Coverage snapshot`,
    `- Operations covered: ${plan.coverage.operationsCovered}`,
    `- Total test cases: ${plan.coverage.totalCases}`,
    `- Deterministic core cases: ${plan.coverage.sources.deterministic}`,
    `- Hybrid edge cases: ${plan.coverage.sources.hybrid}`,
    `- Happy paths: ${plan.coverage.categories.happy}`,
    `- Validation checks: ${plan.coverage.categories.validation}`,
    `- Auth checks: ${plan.coverage.categories.auth}`,
    `- Discovery checks: ${plan.coverage.categories.discovery}`,
    "",
    `## Planning summary`,
    `- ${plan.planSummary ?? "Planning summary unavailable."}`,
    `- Risk insight source: ${formatInsightSource(plan.riskMemoSource)}`,
    "",
    `## Run outcome`,
    `- Passed: ${summary.pass}`,
    `- Failed: ${summary.fail}`,
    `- Errors: ${summary.error}`,
    `- Skipped: ${summary.skipped}`,
    `- Average latency: ${summary.averageLatencyMs} ms`,
    "",
    `## Selected operations`,
    selectedOps || "- No operations selected",
    "",
    `## Structured risk insights`,
    riskBlocks,
    "",
    `## Hybrid edge cases`,
    hybridBlocks,
    "",
    tickets.length > 0
      ? `## Suggested bug tickets\n${tickets.join("\n\n")}`
      : "## Suggested bug tickets\n- No failing tests were found in this run.",
    "",
    `## Detailed results`,
    detailBlocks.join("\n\n"),
  ].join("\n");
}
