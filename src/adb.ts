import { execFile } from "node:child_process";

export interface AdbResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DeviceInfo {
  serial: string;
  state: string;
}

function buildAdbCmd(
  args: string[],
  deviceId?: string | null
): { cmd: string; args: string[] } {
  const fullArgs: string[] = [];
  if (deviceId) {
    fullArgs.push("-s", deviceId);
  }
  fullArgs.push(...args);
  return { cmd: "adb", args: fullArgs };
}

export async function callAdb(
  args: string[],
  deviceId?: string | null
): Promise<AdbResult> {
  const { cmd, args: fullArgs } = buildAdbCmd(args, deviceId);
  return new Promise((resolve) => {
    execFile(cmd, fullArgs, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: error?.code !== undefined ? (typeof error.code === "number" ? error.code : 1) : 0,
      });
    });
  });
}

export async function callAdbSilent(
  args: string[],
  deviceId?: string | null
): Promise<void> {
  const result = await callAdb(args, deviceId);
  if (result.exitCode !== 0) {
    throw new Error(
      `adb ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr.trim()}`
    );
  }
}

export async function getConnectedDeviceList(): Promise<DeviceInfo[]> {
  const result = await callAdb(["devices"]);
  const lines = result.stdout.trim().split("\n").slice(1); // skip header
  const devices: DeviceInfo[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      devices.push({ serial: parts[0], state: parts[1] });
    }
  }
  return devices;
}

export async function resolveDevice(
  deviceId?: string | null
): Promise<string | null> {
  if (deviceId) return deviceId;

  const devices = await getConnectedDeviceList();
  const online = devices.filter((d) => d.state === "device");

  if (online.length === 1) return online[0].serial;

  if (online.length > 1) {
    const list = devices.map((d) => `  - ${d.serial} (${d.state})`).join("\n");
    throw new Error(
      `Multiple devices connected. Specify a device_id:\n${list}\n\nUse the device_list tool to list available devices.`
    );
  }

  // No online devices — let adb produce its own error
  return null;
}
