import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import {
    BarChart,
    LineChart,
    ScatterChart,
    PieChart,
    BoxplotChart,
    HeatmapChart,
} from 'echarts/charts';
import {
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    TitleComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { buildVizOption, type VizRow } from './viz-chart-data';

echarts.use([
    BarChart,
    LineChart,
    ScatterChart,
    PieChart,
    BoxplotChart,
    HeatmapChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    TitleComponent,
    CanvasRenderer,
]);

type Props = {
    chart: string;
    rows: VizRow[];
};

const CHART_HEIGHT = 260;

/**
 * Renders a NodePreview for a viz node as an Apache ECharts chart. Pure
 * option-building lives in viz-chart-data.ts; this component owns only the
 * DOM lifecycle (init, resize, dispose).
 */
export default function VizChart({ chart, rows }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || rows.length === 0) return;

        const instance = echarts.init(container, null, {
            renderer: 'canvas',
            height: CHART_HEIGHT,
        });
        const option = buildVizOption(rows, chart);
        // Dark-theme axis/label defaults applied globally so each builder stays
        // focused on data, not chrome.
        instance.setOption({
            backgroundColor: 'transparent',
            textStyle: { color: '#8b949e' },
            ...option,
        });

        const resize = () => instance.resize();
        const ro = new ResizeObserver(resize);
        ro.observe(container);

        return () => {
            ro.disconnect();
            instance.dispose();
        };
    }, [chart, rows]);

    if (rows.length === 0) {
        return <div className="preview-empty-desc">No data to chart.</div>;
    }

    return (
        <div
            ref={containerRef}
            style={{ width: '100%', height: CHART_HEIGHT }}
            role="img"
            aria-label={`${chart} chart of the node preview, ${rows.length} data point${rows.length === 1 ? '' : 's'}`}
        />
    );
}
