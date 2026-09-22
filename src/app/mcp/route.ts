import { createMcpHandler } from "@modelcontextprotocol/server";

import { hasValidBearerToken } from "@/auth/secrets";
import { env } from "@/env";
import { logger } from "@/lib/logger";
import { createTimeOsMcpServer } from "@/mcp/server";
import { settingsService } from "@/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(() => createTimeOsMcpServer(settingsService), {
  onerror(error) {
    logger.error("MCP request failed", { error: error.message });
  },
});

export async function POST(request: Request): Promise<Response> {
  if (
    !hasValidBearerToken(
      request.headers.get("authorization"),
      env.TIMEOS_MCP_TOKEN,
    )
  ) {
    return Response.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A valid Time OS Bearer token is required.",
        },
      },
      {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      },
    );
  }

  return handler.fetch(request);
}
