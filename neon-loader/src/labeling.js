import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function extractLabelCodeFromFilename(filename) {
  const base = String(filename || "");
  const mbMatch = base.match(/mb[-_]?(\d{3})/i);
  if (mbMatch) return mbMatch[1];

  const underscoreMatch = base.match(/[_-](\d{3})(?:\D|$)/);
  if (underscoreMatch) return underscoreMatch[1];

  const anyMatch = base.match(/(\d{3})/);
  return anyMatch ? anyMatch[1] : "unknown";
}

export async function loadLabelMap(labelMapPath = process.env.LABEL_MAP_PATH) {
  const resolvedPath =
    labelMapPath || path.resolve(__dirname, "..", "label-map.json");
  const content = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || !parsed.labels) {
    throw new Error("Invalid label-map.json format");
  }
  return parsed;
}

export function resolveLabel(labelMapConfig, filename) {
  const labelMap = labelMapConfig.labels || {};
  const code = extractLabelCodeFromFilename(filename);
  if (code === "unknown") {
    return {
      labelCode: "unknown",
      labelName: "Unknown Label",
      deviceAddress: "unknown",
      physicalGroup: "unknown",
      schemaId: "default_v1",
      hasData: true,
    };
  }
  const match = labelMap[code];
  if (!match) {
    return {
      labelCode: code,
      labelName: "Unknown Label",
      deviceAddress: `mb-${code}`,
      physicalGroup: "unknown",
      schemaId: "default_v1",
      hasData: true,
    };
  }
  return {
    labelCode: code,
    labelName: match.labelName || `Label ${code}`,
    deviceAddress: match.deviceAddress || `mb-${code}`,
    physicalGroup: match.physicalGroup || "unknown",
    schemaId: match.schemaId || "default_v1",
    hasData: match.hasData !== false,
  };
}
