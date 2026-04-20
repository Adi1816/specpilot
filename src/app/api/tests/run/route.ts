import { runTestPlan } from "@/lib/test-engine";
import { runPlanInputSchema } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const payload = runPlanInputSchema.safeParse(await request.json());

    if (!payload.success) {
      return Response.json(
        {
          error: payload.error.issues[0]?.message ?? "Invalid test execution payload.",
        },
        { status: 400 },
      );
    }

    const execution = await runTestPlan(
      payload.data.spec,
      payload.data.plan,
      payload.data.runConfig,
    );

    return Response.json(execution);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to run the generated tests.",
      },
      { status: 400 },
    );
  }
}
