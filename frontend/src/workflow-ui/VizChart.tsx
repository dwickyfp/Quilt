import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { rowsToSeries, type VizRow } from './viz-chart-data';

type Props = {
    chart: string;
    rows: VizRow[];
};

const CHART_HEIGHT = 240;

/**
 * Renders a NodePreview for a viz node as a uPlot chart. Pure data-shaping
 * lives in viz-chart-data.ts; this component owns only the DOM lifecycle.
 */
export default function VizChart({ chart, rows }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || rows.length === 0) return;

        const { data, labels } = rowsToSeries(rows, chart);
        const width = container.clientWidth || 320;

        const isScatter = chart === 'scatter';
        const isBars = chart === 'bar' || chart === 'histogram';

        const opts: uPlot.Options = {
            width,
            height: CHART_HEIGHT,
            // Axis labels: categorical charts map indices back to their x label.
            axes: [
                isScatter
                    ? {}
                    : {
                          values: (_u, splits) =>
                              splits.map(s => labels[s] ?? ''),
                      },
                {},
            ],
            scales: { x: { time: false } },
            series: [
                {},
                isScatter
                    ? {
                          // Points only: no connecting line.
                          paths: () => null,
                          points: { show: true, size: 6 },
                          stroke: '#a371f7',
                      }
                    : isBars
                      ? {
                            paths: uPlot.paths.bars?.({ size: [0.6, 100] }),
                            stroke: '#a371f7',
                            fill: 'rgba(163, 113, 247, 0.4)',
                        }
                      : {
                            // line chart
                            stroke: '#a371f7',
                            width: 2,
                            points: { show: true, size: 4 },
                        },
            ],
            legend: { show: false },
        };

        const plot = new uPlot(opts, data, container);
        return () => plot.destroy();
    }, [chart, rows]);

    if (rows.length === 0) {
        return <div className="preview-empty-desc">No data to chart.</div>;
    }

    return (
        <div
            ref={containerRef}
            role="img"
            aria-label={`${chart} chart of the node preview, ${rows.length} data point${rows.length === 1 ? '' : 's'}`}
        />
    );
}
