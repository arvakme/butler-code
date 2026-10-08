import { Flexbox } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { Columns2, MoveHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';

import { href } from './Annotate';

export interface Side { path: string; label: string; width?: number; height?: number }

const styles = createStaticStyles(({ css }) => ({
  stage: css`
    position: relative;
    max-width: 100%;
    margin-inline: auto;
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgContainer};
    line-height: 0;
    user-select: none;
    touch-action: pan-y;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  img: css`
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  `,
  line: css`
    position: absolute;
    inset-block: 0;
    width: 2px;
    margin-inline-start: -1px;
    background: var(--brand);
    box-shadow: 0 0 0 1px rgb(255 255 255 / 70%);
    pointer-events: none;
  `,
  knob: css`
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 50%;
    width: 26px;
    height: 26px;
    margin: -13px 0 0 -13px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: var(--brand);
    box-shadow: 0 2px 8px rgb(0 0 0 / 30%);
  `,
  chip: css`
    position: absolute;
    inset-block-start: 8px;
    padding-inline: 8px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 20px;
    color: #fff;
    background: rgb(20 16 32 / 72%);
    pointer-events: none;
  `,
  switch: css`
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 10px;
    background: ${cssVar.colorBgContainer};
  `,
  seg: css`
    cursor: pointer;
    display: inline-flex;
    gap: 5px;
    align-items: center;
    padding: 3px 10px;
    border: 0;
    border-radius: 8px;
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
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
}));

const CAP = 'min(60vh, 520px)';

/** Two pictures of the same thing: a draggable divider, or next to each other. */
/** How two pictures are shown: next to each other, or one drag over the other. Labelled, so it is easy to find. */
export function ModeSwitch({ mode, onMode }: { mode: 'side' | 'slide'; onMode: (mode: 'side' | 'slide') => void }) {
  return (
    <Flexbox horizontal align={'center'} gap={8}>
      <span style={{ color: cssVar.colorTextTertiary, fontSize: 12 }}>对比方式</span>
      <span aria-label={'对比方式'} className={styles.switch} role={'group'}>
        <button aria-pressed={mode === 'side'} className={styles.seg} type={'button'} onClick={() => onMode('side')}>
          <Columns2 size={13} />
          并排
        </button>
        <button aria-pressed={mode === 'slide'} className={styles.seg} type={'button'} onClick={() => onMode('slide')}>
          <MoveHorizontal size={13} />
          滑动对比
        </button>
      </span>
    </Flexbox>
  );
}

export default function Compare({ before, after, initial = 'slide' }: { before: Side; after: Side; initial?: 'slide' | 'side' }) {
  const [mode, setMode] = useState(initial);
  const [pos, setPos] = useState(50);
  const [ratio, setRatio] = useState(after.width && after.height ? after.width / after.height : 16 / 9);
  const box = useRef<HTMLDivElement>(null);
  const move = (event: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    setPos(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
  };
  return (
    <Flexbox gap={8}>
      <ModeSwitch mode={mode} onMode={setMode} />
      {mode === 'slide' ? (
        <div
          aria-label={`${before.label}与${after.label}对比，左右方向键移动分界线`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={Math.round(pos)}
          className={styles.stage}
          ref={box}
          role={'slider'}
          style={{ aspectRatio: String(ratio), width: `min(100%, calc(${CAP} * ${ratio}))` }}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setPos((value) => Math.max(0, value - 5));
            else if (event.key === 'ArrowRight') setPos((value) => Math.min(100, value + 5));
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            move(event);
          }}
          onPointerMove={(event) => event.buttons && move(event)}
        >
          <img
            alt={after.label}
            className={styles.img}
            draggable={false}
            src={href(after.path)}
            onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
          />
          <img alt={before.label} className={styles.img} draggable={false} src={href(before.path)} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
          <span className={styles.chip} style={{ insetInlineStart: 8 }}>
            {before.label}
          </span>
          <span className={styles.chip} style={{ insetInlineEnd: 8 }}>
            {after.label}
          </span>
          <span className={styles.line} style={{ insetInlineStart: `${pos}%` }}>
            <span className={styles.knob} />
          </span>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {[before, after].map((side) => (
            <figure key={side.path + side.label} style={{ margin: 0, textAlign: 'center' }}>
              <img
                alt={side.label}
                src={href(side.path)}
                style={{ borderRadius: 8, border: `1px solid ${cssVar.colorBorderSecondary}`, maxHeight: CAP, maxWidth: '100%', width: 'auto' }}
              />
              <figcaption style={{ color: cssVar.colorTextSecondary, fontSize: 12, marginBlockStart: 4 }}>{side.label}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </Flexbox>
  );
}
