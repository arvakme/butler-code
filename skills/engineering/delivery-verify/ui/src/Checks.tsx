import { ActionIcon, Empty, Flexbox, Icon } from '@lobehub/ui';
import { Button, Select, Switch, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftIcon, CheckIcon, ExpandViewIcon, RetryIcon, SkipBlockIcon } from '@unlocalhosted/dither-icons';
import { ChevronRight, ChevronsDownUp } from 'lucide-react';
import { useState } from 'react';

import { fileName, NoteList, where } from './Annotate';
import Compare from './Compare';
import EvidenceList from './Evidence';
import { type Draft, TAGS } from './feedback';
import { type Closed, type History, pastEvidence, type Step, type Verdict } from './history';
import { G } from './icons';
import { FILTERS, type Filter, filterOf, KIND_LABEL, STATUS } from './status';
import type { Case, Note } from './types';

export const reveal = {
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  initial: { height: 0, opacity: 0 },
  style: { overflow: 'hidden' },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
} as const;

const styles = createStaticStyles(({ css }) => ({
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  row: css`
    scroll-margin-block-start: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    &:first-child {
      border-block-start: none;
    }
  `,
  head: css`
    cursor: pointer;
    padding-block: 12px;
    padding-inline: 16px;
    transition: background 0.2s;

    &:not([data-expanded]):hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  seq: css`
    flex: none;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    letter-spacing: 0.02em;
  `,
  title: css`
    min-width: 0;
    font-size: 14px;
    line-height: 22px;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  ellipsis: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  state: css`
    flex: none;
    font-size: 12px;
    line-height: 22px;
  `,
  observation: css`
    font-size: 13px;
    line-height: 1.7;
    color: ${cssVar.colorTextSecondary};
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,
  spec: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};
    font-size: 12px;
    background: ${cssVar.colorFillQuaternary};

    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 12px;
      margin: 8px 0 2px;
    }

    dt {
      color: ${cssVar.colorTextTertiary};
    }

    dd {
      margin: 0;
      color: ${cssVar.colorText};
      overflow-wrap: anywhere;
    }
  `,
  specToggle: css`
    cursor: pointer;
    display: inline-flex;
    gap: 4px;
    align-items: center;
    width: fit-content;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    background: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  reject: css`
    padding: 12px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorErrorBg};
  `,
  textarea: css`
    box-sizing: border-box;
    width: 100%;
    min-height: 64px;
    padding: 8px 10px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
    font: inherit;
    font-size: 13px;
    color: ${cssVar.colorText};
    resize: vertical;
    background: ${cssVar.colorBgContainer};

    &:focus {
      border-color: ${cssVar.colorPrimary};
      outline: none;
    }
  `,
  tagRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  `,
  chipBtn: css`
    cursor: pointer;
    padding: 2px 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 14px;
    font: inherit;
    font-size: 12px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorBgContainer};
    transition: background 0.2s, color 0.2s, border-color 0.2s;

    &[aria-pressed='true'] {
      border-color: ${cssVar.colorError};
      color: ${cssVar.colorError};
      background: ${cssVar.colorErrorBg};
    }

    &[data-pick]:not([aria-pressed='true']):hover {
      color: var(--brand);
      border-color: var(--brand);
    }
  `,
  lesson: css`
    padding: 10px 12px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
    font-size: 12px;
    line-height: 1.7;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorBgContainer};
    overflow-wrap: anywhere;
  `,
  step: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-inline-start: 2px solid ${cssVar.colorBorderSecondary};
    font-size: 12px;
    line-height: 1.7;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;

    &[data-now] {
      border-inline-start-color: var(--brand);
    }
  `,
  emptyCard: css`
    padding-block: 48px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
}));

const DECISION_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '待你决定' },
  { key: 'accept', label: '已接受' },
  { key: 'reject', label: '要求修改' },
  { key: 'ignore', label: '已忽略' },
] as const;
type DecisionFilter = (typeof DECISION_FILTERS)[number]['key'];

/** The lesson this rejection would leave for the next delivery, in the reader's own words. */
export function lessonText(title: string, draft: Draft, notes: Note[]) {
  const why = [draft.reason.trim(), ...notes.map((note) => `${where(note)}：${note.text.trim()}`)].filter(Boolean).join('；');
  if (!why) return '';
  return `下一轮交付前先对照：${draft.tags.length ? `【${draft.tags.join('、')}】` : ''}${title}。${why}`;
}

