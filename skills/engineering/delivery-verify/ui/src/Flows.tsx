import { Flexbox } from '@lobehub/ui';
import { Select, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, RetryIcon, SkipBlockIcon } from '@unlocalhosted/dither-icons';
import { Focus, LayoutGrid, Layers, Maximize2, Minimize2, Minus, Paperclip, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Draft } from './feedback';
import type { Closed, History, Verdict } from './history';
import { G } from './icons';
import { STATUS } from './status';
import type { Flow, Report } from './types';

const W = 224; // card width
const H = 124; // card height
const GAP = 190; // between cards in a row, where the arrow label sits
const HEAD = 52; // flow title strip
const ROW = H + HEAD + 70;
const MIN = 0.25;
const MAX = 2.5;

const styles = createStaticStyles(({ css }) => ({
  meta: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  crumb: css`
    cursor: pointer;
    padding: 2px 10px;
    border: 0;
    border-radius: 12px;
    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    background: transparent;

    &[aria-pressed='true'] {
      color: #fff;
      background: var(--brand);
    }

    &:not([aria-pressed='true']):hover {
      color: var(--brand);
      background: var(--brand-tint);
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  stage: css`
    position: relative;
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background-color: ${cssVar.colorFillQuaternary};
    background-image: radial-gradient(${cssVar.colorBorderSecondary} 1px, transparent 1px);
    background-size: 22px 22px;
    cursor: grab;
    user-select: none;

    &:active {
      cursor: grabbing;
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  world: css`
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    transform-origin: 0 0;
  `,
  node: css`
    cursor: pointer;
    position: absolute;
    box-sizing: border-box;
    width: ${W}px;
    height: ${H}px;
    overflow: hidden;
    padding: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    text-align: start;
    background: ${cssVar.colorBgContainer};
    transition: border-color 0.2s, box-shadow 0.2s;

    &:hover,
    &:focus-visible {
      border-color: var(--brand-soft);
      box-shadow: 0 6px 20px -12px var(--brand);
      outline: none;
    }

    &[data-dragging] {
      cursor: grabbing;
      border-color: var(--brand);
      box-shadow: 0 12px 28px -12px var(--brand);
    }
  `,
  title: css`
    display: -webkit-box;
    overflow: hidden;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorText};
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  note: css`
    display: -webkit-box;
    overflow: hidden;
    margin-block-start: 6px;
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextTertiary};
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  `,
  stat: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
  head: css`
    position: absolute;
    display: flex;
    gap: 8px;
    align-items: center;
    height: 32px;
    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorText};
    white-space: nowrap;
  `,
  pill: css`
    position: absolute;
    width: max-content;
    max-width: ${GAP - 40}px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
    background: ${cssVar.colorBgContainer};
    border: 1px solid ${cssVar.colorBorderSecondary};
    transform: translate(-50%, -50%);
    pointer-events: none;
  `,
  tools: css`
    position: absolute;
    inset-block-end: 10px;
    inset-inline-start: 10px;
    display: flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;
    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  tool: css`
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 30px;
    height: 30px;
    padding-inline: 8px;
    border: 0;
    border-radius: 8px;
    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    background: none;

    &:hover {
      color: var(--brand);
      background: var(--brand-tint);
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  mini: css`
    position: absolute;
    inset-block-end: 10px;
    inset-inline-end: 10px;
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};

    @media (width <= 700px) {
      display: none;
    }
  `,
  hint: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 12px;
    font-size: 11px;
    color: ${cssVar.colorTextQuaternary};
    pointer-events: none;
  `,
  overlay: css`
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: ${cssVar.colorBgContainer};
  `,
}));

type Rect = { x: number; y: number; w: number; h: number };

/** What the reader decided about a check, or else how the Agent's own run of it ended. */
function Mark({ status, decision }: { status: string; decision?: Verdict }) {
  if (decision === 'accept') return <span style={{ color: cssVar.colorSuccess, display: 'inline-flex' }}><G icon={CheckIcon} size={16} /></span>;
  if (decision === 'reject') return <span style={{ color: cssVar.colorError, display: 'inline-flex' }}><G icon={RetryIcon} size={16} /></span>;
  if (decision === 'ignore') return <span style={{ color: cssVar.colorTextQuaternary, display: 'inline-flex' }}><G icon={SkipBlockIcon} size={16} /></span>;
  const meta = STATUS[status as keyof typeof STATUS] ?? STATUS.pending;
  return <span style={{ color: meta.color, display: 'inline-flex' }}><G icon={meta.icon} size={16} /></span>;
}

