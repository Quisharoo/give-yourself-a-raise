import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CAPTURE_ROOT = join(process.cwd(), ".local", "enable-banking-captures");
const RUN_ID = new Date().toISOString().replaceAll(":", "-");

type CapturePayload = {
  data: unknown;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

export function shouldCaptureEnableBankingData() {
  return process.env.ENABLE_BANKING_CAPTURE_LOCAL === "1";
}

export async function writeEnableBankingCapture(
  name: string,
  payload: CapturePayload,
) {
  if (!shouldCaptureEnableBankingData()) {
    return;
  }

  const runDirectory = join(CAPTURE_ROOT, RUN_ID);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const safeName = name.replaceAll(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const targetPath = join(runDirectory, `${timestamp}-${safeName}.json`);

  const document = {
    capturedAt: new Date().toISOString(),
    meta: payload.meta ?? {},
    runId: RUN_ID,
    data: payload.data,
  };

  try {
    await mkdir(runDirectory, { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("Enable Banking local capture failed", error);
  }
}
