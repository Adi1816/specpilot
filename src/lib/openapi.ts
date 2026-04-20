import YAML from "yaml";
import {
  httpMethods,
  type ApiOperation,
  type ApiParameter,
  type ApiRequestBody,
  type ApiResponse,
  type ApiSecurityScheme,
  type HttpMethod,
  type JsonSchemaObject,
  type NormalizedSpec,
} from "@/lib/types";

type UnknownRecord = Record<string, unknown>;
type InternalParameter = Omit<ApiParameter, "in"> & {
  in: ApiParameter["in"] | "body";
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function resolveJsonPointer(document: UnknownRecord, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    return undefined;
  }

  const segments = ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

  let cursor: unknown = document;
  for (const segment of segments) {
    if (!isRecord(cursor) || !(segment in cursor)) {
      return undefined;
    }
    cursor = cursor[segment];
  }

  return cursor;
}

function resolveSchema(
  document: UnknownRecord,
  rawSchema: unknown,
  trail = new Set<string>(),
): JsonSchemaObject | undefined {
  if (!isRecord(rawSchema)) {
    return undefined;
  }

  if (typeof rawSchema.$ref === "string") {
    if (trail.has(rawSchema.$ref)) {
      return {
        type: "object",
        description: `Circular reference detected for ${rawSchema.$ref}.`,
      };
    }

    const nextTrail = new Set(trail);
    nextTrail.add(rawSchema.$ref);
    return resolveSchema(document, resolveJsonPointer(document, rawSchema.$ref), nextTrail);
  }

  if (Array.isArray(rawSchema.allOf) && rawSchema.allOf.length > 0) {
    const merged: JsonSchemaObject = {
      type: "object",
      properties: {},
      required: [],
    };

    for (const item of rawSchema.allOf) {
      const resolved = resolveSchema(document, item, trail);
      if (!resolved) {
        continue;
      }

      if (resolved.type && !merged.type) {
        merged.type = resolved.type;
      }

      if (resolved.description && !merged.description) {
        merged.description = resolved.description;
      }

      if (resolved.properties) {
        merged.properties = {
          ...merged.properties,
          ...resolved.properties,
        };
      }

      if (resolved.required) {
        merged.required = [...new Set([...(merged.required ?? []), ...resolved.required])];
      }
    }

    return merged;
  }

  if (Array.isArray(rawSchema.oneOf) && rawSchema.oneOf.length > 0) {
    return resolveSchema(document, rawSchema.oneOf[0], trail);
  }

  if (Array.isArray(rawSchema.anyOf) && rawSchema.anyOf.length > 0) {
    return resolveSchema(document, rawSchema.anyOf[0], trail);
  }

  return structuredClone(rawSchema) as JsonSchemaObject;
}

function normalizeType(type: string | string[] | undefined) {
  if (Array.isArray(type)) {
    return type.find((entry) => entry !== "null") ?? type[0];
  }

  return type;
}

function generateStringSample(schema: JsonSchemaObject, name: string) {
  if (typeof schema.example === "string") {
    return schema.example;
  }

  if (typeof schema.default === "string") {
    return schema.default;
  }

  if (Array.isArray(schema.enum) && typeof schema.enum[0] === "string") {
    return schema.enum[0];
  }

  const lowerName = name.toLowerCase();
  switch (schema.format) {
    case "email":
      return "pilot@example.com";
    case "uuid":
      return "550e8400-e29b-41d4-a716-446655440000";
    case "date":
      return "2026-04-20";
    case "date-time":
      return "2026-04-20T12:00:00.000Z";
    case "uri":
    case "url":
      return "https://example.com/resource";
    default:
      break;
  }

  if (lowerName.includes("order")) {
    return "ord_demo_001";
  }

  if (lowerName.includes("id")) {
    return "demo-id-001";
  }

  if (lowerName.includes("token")) {
    return "token-demo-123";
  }

  if (lowerName.includes("status")) {
    return "active";
  }

  return `sample_${lowerName || "value"}`;
}

export function generateSampleValue(
  schema: JsonSchemaObject | undefined,
  propertyName = "value",
  depth = 0,
): unknown {
  if (!schema || depth > 4) {
    return null;
  }

  if (schema.example !== undefined) {
    return schema.example;
  }

  if (schema.default !== undefined) {
    return schema.default;
  }

  if (schema.const !== undefined) {
    return schema.const;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generateSampleValue(schema.oneOf[0], propertyName, depth + 1);
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return generateSampleValue(schema.anyOf[0], propertyName, depth + 1);
  }

  const type = normalizeType(schema.type);

  switch (type) {
    case "boolean":
      return true;
    case "integer":
      return propertyName.toLowerCase().includes("quantity") ? 1 : 101;
    case "number":
      return schema.minimum ?? 49.99;
    case "array":
      return [generateSampleValue(schema.items, `${propertyName}_item`, depth + 1)];
    case "object": {
      const result: Record<string, unknown> = {};
      const properties = schema.properties ?? {};
      const required = new Set(schema.required ?? Object.keys(properties).slice(0, 3));

      for (const [name, value] of Object.entries(properties)) {
        if (!required.has(name) && Object.keys(result).length >= 3) {
          continue;
        }

        result[name] = generateSampleValue(value, name, depth + 1);
      }

      return result;
    }
    case "string":
    default:
      return generateStringSample(schema, propertyName);
  }
}

