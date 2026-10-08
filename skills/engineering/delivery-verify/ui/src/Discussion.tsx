import { Flexbox } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MessageIcon } from '@unlocalhosted/dither-icons';
import { Bot, Plus, User } from 'lucide-react';
import { useEffect, useState } from 'react';

import { where } from './Annotate';
import { when } from './format';
import { G } from './icons';
import type { History, Submission } from './history';
import Markdown from './Markdown';
import type { Report } from './types';

const styles = createStaticStyles(({ css }) => ({
  muted: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  avatar: css`
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 600;
  `,
  card: css`
    flex: 1;
    min-width: 0;
    padding: 12px 14px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    font-size: 13px;
    line-height: 1.7;
    color: ${cssVar.colorText};
    background: ${cssVar.colorBgContainer};
    overflow-wrap: anywhere;
  `,
  line: css`
    color: ${cssVar.colorTextSecondary};
  `,
  react: css`
    cursor: pointer;
    display: inline-flex;
    gap: 4px;
    align-items: center;
    padding: 1px 8px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;
    font: inherit;
    font-size: 13px;
    line-height: 22px;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorBgContainer};
    transition: border-color 0.2s, background 0.2s;

    &:hover {
      border-color: var(--brand-soft);
    }

    &[aria-pressed='true'] {
      border-color: var(--brand-soft);
      background: var(--brand-tint);
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
    }
  `,
  chip: css`
    padding-inline: 8px;
    border-radius: 10px;
    font-size: 12px;
    line-height: 20px;
  `,
  textarea: css`
    box-sizing: border-box;
    width: 100%;
    min-height: 120px;
    padding: 10px 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};
    font: inherit;
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    resize: vertical;
    background: ${cssVar.colorBgContainer};

    &:focus {
      border-color: ${cssVar.colorPrimary};
      outline: none;
    }
  `,
}));

type Entry = { key: string; at: string; node: React.ReactNode };

const DELIVERY: Record<string, string> = { delivered: '已送到 Agent', delivery_unknown: '已保存，尚未确认 Agent 收到', sending: '正在投递' };

function Avatar({ you }: { you?: boolean }) {
  return (
    <span
      className={styles.avatar}
      style={you ? { color: '#fff', background: 'var(--brand)' } : { color: 'var(--brand)', background: 'var(--brand-tint)' }}
    >
      {you ? <User aria-label={'你'} size={15} /> : <Bot aria-label={'Agent'} size={16} />}
    </span>
  );
}

const PALETTE = ['👍', '❤️', '🎉', '👀', '🤔', '❓'];

/** Emoji on a message, kept on the board next to the round it belongs to (nothing is sent to the Agent for it). */
function useReactions(history: History | null | undefined) {
  const [mine, setMine] = useState<Record<string, string[]>>({});
  const [problem, setProblem] = useState('');
  useEffect(() => {
    const next: Record<string, string[]> = {};
    for (const round of history?.rounds ?? []) for (const [target, list] of Object.entries(round.reactions ?? {})) next[`${round.round}|${target}`] = list;
    setMine(next);
  }, [history]);
  const toggle = async (round: number, target: string, emoji: string) => {
    const key = `${round}|${target}`;
    const on = !(mine[key] ?? []).includes(emoji);
    const before = mine;
    setMine({ ...mine, [key]: on ? [...(mine[key] ?? []), emoji] : (mine[key] ?? []).filter((entry) => entry !== emoji) });
    setProblem('');
    try {
      const response = await fetch(new URL('reaction', location.href), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ round, target, emoji, on }) });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      setMine(before);
      setProblem('表情没保存上，请从看板的 HTTPS 地址打开再试。');
    }
  };
  return { mine, toggle, problem, enabled: Boolean(history) && location.protocol === 'https:' };
}

function Reactions({ list, enabled, onToggle }: { list: string[]; enabled: boolean; onToggle: (emoji: string) => void }) {
  const [picking, setPicking] = useState(false);
  if (!enabled && !list.length) return null;
  return (
    <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'} style={{ marginBlockStart: 4 }}>
      {list.map((emoji) => (
        <button aria-label={`取消表情 ${emoji}`} aria-pressed={'true'} className={styles.react} disabled={!enabled} key={emoji} type={'button'} onClick={() => onToggle(emoji)}>
          {emoji}
        </button>
      ))}
      {enabled && (
        <button aria-expanded={picking} aria-label={'添加表情'} className={styles.react} type={'button'} onClick={() => setPicking(!picking)}>
          <Plus size={13} />
        </button>
      )}
      {enabled &&
        picking &&
        PALETTE.filter((emoji) => !list.includes(emoji)).map((emoji) => (
          <button
            aria-label={`表情 ${emoji}`}
            className={styles.react}
            key={emoji}
            type={'button'}
            onClick={() => {
              setPicking(false);
              onToggle(emoji);
            }}
          >
            {emoji}
          </button>
        ))}
    </Flexbox>
  );
}

