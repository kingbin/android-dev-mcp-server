import { z } from "zod";
import { tool, textResult, ServerTool } from "../tool.js";
import { callAdbSilent, resolveDevice } from "../adb.js";

export const rnReversePort = tool(
  {
    name: "rn_reverse_port",
    description: "Starts the ADB reverse port for react-native projects.",
    inputSchema: z.object({
      lport: z.number().default(8081).describe("The Local Port"),
      rport: z.number().default(8081).describe("The Remote Port"),
      device_id: z
        .string()
        .optional()
        .describe(
          "Target device serial number. Optional if only one device is connected."
        ),
    }),
  },
  async ({ lport, rport, device_id }) => {
    const resolved = await resolveDevice(device_id);
    await callAdbSilent(
      ["reverse", `tcp:${lport}`, `tcp:${rport}`],
      resolved
    );
    return textResult("success");
  }
);

export const rnOpenDevMenu = tool(
  {
    name: "rn_open_dev_menu",
    description:
      "Opens the React Native developer menu on the connected Android device by sending keyevent 82 (KEYCODE_MENU).",
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
    await callAdbSilent(["shell", "input", "keyevent", "82"], resolved);
    return textResult("React Native dev menu opened");
  }
);

export const reactNativeTools: ServerTool[] = [rnReversePort, rnOpenDevMenu];
