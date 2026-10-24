/**
 * Small single-series charts in plain SVG (no chart library). One hue per chart (--series, validated against
 * every reading theme's surface), thin marks with rounded data ends, recessive axes, a tooltip on every mark
 * (tap on a phone), and the numbers as a table for anyone who'd rather read them.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';

export function useSeriesColor(): string {
  return useTheme().palette.mode === 'dark' ? '#3987e5' : '#2a78d6';
}

export interface Datum {
  label: string; // axis label (short)
  value: number | null;
  tip: string; // tooltip text
}

const H = 140;
const PAD = { top: 10, right: 6, bottom: 22, left: 34 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) ?? v;
}

/** Which axis labels to show so they don't crowd: about six */
const every = (n: number) => Math.max(1, Math.ceil(n / 7));

function Frame({ width, max, format, children, labels }: {
  width: number; max: number; format: (v: number) => string; children: ReactNode; labels: string[];
}) {
  const innerH = H - PAD.top - PAD.bottom;
  const step = (width - PAD.left - PAD.right) / Math.max(1, labels.length);
  const k = every(labels.length);
  return (
    <svg viewBox={`0 0 ${width} ${H}`} width="100%" height={H} role="img" style={{ display: 'block', overflow: 'visible' }}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + innerH * (1 - f)} y2={PAD.top + innerH * (1 - f)}
            stroke="currentColor" strokeOpacity={f === 0 ? 0.35 : 0.12} />
          <text x={PAD.left - 6} y={PAD.top + innerH * (1 - f) + 4} textAnchor="end" fontSize="10" fill="currentColor" opacity={0.6}>
            {format(max * f)}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (i % k === 0 || i === labels.length - 1) && (
        <text key={i} x={PAD.left + step * (i + 0.5)} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor" opacity={0.6}>{l}</text>
      ))}
      {children}
    </svg>
  );
}

function useWidth(): [number, RefObject<HTMLDivElement | null>] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [width, ref];
}

/** Bars from a baseline; an optional dashed reference line (the daily goal). */
export function BarChart({ data, format, reference, referenceLabel }: {
  data: Datum[]; format: (v: number) => string; reference?: number; referenceLabel?: string;
}) {
  const color = useSeriesColor();
  const [width, ref] = useWidth();
  const max = niceMax(Math.max(reference ?? 0, ...data.map((d) => d.value ?? 0)));
  const innerH = H - PAD.top - PAD.bottom;
  const step = (width - PAD.left - PAD.right) / Math.max(1, data.length);
  const bar = Math.min(24, step - 2);
  const y = (v: number) => PAD.top + innerH * (1 - v / max);
  return (
    <Box ref={ref} sx={{ color: 'text.secondary' }}>
      <Frame width={width} max={max} format={format} labels={data.map((d) => d.label)}>
        {reference !== undefined && reference > 0 && (
          <g>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(reference)} y2={y(reference)} stroke="currentColor"
              strokeDasharray="4 3" strokeOpacity={0.7} />
            {referenceLabel && <text x={width - PAD.right} y={y(reference) - 4} textAnchor="end" fontSize="10" fill="currentColor">{referenceLabel}</text>}
          </g>
        )}
        {data.map((d, i) => {
          const x = PAD.left + step * i + (step - bar) / 2;
          const v = d.value ?? 0;
          const top = y(v);
          const h = PAD.top + innerH - top;
          const r = Math.min(4, h / 2, bar / 2);
          return (
            <Tooltip key={i} title={d.tip} enterTouchDelay={0} arrow placement="top">
              <g>
                <rect x={PAD.left + step * i} y={PAD.top} width={step} height={innerH} fill="transparent" />
                {v > 0 && (
                  <path fill={color} d={`M${x},${PAD.top + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bar - r}
                    Q${x + bar},${top} ${x + bar},${top + r} V${PAD.top + innerH} Z`} />
                )}
              </g>
            </Tooltip>
          );
        })}
      </Frame>
    </Box>
  );
}

/** A 2px line with 8px points; null values leave a gap. */
export function LineChart({ data, format }: { data: Datum[]; format: (v: number) => string }) {
  const color = useSeriesColor();
  const theme = useTheme();
  const [width, ref] = useWidth();
  const max = niceMax(Math.max(...data.map((d) => d.value ?? 0)));
  const innerH = H - PAD.top - PAD.bottom;
  const step = (width - PAD.left - PAD.right) / Math.max(1, data.length);
  const px = (i: number) => PAD.left + step * (i + 0.5);
  const py = (v: number) => PAD.top + innerH * (1 - v / max);
  const runs: string[] = [];
  let run = '';
  data.forEach((d, i) => {
    if (d.value === null) { if (run) runs.push(run); run = ''; return; }
    run += `${run ? 'L' : 'M'}${px(i)},${py(d.value)} `;
  });
  if (run) runs.push(run);
  return (
    <Box ref={ref} sx={{ color: 'text.secondary' }}>
      <Frame width={width} max={max} format={format} labels={data.map((d) => d.label)}>
        {runs.map((r, i) => <path key={i} d={r} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        {data.map((d, i) => d.value !== null && (
          <Tooltip key={i} title={d.tip} enterTouchDelay={0} arrow placement="top">
            <g>
              <rect x={PAD.left + step * i} y={PAD.top} width={step} height={innerH} fill="transparent" />
              <circle cx={px(i)} cy={py(d.value)} r={4} fill={color} stroke={theme.palette.background.paper} strokeWidth={2} />
            </g>
          </Tooltip>
        ))}
      </Frame>
    </Box>
  );
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Reading time by weekday and hour: one hue, lighter = less. */
export function Heatmap({ cells, format }: { cells: number[][]; format: (seconds: number) => string }) {
  const color = useSeriesColor();
  const max = Math.max(1, ...cells.flat());
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '34px repeat(24, minmax(10px, 1fr))', gap: '2px', minWidth: 320,
        fontSize: 10, color: 'text.secondary', alignItems: 'center' }}>
        {cells.map((row, d) => [
          <span key={`l${d}`}>{DAYS[d]}</span>,
          ...row.map((v, h) => (
            <Tooltip key={`${d}-${h}`} title={`${DAYS[d]} ${h}:00–${h + 1}:00 · ${v ? format(v) : 'no reading'}`} enterTouchDelay={0} arrow>
              <Box sx={{ aspectRatio: '1', borderRadius: '2px', bgcolor: v ? color : 'action.hover',
                opacity: v ? 0.2 + 0.8 * (v / max) : 1 }} />
            </Tooltip>
          )),
        ])}
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={`h${h}`} style={{ textAlign: 'center' }}>{h % 6 === 0 ? h : ''}</span>
        ))}
      </Box>
    </Box>
  );
}

/** The chart's numbers as a table, folded away. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <Box component="details" sx={{ mt: 0.5, fontSize: 13, color: 'text.secondary', '& summary': { cursor: 'pointer' } }}>
      <summary>Show as table</summary>
      <Box component="table" sx={{ mt: 1, borderCollapse: 'collapse', '& td, & th': { pr: 2, py: 0.25, textAlign: 'left' } }}>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </Box>
    </Box>
  );
}

/** A ring for today's goal: share of the minutes read. */
export function GoalRing({ fraction, size = 72, children }: { fraction: number; size?: number; children?: ReactNode }) {
  const color = useSeriesColor();
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>{children}</Typography>
      </Box>
    </Box>
  );
}
