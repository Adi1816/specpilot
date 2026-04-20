export const DEMO_AUTH_TOKEN = "demo-token";

type DemoMoney = {
  amount: number;
  currency: string;
};

export type DemoOrderItem = {
  sku: string;
  quantity: number;
  unitPrice?: DemoMoney;
};

export type DemoOrder = {
  id: string;
  status: "pending" | "paid" | "refunded";
  total: DemoMoney;
  createdAt: string;
  customerEmail: string;
  items: DemoOrderItem[];
  notes?: string;
};

type CreateOrderInput = {
  customerEmail: string;
  notes?: string;
  items: DemoOrderItem[];
};

type RefundInput = {
  reason: string;
  amount?: DemoMoney;
};

const defaultUnitPrice: DemoMoney = {
  amount: 24.99,
  currency: "USD",
};

const initialOrders: DemoOrder[] = [
  {
    id: "ord_demo_001",
    status: "paid",
    total: { amount: 49.98, currency: "USD" },
    createdAt: "2026-04-20T08:00:00.000Z",
    customerEmail: "pilot@example.com",
    items: [
      {
        sku: "sku_solar_mug",
        quantity: 2,
        unitPrice: { amount: 24.99, currency: "USD" },
      },
    ],
    notes: "Leave with reception",
  },
  {
    id: "ord_demo_002",
    status: "pending",
    total: { amount: 74.97, currency: "USD" },
    createdAt: "2026-04-20T09:30:00.000Z",
    customerEmail: "qa@example.com",
    items: [
      {
        sku: "sku_solar_mug",
        quantity: 3,
        unitPrice: { amount: 24.99, currency: "USD" },
      },
    ],
  },
];

const orderStore = new Map<string, DemoOrder>(initialOrders.map((order) => [order.id, order]));

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function jsonResponse(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}

export function unauthorizedResponse() {
  return jsonResponse({ error: "Missing or invalid token." }, 401);
}

export function badRequestResponse(message: string) {
  return jsonResponse({ error: message }, 400);
}

export function validationResponse(message: string) {
  return jsonResponse({ error: message }, 422);
}

export function requireDemoAuth(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization === `Bearer ${DEMO_AUTH_TOKEN}`;
}

export function listDemoOrders(status?: string) {
  const orders = [...orderStore.values()].sort((left, right) =>
    left.createdAt < right.createdAt ? 1 : -1,
  );

  if (!status) {
    return orders;
  }

  return orders.filter((order) => order.status === status);
}

export function getDemoOrder(orderId: string) {
  return orderStore.get(orderId);
}

function isMoney(value: unknown): value is DemoMoney {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { amount?: unknown }).amount === "number" &&
    typeof (value as { currency?: unknown }).currency === "string"
  );
}

function isOrderItem(value: unknown): value is DemoOrderItem {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { sku?: unknown }).sku === "string" &&
    typeof (value as { quantity?: unknown }).quantity === "number" &&
    (value as { quantity: number }).quantity >= 1
  );
}

export function validateCreateOrderInput(value: unknown): value is CreateOrderInput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { customerEmail?: unknown }).customerEmail === "string" &&
    (value as { customerEmail: string }).customerEmail.includes("@") &&
    Array.isArray((value as { items?: unknown }).items) &&
    (value as { items: unknown[] }).items.length > 0 &&
    (value as { items: unknown[] }).items.every(isOrderItem)
  );
}

export function createDemoOrder(input: CreateOrderInput) {
  const amount = roundMoney(
    input.items.reduce((total, item) => {
      const unitPrice = isMoney(item.unitPrice) ? item.unitPrice : defaultUnitPrice;
      return total + unitPrice.amount * item.quantity;
    }, 0),
  );

  const currency = isMoney(input.items[0]?.unitPrice)
    ? input.items[0].unitPrice.currency
    : defaultUnitPrice.currency;

  const order: DemoOrder = {
    id: `ord_demo_${String(orderStore.size + 1).padStart(3, "0")}`,
    status: "pending",
    total: {
      amount,
      currency,
    },
    createdAt: new Date().toISOString(),
    customerEmail: input.customerEmail,
    items: input.items.map((item) => ({
      ...item,
      unitPrice: isMoney(item.unitPrice) ? item.unitPrice : defaultUnitPrice,
    })),
    notes: input.notes,
  };

  orderStore.set(order.id, order);
  return order;
}

export function validateRefundInput(value: unknown): value is RefundInput {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { reason?: unknown }).reason === "string" &&
    (value as { reason: string }).reason.trim().length > 0 &&
    ((value as { amount?: unknown }).amount === undefined || isMoney((value as { amount?: unknown }).amount))
  );
}

export function refundDemoOrder(orderId: string, input: RefundInput) {
  const order = orderStore.get(orderId);
  if (!order) {
    return null;
  }

  if (order.status === "refunded") {
    return "already-refunded" as const;
  }

  const nextOrder: DemoOrder = {
    ...order,
    status: "refunded",
  };

  orderStore.set(orderId, nextOrder);

  return {
    order: nextOrder,
    refund: {
      accepted: true,
      reason: input.reason,
      amount: input.amount ?? nextOrder.total,
    },
  };
}
