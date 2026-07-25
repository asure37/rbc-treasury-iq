"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { RefreshCw } from "lucide-react";
import type { BankData, MetricKey } from "@/types/metrics";

interface Quote {
  bankId: string;
  ticker: string;
  price: number;
  priceToBook: number;
  bookValuePerShare: number;
  live: boolean;
  asOfClose?: string;
}
interface MarketResponse {
  asOf: string;
  live: boolean;
  source: string;
  quotes: Quote[];
}

interface BubbleDatum {
  bankId: string;
  name: string;
  bankName: string;
  x: number; // ROE %
  y: number; // Price / Book (×)
  z: number; // assets ($B)
  color: string;
  home?: boolean;
  price: number;
  bvps: number;
}

const latestOf = (b: BankData, key: MetricKey): number | null => {
  for (let i = b.quarters.length - 1; i >= 0; i--) {
    const v = b.quarters[i].metrics[key];
    if (v != null) return v;
  }
  return null;
};

export function ValuationBubble({ banks, height = 340 }: { banks: BankData[]; height?: number }) {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as MarketResponse);
      setStatus("ok");
    } catch {
      setStatus((s) => (s === "ok" ? "ok" : "error")); // keep prior data on a transient failure
    }
  }, []);

  useEffect(() => {
    // setState here happens only after the fetch resolves (async), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = setInterval(load, 60_000); // refresh every minute
    return () => clearInterval(id);
  }, [load]);

  const qmap = new Map((data?.quotes ?? []).map((q) => [q.bankId, q]));
  const points = banks
    .map((b): BubbleDatum | null => {
      const q = qmap.get(b.bankId);
      const roe = latestOf(b, "roe");
      const assets = latestOf(b, "totalAssetsBillions");
      if (!q || roe == null || assets == null) return null;
      return {
        bankId: b.bankId,
        name: b.ticker,
        bankName: b.bankName,
        x: roe,
        y: q.priceToBook,
        z: assets,
        color: b.colorHex,
        home: b.isHomeInstitution,
        price: q.price,
        bvps: q.bookValuePerShare,
      };
    })
    .filter((d): d is BubbleDatum => d !== null);

  const anyLive = data?.quotes.some((q) => q.live);
  const asOfLabel = data ? new Date(data.asOf).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-2 rounded-full ${anyLive ? "animate-pulse-glow bg-up" : "bg-warn"}`} />
          <span className={anyLive ? "font-semibold text-up" : "font-semibold text-warn"}>{anyLive ? "LIVE" : "Fallback"}</span>
          <span className="text-text-muted">
            {status === "loading" && !data ? "connecting…" : `price as of ${asOfLabel}`}
            {!anyLive && data ? " · disclosed Apr 30 close" : ""}
          </span>
        </span>
        <button
          onClick={load}
          title="Refresh prices"
          className="flex items-center gap-1 rounded-md border border-border-soft bg-surface px-2 py-0.5 text-text-muted transition-colors hover:border-rbc-cyan/50 hover:text-text-primary"
        >
          <RefreshCw className={`size-3 ${status === "loading" ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {points.length === 0 ? (
        <div className="flex items-center justify-center text-sm text-text-muted" style={{ height }}>
          {status === "error" ? "Live price feed unavailable." : "Loading live valuations…"}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <ScatterChart margin={{ top: 20, right: 30, bottom: 10, left: 0 }}>
            <CartesianGrid stroke="rgba(140,175,220,0.08)" />
            <XAxis
              type="number"
              dataKey="x"
              name="ROE"
              unit="%"
              stroke="#6b7f9e"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={["dataMin - 1", "dataMax + 1"]}
              label={{ value: "Return on Equity (ROE)", position: "insideBottom", offset: -4, fill: "#a8bbd6", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="P/B"
              unit="×"
              stroke="#6b7f9e"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              domain={["dataMin - 0.2", "dataMax + 0.2"]}
              label={{ value: "Price / Book (×)", angle: -90, position: "insideLeft", fill: "#a8bbd6", fontSize: 11 }}
            />
            <ZAxis type="number" dataKey="z" range={[600, 2600]} name="Assets" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: "rgba(140,175,220,0.3)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload as BubbleDatum;
                return (
                  <div className="glass-panel rounded-lg px-3 py-2 text-xs shadow-xl">
                    <div className="mb-1 flex items-center gap-1.5 font-medium text-text-secondary">
                      <span className="inline-block size-2 rounded-full" style={{ background: d.color }} />
                      {d.bankName}
                    </div>
                    <div className="space-y-0.5 tabular-nums text-text-primary">
                      <div>
                        Price / Book: <span className="font-semibold">{d.y.toFixed(2)}×</span>
                      </div>
                      <div>
                        ROE: <span className="font-semibold">{d.x.toFixed(1)}%</span>
                      </div>
                      <div className="text-text-muted">
                        ${d.price.toFixed(2)} price ÷ ${d.bvps.toFixed(2)} book/sh
                      </div>
                      <div className="text-text-muted">Assets: ${d.z.toLocaleString()}B</div>
                    </div>
                  </div>
                );
              }}
            />
            {points.map((d) => (
              <Scatter
                key={d.bankId}
                name={d.name}
                data={[d]}
                fill={d.color}
                fillOpacity={d.home ? 0.9 : 0.55}
                stroke={d.home ? "#fff" : d.color}
                strokeWidth={d.home ? 1.5 : 0}
                isAnimationActive
                animationDuration={500}
              >
                <LabelList dataKey="name" position="top" fill="#eef4fc" fontSize={11} fontWeight={600} />
              </Scatter>
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
