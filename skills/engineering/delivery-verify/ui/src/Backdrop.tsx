// Ported from ~/Devs/arvak-blog-purple (components/dither-field.tsx, site-backdrop, sparkle, star-burst;
// same author and owner). Decorative only: aria-hidden, no pointer events, off under reduced motion.
import { createStaticStyles } from 'antd-style';
import { type CSSProperties, useEffect, useRef } from 'react';

// Ordered 4×4 Bayer dithering against a Gaussian band that follows a slow sine ridge.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const PEAK_DENSITY = 0.7;
const WAVE_WIDTH = 8;
const RADII = BAYER.map((value) => {
  const threshold = (value + 0.5) / 16;
  return threshold < PEAK_DENSITY ? Math.sqrt(-Math.log(threshold / PEAK_DENSITY)) / WAVE_WIDTH : 0;
});
const CELL = 5;
const FRAME_MS = 1000 / 20;

function forEachDot(width: number, height: number, phase: number, plot: (x: number, y: number) => void) {
  for (let x = 0; x < width; x++) {
    const u = x / width;
    const ridge = 0.55 + Math.sin(u * 7 + phase) * 0.15 + Math.cos(u * 13 - phase * 0.6) * 0.04;
    for (let row = 0; row < 4; row++) {
      const radius = RADII[row * 4 + (x % 4)];
      if (!radius) continue;
      const low = Math.max(0, Math.floor((ridge - radius) * height) + 1);
      const high = Math.min(height, Math.ceil((ridge + radius) * height));
      const start = row + Math.ceil((low - row) / 4) * 4;
      for (let y = start; y < high; y += 4) plot(x, y);
    }
  }
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function DitherField({ className }: { className: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const host = canvas.parentElement!;
    const context = canvas.getContext('2d', { alpha: true })!;
    let timer = 0;
    let phase = 0.9;
    let columns = 0;
    let rows = 0;
    let image: ImageData | null = null;
    let pixels: Uint32Array | null = null;
    let ink = 0;
    const readInk = () => {
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.fillStyle = getComputedStyle(canvas).color;
      probe.fillRect(0, 0, 1, 1);
      ink = new Uint32Array(new Uint8ClampedArray(probe.getImageData(0, 0, 1, 1).data).buffer)[0];
    };
    const paint = () => {
      if (!image || !pixels) return;
      pixels.fill(0);
      const out = pixels;
      forEachDot(columns, rows, phase, (x, y) => {
        out[y * columns + x] = ink;
      });
      context.putImageData(image, 0, 0);
    };
    const tick = () => {
      timer = 0;
      if (reducedMotion() || document.hidden) return;
      phase += FRAME_MS / 16000;
      requestAnimationFrame(paint);
      timer = window.setTimeout(tick, FRAME_MS);
    };
    const sync = () => {
      window.clearTimeout(timer);
      timer = reducedMotion() || document.hidden ? 0 : window.setTimeout(tick, FRAME_MS);
      paint();
    };
    const resize = () => {
      const nextColumns = Math.max(1, Math.ceil(host.clientWidth / CELL));
      const nextRows = Math.max(1, Math.ceil(host.clientHeight / CELL));
      if (nextColumns === columns && nextRows === rows) return;
      columns = nextColumns;
      rows = nextRows;
      canvas.width = columns;
      canvas.height = rows;
      image = context.createImageData(columns, rows);
      pixels = new Uint32Array(image.data.buffer);
      paint();
    };
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const recolor = () => {
      readInk();
      paint();
    };
    const observer = new ResizeObserver(resize);
    readInk();
    observer.observe(host);
    scheme.addEventListener('change', recolor);
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    resize();
    sync();
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      scheme.removeEventListener('change', recolor);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
  return <canvas aria-hidden={'true'} className={className} ref={ref} />;
}

const SPARK_PATH = 'M12 0C12.9 6.6 17.4 11.1 24 12C17.4 12.9 12.9 17.4 12 24C11.1 17.4 6.6 12.9 0 12C6.6 11.1 11.1 6.6 12 0Z';

export function Sparkle({ size = 12, style, soft }: { size?: number; style?: CSSProperties; soft?: boolean }) {
  return (
    <span
      aria-hidden={'true'}
      className={'spark'}
      style={{ color: soft ? 'var(--brand-soft)' : 'var(--brand)', height: size, width: size, ...style }}
    >
      <svg height={size} viewBox={'0 0 24 24'} width={size} style={{ display: 'block' }}>
        <path d={SPARK_PATH} fill={'currentColor'} />
      </svg>
    </span>
  );
}

const styles = createStaticStyles(({ css }) => ({
  root: css`
    --mask-edge: 4%;
    --mask-fade: 20%;
    pointer-events: none;
    position: fixed;
    z-index: 0;
    inset: 0;
    overflow: hidden;

    @media (width >= 1100px) {
      --mask-edge: 22%;
      --mask-fade: 37%;
    }
  `,
  glow: css`
    position: absolute;
    inset: 0;
    background:
      radial-gradient(900px 520px at 88% 104%, var(--glow-strong), transparent 70%),
      radial-gradient(760px 460px at 4% 96%, var(--glow-soft), transparent 70%),
      radial-gradient(620px 300px at 50% -8%, var(--glow-top), transparent 70%);
  `,
  field: css`
    --mask: linear-gradient(90deg, #000 0%, #000 var(--mask-edge), rgb(0 0 0 / 0.12) var(--mask-fade),
      rgb(0 0 0 / 0.12) calc(100% - var(--mask-fade)), #000 calc(100% - var(--mask-edge)), #000 100%);
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    height: 65vh;
    mask-image: var(--mask);
  `,
  canvas: css`
    display: block;
    width: 100%;
    height: 100%;
    color: var(--brand);
    opacity: var(--field-opacity);
    image-rendering: pixelated;
  `,
  margin: css`
    position: absolute;
    display: none;

    @media (width >= 1280px) {
      display: block;
    }
  `,
}));

// Kept in the side margins: the content column is at most 920px wide and centred.
const SPARKS = [
  { left: 'calc(50% - 560px)', top: '23.6%', size: 14, soft: true, delay: '0s' },
  { left: 'calc(50% + 540px)', top: '35.3%', size: 10, soft: false, delay: '1.1s' },
  { left: 'calc(50% + 590px)', top: '71.1%', size: 16, soft: true, delay: '0.5s' },
  { left: 'calc(50% - 600px)', top: '82.4%', size: 11, soft: false, delay: '1.8s' },
];

/** Fixed decorative layer: soft purple glow, drifting dither band and a few sparkles. */
export default function Backdrop() {
  return (
    <div aria-hidden={'true'} className={styles.root}>
      <div className={styles.glow} />
      <div className={styles.field}>
        <DitherField className={styles.canvas} />
      </div>
      {SPARKS.map((spark) => (
        <span className={styles.margin} key={spark.left} style={{ left: spark.left, top: spark.top }}>
          <Sparkle size={spark.size} soft={spark.soft} style={{ animationDelay: spark.delay }} />
        </span>
      ))}
    </div>
  );
}

const STAR = 'M12 1.5c.7 5.2 2.3 8.8 10.5 10.5C14.3 13.7 12.7 16.8 12 22.5 11.3 16.8 9.7 13.7 1.5 12 9.7 10.3 11.3 6.7 12 1.5Z';

/** Nine dithered stars fly out from an element's centre; used when the reviewer accepts. */
export function burstFrom(element: Element | null) {
  if (!element || reducedMotion()) return;
  const box = element.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  for (let i = 0; i < 9; i++) {
    const node = document.createElement('span');
    node.setAttribute('aria-hidden', 'true');
    node.style.cssText = `position:fixed;left:0;top:0;width:20px;height:20px;pointer-events:none;z-index:1000;color:var(${Math.random() < 0.45 ? '--brand-soft' : '--brand'})`;
    node.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="${STAR}" fill="currentColor"/></svg>`;
    document.body.appendChild(node);
    const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.4;
    const distance = 36 + Math.random() * 40;
    const k = (14 + Math.random() * 10) / 20;
    const x0 = x - 10;
    const y0 = y - 10;
    const x1 = x0 + Math.cos(angle) * distance;
    const y1 = y0 + Math.sin(angle) * distance;
    // Linear timeline so opacity holds; the flight itself eases out on its first leg.
    const animation = node.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) scale(${0.2 * k}) rotate(0deg)`, opacity: 0, easing: 'cubic-bezier(.22,1,.36,1)' },
        { transform: `translate(${x0 + (x1 - x0) * 0.8}px, ${y0 + (y1 - y0) * 0.8}px) scale(${k}) rotate(60deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${x1}px, ${y1}px) scale(${0.6 * k}) rotate(90deg)`, opacity: 0 },
      ],
      { duration: 1000, easing: 'linear', fill: 'forwards' },
    );
    animation.onfinish = () => node.remove();
  }
}
