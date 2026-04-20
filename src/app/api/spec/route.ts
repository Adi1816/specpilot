import { normalizeSpec } from "@/lib/openapi";
import { analyzeSpecInputSchema } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const payload = analyzeSpecInputSchema.safeParse(await request.json());

    if (!payload.success) {
      return Response.json(
        {
          error: payload.error.issues[0]?.message ?? "Invalid spec payload.",
        },
        { status: 400 },
      );
    }

    const spec = normalizeSpec(payload.data.rawSpec);

    return Response.json({
      spec,
      defaultBaseUrl: spec.metadata.servers[0] ?? "",
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to analyze the provided spec.",
      },
      { status: 400 },
    );
  }
}