function normalizeParameter(
  document: UnknownRecord,
  rawParameter: unknown,
): InternalParameter | null {
  const parameter = toRecord(
    isRecord(rawParameter) && typeof rawParameter.$ref === "string"
      ? resolveJsonPointer(document, rawParameter.$ref)
      : rawParameter,
  );

  if (!parameter) {
    return null;
  }

  const location = parameter.in;
  if (
    location !== "query" &&
    location !== "path" &&
    location !== "header" &&
    location !== "cookie" &&
    location !== "body"
  ) {
    return null;
  }

  const schema =
    resolveSchema(document, parameter.schema) ??
    resolveSchema(document, {
      type: parameter.type,
      format: parameter.format,
      enum: parameter.enum,
      items: parameter.items,
    });

  return {
    name: typeof parameter.name === "string" ? parameter.name : "value",
    in: location,
    description: typeof parameter.description === "string" ? parameter.description : undefined,
    required: Boolean(parameter.required) || location === "path",
    schema,
    example:
      parameter.example ??
      (isRecord(parameter.examples)
        ? Object.values(parameter.examples).find((item) => isRecord(item) && "value" in item)
        : undefined),
  };
}

function normalizeParameters(document: UnknownRecord, rawParameters: unknown): InternalParameter[] {
  if (!Array.isArray(rawParameters)) {
    return [];
  }

  const parameters: InternalParameter[] = [];
  for (const parameter of rawParameters) {
    const normalized = normalizeParameter(document, parameter);
    if (normalized) {
      parameters.push(normalized);
    }
  }

  const deduped = new Map<string, InternalParameter>();

  for (const parameter of parameters) {
    deduped.set(`${parameter.in}:${parameter.name}`, parameter);
  }

  return [...deduped.values()];
}

function extractRequestBody(
  document: UnknownRecord,
  operation: UnknownRecord,
  parameters: InternalParameter[],
  format: "openapi" | "swagger",
): ApiRequestBody | undefined {
  if (format === "swagger") {
    const bodyParameter = parameters.find((parameter) => parameter.in === "body");
    if (!bodyParameter) {
      return undefined;
    }

    return {
      required: bodyParameter.required,
      contentType: "application/json",
      description: bodyParameter.description,
      schema: bodyParameter.schema,
      example:
        bodyParameter.example ?? generateSampleValue(bodyParameter.schema, bodyParameter.name),
    };
  }

  const requestBody = toRecord(
    isRecord(operation.requestBody) && typeof operation.requestBody.$ref === "string"
      ? resolveJsonPointer(document, operation.requestBody.$ref)
      : operation.requestBody,
  );

  if (!requestBody) {
    return undefined;
  }

  const content = toRecord(requestBody.content);
  if (!content) {
    return undefined;
  }

  const preferredType =
    (["application/json", "application/merge-patch+json"] as const).find((type) => type in content) ??
    Object.keys(content)[0];

  if (!preferredType) {
    return undefined;
  }

  const selected = toRecord(content[preferredType]);
  const schema = resolveSchema(document, selected?.schema);

  return {
    required: Boolean(requestBody.required),
    contentType: preferredType,
    description: typeof requestBody.description === "string" ? requestBody.description : undefined,
    schema,
    example:
      selected?.example ??
      generateSampleValue(schema, preferredType.includes("json") ? "payload" : "body"),
  };
}

function extractResponses(
  document: UnknownRecord,
  rawResponses: unknown,
  format: "openapi" | "swagger",
): ApiResponse[] {
  const responses = toRecord(rawResponses);
  if (!responses) {
    return [];
  }

  const normalized: ApiResponse[] = [];

  for (const [status, rawResponse] of Object.entries(responses)) {
    const response = toRecord(
      isRecord(rawResponse) && typeof rawResponse.$ref === "string"
        ? resolveJsonPointer(document, rawResponse.$ref)
        : rawResponse,
    );

    if (!response) {
      continue;
    }

    if (format === "swagger") {
      normalized.push({
        status,
        description: typeof response.description === "string" ? response.description : undefined,
        contentType: "application/json",
        schema: resolveSchema(document, response.schema),
      });
      continue;
    }

    const content = toRecord(response.content);
    const preferredType =
      content &&
      ((["application/json", "application/problem+json"] as const).find((type) => type in content) ??
        Object.keys(content)[0]);
    const selected = preferredType && content ? toRecord(content[preferredType]) : undefined;

    normalized.push({
      status,
      description: typeof response.description === "string" ? response.description : undefined,
      contentType: preferredType,
      schema: resolveSchema(document, selected?.schema),
    });
  }

  return normalized;
}

