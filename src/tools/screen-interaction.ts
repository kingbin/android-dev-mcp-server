import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { tool, textResult, errorResult, imageResult, ServerTool } from "../tool.js";
import { callAdb, callAdbSilent, resolveDevice } from "../adb.js";

let tempDir = "/tmp/android-mcp";

export function setTempDir(dir: string) {
  tempDir = dir;
}

function parseXmlBounds(boundsStr: string): [number, number, number, number] | null {
  const match = boundsStr.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  return [
    parseInt(match[1]),
    parseInt(match[2]),
    parseInt(match[3]),
    parseInt(match[4]),
  ];
}

export const screenCapture = tool(
  {
    name: "screen_capture",
    description:
      "Gets a screenshot of the connected Android device. Use this tool when you need to check the visual appearance of the UI. Prefer using the screen_ui_dump tool to identify the UI elements on the screen and their position.",
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
    const screenshotPath = path.join(tempDir, "screenshot.png");

    await callAdbSilent(
      ["shell", "screencap", "-p", "/sdcard/screenshot.png"],
      resolved
    );
    await callAdbSilent(
      ["pull", "/sdcard/screenshot.png", screenshotPath],
      resolved
    );
    await callAdbSilent(["shell", "rm", "/sdcard/screenshot.png"], resolved);

    // Resize with sharp
    const sharp = (await import("sharp")).default;
    const metadata = await sharp(screenshotPath).metadata();
    const newWidth = Math.round((metadata.width ?? 1080) * 0.4);
    const resizedBuffer = await sharp(screenshotPath)
      .resize(newWidth)
      .png()
      .toBuffer();

    await rm(screenshotPath, { force: true });

    return imageResult(resizedBuffer.toString("base64"), "image/png");
  }
);

export const screenUiDump = tool(
  {
    name: "screen_ui_dump",
    description:
      "Gets the UI hierarchy dump from the connected Android device using an XML format. This is useful to understand the components currently visible on the screen. For each node in the XML, only the attributes specified in the 'returned_attributes' argument are returned.",
    inputSchema: z.object({
      returned_attributes: z
        .string()
        .describe(
          "A comma-separated list of attributes to return for each XML node. Possible attributes: index, text, resource-id, class, package, content-desc, checkable, checked, clickable, enabled, focusable, focused, scrollable, long-clickable, password, selected, bounds, drawing-order, hint."
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ returned_attributes, device_id }) => {
    const possibleAttributes = new Set([
      "index", "text", "resource-id", "class", "package", "content-desc",
      "checkable", "checked", "clickable", "enabled", "focusable", "focused",
      "scrollable", "long-clickable", "password", "selected", "bounds",
      "drawing-order", "hint",
    ]);

    const attrsToKeep = returned_attributes.split(",").map((a) => a.trim());
    const invalid = attrsToKeep.filter((a) => !possibleAttributes.has(a));
    if (invalid.length > 0) {
      return errorResult(
        `Invalid attribute(s) requested: ${invalid.join(", ")}. Possible attributes are: ${[...possibleAttributes].join(", ")}`
      );
    }

    const resolved = await resolveDevice(device_id);
    const dumpPath = path.join(tempDir, "window_dump.xml");

    await callAdbSilent(["shell", "uiautomator", "dump"], resolved);
    await callAdbSilent(
      ["pull", "/sdcard/window_dump.xml", dumpPath],
      resolved
    );
    await callAdbSilent(["shell", "rm", "/sdcard/window_dump.xml"], resolved);

    const xml = await readFile(dumpPath, "utf-8");
    await rm(dumpPath, { force: true });

    // Filter XML attributes — keep only requested ones
    const attrsToKeepSet = new Set(attrsToKeep);
    const filtered = xml.replace(
      /\s(\w[\w-]*)="[^"]*"/g,
      (match, attrName) => {
        return attrsToKeepSet.has(attrName) ? match : "";
      }
    );

    return textResult(filtered);
  }
);

export const screenDescribeAll = tool(
  {
    name: "screen_describe_all",
    description:
      "Describes accessibility information for all visible UI elements on the Android device screen. Returns a list of elements with their class, text, content description, resource ID, bounds, and interactive states. Use this to understand what's on the screen in a human-readable format.",
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
    const dumpPath = path.join(tempDir, "window_dump.xml");

    await callAdbSilent(["shell", "uiautomator", "dump"], resolved);
    await callAdbSilent(
      ["pull", "/sdcard/window_dump.xml", dumpPath],
      resolved
    );
    await callAdbSilent(["shell", "rm", "/sdcard/window_dump.xml"], resolved);

    const xml = await readFile(dumpPath, "utf-8");
    await rm(dumpPath, { force: true });

    const elements: Record<string, string>[] = [];
    const nodeRegex = /<node\s([^>]+)\/?>/g;
    let match;

    while ((match = nodeRegex.exec(xml)) !== null) {
      const attrsStr = match[1];
      const desc: Record<string, string> = {};

      const cls = attrsStr.match(/class="([^"]*)"/)?.[1] ?? "";
      if (cls) desc["class"] = cls.split(".").pop() ?? cls;

      for (const key of ["text", "content-desc", "resource-id", "bounds"]) {
        const val = attrsStr.match(new RegExp(`${key}="([^"]*)"`))
          ?.[1]
          ?.trim();
        if (val) desc[key] = val;
      }

      for (const key of [
        "clickable", "checkable", "checked", "scrollable", "focusable", "enabled",
      ]) {
        if (attrsStr.includes(`${key}="true"`)) desc[key] = "true";
      }

      if (Object.keys(desc).length > 0 && desc["class"] !== "hierarchy") {
        elements.push(desc);
      }
    }

    if (elements.length === 0) {
      return errorResult("No UI elements found on screen.");
    }

    return textResult(JSON.stringify(elements, null, 2));
  }
);