interface RowProps {
  item: Case;
  seq: number;
  open: boolean;
  onToggle: () => void;
  round: number;
  accepted: boolean;
  onAccept: () => void;
  ignored: boolean;
  onIgnore: () => void;
  draft: Draft | undefined;
  onReject: (draft: Draft | undefined) => void;
  notes: Note[];
  onNotes: (next: Note[]) => void;
  steps: Step[];
  closed: Closed | undefined;
  submitted: Verdict | undefined;
  history: History | null | undefined;
}

const CheckRow = ({ item, seq, open, onToggle, round, accepted, onAccept, ignored, onIgnore, draft, onReject, notes, onNotes, steps, closed, submitted, history }: RowProps) => {
  const [specOpen, setSpecOpen] = useState(false);
  const [trailOpen, setTrailOpen] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number }>();
  const [pick, setPick] = useState(0);
  const meta = STATUS[item.status];
  const rejected = draft !== undefined;
  const kinds = item.evidence_required.map((kind) => KIND_LABEL[kind]).join('、') || '按行为选取';

  const earlier = steps.filter((step) => step.round < round);
  const past = pastEvidence(history, item.id, round);
  const current = item.evidence.filter((entry) => entry.kind === 'image');
  const pairs = (past?.items ?? []).flatMap((before, index) => {
    const now = current.find((entry) => fileName(entry.path) === fileName(before.path)) ?? current[index];
    return now ? [{ before, now }] : [];
  });
  const pair = pairs[Math.min(pick, pairs.length - 1)];
  const lesson = draft ? lessonText(item.title, draft, notes) : '';

  return (
    <div className={styles.row} data-status={item.status} id={item.id} style={closed !== undefined && !open ? { opacity: 0.72 } : undefined}>
      <Flexbox
        horizontal
        align={'flex-start'}
        aria-expanded={open}
        className={`${styles.head} di-trigger`}
        data-expanded={open ? '' : undefined}
        gap={10}
        role={'button'}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <Flexbox align={'center'} height={22} style={{ flex: 'none' }}>
          <span style={{ color: rejected ? cssVar.colorError : accepted || closed?.kind === 'accept' ? cssVar.colorSuccess : ignored || closed?.kind === 'ignore' ? cssVar.colorTextQuaternary : meta.color }}>
            <G icon={rejected ? RetryIcon : accepted || closed?.kind === 'accept' ? CheckIcon : ignored || closed?.kind === 'ignore' ? SkipBlockIcon : meta.icon} size={16} />
          </span>
        </Flexbox>
        <span className={styles.seq}>C{seq}</span>
        <Flexbox horizontal align={'center'} flex={1} gap={8} style={{ minWidth: 0 }} wrap={open ? 'wrap' : 'nowrap'}>
          <span className={cx(styles.title, !open && styles.ellipsis)}>{item.title}</span>
          {!item.required && <Tag size={'small'}>可选</Tag>}
          {closed !== undefined && (
            <Tag color={closed.kind === 'accept' ? 'success' : undefined} size={'small'}>
              第 {closed.round} 轮已{closed.kind === 'accept' ? '接受' : '忽略'}
            </Tag>
          )}
          {ignored && <Tag size={'small'}>已忽略</Tag>}
          {rejected && (
            <Tag color={'error'} size={'small'}>
              要求修改
            </Tag>
          )}
          {accepted && (
            <Tag color={'success'} size={'small'}>
              已接受
            </Tag>
          )}
          {submitted && !rejected && !accepted && !ignored && (
            <Tag size={'small'}>已提交：{submitted === 'accept' ? '接受' : submitted === 'ignore' ? '忽略' : '要求修改'}</Tag>
          )}
        </Flexbox>
        <span className={styles.state} style={{ color: meta.color }}>
          {meta.label}
        </span>
        <Flexbox align={'center'} height={22} style={{ flex: 'none' }}>
          <Icon
            color={cssVar.colorTextQuaternary}
            icon={ChevronRight}
            size={14}
            style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.45s var(--spring)' }}
          />
        </Flexbox>
      </Flexbox>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div {...reveal}>
            <Flexbox gap={12} paddingBlock={'0 16px'} paddingInline={16}>
              <div className={styles.observation}>{item.observation}</div>
              {item.evidence.length ? (
                <EvidenceList focus={focus} items={item.evidence} notes={notes} onNotes={onNotes} />
              ) : (
                <Text fontSize={12} type={'secondary'}>
                  尚无证据，不表示已验证。
                </Text>
              )}
              <div className={styles.spec}>
                <button
                  aria-expanded={specOpen}
                  className={styles.specToggle}
                  type={'button'}
                  onClick={() => setSpecOpen(!specOpen)}
                >
                  <Icon
                    icon={ChevronRight}
                    size={12}
                    style={{ transform: specOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
                  />
                  验法与预期 · <code>{item.id}</code> · {item.required ? '必验' : '可选'}
                </button>
                <AnimatePresence initial={false}>
                  {specOpen && (
                    <motion.div {...reveal}>
                      <dl>
                        <dt>验法</dt>
                        <dd>{item.method}</dd>
                        <dt>预期</dt>
                        <dd>{item.expected}</dd>
                        <dt>须产出</dt>
                        <dd>{kinds}</dd>
                      </dl>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {earlier.length > 0 && (
                <div className={styles.spec}>
                  <button
                    aria-expanded={trailOpen}
                    className={styles.specToggle}
                    type={'button'}
                    onClick={() => setTrailOpen(!trailOpen)}
                  >
                    <Icon
                      icon={ChevronRight}
                      size={12}
                      style={{ transform: trailOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}
                    />
                    轮次历史 · 已走过 {earlier.length} 轮，现在第 {round} 轮
                  </button>
                  <AnimatePresence initial={false}>
                    {trailOpen && (
                      <motion.div {...reveal}>
                        <Flexbox gap={8} style={{ marginBlockStart: 8 }}>
                          {[...steps].reverse().map((step) => (
                            <div className={styles.step} data-now={step.round === round ? '' : undefined} key={step.round}>
                              <b style={{ color: cssVar.colorText }}>第 {step.round} 轮</b>
                              {step.round === round && '（本轮）'} · {STATUS[step.status as keyof typeof STATUS]?.label ?? step.status}
                              {step.decision === 'accept' && ' · 你接受了'}
                              {step.decision === 'ignore' && ' · 你选了忽略'}
                              {step.decision === 'reject' && ' · 你要求修改'}
                              {step.rejection?.tags?.length ? `【${step.rejection.tags.join('、')}】` : ''}
                              {step.reason ? `：${step.reason}` : ''}
                              {step.rejection?.notes?.map((note) => (
                                <div key={note.id}>
                                  {where(note)}：{note.text}
                                </div>
                              ))}
                            </div>
                          ))}
                          {pair && past && (
                            <Flexbox gap={8} style={{ marginBlockStart: 4 }}>
                              <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
                                <Text fontSize={12} strong>
                                  与第 {past.round} 轮对比
                                </Text>
                                {pairs.length > 1 &&
                                  pairs.map((entry, index) => (
                                    <button
                                      aria-pressed={entry === pair}
                                      className={styles.chipBtn}
                                      data-pick={''}
                                      key={entry.now.path}
                                      type={'button'}
                                      style={entry === pair ? { borderColor: 'var(--brand)', color: 'var(--brand)', background: 'var(--brand-tint)' } : undefined}
                                      onClick={() => setPick(index)}
                                    >
                                      {fileName(entry.now.path)}
                                    </button>
                                  ))}
                              </Flexbox>
                              <Compare
                                after={{ label: `第 ${round} 轮`, path: pair.now.path, width: pair.now.width, height: pair.now.height }}
                                before={{ label: `第 ${past.round} 轮`, path: pair.before.path }}
                                key={pair.now.path}
                              />
                            </Flexbox>
                          )}
                        </Flexbox>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              <AnimatePresence initial={false}>
                {draft && (
                  <motion.div key={'reject'} {...reveal}>
                    <Flexbox className={styles.reject} gap={10}>
                      <Text fontSize={12} strong>
                        哪里不对（可多选）
                      </Text>
                      <div className={styles.tagRow}>
                        {TAGS.map((tag) => (
                          <button
                            aria-pressed={draft.tags.includes(tag)}
                            className={styles.chipBtn}
                            data-pick={''}
                            key={tag}
                            type={'button'}
                            onClick={() =>
                              onReject({ ...draft, tags: draft.tags.includes(tag) ? draft.tags.filter((entry) => entry !== tag) : [...draft.tags, tag] })
                            }
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                      <Text fontSize={12} strong>
                        具体说一句（可选；图上、视频里标的意见会一起提交）
                      </Text>
                      <textarea
                        autoFocus={notes.length === 0}
                        aria-label={`C${seq} 打回原因`}
                        className={styles.textarea}
                        placeholder={'例如：窄屏下截图太小，看不清按钮文字。'}
                        value={draft.reason}
                        onChange={(event) => onReject({ ...draft, reason: event.target.value })}
                      />
                      <NoteList
                        notes={notes}
                        onChange={onNotes}
                        onLocate={(note) => setFocus((now) => ({ id: note.id, n: (now?.n ?? 0) + 1 }))}
                      />
                      <Flexbox horizontal align={'center'} gap={8}>
                        <Switch aria-label={'存成教训'} checked={draft.lesson} size={'small'} onChange={(lessonOn: boolean) => onReject({ ...draft, lesson: lessonOn })} />
                        <Text fontSize={12}>存成一条教训，下一轮交付前先对照</Text>
                      </Flexbox>
                      {draft.lesson && (
                        <div className={styles.lesson}>
                          {lesson || '写下原因或在图上标一处后，这里会预览将记下的教训。'}
                          {lesson && <div style={{ color: cssVar.colorTextTertiary }}>按你写的原话交给 Agent，由它整理成可检查的规则。</div>}
                        </div>
                      )}
                    </Flexbox>
                  </motion.div>
                )}
              </AnimatePresence>
              <Flexbox horizontal gap={8} justify={'flex-end'}>
                {rejected ? (
                  <Button className={'di-trigger jelly'} icon={<G icon={ArrowLeftIcon} size={14} />} size={'small'} onClick={() => onReject(undefined)}>
                    撤回打回
                  </Button>
                ) : (
                  <Button danger className={'di-trigger jelly'} icon={<G icon={RetryIcon} size={14} />} size={'small'} type={'fill'} onClick={() => onReject({ reason: '', tags: [], lesson: true })}>
                    要求修改
                  </Button>
                )}
                {ignored ? (
                  <Button className={'di-trigger jelly'} icon={<G icon={ArrowLeftIcon} size={14} />} size={'small'} onClick={onIgnore}>
                    撤回忽略
                  </Button>
                ) : (
                  <Button className={'di-trigger jelly'} icon={<G icon={SkipBlockIcon} size={14} />} size={'small'} title={'这一项不用处理：不需要、不适用或之后再说'} onClick={onIgnore}>
                    忽略
                  </Button>
                )}
                {accepted ? (
                  <Button className={'di-trigger jelly'} icon={<G icon={ArrowLeftIcon} size={14} />} size={'small'} onClick={onAccept}>
                    撤回接受
                  </Button>
                ) : (
                  <Button className={'di-trigger jelly'} icon={<G icon={CheckIcon} size={14} />} size={'small'} onClick={onAccept}>
                    接受{notes.length ? '（会清掉已标的意见）' : ''}
                  </Button>
                )}
              </Flexbox>
            </Flexbox>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface ChecksProps {
  cases: Case[];
  filter: Filter;
  setFilter: (filter: Filter) => void;
  open: Set<string>;
  setOpen: (next: Set<string>) => void;
  round: number;
  history: History | null | undefined;
  accepted: Set<string>;
  onAccept: (id: string) => void;
  ignored: Set<string>;
  onIgnore: (id: string) => void;
  drafts: Map<string, Draft>;
  onReject: (id: string, draft: Draft | undefined) => void;
  notes: Map<string, Note[]>;
  onNotes: (id: string, next: Note[]) => void;
  steps: (id: string) => Step[];
  closed: Map<string, Closed>;
  submitted: Map<string, Verdict>;
}

export default function Checks({ cases, filter, setFilter, open, setOpen, round, history, accepted, onAccept, ignored, onIgnore, drafts, onReject, notes, onNotes, steps, closed, submitted }: ChecksProps) {
  const [decision, setDecision] = useState<DecisionFilter>('all');
  const [fromRound, setFromRound] = useState<number>(0);
  const decisionOf = (item: Case): Exclude<DecisionFilter, 'all'> =>
    drafts.has(item.id) ? 'reject' : ignored.has(item.id) || closed.get(item.id)?.kind === 'ignore' ? 'ignore' : accepted.has(item.id) || closed.has(item.id) ? 'accept' : 'open';
  const earlierRounds = (history?.rounds ?? []).filter((entry) => entry.round < round);
  const inRound = (item: Case) =>
    fromRound === 0 || fromRound === round || !!history?.rounds.find((entry) => entry.round === fromRound)?.cases.some((entry) => entry.id === item.id);
  const shown = cases.filter((item) => (decision === 'all' || decisionOf(item) === decision) && inRound(item));
  const count = (key: Filter) => shown.filter((item) => key === 'all' || filterOf(item) === key).length;
  const visible = shown.filter((item) => filter === 'all' || filterOf(item) === filter);
  const allOpen = visible.length > 0 && visible.every((item) => open.has(item.id));
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  const decisionCount = (key: DecisionFilter) => cases.filter((item) => key === 'all' || decisionOf(item) === key).length;
  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align={'center'} gap={12} justify={'space-between'} wrap={'wrap'}>
        <Text strong>验收项</Text>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Select
            aria-label={'按你的决定筛选'}
            value={decision}
            style={{ width: 128 }}
            options={DECISION_FILTERS.map((item) => ({ label: `${item.label} ${decisionCount(item.key)}`, value: item.key }))}
            onChange={(value) => setDecision(value as DecisionFilter)}
          />
          {earlierRounds.length > 0 && (
            <Select
              aria-label={'按轮次筛选'}
              value={fromRound}
              style={{ width: 128 }}
              options={[
                { label: '全部轮次', value: 0 },
                ...earlierRounds.map((entry) => ({ label: `第 ${entry.round} 轮`, value: entry.round })),
                { label: `第 ${round} 轮（本轮）`, value: round },
              ]}
              onChange={(value) => setFromRound(Number(value))}
            />
          )}
          <Select
            aria-label={'筛选验收项'}
            value={filter}
            style={{ width: 132 }}
            options={FILTERS.filter((item) => item.key === 'all' || count(item.key)).map((item) => ({
              label: `${item.label} ${count(item.key)}`,
              value: item.key,
            }))}
            onChange={(value) => setFilter(value as Filter)}
          />
          <ActionIcon
            aria-label={allOpen ? '全部收起' : '全部展开'}
            className={'di-trigger jelly'}
            icon={allOpen ? ChevronsDownUp : <G icon={ExpandViewIcon} size={16} />}
            size={'small'}
            title={allOpen ? '全部收起' : '全部展开'}
            onClick={() => setOpen(allOpen ? new Set() : new Set(cases.map((item) => item.id)))}
          />
        </Flexbox>
      </Flexbox>
      <p aria-live={'polite'} style={{ height: 0, margin: 0, overflow: 'hidden' }}>
        显示 {visible.length} 项
      </p>
      {visible.length === 0 ? (
        <Flexbox align={'center'} className={styles.emptyCard} justify={'center'}>
          <Empty description={'这个分类没有验收项。'} />
        </Flexbox>
      ) : (
        <div className={styles.list}>
          {visible.map((item) => (
            <CheckRow
              accepted={accepted.has(item.id)}
              ignored={ignored.has(item.id)}
              onIgnore={() => onIgnore(item.id)}
              closed={closed.get(item.id)}
              draft={drafts.get(item.id)}
              history={history}
              item={item}
              key={item.id}
              notes={notes.get(item.id) ?? []}
              open={open.has(item.id)}
              round={round}
              seq={cases.indexOf(item) + 1}
              steps={steps(item.id)}
              submitted={submitted.get(item.id)}
              onAccept={() => onAccept(item.id)}
              onNotes={(next) => onNotes(item.id, next)}
              onReject={(next) => onReject(item.id, next)}
              onToggle={() => toggle(item.id)}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
}
