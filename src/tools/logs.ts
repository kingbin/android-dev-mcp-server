import { z } from "zod";
import { tool, textResult, errorResult, ServerTool } from "../tool.js";
import { callAdb, resolveDevice } from "../adb.js";

export const logLogcat = tool(
  {
    name: "log_logcat",
    description:
      "Retrieves the last 100 lines of logs from the connected Android device using logcat.",
    inputSchema: z.object({
      app_package: z
        .string()
        .describe("The base package of the app to get the logs from"),
      log_level: z
        .enum(["DEBUG", "WARNING", "ERROR"])
        .default("DEBUG")
        .describe(
          "The log level to filter the events. Possible values: DEBUG, WARNING, ERROR."
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ app_package, log_level, device_id }) => {
    const resolved = await resolveDevice(device_id);

    const pidResult = await callAdb(
      ["shell", "pidof", "-s", app_package],
      resolved
    );
    const pid = pidResult.stdout.trim();
    if (pidResult.exitCode !== 0 || !pid) {
      return errorResult(
        `App with package '${app_package}' not running or not found.`
      );
    }

    const logLevelMap: Record<string, string> = {
      DEBUG: "D",
      WARNING: "W",
      ERROR: "E",
    };

    const result = await callAdb(
      ["logcat", "-d", "-b", "default", `*:${logLevelMap[log_level]}`],
      resolved
    );

    if (result.exitCode !== 0) {
      return errorResult(`Error getting logcat output: ${result.stderr}`);
    }

    const filteredLines = result.stdout
      .split("\n")
      .filter((line) => line.includes(pid));

    return textResult(filteredLines.slice(-100).join("\n"));
  }
);

export const logsTools: ServerTool[] = [logLogcat];