export const screenDescribePoint = tool(
  {
    name: "screen_describe_point",
    description:
      "Returns accessibility information for the UI element at the given screen coordinates. Finds the most specific (smallest) element whose bounds contain the point.",
    inputSchema: z.object({
      x: z.number().describe("The x-coordinate of the point to describe"),
      y: z.number().describe("The y-coordinate of the point to describe"),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ x, y, device_id }) => {
    const resolved = await resolveDevice(device_id);
    const dumpPath = path.join(tempDir, "window_dump.xml");

    await callAdbSilent(["shell", "uiautomator", "dump"], resolved);
    await callAdbSilent(
      ["pull", "/sdcard/window_dump.xml", dumpPath],
      resolved
    );
    await callAdbSilent(["shell", "rm", "/sdcard/window_dump.xml"], resolved);

    const xml = await readFile(dumpPath, "utf-8");
    await rm(dumpPath, { force: true });

    let bestNode: Record<string, string> | null = null;
    let bestArea = Infinity;

    const nodeRegex = /<node\s([^>]+)\/?>/g;
    let match;

    while ((match = nodeRegex.exec(xml)) !== null) {
      const attrsStr = match[1];
      const boundsMatch = attrsStr.match(/bounds="([^"]*)"/);
      if (!boundsMatch) continue;

      const parsed = parseXmlBounds(boundsMatch[1]);
      if (!parsed) continue;

      const [x1, y1, x2, y2] = parsed;
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        const area = (x2 - x1) * (y2 - y1);
        if (area < bestArea) {
          bestArea = area;
          const desc: Record<string, string> = {};
          const cls = attrsStr.match(/class="([^"]*)"/)?.[1] ?? "";
          if (cls) desc["class"] = cls.split(".").pop() ?? cls;
          for (const key of ["text", "content-desc", "resource-id", "bounds"]) {
            const val = attrsStr.match(new RegExp(`${key}="([^"]*)"`))
              ?.[1]
              ?.trim();
            if (val) desc[key] = val;
          }
          for (const key of [
            "clickable", "checkable", "checked", "scrollable", "focusable", "enabled",
          ]) {
            if (attrsStr.includes(`${key}="true"`)) desc[key] = "true";
          }
          bestNode = desc;
        }
      }
    }

    if (!bestNode) {
      return errorResult(`No UI element found at (${x}, ${y}).`);
    }

    return textResult(JSON.stringify(bestNode, null, 2));
  }
);

