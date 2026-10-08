import { Flexbox } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronLeft, ChevronRight, Crosshair, Maximize2, Minus, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Evidence, Note } from './types';

export const href = (path: string) => encodeURI(path);
export const fileName = (path: string) => path.split('/').pop() ?? path;

const FPS = 30; // the report does not record the frame rate; one step is a 30th of a second
const STAGE = 'min(88vh, 900px)';

export const clock = (seconds: number) => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${Math.min(9, Math.floor((seconds - whole) * 10))}`;
};
const percent = (value: number) => `${Math.round(value * 100)}%`;
export const where = (note: Note) =>
  note.kind === 'video'
    ? `视频 ${clock(note.t ?? 0)}`
    : note.rect && note.rect[2] > 0
      ? `图 区域 ${percent(note.rect[0])},${percent(note.rect[1])}`
      : note.rect
        ? `图 点 ${percent(note.rect[0])},${percent(note.rect[1])}`
        : '图';

const styles = createStaticStyles(({ css }) => ({
  note: css`
    padding: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
    transition: border-color 0.2s, box-shadow 0.2s;

    &[data-active] {
      border-color: var(--brand);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 18%, transparent);
    }
  `,
  noteHead: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  badge: css`
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding-inline: 4px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    background: var(--brand);
  `,
  textarea: css`
    box-sizing: border-box;
    width: 100%;
    min-height: 52px;
    padding: 6px 8px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
    font: inherit;
    font-size: 13px;
    line-height: 1.5;
    color: ${cssVar.colorText};
    resize: vertical;
    background: ${cssVar.colorBgContainer};

    &:focus {
      border-color: ${cssVar.colorPrimary};
      outline: none;
    }
  `,
  link: css`
    cursor: pointer;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    background: none;

    &:hover {
      color: var(--brand);
    }
  `,
  overlay: css`
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgb(12 9 24 / 58%);
    backdrop-filter: blur(6px);
  `,
  dialog: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    width: min(1180px, 100%);
    max-height: ${STAGE};
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgElevated};
    box-shadow: 0 30px 80px -30px rgb(0 0 0 / 55%);

    &:focus {
      outline: none;
    }

    @media (width <= 767px) {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto;
      max-height: 94vh;
      overflow: auto;
    }
  `,
  stageWrap: css`
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: ${cssVar.colorFillQuaternary};
  `,
  bar: css`
    padding: 10px 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  stage: css`
    display: flex;
    flex: 1;
    min-height: 0;
    max-height: calc(${STAGE} - 57px);
    overflow: auto;
    padding: 16px;

    @media (width <= 767px) {
      max-height: 58vh;
    }
  `,
  canvas: css`
    position: relative;
    flex: none;
    margin: auto;
    line-height: 0;
    user-select: none;
  `,
  side: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    overflow: auto;
    padding: 14px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};

    @media (width <= 767px) {
      border-inline-start: 0;
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  iconBtn: css`
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: ${cssVar.borderRadius};
    color: ${cssVar.colorTextSecondary};
    background: transparent;

    &:hover:not(:disabled) {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }

    &:disabled {
      cursor: default;
      opacity: 0.35;
    }

    &[aria-pressed='true'] {
      color: var(--brand);
      background: color-mix(in srgb, var(--brand) 14%, transparent);
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  mark: css`
    position: absolute;
    box-sizing: border-box;
    border: 2px dashed var(--brand);
    border-radius: 4px;
    background: color-mix(in srgb, var(--brand) 12%, transparent);
    pointer-events: none;

    &[data-active] {
      border-style: solid;
      background: color-mix(in srgb, var(--brand) 22%, transparent);
    }

    &[data-point] {
      border-radius: 50%;
    }
  `,
  markBadge: css`
    position: absolute;
    inset-block-start: -11px;
    inset-inline-start: -11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    color: #fff;
    background: var(--brand);
  `,
  hint: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
  videoStage: css`
    display: flex;
    justify-content: center;
    padding: 12px;
    background: ${cssVar.colorFillQuaternary};

    video {
      border-radius: ${cssVar.borderRadius};
    }
  `,
  spot: css`
    cursor: pointer;
    display: flex;
    gap: 8px;
    align-items: baseline;
    width: 100%;
    border: 0;
    padding: 4px 0;
    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-align: start;
    background: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  tick: css`
    cursor: pointer;
    position: absolute;
    inset-block: 0;
    width: 10px;
    margin-inline-start: -5px;
    border: 0;
    padding: 0;
    background: none;

    &::after {
      content: '';
      position: absolute;
      inset-block: 2px;
      inset-inline: 3px;
      border-radius: 2px;
      background: var(--brand);
    }

    &[data-active]::after {
      inset-inline: 1px;
      background: ${cssVar.colorError};
    }
  `,
}));

// ───────────────────────────── notes list ─────────────────────────────

export function NoteList({
  notes,
  onChange,
  onLocate,
  active,
}: {
  notes: Note[];
  onChange: (next: Note[]) => void;
  onLocate?: (note: Note) => void;
  active?: string;
}) {
  if (!notes.length) return null;
  return (
    <Flexbox gap={8}>
      {notes.map((note, index) => (
        <div className={styles.note} data-active={active === note.id ? '' : undefined} key={note.id}>
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox horizontal align={'center'} className={styles.noteHead} gap={6} style={{ minWidth: 0 }}>
              <span className={styles.badge}>{index + 1}</span>
              <span style={{ overflowWrap: 'anywhere' }}>
                {where(note)} · {fileName(note.path)}
              </span>
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={10} style={{ flex: 'none' }}>
              {onLocate && (
                <button className={styles.link} type={'button'} onClick={() => onLocate(note)}>
                  定位
                </button>
              )}
              <button
                aria-label={`删除意见 ${index + 1}`}
                className={styles.link}
                type={'button'}
                onClick={() => onChange(notes.filter((item) => item.id !== note.id))}
              >
                <Trash2 size={13} style={{ display: 'block' }} />
              </button>
            </Flexbox>
          </Flexbox>
          <textarea
            aria-label={`意见 ${index + 1}`}
            className={styles.textarea}
            style={{ marginBlockStart: 6 }}
            value={note.text}
            onChange={(event) => onChange(notes.map((item) => (item.id === note.id ? { ...item, text: event.target.value } : item)))}
          />
        </div>
      ))}
    </Flexbox>
  );
}

function Composer({ label, onSave, onCancel }: { label: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <Flexbox className={styles.note} data-active={''} gap={8}>
      <span className={styles.noteHead}>{label}</span>
      <textarea
        autoFocus
        aria-label={'这一处的意见'}
        className={styles.textarea}
        placeholder={'这里哪里不对？例如：按钮文字被截断。'}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onCancel();
          else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && text.trim()) onSave(text.trim());
        }}
      />
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        <Button size={'small'} onClick={onCancel}>
          取消
        </Button>
        <Button disabled={!text.trim()} size={'small'} type={'primary'} onClick={() => onSave(text.trim())}>
          记下这条意见
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

// ───────────────────────────── image viewer ─────────────────────────────

const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
const clamp = (value: number) => Math.min(1, Math.max(0, value));

interface LightboxProps {
  images: Evidence[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  /** Notes of the whole check; the viewer shows the ones on the current picture. */
  notes: Note[];
  onNotes: (next: Note[]) => void;
  selected?: string;
  /** Open with the region tool already on, for the "comment on a region" shortcut on the picture. */
  marking?: boolean;
}

export function Lightbox({ images, index, onIndex, onClose, notes, onNotes, selected, marking: startMarking }: LightboxProps) {
  const item = images[index];
  const dialog = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<{ w: number; h: number }>();
  const [zoom, setZoom] = useState<number | null>(null); // null = fit the window
  const [natural, setNatural] = useState<{ w: number; h: number }>();
  const [marking, setMarking] = useState(!!startMarking);
  const [drag, setDrag] = useState<[number, number, number, number]>();
  const [draft, setDraft] = useState<[number, number, number, number]>();
  const [current, setCurrent] = useState(selected);
  const mine = notes.filter((note) => note.kind === 'image' && note.path === item.path);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    const { overflow, paddingRight } = document.body.style;
    document.body.style.overflow = 'hidden';
    if (scrollbar) document.body.style.paddingRight = `${scrollbar}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    setZoom(null);
    setNatural(undefined);
    setDraft(undefined);
    setDrag(undefined);
  }, [index]);
  useEffect(() => setCurrent(selected), [selected, index]);
  // The viewer is modal, so its keys work wherever focus is (focus is lost when a button inside it unmounts).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && /^(TEXTAREA|INPUT|SELECT)$/.test(event.target.tagName)) return;
      if (event.key === 'Escape') {
        if (draft) setDraft(undefined);
        else if (marking) setMarking(false);
        else onClose();
      } else if (event.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
      else if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, draft, marking, onClose, onIndex]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setRoom({ w: el.clientWidth - 32, h: el.clientHeight - 32 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const size = natural ?? (item.width && item.height ? { w: item.width, h: item.height } : undefined);
  // "fit" shows the whole picture inside the stage and never blows a small one up
  const fit = size && room ? Math.min(1, room.w / size.w, room.h / size.h) : 1;
  const scale = zoom ?? fit;
  const step = (direction: 1 | -1) => {
    const now = scale;
    const next = direction > 0 ? ZOOMS.find((z) => z > now + 0.01) : [...ZOOMS].reverse().find((z) => z < now - 0.01);
    if (next) setZoom(next);
  };

  const point = (event: React.PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    return [clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height)] as const;
  };
  const down = (event: React.PointerEvent) => {
    if (!marking || draft) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x, y] = point(event);
    setDrag([x, y, x, y]); // start and current corner
  };
  const move = (event: React.PointerEvent) => {
    if (!drag) return;
    const [x, y] = point(event);
    setDrag([drag[0], drag[1], x, y]);
  };
  const up = () => {
    if (!drag) return;
    const [x0, y0, x1, y1] = drag;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    setDrag(undefined);
    // a click without dragging marks a point
    setDraft(w < 0.01 && h < 0.01 ? [x0, y0, 0, 0] : [left, top, w, h]);
    setMarking(false);
  };

  const save = (text: string) => {
    if (!draft) return;
    const id = crypto.randomUUID();
    onNotes([...notes, { id, kind: 'image', path: item.path, rect: draft.map((v) => Math.round(v * 1000) / 1000) as Note['rect'], text }]);
    setCurrent(id);
    setDraft(undefined);
  };

  const preview = drag && { x: Math.min(drag[0], drag[2]), y: Math.min(drag[1], drag[3]), w: Math.abs(drag[2] - drag[0]), h: Math.abs(drag[3] - drag[1]) };
  const box = (rect: [number, number, number, number]) => {
    const [x, y, w, h] = rect;
    return w > 0 || h > 0
      ? { left: percent(x), top: percent(y), width: percent(w), height: percent(h) }
      : { left: `calc(${percent(x)} - 9px)`, top: `calc(${percent(y)} - 9px)`, width: 18, height: 18 };
  };

  return createPortal(
    <div
      className={styles.overlay}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        aria-label={`图片：${item.caption}`}
        aria-modal={'true'}
        className={styles.dialog}
        ref={dialog}
        role={'dialog'}
        tabIndex={-1}
      >
        <div className={styles.stageWrap}>
          <Flexbox horizontal align={'center'} className={styles.bar} gap={4}>
            <button aria-label={'上一张'} className={styles.iconBtn} disabled={index === 0} type={'button'} onClick={() => onIndex(index - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 12, color: cssVar.colorTextSecondary, minWidth: 40, textAlign: 'center' }}>
              {index + 1} / {images.length}
            </span>
            <button aria-label={'下一张'} className={styles.iconBtn} disabled={index === images.length - 1} type={'button'} onClick={() => onIndex(index + 1)}>
              <ChevronRight size={16} />
            </button>
            <span style={{ flex: 1 }} />
            <button aria-label={'缩小'} className={styles.iconBtn} type={'button'} onClick={() => step(-1)}>
              <Minus size={16} />
            </button>
            <button
              aria-label={zoom === null ? '切到原始大小' : '适应窗口'}
              className={styles.iconBtn}
              style={{ width: 'auto', paddingInline: 8, fontSize: 12 }}
              type={'button'}
              onClick={() => setZoom(zoom === null ? 1 : null)}
            >
              {zoom === null ? '适应' : `${Math.round(zoom * 100)}%`}
            </button>
            <button aria-label={'放大'} className={styles.iconBtn} type={'button'} onClick={() => step(1)}>
              <Plus size={16} />
            </button>
            <button aria-label={'适应窗口'} className={styles.iconBtn} type={'button'} onClick={() => setZoom(null)}>
              <Maximize2 size={15} />
            </button>
            <button aria-label={'关闭'} className={styles.iconBtn} type={'button'} onClick={onClose}>
              <X size={16} />
            </button>
          </Flexbox>
          <div className={styles.stage} ref={stage}>
            <div
              className={styles.canvas}
              ref={canvas}
              style={{ cursor: marking ? 'crosshair' : undefined, touchAction: marking ? 'none' : undefined }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
            >
              <img
                alt={item.caption}
                draggable={false}
                src={href(item.path)}
                style={{ display: 'block', maxWidth: 'none', width: size ? size.w * scale : undefined, height: 'auto' }}
                onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
              />
              {mine.map((note, i) => (
                <span
                  className={styles.mark}
                  data-active={current === note.id ? '' : undefined}
                  data-point={note.rect && note.rect[2] === 0 && note.rect[3] === 0 ? '' : undefined}
                  key={note.id}
                  style={box(note.rect!)}
                >
                  <span className={styles.markBadge}>{i + 1}</span>
                </span>
              ))}
              {draft && (
                <span className={styles.mark} data-active={''} data-point={draft[2] === 0 && draft[3] === 0 ? '' : undefined} style={box(draft)}>
                  <span className={styles.markBadge}>+</span>
                </span>
              )}
              {preview && <span className={styles.mark} data-active={''} style={box([preview.x, preview.y, preview.w, preview.h])} />}
            </div>
          </div>
        </div>
        <div className={styles.side}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, overflowWrap: 'anywhere' }}>{item.caption}</div>
            <div className={styles.hint} style={{ marginBlockStart: 4 }}>
              {item.phase === 'final' ? '最终效果' : '验证过程'} · {item.source}
              {item.inspected ? ' · 已查看' : ' · 未查看'}
            </div>
          </div>
          <Button
            aria-pressed={marking}
            className={'di-trigger jelly'}
            icon={<Crosshair size={14} />}
            type={marking ? 'primary' : 'default'}
            onClick={() => {
              setDraft(undefined);
              setMarking(!marking);
            }}
          >
            {marking ? '在图上拖一个框，或点一下' : '框选一处写意见'}
          </Button>
          {draft && <Composer label={'新意见'} onCancel={() => setDraft(undefined)} onSave={save} />}
          <NoteList
            active={current}
            notes={mine}
            onChange={(next) => onNotes([...notes.filter((note) => !(note.kind === 'image' && note.path === item.path)), ...next])}
            onLocate={(note) => setCurrent(note.id)}
          />
          {!mine.length && !draft && (
            <span className={styles.hint}>
              哪里不对就直接在图上框出来，意见会跟着这一处一起交回 Agent，不用再描述“左上角那个”。
              <br />
              快捷键：← → 切换图片，Esc 关闭。
            </span>
          )}
        </div>
      </div>
    </div>,
    // the theme variables live on the app root, not on <body>
    document.querySelector('.ant-app') ?? document.body,
  );
}

