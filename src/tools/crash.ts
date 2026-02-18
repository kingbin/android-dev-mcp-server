import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { tool, textResult, errorResult, ServerTool } from "../tool.js";
import { callAdb, resolveDevice } from "../adb.js";

export const logCrashDump = tool(
  {
    name: "log_crash_dump",
    description:
      "Retrieves the crash log buffer from the connected Android device using 'adb logcat -b crash'. This returns only fatal exceptions and native crashes, which is much cleaner than filtering general logcat. Use this after reproducing a crash to get the exact crash stack trace.",
    inputSchema: z.object({
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ device_id }) => {
    const resolved = await resolveDevice(device_id);
    const result = await callAdb(["logcat", "-b", "crash", "-d"], resolved);

    if (result.exitCode !== 0) {
      return errorResult(`Error reading crash buffer: ${result.stderr.trim()}`);
    }

    const output = result.stdout.trim();
    if (!output) {
      return textResult("No crashes found in the crash log buffer.");
    }

    return textResult(output);
  }
);

export const logAnrTraces = tool(
  {
    name: "log_anr_traces",
    description:
      "Pulls ANR (Application Not Responding) trace files from the connected Android device. ANR traces contain thread dumps captured when an app becomes unresponsive. Use this to investigate ANR issues reported by Crashlytics or users.",
    inputSchema: z.object({
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ device_id }) => {
    const resolved = await resolveDevice(device_id);

    // Try the legacy single-file location first
    const checkResult = await callAdb(
      ["shell", "test", "-f", "/data/anr/traces.txt", "&&", "echo", "exists"],
      resolved
    );

    if (checkResult.stdout.includes("exists")) {
      const result = await callAdb(
        ["shell", "cat", "/data/anr/traces.txt"],
        resolved
      );
      if (result.exitCode === 0 && result.stdout.trim()) {
        return textResult(result.stdout.trim());
      }
    }

    // Try listing individual ANR files (Android 11+)
    const lsResult = await callAdb(["shell", "ls", "/data/anr/"], resolved);

    if (
      lsResult.exitCode !== 0 ||
      (lsResult.stdout + lsResult.stderr).includes("No such file")
    ) {
      return textResult("No ANR traces found on device.");
    }

    const files = lsResult.stdout
      .trim()
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    if (files.length === 0) {
      return textResult("No ANR traces found on device.");
    }

    // Pull the most recent ANR file
    const mostRecent = files[files.length - 1];
    const result = await callAdb(
      ["shell", "cat", `/data/anr/${mostRecent}`],
      resolved
    );

    if (result.exitCode !== 0) {
      return errorResult(`Error reading ANR trace: ${result.stderr.trim()}`);
    }

    const output = result.stdout.trim();
    if (!output) {
      return textResult("ANR trace file is empty.");
    }

    const lines = output.split("\n");
    if (lines.length > 500) {
      return textResult(
        lines.slice(0, 500).join("\n") +
          `\n\n... truncated (${lines.length} total lines)`
      );
    }

    return textResult(output);
  }
);

export const bugreportCapture = tool(
  {
    name: "bugreport_capture",
    description:
      "Captures a full Android bugreport from the connected device. A bugreport contains comprehensive device state: logcat, system logs, memory info, running processes, ANR traces, battery stats, and more. This is a heavyweight operation that can take 1-3 minutes to complete. The output is a zip file that can be opened with Android Studio's bugreport viewer.",
    inputSchema: z.object({
      save_path: z
        .string()
        .describe(
          "Absolute local path to save the bugreport zip file (e.g. '/tmp/bugreport.zip')."
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ save_path, device_id }) => {
    const resolved = await resolveDevice(device_id);

    const args: string[] = [];
    if (resolved) args.push("-s", resolved);
    args.push("bugreport", save_path);

    const result = await new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            "Bugreport timed out after 5 minutes. The device may be unresponsive."
          )
        );
      }, 300_000);

      execFile(
        "adb",
        args,
        { maxBuffer: 50 * 1024 * 1024 },
        (error, stdout, stderr) => {
          clearTimeout(timeout);
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: error ? 1 : 0,
          });
        }
      );
    });

    if (result.exitCode !== 0) {
      return errorResult(
        `Bugreport capture failed: ${(result.stdout + result.stderr).trim()}`
      );
    }

    try {
      const stats = await stat(save_path);
      const sizeMb = stats.size / (1024 * 1024);
      return textResult(
        `Bugreport saved to ${save_path} (${sizeMb.toFixed(1)} MB)`
      );
    } catch {
      return errorResult(
        `Bugreport command succeeded but file not found at ${save_path}`
      );
    }
  }
);

export const logCrashDumpForApp = tool(
  {
    name: "log_crash_dump_for_app",
    description:
      "Retrieves crash logs filtered to a specific app package from the crash log buffer. This combines the crash buffer with PID-based filtering to show only crashes from the target app. Also includes recent 'FATAL EXCEPTION' entries from the main log.",
    inputSchema: z.object({
      app_package: z
        .string()
        .describe(
          "The package name of the app to filter crash logs for (e.g. 'com.example.myapp')"
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ app_package, device_id }) => {
    const resolved = await resolveDevice(device_id);
    const outputParts: string[] = [];

    const crashResult = await callAdb(
      ["logcat", "-b", "crash", "-d"],
      resolved
    );
    if (crashResult.exitCode === 0 && crashResult.stdout.trim()) {
      const crashLines = crashResult.stdout
        .split("\n")
        .filter((line) => line.includes(app_package));
      if (crashLines.length > 0) {
        outputParts.push(
          "=== Crash Buffer ===\n" + crashLines.slice(-50).join("\n")
        );
      }
    }

    const fatalResult = await callAdb(
      ["logcat", "-b", "main", "-d", "AndroidRuntime:E", "*:S"],
      resolved
    );
    if (fatalResult.exitCode === 0 && fatalResult.stdout.trim()) {
      const fatalLines = fatalResult.stdout
        .split("\n")
        .filter(
          (line) =>
            line.includes(app_package) || line.includes("FATAL EXCEPTION")
        );
      if (fatalLines.length > 0) {
        outputParts.push(
          "=== Fatal Exceptions (AndroidRuntime) ===\n" +
            fatalLines.slice(-50).join("\n")
        );
      }
    }

    if (outputParts.length === 0) {
      return textResult(`No crash logs found for ${app_package}.`);
    }

    return textResult(outputParts.join("\n\n"));
  }
);

export const crashTools: ServerTool[] = [
  logCrashDump,
  logAnrTraces,
  bugreportCapture,
  logCrashDumpForApp,
];
