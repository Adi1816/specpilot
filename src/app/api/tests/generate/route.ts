import { generateTestPlan } from "@/lib/test-engine";
import { generatePlanInputSchema } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const payload = generatePlanInputSchema.safeParse(await request.json());

    if (!payload.success) {
      return Response.json(
        {
          error: payload.error.issues[0]?.message ?? "Invalid test generation payload.",
        },
        { status: 400 },
      );
    }

    const plan = await generateTestPlan(
      payload.data.spec,
      payload.data.selectedOperationIds,
      payload.data.strategy,
    );

    return Response.json({ plan });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to generate the test plan.",
      },
      { status: 400 },
    );
  }
}
