import { execFile } from "node:child_process";
import { z } from "zod";
import { tool, textResult, errorResult, ServerTool } from "../tool.js";
import {
  callAdb,
  getConnectedDeviceList,
  resolveDevice,
} from "../adb.js";
import { which } from "../utils.js";
import path from "node:path";

async function findEmulatorBinary(): Promise<string> {
  const fromPath = await which("emulator");
  if (fromPath) return fromPath;

  for (const envVar of ["ANDROID_HOME", "ANDROID_SDK_ROOT"]) {
    const sdk = process.env[envVar];
    if (sdk) {
      const candidate = path.join(sdk, "emulator", "emulator");
      try {
        const { fileExists } = await import("../utils.js");
        if (await fileExists(candidate)) return candidate;
      } catch {
        // continue
      }
    }
  }

  throw new Error(
    "Could not find the Android emulator binary. Ensure 'emulator' is on your PATH or set ANDROID_HOME / ANDROID_SDK_ROOT."
  );
}

export const deviceList = tool(
  {
    name: "device_list",
    description:
      "Lists all connected Android devices/emulators and their connection state. Returns a list of devices with their serial number and state (device/offline/unauthorized). Use this to discover available devices before targeting a specific one.",
    inputSchema: z.object({}),
  },
  async () => {
    const devices = await getConnectedDeviceList();
    if (devices.length === 0) {
      return errorResult(
        "No devices found. Is an emulator running or a device connected via USB?"
      );
    }
    return textResult(JSON.stringify(devices, null, 2));
  }
);

export const deviceConnect = tool(
  {
    name: "device_connect",
    description:
      "Connects to an Android device over TCP/IP using 'adb connect'. The device must have TCP/IP debugging enabled (e.g. via device_enable_tcpip).",
    inputSchema: z.object({
      host: z
        .string()
        .describe(
          "The IP address or hostname of the device to connect to (e.g. '192.168.1.100')"
        ),
      port: z
        .number()
        .default(5555)
        .describe("The port to connect on."),
    }),
  },
  async ({ host, port }) => {
    const target = `${host}:${port}`;
    const result = await callAdb(["connect", target]);
    const output = (result.stdout + result.stderr).trim();

    if (
      !output.toLowerCase().includes("connected") &&
      !output.toLowerCase().includes("already")
    ) {
      return errorResult(`Failed to connect to ${target}: ${output}`);
    }

    return textResult(`Connected to ${target}`);
  }
);

export const deviceDisconnect = tool(
  {
    name: "device_disconnect",
    description: "Disconnects an Android device or emulator from ADB.",
    inputSchema: z.object({
      device_id: z
        .string()
        .describe(
          "The serial number or IP:port of the device to disconnect (e.g. 'emulator-5554' or '192.168.1.100:5555')"
        ),
    }),
  },
  async ({ device_id }) => {
    const devices = await getConnectedDeviceList();
    const knownSerials = devices.map((d) => d.serial);

    if (!knownSerials.includes(device_id)) {
      return errorResult(
        `Device '${device_id}' is not currently connected.\nConnected devices: ${knownSerials.length ? knownSerials.join(", ") : "none"}`
      );
    }

    const result = await callAdb(["disconnect", device_id]);
    const output = (result.stdout + result.stderr).trim();

    if (output.toLowerCase().includes("disconnected") || result.exitCode === 0) {
      return textResult(`Disconnected ${device_id}`);
    }

    return errorResult(`Failed to disconnect ${device_id}: ${output}`);
  }
);