function SubmissionCard({ sub, round, titles }: { sub: Submission; round: number; titles: Map<string, string> }) {
  const name = (id: string) => titles.get(id) ?? id;
  return (
    <Flexbox className={styles.card} gap={4}>
      <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
        <b>你提交了第 {round} 轮的决定</b>
        {sub.accepted.length > 0 && (
          <span className={styles.chip} style={{ background: cssVar.colorSuccessBg, color: cssVar.colorSuccess }}>
            接受 {sub.accepted.length}
          </span>
        )}
        {(sub.ignored?.length ?? 0) > 0 && <span className={styles.chip} style={{ background: cssVar.colorFillTertiary, color: cssVar.colorTextSecondary }}>忽略 {sub.ignored!.length}</span>}
        {sub.rejected.length > 0 && (
          <span className={styles.chip} style={{ background: cssVar.colorErrorBg, color: cssVar.colorError }}>
            要求修改 {sub.rejected.length}
          </span>
        )}
      </Flexbox>
      {sub.accepted.length > 0 && <div className={styles.line}>已接受：{sub.accepted.map(name).join('、')}</div>}
      {(sub.ignored?.length ?? 0) > 0 && <div className={styles.line}>已忽略：{sub.ignored!.map(name).join('、')}</div>}
      {sub.rejected.map((item) => (
        <div key={item.id}>
          <b>{name(item.id)}</b>
          {item.tags?.length ? ` 【${item.tags.join('、')}】` : ''}
          {item.reason ? `：${item.reason}` : ''}
          {item.notes?.map((note) => (
            <div className={styles.line} key={note.id}>
              {where(note)}：{note.text}
            </div>
          ))}
        </div>
      ))}
      {sub.comment.trim() && <div style={{ whiteSpace: 'pre-wrap' }}>{sub.comment.trim()}</div>}
      <span className={styles.muted} style={{ fontSize: 12 }}>
        {DELIVERY[sub.status ?? ''] ?? sub.status ?? ''}
      </span>
    </Flexbox>
  );
}

interface Props {
  report: Report;
  history: History | null | undefined;
  accepted: number;
  ignored: number;
  rejected: number;
  comment: string;
  setComment: (value: string) => void;
  sending: boolean;
  message: string;
  onSend: () => void;
}

export default function Discussion({ report, history, accepted, ignored, rejected, comment, setComment, sending, message, onSend }: Props) {
  const entries: Entry[] = [];
  const reactions = useReactions(history);
  for (const round of history?.rounds ?? []) {
    const titles = new Map(round.cases.map((item) => [item.id, item.title ?? item.id]));
    entries.push({
      key: `r${round.round}`,
      at: round.created_at,
      node: (
        <Flexbox horizontal gap={12}>
          <Avatar />
          <Flexbox className={styles.card} gap={4}>
            <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
              <b>Agent 提交了第 {round.round} 轮</b>
              <span className={styles.chip} style={{ background: 'var(--brand-tint)', color: 'var(--brand)' }}>
                {round.cases.length} 项
              </span>
            </Flexbox>
            {round.message ? <Markdown text={round.message} /> : <div className={styles.line}>{round.summary}</div>}
            <span className={styles.muted} style={{ fontSize: 12 }}>
              {when(round.created_at)}
            </span>
            <Reactions enabled={reactions.enabled} list={reactions.mine[`${round.round}|round`] ?? []} onToggle={(emoji) => reactions.toggle(round.round, 'round', emoji)} />
          </Flexbox>
        </Flexbox>
      ),
    });
    for (const sub of round.submissions) {
      entries.push({
        key: sub.id,
        at: sub.at,
        node: (
          <Flexbox horizontal gap={12}>
            <Avatar you />
            <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
              <SubmissionCard round={round.round} sub={sub} titles={titles} />
              <span className={styles.muted} style={{ fontSize: 12, paddingInlineStart: 4 }}>
                你 · {when(sub.at)}
              </span>
              <div style={{ paddingInlineStart: 4 }}>
                <Reactions enabled={reactions.enabled} list={reactions.mine[`${round.round}|sub:${sub.id}`] ?? []} onToggle={(emoji) => reactions.toggle(round.round, `sub:${sub.id}`, emoji)} />
              </div>
            </Flexbox>
          </Flexbox>
        ),
      });
    }
  }
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <Flexbox gap={16}>
      <Text strong>讨论</Text>
      {history === undefined && <span className={styles.muted}>正在读取历史…</span>}
      {reactions.problem && <span className={styles.muted} role={'status'}>{reactions.problem}</span>}
      {history === null && (
        <span className={styles.muted}>这份报告是离线打开的，看不到历史记录和已提交的决定。从交付看板的地址打开就能看到。</span>
      )}
      {entries.map((entry) => (
        <div key={entry.key}>{entry.node}</div>
      ))}
      <Flexbox gap={8}>
        <label htmlFor={'feedback'} style={{ fontSize: 13, fontWeight: 500 }}>
          总体意见
        </label>
        <span className={styles.muted}>
          逐项的决定在“验收项”里做（接受、要求修改，图上和视频里可直接标）。这里补充不针对某一项的话；
          {accepted + rejected + ignored > 0 ? `现在已选：接受 ${accepted} 项、要求修改 ${rejected} 项${ignored ? `、忽略 ${ignored} 项` : ''}，点提交一起交回 Agent。` : '什么都不选，只写意见也可以提交。'}
        </span>
        <textarea
          className={styles.textarea}
          id={'feedback'}
          placeholder={'例如：主要流程没问题，但窄屏下截图希望再大一些。'}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <Flexbox horizontal align={'center'} gap={12} wrap={'wrap'}>
          <Button
            className={'di-trigger jelly brand-btn'}
            icon={<G icon={MessageIcon} />}
            id={'submit-feedback'}
            loading={sending}
            type={'primary'}
            onClick={onSend}
          >
            提交
          </Button>
          <span className={styles.muted}>直接交回本次交付的 Agent · 第 {report.round} 轮</span>
        </Flexbox>
        <p id={'feedback-result'} role={'status'} style={{ fontSize: 13, margin: 0 }}>
          {message}
        </p>
      </Flexbox>
    </Flexbox>
  );
}
