import {
  badRequestResponse,
  refundDemoOrder,
  requireDemoAuth,
  unauthorizedResponse,
  validateRefundInput,
  validationResponse,
} from "@/lib/demo-api";

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      orderId: string;
    }>;
  },
) {
  if (!requireDemoAuth(request)) {
    return unauthorizedResponse();
  }

  try {
    const payload = (await request.json()) as unknown;

    if (!validateRefundInput(payload)) {
      return validationResponse("A non-empty refund reason is required.");
    }

    const { orderId } = await context.params;
    const result = refundDemoOrder(orderId, payload);

    if (result === null) {
      return Response.json({ error: "Order not found." }, { status: 404 });
    }

    if (result === "already-refunded") {
      return badRequestResponse("Order has already been refunded.");
    }

    return Response.json(result);
  } catch {
    return badRequestResponse("Malformed JSON payload.");
  }
}
