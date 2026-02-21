import { z } from "zod";
import { tool, textResult, errorResult, ServerTool } from "../tool.js";
import { callAdb, resolveDevice } from "../adb.js";

export const logLogcat = tool(
  {
    name: "log_logcat",
    description:
      "Reads logcat logs from the connected Android device. Use this tool instead of running 'adb logcat' via the shell. " +
      "Can return all device logs or filter to a specific app package. " +
      "Returns the most recent log lines (default 200, configurable via 'lines' parameter).",
    inputSchema: z.object({
      app_package: z
        .string()
        .optional()
        .describe(
          "Optional app package name to filter logs to (e.g. 'com.example.myapp'). " +
          "If omitted, returns all device logs unfiltered."
        ),
      log_level: z
        .enum(["VERBOSE", "DEBUG", "INFO", "WARNING", "ERROR"])
        .default("DEBUG")
        .describe(
          "Minimum log level to include. Possible values: VERBOSE, DEBUG, INFO, WARNING, ERROR."
        ),
      lines: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .default(200)
        .describe(
          "Number of recent log lines to return (default 200, max 5000)."
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ app_package, log_level, lines, device_id }) => {
    const resolved = await resolveDevice(device_id);

    const logLevelMap: Record<string, string> = {
      VERBOSE: "V",
      DEBUG: "D",
      INFO: "I",
      WARNING: "W",
      ERROR: "E",
    };

    // If app_package is provided, try to filter by PID
    let pid: string | null = null;
    if (app_package) {
      const pidResult = await callAdb(
        ["shell", "pidof", "-s", app_package],
        resolved
      );
      pid = pidResult.stdout.trim() || null;
      // Don't fail — app may not be running yet but there could be historical logs
    }

    const result = await callAdb(
      ["logcat", "-d", "-b", "default", `*:${logLevelMap[log_level]}`],
      resolved
    );

    if (result.exitCode !== 0) {
      return errorResult(`Error getting logcat output: ${result.stderr}`);
    }

    let outputLines = result.stdout.split("\n");

    // Filter by PID if we found a running app
    if (pid) {
      outputLines = outputLines.filter((line) => line.includes(pid));
    } else if (app_package) {
      // App not running — fall back to filtering by package name string in log lines
      outputLines = outputLines.filter((line) => line.includes(app_package));
      if (outputLines.length === 0) {
        return textResult(
          `No logs found for '${app_package}'. The app may not be running and has no recent log entries.`
        );
      }
    }

    return textResult(outputLines.slice(-lines).join("\n"));
  }
);

export const logsTools: ServerTool[] = [logLogcat];
