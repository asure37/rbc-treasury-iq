// Shared between the server-side render_chart tool (which validates the
// model's tool call against the real dataset) and the client-side renderer
// (which resolves this spec against live dashboard data — the model never
// supplies actual numbers, only what to show).
export type ChartType = "trend_line" | "peer_bar" | "radar" | "share_pie" | "bubble";

export interface ChartSpec {
  chartType: ChartType;
  title: string;
  metricKey?: string;
  yMetricKey?: string;
  sizeMetricKey?: string;
  metricKeys?: string[];
  bankIds?: string[];
  period?: string;
  periods?: string[];
}
