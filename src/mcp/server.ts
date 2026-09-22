import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  errorMessage,
  settingsGetContract,
  settingsUpdateContract,
} from "@/adapters/settings-contract";
import type { SettingsService } from "@/services/settings";
import { updateSettingsSchema } from "@/shared/schemas/settings";

const context = { actor: "mcp" } as const;

function toolResult(result: object, error?: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result,
    ...(error ? { isError: true } : {}),
  };
}

export function createTimeOsMcpServer(settingsService: SettingsService) {
  const server = new McpServer({ name: "time-os", version: "0.1.0" });

  server.registerTool(
    "system_health",
    {
      title: "Time OS health",
      description:
        "Check that the authenticated Time OS endpoint and database schema are ready.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        await settingsService.checkSchema(context);
        return toolResult({ ok: true, data: { status: "ready" } });
      } catch {
        return toolResult(
          {
            ok: false,
            error: {
              code: "SCHEMA_NOT_READY",
              message: "The Time OS database schema is not ready.",
            },
          },
          "Schema is not ready",
        );
      }
    },
  );

  server.registerTool(
    "settings_get",
    {
      title: "Get settings",
      description:
        "Read Time OS timezone, default focus duration, and week start.",
      inputSchema: z.object({}),
    },
    async () => {
      const result = await settingsGetContract(settingsService, context);
      return toolResult(
        result,
        result.ok ? undefined : errorMessage(result.error),
      );
    },
  );

  server.registerTool(
    "settings_update",
    {
      title: "Update settings",
      description:
        "Update Time OS timezone, default focus duration, and week start.",
      inputSchema: updateSettingsSchema,
    },
    async (input) => {
      const result = await settingsUpdateContract(
        settingsService,
        context,
        input,
      );
      return toolResult(
        result,
        result.ok ? undefined : errorMessage(result.error),
      );
    },
  );

  return server;
}
