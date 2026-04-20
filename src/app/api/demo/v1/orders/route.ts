import {
  badRequestResponse,
  createDemoOrder,
  listDemoOrders,
  requireDemoAuth,
  unauthorizedResponse,
  validateCreateOrderInput,
  validationResponse,
} from "@/lib/demo-api";

export async function GET(request: Request) {
  if (!requireDemoAuth(request)) {
    return unauthorizedResponse();
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;

  return Response.json({
    orders: listDemoOrders(status),
  });
}

export async function POST(request: Request) {
  if (!requireDemoAuth(request)) {
    return unauthorizedResponse();
  }

  try {
    const payload = (await request.json()) as unknown;

    if (!validateCreateOrderInput(payload)) {
      return validationResponse(
        "customerEmail and at least one valid item with sku and quantity are required.",
      );
    }

    const order = createDemoOrder(payload);

    return Response.json(order, { status: 201 });
  } catch {
    return badRequestResponse("Malformed JSON payload.");
  }
}