export const deviceEnableTcpip = tool(
  {
    name: "device_enable_tcpip",
    description:
      "Switches a USB-connected Android device to TCP/IP mode by running 'adb tcpip <port>'. After this, the device can be connected wirelessly using device_connect with the device's IP address.",
    inputSchema: z.object({
      port: z
        .number()
        .default(5555)
        .describe("The port to listen on for TCP/IP connections."),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ port, device_id }) => {
    const resolved = await resolveDevice(device_id);
    const result = await callAdb(["tcpip", String(port)], resolved);
    const output = (result.stdout + result.stderr).trim();

    if (result.exitCode !== 0) {
      return errorResult(`Failed to enable TCP/IP mode: ${output}`);
    }

    return textResult(
      `Device now listening on port ${port}. Use device_connect with the device's IP to connect wirelessly.`
    );
  }
);

export const adbRestart = tool(
  {
    name: "adb_restart",
    description:
      "Restarts the ADB server by running 'adb kill-server' followed by 'adb start-server'. This can fix connection issues with devices.",
    inputSchema: z.object({}),
  },
  async () => {
    await callAdb(["kill-server"]);
    const result = await callAdb(["start-server"]);

    if (result.exitCode !== 0) {
      const output = (result.stdout + result.stderr).trim();
      return errorResult(`Failed to start ADB server: ${output}`);
    }

    return textResult("ADB server restarted successfully");
  }
);

export const emulatorListAvds = tool(
  {
    name: "emulator_list_avds",
    description:
      "Lists all available Android Virtual Devices (AVDs) configured in Android Studio. Use this to discover which emulators can be booted with emulator_boot.",
    inputSchema: z.object({}),
  },
  async () => {
    const emulator = await findEmulatorBinary();
    return new Promise((resolve) => {
      execFile(emulator, ["-list-avds"], (error, stdout) => {
        if (error) {
          resolve(errorResult(`Error listing AVDs: ${error.message}`));
          return;
        }
        const avds = stdout
          .trim()
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (avds.length === 0) {
          resolve(
            errorResult(
              "No AVDs found. Create one in Android Studio's Device Manager first."
            )
          );
          return;
        }
        resolve(textResult(JSON.stringify(avds, null, 2)));
      });
    });
  }
);

export const emulatorBoot = tool(
  {
    name: "emulator_boot",
    description:
      "Boots an Android Studio emulator by AVD name. The emulator launches in the background. Use device_list to check when it's ready.",
    inputSchema: z.object({
      avd_name: z
        .string()
        .describe(
          "The name of the AVD to boot. Use emulator_list_avds to see available names."
        ),
      cold_boot: z
        .boolean()
        .default(false)
        .describe(
          "If true, perform a cold boot instead of resuming from a snapshot."
        ),
    }),
  },
  async ({ avd_name, cold_boot }) => {
    const emulator = await findEmulatorBinary();

    // Verify AVD exists
    const avds: string[] = await new Promise((resolve, reject) => {
      execFile(emulator, ["-list-avds"], (error, stdout) => {
        if (error) return reject(error);
        resolve(
          stdout
            .trim()
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
        );
      });
    });

    if (!avds.includes(avd_name)) {
      return errorResult(
        `AVD '${avd_name}' not found. Available AVDs:\n${avds.map((a) => `  - ${a}`).join("\n")}`
      );
    }

    const cmd = ["-avd", avd_name];
    if (cold_boot) cmd.push("-no-snapshot-load");

    // Launch in background (detached)
    const { spawn } = await import("node:child_process");
    const child = spawn(emulator, cmd, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    return textResult(
      `Emulator '${avd_name}' is booting. Use device_list to check when it's online.`
    );
  }
);

export const appInstall = tool(
  {
    name: "app_install",
    description:
      "Installs an APK file on the connected Android device or emulator.",
    inputSchema: z.object({
      apk_path: z.string().describe("Absolute path to the APK file to install"),
      reinstall: z
        .boolean()
        .default(false)
        .describe(
          "If true, reinstall the app keeping its data (adb install -r)."
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ apk_path, reinstall, device_id }) => {
    const { fileExists } = await import("../utils.js");
    if (!(await fileExists(apk_path))) {
      return errorResult(`APK file not found: ${apk_path}`);
    }

    const resolved = await resolveDevice(device_id);
    const args = ["install"];
    if (reinstall) args.push("-r");
    args.push(apk_path);

    const result = await callAdb(args, resolved);
    const output = (result.stdout + result.stderr).trim();

    if (result.exitCode !== 0 || output.includes("Failure")) {
      return errorResult(`Failed to install APK: ${output}`);
    }

    return textResult(`Installed ${path.basename(apk_path)} successfully`);
  }
);

export const appLaunch = tool(
  {
    name: "app_launch",
    description:
      "Launches an app on the connected Android device by its package name. Uses 'monkey' to start the app's default launcher activity.",
    inputSchema: z.object({
      package_name: z
        .string()
        .describe(
          "The package name of the app to launch (e.g. 'com.example.myapp')"
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ package_name, device_id }) => {
    const resolved = await resolveDevice(device_id);
    const result = await callAdb(
      [
        "shell",
        "monkey",
        "-p",
        package_name,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ],
      resolved
    );
    const output = (result.stdout + result.stderr).trim();

    if (output.includes("No activities found")) {
      return errorResult(
        `No launchable activity found for package '${package_name}'. Is it installed?`
      );
    }

    return textResult(`Launched ${package_name}`);
  }
);

export const deviceManagementTools: ServerTool[] = [
  deviceList,
  deviceConnect,
  deviceDisconnect,
  deviceEnableTcpip,
  adbRestart,
  emulatorListAvds,
  emulatorBoot,
  appInstall,
  appLaunch,
];