// ───────────────────────────── video ─────────────────────────────

const RATES = [0.25, 0.5, 1, 1.5, 2];
const VIDEO_CAP = 'min(70vh, 560px)';

export function VideoPlayer({
  item,
  notes,
  onNotes,
  focus,
}: {
  item: Evidence;
  notes: Note[];
  onNotes: (next: Note[]) => void;
  focus?: { id: string; n: number };
}) {
  const selected = focus?.id;
  const video = useRef<HTMLVideoElement>(null);
  const [ratio, setRatio] = useState<number>();
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [draft, setDraft] = useState<number>();
  const mine = notes.filter((note) => note.kind === 'video' && note.path === item.path);
  const sync = () => setTime(video.current?.currentTime ?? 0);
  const seek = (t: number) => {
    const el = video.current;
    if (!el) return;
    el.pause();
    el.currentTime = Math.min(Math.max(0, t), el.duration || t);
    setTime(el.currentTime);
  };
  const frame = (direction: 1 | -1) => {
    const el = video.current;
    if (el) seek((Math.round(el.currentTime * FPS) + direction) / FPS);
  };
  useEffect(() => {
    const note = notes.find((entry) => entry.id === selected && entry.path === item.path);
    if (note?.t !== undefined) seek(note.t);
  }, [focus?.n]);

  return (
    <div
      role={'group'}
      aria-label={`录像：${item.caption}`}
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement) return;
        if (event.key === ',') frame(-1);
        else if (event.key === '.') frame(1);
      }}
    >
      <div className={styles.videoStage}>
        <video
          controls
          playsInline
          aria-label={item.caption}
          preload={'metadata'}
          ref={video}
          src={href(item.path)}
          style={
            ratio
              ? { display: 'block', width: `min(100%, calc(${VIDEO_CAP} * ${ratio}))`, aspectRatio: String(ratio), background: '#000' }
              : { display: 'block', width: '100%', aspectRatio: '16 / 9', background: '#000' }
          }
          onLoadedMetadata={(event) => {
            const el = event.currentTarget;
            if (el.videoWidth && el.videoHeight) setRatio(el.videoWidth / el.videoHeight);
            setDuration(el.duration || 0);
          }}
          onPause={sync}
          onSeeked={sync}
          onTimeUpdate={sync}
        />
      </div>
      {duration > 0 && mine.length > 0 && (
        <div aria-label={'意见在视频里的位置'} style={{ position: 'relative', height: 14, margin: '6px 12px 0' }}>
          <div style={{ position: 'absolute', inset: '6px 0', borderRadius: 2, background: cssVar.colorFillSecondary }} />
          {mine.map((note) => (
            <button
              aria-label={`跳到 ${clock(note.t ?? 0)}：${note.text}`}
              className={styles.tick}
              data-active={selected === note.id ? '' : undefined}
              key={note.id}
              style={{ left: `${((note.t ?? 0) / duration) * 100}%` }}
              title={`${clock(note.t ?? 0)} ${note.text}`}
              type={'button'}
              onClick={() => seek(note.t ?? 0)}
            />
          ))}
        </div>
      )}
      <Flexbox horizontal align={'center'} gap={6} style={{ padding: '8px 12px' }} wrap={'wrap'}>
        <button aria-label={'上一帧'} className={styles.iconBtn} title={'上一帧（,）'} type={'button'} onClick={() => frame(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button aria-label={'下一帧'} className={styles.iconBtn} title={'下一帧（.）'} type={'button'} onClick={() => frame(1)}>
          <ChevronRight size={16} />
        </button>
        <span style={{ fontFamily: cssVar.fontFamilyCode, fontSize: 12, color: cssVar.colorTextSecondary, minWidth: 92 }}>
          {clock(time)} / {clock(duration)}
        </span>
        <select
          aria-label={'播放速度'}
          style={{ height: 28, border: `1px solid ${cssVar.colorBorder}`, borderRadius: 6, color: cssVar.colorText, background: cssVar.colorBgContainer, font: 'inherit', fontSize: 12 }}
          value={rate}
          onChange={(event) => {
            const next = Number(event.target.value);
            setRate(next);
            if (video.current) video.current.playbackRate = next;
          }}
        >
          {RATES.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <Button
          className={'di-trigger jelly'}
          disabled={draft !== undefined}
          icon={<Crosshair size={14} />}
          size={'small'}
          onClick={() => {
            video.current?.pause();
            setDraft(video.current?.currentTime ?? time);
          }}
        >
          在 {clock(time)} 写意见
        </Button>
      </Flexbox>
      {mine.length > 0 && (
        <div style={{ padding: '0 12px 8px' }}>
          {mine.map((note) => (
            <button className={styles.spot} key={note.id} type={'button'} onClick={() => seek(note.t ?? 0)}>
              <span style={{ flex: 'none', fontFamily: cssVar.fontFamilyCode, color: 'var(--brand)' }}>{clock(note.t ?? 0)}</span>
              <span style={{ overflowWrap: 'anywhere' }}>{note.text}</span>
            </button>
          ))}
        </div>
      )}
      {draft !== undefined && (
        <div style={{ padding: '0 12px 12px' }}>
          <Composer
            label={`视频 ${clock(draft)}`}
            onCancel={() => setDraft(undefined)}
            onSave={(text) => {
              onNotes([...notes, { id: crypto.randomUUID(), kind: 'video', path: item.path, t: Math.round(draft * 1000) / 1000, text }]);
              setDraft(undefined);
            }}
          />
        </div>
      )}
      {!mine.length && draft === undefined && (
        <span className={styles.hint} style={{ display: 'block', padding: '0 12px 8px' }}>
          看到哪一刻不对，就暂停在那里写意见；键盘 , 和 . 逐帧前后。
        </span>
      )}
    </div>
  );
}