export interface Step {
  id: string;
  title: string;
  status: string;
  note?: string;
  files: number;
  rounds: number;
  decision?: Verdict;
}

interface Node { key: string; step: Step; x: number; y: number }
interface Head { key: string; flow?: Flow; title: string; line: string; x: number; y: number }
interface Edge { from: string; to: string; label?: string }

/** Lay the flows out as rows of cards, one row per flow with its title above, and the checks in no flow in a last row. */
function layout(flows: Flow[], steps: Step[]) {
  const nodes: Node[] = [];
  const heads: Head[] = [];
  const edges: Edge[] = [];
  let row = 0;
  for (const flow of flows) {
    const inside = flow.steps.map((entry) => ({ entry, step: steps.find((item) => item.id === entry.case) })).filter((item): item is { entry: Flow['steps'][number]; step: Step } => Boolean(item.step));
    const ok = inside.filter((item) => item.step.decision === 'accept').length;
    heads.push({ key: `head:${flow.id}`, flow, title: flow.title, line: `${inside.length} 步${ok ? ` · ${ok} 已接受` : ''}`, x: 0, y: row * ROW });
    let before: string | undefined;
    inside.forEach(({ entry, step }, index) => {
      const key = `${flow.id}:${index}:${step.id}`;
      nodes.push({ key, step, x: index * (W + GAP), y: row * ROW + HEAD });
      if (before) edges.push({ from: before, to: key, label: entry.label });
      before = key;
    });
    row++;
  }
  const inFlows = new Set(flows.flatMap((flow) => flow.steps.map((entry) => entry.case)));
  const alone = steps.filter((step) => !inFlows.has(step.id));
  if (alone.length) {
    heads.push({ key: 'head:alone', title: flows.length ? '没有归入流程的验收项' : '验收项', line: `${alone.length} 项`, x: 0, y: row * ROW });
    alone.forEach((step, index) => nodes.push({ key: `alone:${step.id}`, step, x: index * (W + 40), y: row * ROW + HEAD }));
  }
  return { nodes, heads, edges };
}

interface CanvasProps {
  nodes: Node[];
  heads: Head[];
  edges: Edge[];
  height: number | string;
  offsets: Record<string, [number, number]>;
  onOffsets: (next: Record<string, [number, number]>) => void;
  onOpen: (id: string) => void;
  /** which node keys to frame when asked to fit */
  focus: string[];
  fullscreen?: boolean;
  onFullscreen: () => void;
  fitKey: string;
}

