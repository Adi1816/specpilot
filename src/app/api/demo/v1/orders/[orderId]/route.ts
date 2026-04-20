import {
  getDemoOrder,
  requireDemoAuth,
  unauthorizedResponse,
} from "@/lib/demo-api";

export async function GET(
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

  const { orderId } = await context.params;
  const order = getDemoOrder(orderId);

  if (!order) {
    return Response.json({ error: "Order not found." }, { status: 404 });
  }

  return Response.json(order);
}
