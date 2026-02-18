import { z, ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ServerTool {
  name: string;
  description: string;
  inputSchema: ReturnType<typeof zodToJsonSchema>;
  _zodSchema: ZodTypeAny;
  fn: (input: any) => Promise<CallToolResult>;
}

export function tool<InputSchema extends ZodTypeAny>(
  options: {
    name: string;
    description: string;
    inputSchema: InputSchema;
  },
  fn: (input: z.infer<InputSchema>) => Promise<CallToolResult>
): ServerTool {
  return {
    name: options.name,
    description: options.description,
    inputSchema: zodToJsonSchema(options.inputSchema),
    _zodSchema: options.inputSchema,
    fn: fn as ServerTool["fn"],
  };
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function imageResult(base64Data: string, mimeType: string): CallToolResult {
  return {
    content: [{ type: "image", data: base64Data, mimeType }],
  };
}