function Canvas({ nodes, heads, edges, height, offsets, onOffsets, onOpen, focus, fullscreen, onFullscreen, fitKey }: CanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 24, y: 24, z: 1 });
  const [size, setSize] = useState({ w: 800, h: 420 });
  const [dragging, setDragging] = useState<string>();
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: 'pan' | 'node' | 'pinch'; key?: string; startX: number; startY: number; view: typeof view; base?: [number, number]; moved: boolean; dist?: number } | null>(null);
  const place = useCallback((n: { key: string; x: number; y: number }) => ({ x: n.x + (offsets[n.key]?.[0] ?? 0), y: n.y + (offsets[n.key]?.[1] ?? 0) }), [offsets]);
  const rects = useMemo<Record<string, Rect>>(() => Object.fromEntries(nodes.map((n) => [n.key, { ...place(n), w: W, h: H }])), [nodes, place]);

  const bounds = useCallback(
    (keys: string[]) => {
      const list = [
        ...nodes.filter((n) => !keys.length || keys.includes(n.key)).map((n) => rects[n.key]),
        ...heads.filter((h) => !keys.length || keys.some((k) => k.startsWith(h.key.replace('head:', '')))).map((h) => ({ x: h.x, y: h.y, w: 260, h: 32 })),
      ];
      if (!list.length) return { x: 0, y: 0, w: W, h: H };
      const x0 = Math.min(...list.map((r) => r.x));
      const y0 = Math.min(...list.map((r) => r.y));
      const x1 = Math.max(...list.map((r) => r.x + r.w));
      const y1 = Math.max(...list.map((r) => r.y + r.h));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    [nodes, heads, rects],
  );
  const fit = useCallback(
    (keys = focus) => {
      const b = bounds(keys);
      const room = size.h - 64; // keep the tool strip at the bottom clear of the cards
      const z = Math.min(1.2, Math.max(MIN, Math.min((size.w - 56) / b.w, (room - 24) / b.h)));
      setView({ z, x: (size.w - b.w * z) / 2 - b.x * z, y: Math.max(16, (room - b.h * z) / 2) - b.y * z });
    },
    [bounds, focus, size],
  );

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // frame what is asked for when the picture, the round, the focus or the window changes (not on every drag)
  useEffect(() => fit(), [fitKey, size.w, size.h]);

  const zoomAt = (px: number, py: number, factor: number) =>
    setView((v) => {
      const z = Math.min(MAX, Math.max(MIN, v.z * factor));
      return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z };
    });
  const center = () => [size.w / 2, size.h / 2] as const;

  useEffect(() => {
    // zoom with ⌘ or Ctrl and the wheel; a plain wheel keeps scrolling the page
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey || fullscreen)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fullscreen]);

  const local = (event: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const down = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('[data-tool]')) return;
    box.current!.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-node]');
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { mode: 'pinch', startX: 0, startY: 0, view, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const p = local(event);
    gesture.current = { mode: hit ? 'node' : 'pan', key: hit?.dataset.node, startX: p.x, startY: p.y, view, base: hit ? (offsets[hit.dataset.node!] ?? [0, 0]) : undefined, moved: false };
  };
  const move = (event: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(event.pointerId)) return;
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    if (g.mode === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / g.dist);
      g.dist = dist;
      return;
    }
    const dx = p.x - g.startX;
    const dy = p.y - g.startY;
    if (!g.moved && Math.hypot(dx, dy) < 5) return;
    g.moved = true;
    if (g.mode === 'pan') setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    else if (g.mode === 'node' && g.key) {
      setDragging(g.key);
      onOffsets({ ...offsets, [g.key]: [g.base![0] + dx / g.view.z, g.base![1] + dy / g.view.z] });
    }
  };
  const up = (event: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    setDragging(undefined);
    if (g && g.mode === 'node' && !g.moved && g.key) {
      const node = nodes.find((n) => n.key === g.key);
      if (node) onOpen(node.step.id);
    }
  };

  const panBy = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  const total = bounds([]);
  const MINI = { w: 168, h: 100 };
  const scale = Math.min(MINI.w / (total.w + 80), MINI.h / (total.h + 80));
  const dirty = Object.keys(offsets).length > 0;

  return (
    <div
      aria-label={'用户流程画布：拖动平移，拖卡片调整位置，点卡片打开验收项；⌘ 或 Ctrl 加滚轮缩放；方向键平移，+ − 缩放，0 适应'}
      className={styles.stage}
      ref={box}
      role={'application'}
      style={{ height, touchAction: fullscreen ? 'none' : 'pan-y' }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') panBy(48, 0);
        else if (event.key === 'ArrowRight') panBy(-48, 0);
        else if (event.key === 'ArrowUp') panBy(0, 48);
        else if (event.key === 'ArrowDown') panBy(0, -48);
        else if (event.key === '+' || event.key === '=') zoomAt(...center(), 1.2);
        else if (event.key === '-') zoomAt(...center(), 1 / 1.2);
        else if (event.key === '0') fit();
        else return;
        event.preventDefault();
      }}
      onPointerCancel={up}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    >
      <div className={styles.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <svg height={1} overflow={'visible'} style={{ position: 'absolute', left: 0, pointerEvents: 'none', top: 0 }} width={1}>
          <defs>
            <marker id={'flow-arrow'} markerHeight={8} markerWidth={8} orient={'auto'} refX={7} refY={4}>
              <path d={'M0 0 L8 4 L0 8 z'} fill={'var(--brand)'} />
            </marker>
          </defs>
          {edges.map((edge) => {
            const a = rects[edge.from];
            const b = rects[edge.to];
            if (!a || !b) return null;
            const x1 = a.x + a.w;
            const y1 = a.y + a.h / 2;
            const x2 = b.x;
            const y2 = b.y + b.h / 2;
            const bend = Math.max(40, Math.abs(x2 - x1) / 2);
            return <path d={`M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2 - 2} ${y2}`} fill={'none'} key={`${edge.from}>${edge.to}`} markerEnd={'url(#flow-arrow)'} stroke={'var(--brand)'} strokeOpacity={0.55} strokeWidth={1.6} />;
          })}
        </svg>
        {edges.map((edge) => {
          const a = rects[edge.from];
          const b = rects[edge.to];
          if (!a || !b || !edge.label) return null;
          return (
            <span className={styles.pill} key={`l:${edge.from}>${edge.to}`} style={{ left: (a.x + a.w + b.x) / 2, top: (a.y + b.y) / 2 + a.h / 2 }}>
              {edge.label}
            </span>
          );
        })}
        {heads.map((head) => (
          <div className={styles.head} key={head.key} style={{ left: head.x, top: head.y }}>
            {head.title}
            <span className={styles.meta} style={{ fontWeight: 400 }}>
              {head.line}
            </span>
          </div>
        ))}
        {nodes.map((node) => {
          const at = rects[node.key];
          return (
            <div
              aria-label={`${node.step.title}，按回车打开验收项`}
              className={styles.node}
              data-dragging={dragging === node.key ? '' : undefined}
              data-node={node.key}
              key={node.key}
              role={'button'}
              style={{ left: at.x, top: at.y }}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen(node.step.id);
                }
              }}
            >
              <Flexbox horizontal align={'flex-start'} gap={8}>
                <Mark decision={node.step.decision} status={node.step.status} />
                <span className={styles.title}>{node.step.title}</span>
              </Flexbox>
              {node.step.note && <div className={styles.note}>{node.step.note}</div>}
              <Flexbox horizontal gap={12} style={{ bottom: 10, left: 12, position: 'absolute' }}>
                <span className={styles.stat} title={'走过的轮数'}>
                  <Layers size={12} />
                  {node.step.rounds}
                </span>
                <span className={styles.stat} title={'证据数量'}>
                  <Paperclip size={12} />
                  {node.step.files}
                </span>
              </Flexbox>
            </div>
          );
        })}
      </div>
      <span className={styles.hint}>拖动平移 · ⌘/Ctrl + 滚轮缩放</span>
      <div className={styles.tools} data-tool>
        <button aria-label={'放大'} className={styles.tool} type={'button'} onClick={() => zoomAt(...center(), 1.25)}>
          <Plus size={15} />
        </button>
        <span style={{ alignItems: 'center', color: cssVar.colorTextTertiary, display: 'inline-flex', fontSize: 11, minWidth: 38, justifyContent: 'center' }}>{Math.round(view.z * 100)}%</span>
        <button aria-label={'缩小'} className={styles.tool} type={'button'} onClick={() => zoomAt(...center(), 1 / 1.25)}>
          <Minus size={15} />
        </button>
        <span aria-hidden style={{ alignSelf: 'center', background: cssVar.colorBorderSecondary, height: 18, width: 1 }} />
        <button aria-label={'适应窗口'} className={styles.tool} title={'把全部卡片框进窗口（0）'} type={'button'} onClick={() => fit()}>
          <Focus size={15} />
          适应
        </button>
        <button aria-label={'整理卡片位置'} className={styles.tool} disabled={!dirty} style={dirty ? undefined : { opacity: 0.4 }} title={'把拖乱的卡片放回原位'} type={'button'} onClick={() => onOffsets({})}>
          <LayoutGrid size={15} />
          整理
        </button>
        <button aria-label={fullscreen ? '退出全屏' : '全屏'} className={styles.tool} title={fullscreen ? '退出全屏（Esc）' : '全屏'} type={'button'} onClick={onFullscreen}>
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          {fullscreen ? '退出' : '全屏'}
        </button>
      </div>
      <div
        aria-hidden
        className={styles.mini}
        data-tool
        style={{ height: MINI.h, width: MINI.w }}
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const wx = (event.clientX - rect.left - MINI.w / 2) / scale + (total.x + total.w / 2);
          const wy = (event.clientY - rect.top - MINI.h / 2) / scale + (total.y + total.h / 2);
          setView((v) => ({ ...v, x: size.w / 2 - wx * v.z, y: size.h / 2 - wy * v.z }));
        }}
      >
        <svg height={MINI.h} width={MINI.w}>
          <g transform={`translate(${MINI.w / 2 - (total.x + total.w / 2) * scale} ${MINI.h / 2 - (total.y + total.h / 2) * scale}) scale(${scale})`}>
            {nodes.map((n) => (
              <rect fill={'var(--brand-soft)'} height={H} key={n.key} rx={10} width={W} x={rects[n.key].x} y={rects[n.key].y} />
            ))}
            <rect fill={'none'} height={size.h / view.z} stroke={'var(--brand)'} strokeWidth={3 / scale} width={size.w / view.z} x={-view.x / view.z} y={-view.y / view.z} />
          </g>
        </svg>
      </div>
    </div>
  );
}