function extractSecuritySchemes(
  document: UnknownRecord,
  format: "openapi" | "swagger",
): ApiSecurityScheme[] {
  const schemesSource =
    format === "swagger"
      ? toRecord(document.securityDefinitions)
      : toRecord(toRecord(document.components)?.securitySchemes);

  if (!schemesSource) {
    return [];
  }

  const normalized: ApiSecurityScheme[] = [];

  for (const [name, rawScheme] of Object.entries(schemesSource)) {
    const scheme = toRecord(rawScheme);
    if (!scheme || typeof scheme.type !== "string") {
      continue;
    }

    normalized.push({
      name,
      type: scheme.type,
      in: typeof scheme.in === "string" ? scheme.in : undefined,
      scheme: typeof scheme.scheme === "string" ? scheme.scheme : undefined,
      description: typeof scheme.description === "string" ? scheme.description : undefined,
    });
  }

  return normalized;
}

function normalizeSecurityRequirements(rawSecurity: unknown) {
  if (!Array.isArray(rawSecurity)) {
    return [];
  }

  const names = rawSecurity.flatMap((entry) =>
    isRecord(entry) ? Object.keys(entry).filter((name) => typeof name === "string") : [],
  );

  return [...new Set(names)];
}

function inferServers(document: UnknownRecord, format: "openapi" | "swagger") {
  if (format === "openapi") {
    const servers = Array.isArray(document.servers) ? document.servers : [];
    return servers
      .map((server) => (isRecord(server) && typeof server.url === "string" ? server.url : null))
      .filter((server): server is string => Boolean(server));
  }

  const host = typeof document.host === "string" ? document.host : undefined;
  if (!host) {
    return [];
  }

  const basePath = typeof document.basePath === "string" ? document.basePath : "";
  const schemes = toStringArray(document.schemes);
  const supportedSchemes = schemes.length > 0 ? schemes : ["https"];

  return supportedSchemes.map((scheme) => `${scheme}://${host}${basePath}`);
}

function inferOperationId(operation: UnknownRecord, method: HttpMethod, path: string) {
  if (typeof operation.operationId === "string" && operation.operationId.trim().length > 0) {
    return operation.operationId.trim();
  }

  return `${method.toUpperCase()} ${path}`;
}

export function normalizeSpec(rawSpec: string): NormalizedSpec {
  const parsed = YAML.parse(rawSpec) as unknown;
  const document = toRecord(parsed);

  if (!document) {
    throw new Error("The provided spec is not a valid JSON or YAML document.");
  }

  const format =
    typeof document.openapi === "string"
      ? "openapi"
      : typeof document.swagger === "string"
        ? "swagger"
        : null;

  if (!format) {
    throw new Error("Only OpenAPI 3.x and Swagger 2.0 documents are supported.");
  }

  const info = toRecord(document.info);
  const title = typeof info?.title === "string" ? info.title : "Untitled API";
  const version = typeof info?.version === "string" ? info.version : "0.0.0";
  const description = typeof info?.description === "string" ? info.description : undefined;
  const securitySchemes = extractSecuritySchemes(document, format);
  const operations: ApiOperation[] = [];
  const paths = toRecord(document.paths);

  if (!paths || Object.keys(paths).length === 0) {
    throw new Error("The spec does not contain any paths to analyze.");
  }

  const globalSecurity = normalizeSecurityRequirements(document.security);

  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = toRecord(rawPathItem);
    if (!pathItem) {
      continue;
    }

    const pathParameters = normalizeParameters(document, pathItem.parameters);
    const pathSecurity = normalizeSecurityRequirements(pathItem.security);

    for (const method of httpMethods) {
      const operation = toRecord(pathItem[method]);
      if (!operation) {
        continue;
      }

      const combinedParameters = [
        ...pathParameters,
        ...normalizeParameters(document, operation.parameters),
      ];

      const requestBody = extractRequestBody(document, operation, combinedParameters, format);
      const parameters = combinedParameters.filter(
        (parameter): parameter is ApiParameter => parameter.in !== "body",
      );
      const security = normalizeSecurityRequirements(operation.security);
      const effectiveSecurity =
        security.length > 0 ? security : pathSecurity.length > 0 ? pathSecurity : globalSecurity;
      const headerAuth = parameters.some((parameter) => parameter.in === "header" && /auth/i.test(parameter.name));

      operations.push({
        id: inferOperationId(operation, method, path),
        method,
        path,
        summary:
          typeof operation.summary === "string"
            ? operation.summary
            : typeof operation.description === "string"
              ? operation.description.slice(0, 96)
              : `${method.toUpperCase()} ${path}`,
        description: typeof operation.description === "string" ? operation.description : undefined,
        tags: toStringArray(operation.tags),
        parameters,
        requestBody,
        responses: extractResponses(document, operation.responses, format),
        securitySchemes: effectiveSecurity,
        requiresAuth: effectiveSecurity.length > 0 || headerAuth,
      });
    }
  }

  if (operations.length === 0) {
    throw new Error("No HTTP operations were found in the provided API spec.");
  }

  return {
    metadata: {
      title,
      version,
      description,
      servers: inferServers(document, format),
      format,
      securitySchemes,
    },
    operations,
  };
}
