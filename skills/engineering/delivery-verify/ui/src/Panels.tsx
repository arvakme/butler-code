import { Flexbox, Icon } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckIcon, CloseIcon, EyeIcon, FileIcon, HistoryIcon, PlayIcon } from '@unlocalhosted/dither-icons';

import { useState } from 'react';

import { G } from './icons';

import { fileName, href, TextFile } from './Evidence';
import type { Report } from './types';

const styles = createStaticStyles(({ css }) => ({
  section: css`
    font-size: 13px;
    line-height: 1.7;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  dot: css`
    flex: none;
    width: 9px;
    height: 9px;
    margin-block-start: 7px;
    border: 2px solid var(--brand);
    border-radius: 50%;
    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 0 3px var(--brand-tint);
  `,
  rail: css`
    flex: 1;
    width: 1px;
    margin-block-start: 4px;
    background: linear-gradient(var(--brand-soft), ${cssVar.colorBorderSecondary});
  `,
  code: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  muted: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  item: css`
    padding-block: 10px;
    padding-inline: 14px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    transition: background 0.2s;

    &:first-child {
      border-block-start: none;
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  link: css`
    min-width: 0;
    color: ${cssVar.colorText};
    text-decoration: none;


  `,
  jump: css`
    cursor: pointer;
    flex: none;
    padding-inline: 8px;
    border: 0;
    border-radius: 4px;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 20px;
    color: var(--brand);
    background: var(--brand-tint);
    transition: transform 0.5s var(--spring), background-color 0.2s;

    &:hover {
      background: var(--brand-wash);
      box-shadow: inset 0 0 0 1px var(--brand-soft);
    }

    &:active {
      transform: scale(0.92);
    }
  `,
  dl: css`
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 16px;
    margin: 0;
    font-size: 13px;

    dt {
      color: ${cssVar.colorTextTertiary};
    }

    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
  `,
}));

const Section = ({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) => (
  <Flexbox gap={12}>
    <Flexbox horizontal align={'center'} gap={8}>
      <Text strong>{title}</Text>
      {extra}
    </Flexbox>
    {children}
  </Flexbox>
);

export function Process({ report }: { report: Report }) {
  return (
    <Flexbox gap={28}>
      <Section title={'验证过程'}>
        <Flexbox>
          {report.process.map((step, index) => (
            <Flexbox horizontal align={'stretch'} gap={12} key={index}>
              <Flexbox align={'center'} style={{ flex: 'none' }}>
                <span className={styles.dot} />
                {index < report.process.length - 1 && <span className={styles.rail} />}
              </Flexbox>
              <div className={styles.section} style={{ paddingBlockEnd: 14 }}>
                {step}
              </div>
            </Flexbox>
          ))}
        </Flexbox>
      </Section>
      <Section title={'自动检查'}>
        {report.checks.length ? (
          <Flexbox gap={8}>
            {report.checks.map((check) => {
              const ok = check.exit_code === 0;
              const pending = check.exit_code === null;
              return (
                <TextFile
                  caption={check.command}
                  content={check.content}
                  key={check.log + check.name}
                  path={check.log}
                  truncated={check.truncated}
                  name={check.name}
                  footer={
                    <Flexbox horizontal align={'center'} gap={6} paddingBlock={'0 10px'} paddingInline={12}>
                      <span style={{ color: pending ? cssVar.colorTextQuaternary : ok ? cssVar.colorSuccess : cssVar.colorError }}>
                        <G icon={pending ? HistoryIcon : ok ? CheckIcon : CloseIcon} size={14} />
                      </span>
                      <span className={styles.code}>{pending ? '未执行' : `退出 ${check.exit_code}`}</span>
                    </Flexbox>
                  }
                />
              );
            })}
          </Flexbox>
        ) : (
          <span className={styles.muted}>本轮没有单独的自动检查；适用范围见过程与限制。</span>
        )}
      </Section>
      <Section title={'审阅'}>
        <div className={styles.section}>{report.review}</div>
      </Section>
      <Section title={'限制'}>
        {report.limitations.length ? (
          <ul className={styles.section} style={{ margin: 0, paddingInlineStart: 18 }}>
            {report.limitations.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : (
          <span className={styles.muted}>声明范围内无额外限制；不代表全产品无问题。</span>
        )}
      </Section>
      <Section
        title={'资源收尾'}
        extra={<Tag color={report.cleanup.complete ? 'success' : 'warning'}>{report.cleanup.complete ? '已核对' : '未确认'}</Tag>}
      >
        <div className={styles.section}>{report.cleanup.notes}</div>
      </Section>
      <Section title={'环境'}>
        <dl className={styles.dl}>
          <dt>环境</dt>
          <dd>{report.environment}</dd>
          <dt>入口</dt>
          <dd>{report.entry}</dd>
          <dt>运行版本</dt>
          <dd>{report.revision}</dd>
        </dl>
      </Section>
    </Flexbox>
  );
}

const KIND_ICON = { image: EyeIcon, video: PlayIcon, text: FileIcon };
const KIND_WORD = { image: '截图', video: '录像', text: '记录' } as const;

const files = createStaticStyles(({ css }) => ({
  grid: css`
    column-count: 3;
    column-gap: 12px;

    @media (width <= 900px) {
      column-count: 2;
    }

    @media (width <= 520px) {
      column-count: 1;
    }
  `,
  card: css`
    overflow: hidden;
    break-inside: avoid;
    margin-block-end: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
    transition: border-color 0.2s, box-shadow 0.2s;

    &:hover {
      border-color: var(--brand-soft);
      box-shadow: 0 6px 20px -12px var(--brand);
    }
  `,
  open: css`
    display: block;
    color: inherit;
    text-decoration: none;

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  thumb: css`
    display: block;
    width: 100%;
    height: auto;
    max-height: 360px;
    object-fit: cover;
    object-position: top;
    background: ${cssVar.colorFillQuaternary};
  `,
  head: css`
    padding-block: 14px;
    padding-inline: 14px;
    color: var(--brand);
    background: ${cssVar.colorFillQuaternary};
  `,
  snippet: css`
    overflow: hidden;
    max-height: 96px;
    margin: 0;
    padding-block: 8px;
    padding-inline: 14px;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: ${cssVar.colorFillQuaternary};
  `,
  body: css`
    padding-block: 10px 6px;
    padding-inline: 14px;
  `,
  name: css`
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  caption: css`
    margin-block-start: 2px;
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
  `,
  foot: css`
    padding-block: 4px 12px;
    padding-inline: 14px;
  `,
  tab: css`
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

/** A thumbnail that is never an empty box: loaded at once (lazy loading does not fire inside the multi-column grid in Chromium),
 * retried once if the request is dropped, and a plain icon card if it still fails. */
function Thumb({ src, alt, width, height }: { src: string; alt: string; width?: number; height?: number }) {
  const [tries, setTries] = useState(0);
  if (tries > 1)
    return (
      <Flexbox horizontal align={'center'} className={files.head} gap={10}>
        <G icon={EyeIcon} size={18} />
        <span className={styles.muted}>预览没加载出来，点开看原图</span>
      </Flexbox>
    );
  return (
    <img
      alt={alt}
      className={files.thumb}
      decoding={'async'}
      height={height}
      key={tries}
      src={tries ? `${src}${src.includes('?') ? '&' : '?'}retry=${tries}` : src}
      width={width}
      onError={() => setTries((n) => n + 1)}
    />
  );
}

type FileFilter = 'all' | 'image' | 'video' | 'text';

export function Files({ report, onJump }: { report: Report; onJump: (id: string) => void }) {
  const [only, setOnly] = useState<FileFilter>('all');
  const rows = report.cases.flatMap((item, index) => item.evidence.map((evidence) => ({ item, index, evidence })));
  if (!rows.length) return <span className={styles.muted}>本轮没有附件。</span>;
  const count = (kind: FileFilter) => rows.filter(({ evidence }) => kind === 'all' || evidence.kind === kind).length;
  const shown = rows.filter(({ evidence }) => only === 'all' || evidence.kind === only);
  return (
    <Section
      title={'全部附件'}
      extra={
        <Flexbox horizontal align={'center'} gap={6} style={{ marginInlineStart: 'auto' }}>
          {(['all', 'image', 'video', 'text'] as const).filter((kind) => kind === 'all' || count(kind)).map((kind) => (
            <button
              aria-pressed={only === kind}
              className={styles.jump}
              key={kind}
              style={only === kind ? { background: 'var(--brand)', color: '#fff' } : undefined}
              type={'button'}
              onClick={() => setOnly(kind)}
            >
              {kind === 'all' ? '全部' : KIND_WORD[kind]} {count(kind)}
            </button>
          ))}
        </Flexbox>
      }
    >
      <div className={files.grid}>
        {shown.map(({ item, index, evidence }) => (
          <div className={files.card} key={item.id + evidence.path}>
            <a aria-label={`打开 ${fileName(evidence.path)}`} className={files.open} href={href(evidence.path)} rel={'noopener'} target={'_blank'}>
              {evidence.kind === 'image' ? (
                <Thumb alt={evidence.caption} height={evidence.height} src={href(evidence.path)} width={evidence.width} />
              ) : evidence.kind === 'video' ? (
                // a video card is its icon: browsers differ on showing a first frame, and a black box says nothing
                <Flexbox horizontal align={'center'} className={files.head} gap={10}>
                  <G icon={KIND_ICON.video} size={22} />
                  <span className={styles.muted}>录像，点开播放</span>
                </Flexbox>
              ) : evidence.content ? (
                <pre className={files.snippet}>{evidence.content.slice(0, 400)}</pre>
              ) : (
                <Flexbox horizontal align={'center'} className={files.head} gap={10}>
                  <G icon={KIND_ICON[evidence.kind]} size={18} />
                </Flexbox>
              )}
              <div className={files.body}>
                <Flexbox horizontal align={'center'} gap={8}>
                  <span style={{ color: 'var(--brand)', display: 'inline-flex' }}>
                    <G icon={KIND_ICON[evidence.kind]} size={14} />
                  </span>
                  <span className={files.name}>{fileName(evidence.path)}</span>
                </Flexbox>
                <div className={files.caption}>{evidence.caption}</div>
              </div>
            </a>
            <Flexbox horizontal align={'center'} className={files.foot} gap={8} wrap={'wrap'}>
              <button className={styles.jump} title={`跳到 ${item.title}`} type={'button'} onClick={() => onJump(item.id)}>
                C{index + 1}
              </button>
              <span className={files.tab} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {item.title}
              </span>
              <span className={files.tab}>{evidence.phase === 'final' ? '最终效果' : '验证过程'}</span>
            </Flexbox>
          </div>
        ))}
      </div>
    </Section>
  );
}
