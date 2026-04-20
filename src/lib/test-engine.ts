import { generateOptionalAiMemo } from "@/lib/ai";
import { generateSampleValue } from "@/lib/openapi";
import type {
  ApiOperation,
  ApiParameter,
  AuthHint,
  CoverageSummary,
  NormalizedSpec,
  RunConfig,
  RunSummary,
  StrategyMode,
  TestCase,
  TestPlan,
  TestResult,
  TestStatus,
} from "@/lib/types";

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

    if (value !== undefined && value !== null) {
      result[parameter.name] = value as string | number | boolean;
    }
  }

  return result;
}

function getObjectKeys(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : [];
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
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

function buildFallbackRiskMemo(operations: ApiOperation[]) {
  const bullets: string[] = [];

  if (operations.some((operation) => operation.requestBody?.required)) {
    bullets.push(
      "Validation-heavy routes should be watched closely because malformed payloads are likely to surface the most user-visible defects.",
    );
  }

  if (operations.some((operation) => operation.requiresAuth)) {
    bullets.push(
      "Protected endpoints need explicit auth regression checks so valid traffic does not get blocked while negative tests still fail correctly.",
    );
  }

  if (operations.some((operation) => operation.path.includes("{"))) {
    bullets.push(
      "Identifier-based operations should prioritize 404 behavior, because broken resource lookups are common after schema or routing changes.",
    );
  }

  if (bullets.length === 0) {
    bullets.push(
      "Focus on response-shape consistency and latency thresholds, since the API surface is small enough that regressions will usually be contract-related.",
    );
  }

  return bullets.map((bullet) => `- ${bullet}`).join("\n");
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
  const testCases: TestCase[] = [];

  for (const operation of operations) {
    const happyPath = buildHappyPathCase(spec, operation);
    testCases.push(happyPath);

    const validation = createValidationCase(operation, happyPath);
    if (validation) {
      testCases.push(validation);
    }

    const authCase = createAuthCase(operation, happyPath);
    if (authCase) {
      testCases.push(authCase);
    }

    const notFoundCase = createNotFoundCase(operation, happyPath);
    if (notFoundCase) {
      testCases.push(notFoundCase);
    }
  }

  const coverage: CoverageSummary = {
    operationsCovered: operations.length,
    totalCases: testCases.length,
    categories: {
      happy: testCases.filter((testCase) => testCase.category === "happy").length,
      validation: testCases.filter((testCase) => testCase.category === "validation").length,
      auth: testCases.filter((testCase) => testCase.category === "auth").length,
      discovery: testCases.filter((testCase) => testCase.category === "discovery").length,
    },
  };

  if (strategy === "baseline") {
    return {
      selectedOperationIds: operationIds,
      testCases,
      coverage,
      riskMemoSource: "disabled",
    };
  }

  const operationSnapshot = operations
    .map(
      (operation) =>
        `- ${operation.method.toUpperCase()} ${operation.path}: ${operation.summary}; responses ${operation.responses
          .map((response) => response.status)
          .join(", ")}`,
    )
    .join("\n");

  const prompt = [
    "You are helping an API QA engineer prioritise risks.",
    "Write 4 short bullet points focused on likely regression risk in this API.",
    "Be specific, grounded in the operations below, and avoid generic advice.",
    "",
    `API: ${spec.metadata.title} v${spec.metadata.version}`,
    operationSnapshot,
  ].join("\n");

  const aiMemo = await generateOptionalAiMemo(prompt);

  return {
    selectedOperationIds: operationIds,
    testCases,
    coverage,
    riskMemo: aiMemo ?? buildFallbackRiskMemo(operations),
    riskMemoSource: aiMemo ? "openai" : "fallback",
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
            ? JSON.stringify(testCase.request.body)
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

function buildFailureTicket(testCase: TestCase | undefined, result: TestResult) {
  if (!testCase) {
    return null;
  }

  return [
    `### ${testCase.name}`,
    `- Endpoint: \`${testCase.method.toUpperCase()} ${testCase.path}\``,
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

  return [
    `# SpecPilot execution report`,
    "",
    `Generated at: ${timestamp}`,
    `API: ${spec.metadata.title} v${spec.metadata.version}`,
    "",
    `## Coverage snapshot`,
    `- Operations covered: ${plan.coverage.operationsCovered}`,
    `- Test cases: ${plan.coverage.totalCases}`,
    `- Happy paths: ${plan.coverage.categories.happy}`,
    `- Validation checks: ${plan.coverage.categories.validation}`,
    `- Auth checks: ${plan.coverage.categories.auth}`,
    `- Discovery checks: ${plan.coverage.categories.discovery}`,
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
    plan.riskMemo
      ? `## Risk memo (${plan.riskMemoSource})\n${plan.riskMemo}`
      : "## Risk memo\n- Risk memo was not generated for this run.",
    "",
    tickets.length > 0
      ? `## Suggested bug tickets\n${tickets.join("\n\n")}`
      : "## Suggested bug tickets\n- No failing tests were found in this run.",
    "",
    `## Detailed results`,
    detailBlocks.join("\n\n"),
  ].join("\n");
}
