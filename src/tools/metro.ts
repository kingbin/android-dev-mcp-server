import { z } from "zod";
import { tool, textResult, errorResult, ServerTool } from "../tool.js";
import { execFile, spawn } from "node:child_process";

function runCommand(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode:
          error?.code !== undefined
            ? typeof error.code === "number"
              ? error.code
              : 1
            : 0,
      });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const metroStart = tool(
  {
    name: "metro_start",
    description:
      "Start a Metro bundler instance on a specified port for a React Native project directory. Useful for running multiple emulators in parallel, each on its own Metro port.",
    inputSchema: z.object({
      project_dir: z
        .string()
        .describe("Absolute path to the React Native project directory"),
      port: z
        .number()
        .default(8081)
        .describe("Port for the Metro bundler (default 8081)"),
    }),
  },
  async ({ project_dir, port }) => {
    // Check if the port is already in use
    const check = await runCommand("lsof", ["-i", `:${port}`, "-t"]);
    if (check.stdout.trim()) {
      return errorResult(
        `Port ${port} is already in use (PID: ${check.stdout.trim()})`
      );
    }

    // Start Metro detached
    const child = spawn("npx", ["react-native", "start", "--port", String(port)], {
      cwd: project_dir,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait briefly for Metro to start
    await sleep(1000);

    // Verify the port is now in use
    const verify = await runCommand("lsof", ["-i", `:${port}`, "-t"]);
    if (!verify.stdout.trim()) {
      return errorResult(
        `Metro process was spawned but port ${port} is not yet in use. It may still be starting up.`
      );
    }

    const pid = verify.stdout.trim().split("\n")[0];
    return textResult(`Metro bundler started on port ${port} (PID: ${pid})`);
  }
);

const metroStop = tool(
  {
    name: "metro_stop",
    description: "Stop a running Metro bundler instance by port number.",
    inputSchema: z.object({
      port: z
        .number()
        .default(8081)
        .describe("Port of the Metro bundler to stop (default 8081)"),
    }),
  },
  async ({ port }) => {
    // Find the PID on this port
    const check = await runCommand("lsof", ["-i", `:${port}`, "-t"]);
    const pid = check.stdout.trim();
    if (!pid) {
      return errorResult(`No Metro bundler found on port ${port}`);
    }

    // Kill the process
    await runCommand("kill", ["-SIGTERM", pid.split("\n")[0]]);
    return textResult(`Metro bundler on port ${port} stopped (PID: ${pid.split("\n")[0]})`);
  }
);

const metroStatus = tool(
  {
    name: "metro_status",
    description:
      "List all running Metro bundler instances with their ports and PIDs.",
    inputSchema: z.object({}),
  },
  async () => {
    const instances = new Map<string, string>(); // port -> pid

    // List network connections and filter for node LISTEN processes
    const result = await runCommand("lsof", ["-i", "-P", "-n"]);
    if (result.stdout) {
      const lines = result.stdout.split("\n");
      for (const line of lines) {
        if (line.includes("node") && line.includes("LISTEN")) {
          const parts = line.split(/\s+/);
          const pid = parts[1];
          // Port is in the name column, e.g. *:8081 or 127.0.0.1:8081
          const nameCol = parts[8] ?? "";
          const portMatch = nameCol.match(/:(\d+)$/);
          if (pid && portMatch) {
            instances.set(portMatch[1], pid);
          }
        }
      }
    }

    // Also check common Metro ports 8081-8090 specifically
    for (let p = 8081; p <= 8090; p++) {
      const check = await runCommand("lsof", ["-i", `:${p}`, "-t"]);
      if (check.stdout.trim()) {
        const pid = check.stdout.trim().split("\n")[0];
        if (!instances.has(String(p))) {
          instances.set(String(p), pid);
        }
      }
    }

    if (instances.size === 0) {
      return textResult("No Metro instances running.");
    }

    const header = "Port\tPID\tStatus";
    const rows = Array.from(instances.entries())
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([port, pid]) => `${port}\t${pid}\tLISTEN`);

    return textResult([header, ...rows].join("\n"));
  }
);

export const metroTools: ServerTool[] = [metroStart, metroStop, metroStatus];
