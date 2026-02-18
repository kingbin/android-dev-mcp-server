import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";

export async function which(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("which", [binary], (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(null);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