export const inputTap = tool(
  {
    name: "input_tap",
    description:
      "Taps on the screen of the connected Android device at the given coordinates. This tool is useful also to give the focus to edit boxes that accept text input.",
    inputSchema: z.object({
      x: z.number().describe("The x-coordinate of the point to tap"),
      y: z.number().describe("The y-coordinate of the point to tap"),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ x, y, device_id }) => {
    const resolved = await resolveDevice(device_id);
    await callAdbSilent(
      ["shell", "input", "tap", String(x), String(y)],
      resolved
    );
    return textResult(`Tapped at (${x}, ${y})`);
  }
);

export const inputSwipe = tool(
  {
    name: "input_swipe",
    description:
      "Swipes on the screen of the connected Android device from a starting point to an ending point.",
    inputSchema: z.object({
      x1: z.number().describe("The x-coordinate of the starting point of the swipe"),
      y1: z.number().describe("The y-coordinate of the starting point of the swipe"),
      x2: z.number().describe("The x-coordinate of the ending point of the swipe"),
      y2: z.number().describe("The y-coordinate of the ending point of the swipe"),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ x1, y1, x2, y2, device_id }) => {
    const resolved = await resolveDevice(device_id);
    await callAdbSilent(
      [
        "shell", "input", "swipe",
        String(x1), String(y1), String(x2), String(y2),
      ],
      resolved
    );
    return textResult(`Swiped from (${x1}, ${y1}) to (${x2}, ${y2})`);
  }
);

export const inputText = tool(
  {
    name: "input_text",
    description:
      "Sends the given text to the connected Android device, as if it were typed on a keyboard.",
    inputSchema: z.object({
      text_to_send: z.string().describe("The text to send"),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ text_to_send, device_id }) => {
    if (!text_to_send) {
      return errorResult("The 'text_to_send' argument cannot be empty.");
    }

    const resolved = await resolveDevice(device_id);
    const escaped = text_to_send.replace(/([ &'\\()"|;<>*?$`!#])/g, "\\$1");
    await callAdbSilent(["shell", "input", "text", escaped], resolved);
    return textResult(`Sent text: ${text_to_send}`);
  }
);

export const inputSystemAction = tool(
  {
    name: "input_system_action",
    description:
      "Performs a system action on the connected Android device, such as pressing the back button, going to the home screen, or opening the recent apps view.",
    inputSchema: z.object({
      action: z
        .enum(["BACK", "HOME", "RECENT_APPS"])
        .describe(
          "The system action to perform: BACK (press the system back button), HOME (go to the home screen), RECENT_APPS (open the recent apps view)."
        ),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ action, device_id }) => {
    const actionMap: Record<string, string> = {
      BACK: "KEYCODE_BACK",
      HOME: "KEYCODE_HOME",
      RECENT_APPS: "KEYCODE_RECENT_APPS",
    };

    const resolved = await resolveDevice(device_id);
    await callAdbSilent(
      ["shell", "input", "keyevent", actionMap[action]],
      resolved
    );
    return textResult(`Performed action: ${action}`);
  }
);

export const screenRecordStart = tool(
  {
    name: "screen_record_start",
    description:
      "Starts recording the screen of the connected Android device. The recording is saved to /sdcard/recording.mp4 on the device. Use screen_record_stop to stop recording and pull the file.",
    inputSchema: z.object({
      time_limit: z
        .number()
        .min(1)
        .max(180)
        .default(180)
        .describe("Maximum recording duration in seconds (max 180)."),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ time_limit, device_id }) => {
    const resolved = await resolveDevice(device_id);

    await callAdb(["shell", "pkill", "-f", "screenrecord"], resolved);
    await callAdb(["shell", "rm", "-f", "/sdcard/recording.mp4"], resolved);

    await callAdb(
      [
        "shell", "nohup", "screenrecord",
        "--time-limit", String(time_limit),
        "/sdcard/recording.mp4", "&",
      ],
      resolved
    );

    return textResult(
      `Screen recording started (max ${time_limit}s). Use screen_record_stop to stop and retrieve the file.`
    );
  }
);

export const screenRecordStop = tool(
  {
    name: "screen_record_stop",
    description:
      "Stops the screen recording on the connected Android device and pulls the file to the local machine.",
    inputSchema: z.object({
      save_path: z
        .string()
        .describe(
          "Absolute local path to save the recording to (e.g. '/tmp/recording.mp4')."
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

    await callAdb(["shell", "pkill", "-INT", "-f", "screenrecord"], resolved);
    await new Promise((r) => setTimeout(r, 2000));

    const check = await callAdb(
      ["shell", "ls", "/sdcard/recording.mp4"],
      resolved
    );
    if (check.exitCode !== 0 || check.stdout.includes("No such file")) {
      return errorResult(
        "No recording found on device. Was screen_record_start called?"
      );
    }

    await callAdbSilent(
      ["pull", "/sdcard/recording.mp4", save_path],
      resolved
    );
    await callAdb(["shell", "rm", "-f", "/sdcard/recording.mp4"], resolved);

    return textResult(`Recording saved to ${save_path}`);
  }
);

export const screenInteractionTools: ServerTool[] = [
  screenCapture,
  screenUiDump,
  screenDescribeAll,
  screenDescribePoint,
  inputTap,
  inputSwipe,
  inputText,
  inputSystemAction,
  screenRecordStart,
  screenRecordStop,
];
