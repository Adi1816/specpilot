export async function GET() {
  return Response.json({
    status: "ok",
    service: "specpilot-demo",
    timestamp: new Date().toISOString(),
  });
}