interface Props {
  report: Report;
  history: History | null | undefined;
  accepted: Set<string>;
  ignored: Set<string>;
  drafts: Map<string, Draft>;
  closed: Map<string, Closed>;
  storeKey: string;
  onJump: (id: string) => void;
}

export default function Flows({ report, history, accepted, ignored, drafts, closed, storeKey, onJump }: Props) {
  const rounds = (history?.rounds ?? []).filter((entry) => entry.round <= report.round);
  const [round, setRound] = useState(report.round);
  const [only, setOnly] = useState<string>(); // a flow id, or all flows
  const [full, setFull] = useState(false);
  const [positions, setPositions] = useState<Record<string, [number, number]>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${storeKey}:flowpos`) ?? '{}');
    } catch {
      return {};
    }
  });
  const setOffsets = (next: Record<string, [number, number]>) => {
    setPositions(next);
    try {
      localStorage.setItem(`${storeKey}:flowpos`, JSON.stringify(next));
    } catch {
      /* private window: keep in memory */
    }
  };
  const past = round === report.round ? undefined : rounds.find((entry) => entry.round === round);
  const flows = (past ? past.flows : report.flows) ?? [];
  const steps: Step[] = (past ? past.cases : report.cases).map((item) => {
    const here = !past;
    const decision: Verdict | undefined = here
      ? drafts.has(item.id) ? 'reject' : ignored.has(item.id) || closed.get(item.id)?.kind === 'ignore' ? 'ignore' : accepted.has(item.id) || closed.has(item.id) ? 'accept' : undefined
      : undefined;
    return {
      id: item.id,
      title: item.title,
      status: item.status,
      note: 'observation' in item ? (item as { observation: string }).observation : (item as { note?: string }).note,
      files: 'evidence' in item && here ? item.evidence.length : (item as { files?: number }).files ?? 0,
      rounds: rounds.filter((entry) => entry.cases.some((c) => c.id === item.id) && entry.round <= round).length || 1,
      decision,
    };
  });
  const shownFlows = only ? flows.filter((flow) => flow.id === only) : flows;
  const { nodes, heads, edges } = useMemo(() => layout(only ? shownFlows : flows, only ? steps.filter((s) => shownFlows[0]?.steps.some((e) => e.case === s.id)) : steps), [report, past, only, accepted, ignored, drafts, closed]);
  const offsets = past ? {} : positions;
  const open = (id: string) => {
    if (round !== report.round) return;
    setFull(false);
    onJump(id);
  };
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);
  const fitKey = `${round}|${only ?? ''}|${full}|${flows.map((f) => f.id).join()}`;

  const canvas = (fullscreen: boolean) => (
    <Canvas
      edges={edges}
      fitKey={fitKey}
      focus={[]}
      fullscreen={fullscreen}
      heads={heads}
      height={fullscreen ? '100%' : 'min(62vh, 560px)'}
      nodes={nodes}
      offsets={offsets}
      onFullscreen={() => setFull(!fullscreen)}
      onOffsets={past ? () => undefined : setOffsets}
      onOpen={open}
    />
  );

  const bar = (
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
      <Flexbox horizontal align={'center'} gap={4} wrap={'wrap'}>
        <button aria-pressed={!only} className={styles.crumb} type={'button'} onClick={() => setOnly(undefined)}>
          全部流程
        </button>
        {flows.map((flow) => (
          <button aria-pressed={only === flow.id} className={styles.crumb} key={flow.id} type={'button'} onClick={() => setOnly(only === flow.id ? undefined : flow.id)}>
            {flow.title}
          </button>
        ))}
      </Flexbox>
      {rounds.length > 1 && (
        <Flexbox horizontal align={'center'} gap={8}>
          <span className={styles.meta}>按哪一轮看</span>
          <Select
            aria-label={'按轮次看流程'}
            style={{ width: 132 }}
            value={round}
            options={rounds.map((entry) => ({ label: `第 ${entry.round} 轮`, value: entry.round }))}
            onChange={(value) => setRound(Number(value))}
          />
        </Flexbox>
      )}
    </Flexbox>
  );

  return (
    <Flexbox gap={12}>
      <Text strong>用户流程</Text>
      {bar}
      {!full && canvas(false)}
      {full &&
        createPortal(
          <div aria-modal={'true'} className={styles.overlay} role={'dialog'}>
            <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
              <Text strong style={{ whiteSpace: 'nowrap' }}>用户流程</Text>
              {bar}
            </Flexbox>
            <div style={{ flex: 1, minHeight: 0 }}>{canvas(true)}</div>
          </div>,
          document.querySelector('.ant-app') ?? document.body,
        )}
    </Flexbox>
  );
}
