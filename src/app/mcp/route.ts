import { createMcpHandler } from "@modelcontextprotocol/server";
import { requireMcpAuth } from "@better-auth/mcp";

import {
  auth,
  MCP_READ_SCOPE,
  MCP_RESOURCE,
  MCP_WRITE_SCOPE,
} from "@/auth/auth";
import { logger } from "@/lib/logger";
import { createTimeOsMcpServer } from "@/mcp/server";
import {
  dashboardService,
  distractionService,
  historyService,
  planningService,
  selectionService,
  sessionService,
  settingsService,
  statisticsService,
} from "@/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpHandler(
  () =>
    createTimeOsMcpServer({
      settingsService,
      planningService,
      selectionService,
      sessionService,
      distractionService,
      dashboardService,
      historyService,
      statisticsService,
    }),
  {
    legacy: "reject",
    onerror(error) {
      logger.error("MCP request failed", { error: error.message });
    },
  },
);

export const POST = requireMcpAuth(auth, (request) => handler.fetch(request), {
  resource: MCP_RESOURCE,
  requiredScopes: [MCP_READ_SCOPE, MCP_WRITE_SCOPE],
});
