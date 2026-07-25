import { readFile, writeFile, copyFile } from "fs/promises";
import path from "path";
import { getMetricsMeta } from "@/lib/data";
import { parsePeriod, makeQuarterId, type ProposedQuarter } from "@/lib/quarters";
import { buildQuarterMetrics } from "@/lib/refresh";
import type { BankData, MetricKey } from "@/types/metrics";

export const runtime = "nodejs";

const BANKS_DIR = path.join(process.cwd(), "data", "banks");

interface ApplyRequestBody {
  updates: ProposedQuarter[];
}

interface ApplyOutcome {
  bankId: string;
  applied: boolean;
  reason?: string;
  backup?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ApplyRequestBody | null;
  if (!body || !Array.isArray(body.updates)) {
    return Response.json({ error: "Expected { updates: ProposedQuarter[] }" }, { status: 400 });
  }

  const metricsMeta = (await getMetricsMeta()).metrics;
  const validMetricKeys = new Set(metricsMeta.map((m) => m.key));
  const outcomes: ApplyOutcome[] = [];

  for (const update of body.updates) {
    // Only apply genuine proposals with a real source.
    if (update.status !== "proposed" || !update.reportUrl || !update.reportName) {
      outcomes.push({ bankId: update.bankId, applied: false, reason: "Not a complete, sourced proposal." });
      continue;
    }

    // Guard the bankId to a safe, known file name (no path traversal).
    if (!/^[a-z0-9_-]+$/.test(update.bankId)) {
      outcomes.push({ bankId: update.bankId, applied: false, reason: "Invalid bank id." });
      continue;
    }
    const filePath = path.join(BANKS_DIR, `${update.bankId}.json`);

    let bank: BankData;
    try {
      bank = JSON.parse(await readFile(filePath, "utf-8")) as BankData;
    } catch {
      outcomes.push({ bankId: update.bankId, applied: false, reason: "Bank data file not found." });
      continue;
    }

    const target = parsePeriod(update.targetPeriod);
    if (!target) {
      outcomes.push({ bankId: update.bankId, applied: false, reason: "Invalid target period." });
      continue;
    }
    if (bank.quarters.some((q) => q.period === update.targetPeriod)) {
      outcomes.push({ bankId: update.bankId, applied: false, reason: `${update.targetPeriod} already present.` });
      continue;
    }

    // Re-sanitize metrics/notes to our known keys before writing.
    const metrics: Partial<Record<MetricKey, number | null>> = {};
    const notes: Partial<Record<MetricKey, string>> = {};
    for (const [k, v] of Object.entries(update.metrics ?? {})) {
      if (!validMetricKeys.has(k as MetricKey)) continue;
      if (v == null || (typeof v === "number" && Number.isFinite(v))) metrics[k as MetricKey] = v as number | null;
    }
    for (const [k, v] of Object.entries(update.notes ?? {})) {
      if (validMetricKeys.has(k as MetricKey) && typeof v === "string") notes[k as MetricKey] = v;
    }

    const quarterId = makeQuarterId(target.quarter, target.year);
    const newQuarter = buildQuarterMetrics(quarterId, update.reportName, update.reportUrl, metrics, notes, metricsMeta);

    // Back up the current file before mutating, so an update is always reversible.
    const backupPath = `${filePath}.bak-${Date.now()}`;
    try {
      await copyFile(filePath, backupPath);
      bank.quarters = [...bank.quarters, newQuarter];
      await writeFile(filePath, JSON.stringify(bank, null, 2) + "\n");
      outcomes.push({ bankId: update.bankId, applied: true, backup: path.basename(backupPath) });
    } catch {
      outcomes.push({ bankId: update.bankId, applied: false, reason: "Failed to write update." });
    }
  }

  return Response.json({ outcomes });
}
