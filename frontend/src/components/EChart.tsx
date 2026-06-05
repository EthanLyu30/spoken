import { useEffect, useRef } from "react";
import { init, use, type ECharts, type EChartsCoreOption } from "echarts/core";
import { LineChart, RadarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Register only what we use, so we don't ship all of ECharts.
use([LineChart, RadarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface EChartProps {
  option: EChartsCoreOption;
  height?: number;
  className?: string;
}

/** Minimal ECharts wrapper: inits once, updates on option change, auto-resizes. */
export function EChart({ option, height = 280, className }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} style={{ height }} className={className} />;
}
