import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { AnimatePresence, motion } from 'motion/react';
import { ExternalLinkIcon, FileIcon } from '@unlocalhosted/dither-icons';
import { ChevronRight, Crosshair } from 'lucide-react';

import { G } from './icons';
import { useEffect, useState } from 'react';

import { fileName, href, Lightbox, VideoPlayer } from './Annotate';
import Compare, { ModeSwitch } from './Compare';
import type { Evidence, Note } from './types';

export { fileName, href };

const styles = createStaticStyles(({ css }) => ({
  frame: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  // Pictures keep their own proportions: a phone screenshot is a narrow tall picture, not a banner.
  stage: css`
    position: relative;
    display: flex;
    justify-content: center;
    padding: 12px;
    background: ${cssVar.colorFillQuaternary};
  `,
  zoom: css`
    cursor: zoom-in;
    display: block;
    max-width: 100%;
    border: 0;
    padding: 0;
    border-radius: ${cssVar.borderRadius};
    background: none;
    line-height: 0;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }

    img {
      display: block;
      width: auto;
      max-width: 100%;
      height: auto;
      max-height: min(60vh, 520px);
      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: ${cssVar.borderRadius};
      background: ${cssVar.colorBgContainer};
    }
  `,
  grid: css`
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    padding: 12px;
    background: ${cssVar.colorFillQuaternary};
  `,
  label: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-start: 8px;
    padding-inline: 8px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 20px;
    color: #fff;
    background: rgb(20 16 32 / 72%);
    pointer-events: none;
  `,
  cell: css`
    position: relative;
    display: flex;
    justify-content: center;
    min-width: 0;
  `,
  groupBar: css`
    padding-block: 8px 0;
    padding-inline: 12px;
  `,
  tableWrap: css`
    overflow: auto;
    max-height: 320px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    table {
      width: 100%;
      border-collapse: collapse;
      font-family: ${cssVar.fontFamilyCode};
      font-size: 12px;
    }

    th,
    td {
      padding-block: 6px;
      padding-inline: 12px;
      text-align: start;
      vertical-align: top;
      overflow-wrap: anywhere;
    }

    th {
      position: sticky;
      inset-block-start: 0;
      z-index: 1;
      font-weight: 500;
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillQuaternary};
    }

    tbody tr:nth-child(even) td {
      background: ${cssVar.colorFillQuaternary};
    }

    td:first-child {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  log: css`
    overflow: hidden;
    border-radius: ${cssVar.borderRadiusLG};
    color: #ece9f3;
    background: #17141e;
  `,
  logHead: css`
    padding-block: 8px;
    padding-inline: 12px;
    font-size: 12px;
    color: #aaa4ba;
  `,
  logPre: css`
    margin: 0;
    padding-block: 2px 12px;
    padding-inline: 12px;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,
  logBtn: css`
    cursor: pointer;
    border: 0;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 10px;
    font: inherit;
    font-size: 12px;
    color: #ece9f3;
    background: rgb(255 255 255 / 10%);

    &:hover {
      background: rgb(255 255 255 / 18%);
    }
  `,
  region: css`
    cursor: pointer;
    position: absolute;
    inset-block-end: 20px;
    inset-inline-end: 20px;
    display: inline-flex;
    gap: 5px;
    align-items: center;
    padding: 4px 10px;
    border: 0;
    border-radius: 14px;
    font: inherit;
    font-size: 12px;
    color: #fff;
    background: rgb(20 16 32 / 72%);
    opacity: 0.85;
    transition: opacity 0.2s, background 0.2s;

    &:hover,
    &:focus-visible {
      opacity: 1;
      background: var(--brand);
    }
  `,
  count: css`
    position: absolute;
    inset-block-start: 20px;
    inset-inline-end: 20px;
    padding-inline: 8px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 20px;
    color: #fff;
    background: var(--brand);
    pointer-events: none;
  `,
  caption: css`
    padding-block: 8px;
    padding-inline: 12px;
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    text-align: center;
    overflow-wrap: anywhere;
  `,
  provenance: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    padding-block-end: 10px;
    padding-inline: 12px;
  `,
  chip: css`
    padding-inline: 6px;
    border-radius: 4px;
    font-size: 11px;
    line-height: 18px;
    color: ${cssVar.colorTextTertiary};
    background: ${cssVar.colorFillTertiary};
  `,
  unseen: css`
    color: ${cssVar.colorWarning};
    background: ${cssVar.colorWarningBg};
  `,
  fileHead: css`
    cursor: pointer;
    padding-block: 10px;
    padding-inline: 12px;
    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  fileName: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  fileCaption: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  open: css`
    flex: none;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: var(--brand);
    }
  `,
  pre: css`
    overflow: auto;
    max-height: 360px;
    margin: 0;
    padding: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: ${cssVar.colorFillQuaternary};
  `,
}));

const Provenance = ({ item }: { item: Evidence }) => (
  <div className={styles.provenance}>
    <span className={styles.chip}>{item.phase === 'final' ? '最终效果' : '验证过程'}</span>
    <span className={styles.chip}>{item.source}</span>
    <span className={cx(styles.chip, !item.inspected && styles.unseen)}>{item.inspected ? '已查看' : '未查看'}</span>
  </div>
);

export const TextFile = ({
  name,
  caption,
  path,
  content,
  truncated,
  footer,
}: {
  name: string;
  caption?: string;
  path: string;
  content?: string;
  truncated?: boolean;
  footer?: React.ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const expandable = content !== undefined;
  return (
    <div className={styles.frame}>
      <Flexbox
        horizontal
        align={'center'}
        aria-expanded={expandable ? open : undefined}
        className={`${styles.fileHead} di-trigger`}
        gap={10}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={() => expandable && setOpen(!open)}
        onKeyDown={(event) => {
          if (expandable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            setOpen(!open);
          }
        }}
      >
        <span style={{ color: 'var(--brand)' }}>
          <G icon={FileIcon} size={18} />
        </span>
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <span className={styles.fileName}>{name}</span>
          {caption && <span className={styles.fileCaption}>{caption}</span>}
        </Flexbox>
        <a
          aria-label={`打开 ${name}`}
          className={`${styles.open} di-trigger`}
          href={href(path)}
          rel={'noopener'}
          target={'_blank'}
          onClick={(event) => event.stopPropagation()}
        >
          <G icon={ExternalLinkIcon} size={14} />
        </a>
        {expandable && (
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={ChevronRight}
            size={14}
            style={{ flex: 'none', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.45s var(--spring)' }}
          />
        )}
      </Flexbox>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <pre className={styles.pre}>
              {content}
              {truncated && '\n…（内容过长，已截断；点右上角打开完整文件）'}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
      {footer}
    </div>
  );
};

// ───────────────────────────── text evidence: tables and logs ─────────────────────────────

const extension = (path: string) => path.slice(path.lastIndexOf('.')).toLowerCase();
const cell = (value: unknown) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''));

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') field += (i++, '"');
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') (row.push(field), (field = ''));
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((entry) => entry.some((value) => value !== ''));
}

/** A table the page can draw from a data file, or undefined when it is not tabular (or was cut off). */
function tableOf(item: Evidence): { head: string[]; rows: string[][] } | undefined {
  if (item.content === undefined || item.truncated) return undefined;
  const type = extension(item.path);
  try {
    if (type === '.csv') {
      const [head, ...rows] = csvRows(item.content);
      return head && rows.length && head.length <= 12 ? { head, rows } : undefined;
    }
    if (type !== '.json') return undefined;
    const data = JSON.parse(item.content);
    if (Array.isArray(data) && data.length && data.length <= 200) {
      if (data.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))) {
        const head = [...new Set(data.flatMap((entry) => Object.keys(entry)))];
        return head.length <= 12 ? { head, rows: data.map((entry) => head.map((key) => cell(entry[key]))) } : undefined;
      }
      return { head: ['值'], rows: data.map((entry) => [cell(entry)]) };
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const entries = Object.entries(data);
      return entries.length && entries.length <= 200 ? { head: ['项', '值'], rows: entries.map(([key, value]) => [key, cell(value)]) } : undefined;
    }
  } catch {
    /* not valid data: show it as a file */
  }
  return undefined;
}

const Source = ({ item, color }: { item: Evidence; color?: string }) => (
  <Flexbox horizontal align={'center'} gap={10} style={{ minWidth: 0 }}>
    <span style={{ color: color ?? 'var(--brand)', display: 'inline-flex' }}>
      <G icon={FileIcon} size={18} />
    </span>
    <Flexbox flex={1} style={{ minWidth: 0 }}>
      <span className={styles.fileName} style={color ? { color: '#ece9f3' } : undefined}>
        {fileName(item.path)}
      </span>
      <span className={styles.fileCaption} style={color ? { color: '#aaa4ba' } : undefined}>
        {item.caption}
      </span>
    </Flexbox>
    <a
      aria-label={`打开 ${fileName(item.path)}`}
      className={`${styles.open} di-trigger`}
      href={href(item.path)}
      rel={'noopener'}
      style={color ? { color: '#aaa4ba' } : undefined}
      target={'_blank'}
    >
      <G icon={ExternalLinkIcon} size={14} />
    </a>
  </Flexbox>
);

function DataTable({ item, table }: { item: Evidence; table: { head: string[]; rows: string[][] } }) {
  return (
    <div className={styles.frame}>
      <div style={{ padding: '10px 12px' }}>
        <Source item={item} />
      </div>
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              {table.head.map((name) => (
                <th key={name} scope={'col'}>
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {table.head.map((name, column) => (
                  <td key={name}>{row[column] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Provenance item={item} />
    </div>
  );
}

const FOLDED_LINES = 6;

function LogBlock({ item }: { item: Evidence }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const content = item.content ?? '';
  const lines = content.replace(/\n$/, '').split('\n');
  const folded = !open && lines.length > FOLDED_LINES;
  return (
    <div className={styles.frame}>
      <div className={styles.log}>
        <Flexbox horizontal align={'center'} className={styles.logHead} gap={8}>
          <Flexbox flex={1} style={{ minWidth: 0 }}>
            <Source color={'#bea5f5'} item={item} />
          </Flexbox>
          <button
            className={styles.logBtn}
            type={'button'}
            onClick={() => {
              navigator.clipboard?.writeText(content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }, () => undefined);
            }}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </Flexbox>
        <pre className={styles.logPre}>
          {folded ? lines.slice(0, FOLDED_LINES).join('\n') : content}
          {item.truncated && open && '\n…（内容过长，已截断；点右上角打开完整文件）'}
        </pre>
        {lines.length > FOLDED_LINES && (
          <Flexbox horizontal align={'center'} className={styles.logHead} justify={'space-between'} style={{ background: 'rgb(255 255 255 / 5%)' }}>
            <span>
              共 {lines.length} 行{folded ? `，已显示 ${FOLDED_LINES} 行` : ''}
            </span>
            <button className={styles.logBtn} type={'button'} onClick={() => setOpen(!open)}>
              {open ? '收起' : '展开全部'}
            </button>
          </Flexbox>
        )}
      </div>
      <Provenance item={item} />
    </div>
  );
}

function TextEvidence({ item }: { item: Evidence }) {
  const table = tableOf(item);
  if (table) return <DataTable item={item} table={table} />;
  if (item.content !== undefined && ['.log', '.txt'].includes(extension(item.path))) return <LogBlock item={item} />;
  return (
    <TextFile
      caption={item.caption}
      content={item.content}
      footer={<Provenance item={item} />}
      name={fileName(item.path)}
      path={item.path}
      truncated={item.truncated}
    />
  );
}

// ───────────────────────────── the list ─────────────────────────────

type Block = { kind: 'single'; item: Evidence } | { kind: 'group'; name: string; items: Evidence[] };

/** Consecutive pictures sharing a group become one side-by-side block. */
function blocks(visual: Evidence[]): Block[] {
  const out: Block[] = [];
  for (const item of visual) {
    const last = out[out.length - 1];
    if (item.group && item.kind === 'image' && last?.kind === 'group' && last.name === item.group) last.items.push(item);
    else if (item.group && item.kind === 'image') out.push({ kind: 'group', name: item.group, items: [item] });
    else out.push({ kind: 'single', item });
  }
  // a group of one is just a picture
  return out.map((block) => (block.kind === 'group' && block.items.length === 1 ? { kind: 'single', item: block.items[0] } : block));
}

export default function EvidenceList({
  items,
  notes,
  onNotes,
  focus,
}: {
  items: Evidence[];
  notes: Note[];
  onNotes: (next: Note[]) => void;
  /** A note picked in the list below: open its picture, or move its video to that moment. */
  focus?: { id: string; n: number };
}) {
  const [viewer, setViewer] = useState<{ index: number; note?: string; marking?: boolean }>();
  const [slide, setSlide] = useState<Set<string>>(new Set());
  const images = items.filter((item) => item.kind === 'image');
  useEffect(() => {
    const note = notes.find((entry) => entry.id === focus?.id);
    if (!note || note.kind !== 'image') return;
    const index = images.findIndex((item) => item.path === note.path);
    if (index >= 0) setViewer({ index, note: note.id });
  }, [focus?.n]);
  if (!items.length) return null;
  const visual = items.filter((item) => item.kind !== 'text');
  const texts = items.filter((item) => item.kind === 'text');

  const picture = (item: Evidence) => {
    const count = notes.filter((note) => note.path === item.path).length;
    return (
      <>
        <button
          aria-label={`放大查看，可框选写意见：${item.caption}`}
          className={styles.zoom}
          type={'button'}
          onClick={() => setViewer({ index: images.indexOf(item) })}
        >
          <img alt={item.caption} height={item.height} loading={'lazy'} src={href(item.path)} width={item.width} />
        </button>
        {count > 0 && <span className={styles.count}>{count} 处意见</span>}
        <button
          aria-label={`在图上框选一处写意见：${item.caption}`}
          className={styles.region}
          type={'button'}
          onClick={() => setViewer({ index: images.indexOf(item), marking: true })}
        >
          <Crosshair size={13} />
          框选意见
        </button>
      </>
    );
  };

  return (
    <Flexbox gap={12}>
      {blocks(visual).map((block) => {
        if (block.kind === 'group') {
          const pair = block.items.length === 2;
          const sliding = pair && slide.has(block.name);
          return (
            <figure className={styles.frame} key={block.name + block.items[0].path} style={{ margin: 0 }}>
              {pair && (
                <Flexbox horizontal align={'center'} className={styles.groupBar} gap={12} justify={'space-between'} wrap={'wrap'}>
                  <span style={{ color: cssVar.colorTextSecondary, fontSize: 12 }}>
                    {block.items.map((item) => item.label ?? item.caption).join(' 对 ')}
                  </span>
                  <ModeSwitch
                    mode={sliding ? 'slide' : 'side'}
                    onMode={(mode) => setSlide((now) => (mode === 'slide' ? new Set(now).add(block.name) : (now.delete(block.name), new Set(now))))}
                  />
                </Flexbox>
              )}
              {sliding ? (
                <div style={{ padding: 12 }}>
                  <Compare
                    after={{ label: block.items[1].label ?? block.items[1].caption, path: block.items[1].path, width: block.items[1].width, height: block.items[1].height }}
                    before={{ label: block.items[0].label ?? block.items[0].caption, path: block.items[0].path }}
                    initial={'slide'}
                    key={'slide'}
                  />
                </div>
              ) : (
                <div className={styles.grid}>
                  {block.items.map((item) => (
                    <figure key={item.path} style={{ margin: 0 }}>
                      <div className={styles.cell}>
                        {picture(item)}
                        {item.label && <span className={styles.label}>{item.label}</span>}
                      </div>
                      <figcaption className={styles.caption} style={{ paddingBlockEnd: 0 }}>
                        {item.caption}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <Provenance item={block.items[0]} />
            </figure>
          );
        }
        const item = block.item;
        return (
          <figure className={styles.frame} key={item.path} style={{ margin: 0 }}>
            {item.kind === 'image' ? (
              <div className={styles.stage}>{picture(item)}</div>
            ) : (
              <VideoPlayer focus={focus} item={item} notes={notes} onNotes={onNotes} />
            )}
            <figcaption className={styles.caption}>{item.caption}</figcaption>
            <Provenance item={item} />
          </figure>
        );
      })}
      {texts.map((item) => (
        <TextEvidence item={item} key={item.path} />
      ))}
      {viewer && (
        <Lightbox
          images={images}
          index={viewer.index}
          notes={notes}
          marking={viewer.marking}
          selected={viewer.note}
          onClose={() => setViewer(undefined)}
          onIndex={(index) => setViewer({ index })}
          onNotes={onNotes}
        />
      )}
    </Flexbox>
  );
}
