import { buildMarkdownReport } from "@/lib/test-engine";
import { reportInputSchema } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const payload = reportInputSchema.safeParse(await request.json());

    if (!payload.success) {
      return Response.json(
        {
          error: payload.error.issues[0]?.message ?? "Invalid report payload.",
        },
        { status: 400 },
      );
    }

    const markdown = buildMarkdownReport(
      payload.data.spec,
      payload.data.plan,
      payload.data.results,
      payload.data.summary,
    );

    return Response.json({ markdown });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to compose the execution report.",
      },
      { status: 400 },
    );
  }
}
