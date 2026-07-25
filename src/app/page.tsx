import { getAllBankData, getMetricsMeta, getAllPeriods } from "@/lib/data";
import { AppGate } from "@/components/auth/AppGate";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [banks, metricsMeta] = await Promise.all([getAllBankData(), getMetricsMeta()]);
  const periods = getAllPeriods(banks);

  return (
    <AppGate
      data={{
        banks,
        metricsMeta: metricsMeta.metrics,
        periods,
        generatedAt: metricsMeta.generatedAt,
        sourceMethodology: metricsMeta.sourceMethodology,
      }}
    />
  );
}
