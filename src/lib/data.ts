import { readdir, readFile } from "fs/promises";
import path from "path";
import type { BankData, MetricMeta } from "@/types/metrics";

const DATA_DIR = path.join(process.cwd(), "data");
const BANKS_DIR = path.join(DATA_DIR, "banks");

export async function getAllBankData(): Promise<BankData[]> {
  let files: string[] = [];
  try {
    files = await readdir(BANKS_DIR);
  } catch {
    return [];
  }

  const banks = await Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .map(async (f) => {
        try {
          const raw = await readFile(path.join(BANKS_DIR, f), "utf-8");
          return JSON.parse(raw) as BankData;
        } catch {
          return null;
        }
      })
  );

  const valid = banks.filter((b): b is BankData => b !== null && Array.isArray(b.quarters));

  // Home institution first, then alphabetical by name.
  valid.sort((a, b) => {
    if (a.isHomeInstitution && !b.isHomeInstitution) return -1;
    if (!a.isHomeInstitution && b.isHomeInstitution) return 1;
    return a.bankName.localeCompare(b.bankName);
  });

  return valid;
}

export async function getMetricsMeta(): Promise<{
  generatedAt: string;
  sourceMethodology: string;
  metrics: MetricMeta[];
}> {
  const raw = await readFile(path.join(DATA_DIR, "metrics-meta.json"), "utf-8");
  return JSON.parse(raw);
}

// Union of every fiscal period present across all banks, chronologically ordered
// by periodEnd. Used to build a consistent x-axis even when banks have gaps.
export function getAllPeriods(banks: BankData[]): { period: string; periodEnd: string }[] {
  const map = new Map<string, string>();
  for (const bank of banks) {
    for (const q of bank.quarters) {
      map.set(q.period, q.periodEnd);
    }
  }
  return Array.from(map.entries())
    .map(([period, periodEnd]) => ({ period, periodEnd }))
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}
