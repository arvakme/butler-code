import { Flexbox, Icon } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { MotionConfig } from 'motion/react';
import { CheckIcon, MessageIcon, RetryIcon } from '@unlocalhosted/dither-icons';
import { useEffect, useRef, useState } from 'react';

import Backdrop, { burstFrom, Sparkle } from './Backdrop';
import Checks from './Checks';
import { G } from './icons';
import { type Draft, submitFeedback, type SendOutcome, type FeedbackSubmission } from './feedback';
import Header, { type TabKey } from './Header';
import { Files, Process } from './Panels';
import { FILTERS, type Filter, filterOf } from './status';
import Discussion from './Discussion';
import Flows from './Flows';
import { type Closed, closedIn, trail, useHistory, type Verdict } from './history';
import type { Note, Report } from './types';

const styles = createStaticStyles(({ css }) => ({
  page: css`
    position: relative;
    z-index: 1;
    min-height: 100vh;
    color: ${cssVar.colorText};
  `,
  column: css`
    box-sizing: border-box;
    width: 100%;
    max-width: 920px;
    margin-inline: auto;
    padding-inline: 24px;

    @media (width <= 767px) {
      padding-inline: 16px;
    }
  `,
  bar: css`
    position: sticky;
    z-index: 20;
    inset-block-end: 16px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    box-sizing: border-box;
    width: 100%;
    padding-block: 12px;
    padding-inline: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: color-mix(in srgb, ${cssVar.colorBgElevated} 82%, transparent);
    backdrop-filter: blur(14px) saturate(1.3);
    box-shadow: 0 10px 30px -18px var(--brand), ${cssVar.boxShadowTertiary};

    @media (width <= 767px) {
      inset-block-end: max(8px, env(safe-area-inset-bottom));
      padding: 12px;
    }
  `,
  barSummary: css`
    flex: 1;
    min-width: 160px;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  barActions: css`
    flex-wrap: wrap;
    justify-content: flex-end;

    @media (width <= 480px) {
      width: 100%;

      > button {
        flex: 1;
      }
    }
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
  rejected: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    & > div + div {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  muted: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  footer: css`
    padding-block: 32px 24px;
    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    text-align: center;
  `,
}));

// View state lives in the hash so a copied address reopens the same view.
interface View {
  tab: TabKey;
  filter: Filter;
  open: Set<string>;
}

const TABS: TabKey[] = ['checks', 'flow', 'process', 'files', 'feedback'];

function readView(report: Report): View {
  const hash = decodeURIComponent(location.hash.slice(1));
  const ids = new Set(report.cases.map((item) => item.id));
  if (ids.has(hash)) return { tab: 'checks', filter: 'all', open: new Set([hash]) };
  const params = new URLSearchParams(hash);
  const tab = params.get('tab') as TabKey;
  const filter = params.get('filter') as Filter;
  const open = params.get('open');
  return {
    tab: TABS.includes(tab) ? tab : 'checks',
    filter: FILTERS.some((item) => item.key === filter) ? filter : 'all',
    // Default: every case open so evidence is visible without clicking.
    open: open === null ? new Set(ids) : new Set(open.split(',').filter((id) => ids.has(id))),
  };
}

function writeView(view: View, report: Report) {
  const params = new URLSearchParams();
  if (view.tab !== 'checks') params.set('tab', view.tab);
  if (view.filter !== 'all') params.set('filter', view.filter);
  if (view.open.size !== report.cases.length) params.set('open', [...view.open].join(','));
  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}

function useStored<T>(key: string, initial: T, encode: (value: T) => string, decode: (raw: string) => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : decode(raw);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, encode(value));
    } catch {
      /* private window or blocked storage: keep in memory only */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export default function App({ report }: { report: Report }) {
  const [view, setView] = useState(() => readView(report));
  const history = useHistory();
  const storeKey = `delivery-verify:${report.project}:${report.task}:${report.round}`;
  const [drafts, setDrafts] = useStored(
    `${storeKey}:drafts`,
    new Map<string, Draft>(),
    (value) => JSON.stringify([...value]),
    (raw) => new Map(JSON.parse(raw)),
  );
  const [accepted, setAccepted] = useStored(
    `${storeKey}:accepted`,
    new Set<string>(),
    (value) => JSON.stringify([...value]),
    (raw) => new Set(JSON.parse(raw)),
  );
  const [ignored, setIgnored] = useStored(
    `${storeKey}:ignored`,
    new Set<string>(),
    (value) => JSON.stringify([...value]),
    (raw) => new Set(JSON.parse(raw)),
  );
  const [notes, setNotes] = useStored(
    `${storeKey}:notes`,
    new Map<string, Note[]>(),
    (value) => JSON.stringify([...value]),
    (raw) => new Map(JSON.parse(raw)),
  );
  const [comment, setComment] = useStored(`${storeKey}:comment`, '', String, String);
  const [outcome, setOutcome] = useState<SendOutcome & { at?: number }>();
  const [copying, setCopying] = useState(false);
  const dispatching = useRef(false);
  const [submission, setSubmission] = useStored(`${storeKey}:submission`, { fingerprint: '', id: '' }, JSON.stringify, JSON.parse);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [scrollTo, setScrollTo] = useState<string>();
  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(scrollTo)?.scrollIntoView({ block: 'start' });
    setScrollTo(undefined);
  }, [scrollTo]);

  useEffect(() => writeView(view, report), [view]);
  useEffect(() => {
    // A pasted or clicked address (e.g. #case-id) re-reads the view; replaceState never fires this.
    const onHash = () => setView(readView(report));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // What earlier rounds decided: checks accepted before stay closed, and this round's saved decisions show as submitted.
  const stepsOf = (id: string) => trail(history, id, report.round);
  const closed = new Map<string, Closed>();
  const submitted = new Map<string, Verdict>();
  for (const item of report.cases) {
    const steps = stepsOf(item.id);
    const done = closedIn(steps, report.round);
    if (done) closed.set(item.id, done);
    const now = steps.find((step) => step.round === report.round)?.decision;
    if (now) submitted.set(item.id, now);
  }
  const folded = useRef(false);
  useEffect(() => {
    // closed checks start folded, unless the address says which to open
    if (folded.current || !history) return;
    folded.current = true;
    if (new URLSearchParams(decodeURIComponent(location.hash.slice(1))).has('open')) return;
    setView((current) => ({ ...current, open: new Set([...current.open].filter((id) => !closed.has(id))) }));
  }, [history]);

  const setTab = (tab: TabKey) => {
    setView((current) => ({ ...current, tab }));
    const top = tabsRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) tabsRef.current?.scrollIntoView({ block: 'start' });
  };
  const jump = (id: string) => {
    const target = report.cases.find((item) => item.id === id)!;
    setView((current) => ({
      tab: 'checks',
      filter: current.filter === 'all' || filterOf(target) === current.filter ? current.filter : 'all',
      open: new Set(current.open).add(id),
    }));
    setScrollTo(id);
  };
  const dropNotes = (id: string) => setNotes((current) => (current.has(id) ? new Map([...current].filter(([key]) => key !== id)) : current));
  const unaccept = (id: string) => setAccepted((current) => (current.has(id) ? new Set([...current].filter((key) => key !== id)) : current));
  const unignore = (id: string) => setIgnored((current) => (current.has(id) ? new Set([...current].filter((key) => key !== id)) : current));
  const reject = (id: string, draft: Draft | undefined) => {
    setDrafts((current) => {
      const next = new Map(current);
      if (draft === undefined) next.delete(id);
      else next.set(id, draft);
      return next;
    });
    if (draft === undefined) dropNotes(id); // withdrawing a rejection takes the comments pinned to its pictures and videos with it
    else (unaccept(id), unignore(id));
  };
  // accepting says "nothing to fix here", so it also drops any rejection and what was pinned for it
  const accept = (id: string) => {
    if (accepted.has(id)) return unaccept(id);
    setDrafts((current) => (current.has(id) ? new Map([...current].filter(([key]) => key !== id)) : current));
    dropNotes(id);
    unignore(id);
    setAccepted((current) => new Set(current).add(id));
  };
  // ignoring says "nothing to do about this one": not needed, not applicable, or later; it clears the other choices too
  const ignore = (id: string) => {
    if (ignored.has(id)) return unignore(id);
    setDrafts((current) => (current.has(id) ? new Map([...current].filter(([key]) => key !== id)) : current));
    dropNotes(id);
    unaccept(id);
    setIgnored((current) => new Set(current).add(id));
  };
  // a comment pinned to a picture or video is itself a rejection of that check
  const setCaseNotes = (id: string, next: Note[]) => {
    setNotes((current) => {
      const copy = new Map(current);
      if (next.length) copy.set(id, next);
      else copy.delete(id);
      return copy;
    });
    if (next.length) {
      setDrafts((current) => (current.has(id) ? current : new Map(current).set(id, { reason: '', tags: [], lesson: true })));
      unaccept(id);
      unignore(id);
    }
  };

  const open = report.cases.filter((item) => !closed.has(item.id));
  const acceptedIds = open.filter((item) => accepted.has(item.id)).map((item) => item.id);
  const rejected = report.cases
    .map((item, index) => ({ item, seq: index + 1 }))
    .filter(({ item }) => drafts.has(item.id));
  const ignoredIds = open.filter((item) => ignored.has(item.id)).map((item) => item.id);
  const undecided = open.filter((item) => !accepted.has(item.id) && !drafts.has(item.id) && !ignored.has(item.id)).length;
  const files = report.cases.reduce((sum, item) => sum + item.evidence.length, 0);
  const sent = (history?.rounds ?? []).reduce((sum, round) => sum + round.submissions.length, 0);

  const send = async (all: boolean, from?: Element | null) => {
    if (dispatching.current) return;
    const take = all ? open.filter((item) => !ignored.has(item.id)).map((item) => item.id) : acceptedIds;
    const rejects = all ? [] : rejected.map(({ item }) => ({ id: item.id, ...drafts.get(item.id)!, notes: notes.get(item.id) ?? [] }));
    const skipped = ignoredIds;
    const decision = rejects.length || (!take.length && !skipped.length) ? 'reject' : 'accept';
    const content = { task: report.task, round: report.round, decision, accepted: take, ignored: skipped, rejected: rejects, comment };
    const fingerprint = JSON.stringify(content);
    const id = submission.fingerprint === fingerprint ? submission.id : crypto.randomUUID();
    const next = { fingerprint, id };
    setSubmission(next);
    try { localStorage.setItem(`${storeKey}:submission`, JSON.stringify(next)); } catch { /* keep in memory */ }
    dispatching.current = true;
    setCopying(true);
    const result = await submitFeedback({ id, ...content } as FeedbackSubmission, location.href);
    dispatching.current = false;
    setCopying(false);
    setOutcome({ ...result, at: Date.now() });
    if (result.kind === 'sent' && decision === 'accept' && take.length + skipped.length === open.length) burstFrom(from ?? null);
    else if (result.kind !== 'sent') setTab('feedback');
    if (all && result.kind !== 'empty') setAccepted(new Set(take));
  };
  const message = outcome?.kind === 'empty' ? '请先逐项决定，或填写意见。' : outcome?.message ?? '';
  const acceptRest = () => setAccepted(new Set([...accepted, ...open.filter((item) => !drafts.has(item.id) && !ignored.has(item.id)).map((item) => item.id)]));

  return (
    <MotionConfig reducedMotion={'user'}>
      <Backdrop />
      <div className={styles.page}>
        <div ref={tabsRef} style={{ scrollMarginTop: -200 }} />
        <Header
          column={styles.column}
          discussion={sent}
          files={files}
          pending={acceptedIds.length + rejected.length + ignoredIds.length}
          report={report}
          tab={view.tab}
          onTab={setTab}
        />
        <main className={styles.column} style={{ paddingBlock: 20 }}>
          {view.tab === 'checks' && (
            <Flexbox gap={16}>
              <Checks
                accepted={accepted}
                ignored={ignored}
                cases={report.cases}
                closed={closed}
                drafts={drafts}
                filter={view.filter}
                history={history}
                notes={notes}
                open={view.open}
                round={report.round}
                steps={stepsOf}
                submitted={submitted}
                setFilter={(filter) => setView((current) => ({ ...current, filter }))}
                setOpen={(open) => setView((current) => ({ ...current, open }))}
                onAccept={accept}
                onIgnore={ignore}
                onNotes={setCaseNotes}
                onReject={reject}
              />
              <div className={styles.bar} role={'region'} aria-label={'验收决定'}>
                <div className={styles.barSummary}>
                  {rejected.length || acceptedIds.length || ignoredIds.length ? (
                    <Flexbox horizontal align={'center'} gap={6} wrap={'wrap'}>
                      {rejected.length > 0 && (
                        <span style={{ alignItems: 'center', color: cssVar.colorError, display: 'inline-flex', gap: 6 }}>
                          <G icon={RetryIcon} size={15} />
                          要求修改 {rejected.length}：{rejected.map(({ seq }) => `C${seq}`).join('、')}
                        </span>
                      )}
                      {acceptedIds.length > 0 && <span style={{ color: cssVar.colorSuccess }}>接受 {acceptedIds.length}</span>}
                      {ignoredIds.length > 0 && <span>忽略 {ignoredIds.length}</span>}
                      {undecided > 0 && <span>待决定 {undecided}</span>}
                    </Flexbox>
                  ) : (
                    '逐项查看证据：满意就“接受”，不对就“要求修改”（图上、视频里可以直接标）；都满意就全部接受。'
                  )}
                  {message && view.tab === 'checks' && (
                    <div role={'status'} style={{ color: cssVar.colorTextTertiary, fontSize: 12, marginBlockStart: 4 }}>
                      {message}
                    </div>
                  )}
                </div>
                <Flexbox horizontal className={styles.barActions} gap={8}>
                  <Button className={'di-trigger jelly'} icon={<G icon={MessageIcon} />} onClick={() => setTab('feedback')}>
                    写意见
                  </Button>
                  {rejected.length === 0 && acceptedIds.length + ignoredIds.length > 0 && undecided > 0 && (
                    <Button className={'di-trigger jelly'} onClick={acceptRest}>
                      其余也接受
                    </Button>
                  )}
                  {rejected.length ? (
                    <Button danger className={'di-trigger jelly'} icon={<G icon={MessageIcon} />} loading={copying} type={'primary'} onClick={(event) => send(false, event.currentTarget)}>
                      提交决定
                    </Button>
                  ) : acceptedIds.length + ignoredIds.length > 0 && undecided > 0 ? (
                    <Button className={'di-trigger jelly brand-btn'} icon={<G icon={CheckIcon} />} loading={copying} type={'primary'} onClick={(event) => send(false, event.currentTarget)}>
                      提交已决定的 {acceptedIds.length + ignoredIds.length} 项
                    </Button>
                  ) : (
                    <Button
                      className={'di-trigger jelly brand-btn'}
                      icon={<G icon={CheckIcon} />}
                      loading={copying}
                      type={'primary'}
                      onClick={(event) => send(acceptedIds.length + ignoredIds.length === 0, event.currentTarget)}
                    >
                      {ignoredIds.length ? '提交决定' : '全部接受'}
                    </Button>
                  )}
                </Flexbox>
              </div>
            </Flexbox>
          )}
          {view.tab === 'flow' && (
            <Flows accepted={accepted} closed={closed} drafts={drafts} history={history} ignored={ignored} report={report} storeKey={storeKey} onJump={jump} />
          )}
          {view.tab === 'process' && <Process report={report} />}
          {view.tab === 'files' && <Files report={report} onJump={jump} />}
          {view.tab === 'feedback' && (
            <Discussion
              accepted={acceptedIds.length}
              ignored={ignoredIds.length}
              comment={comment}
              history={history}
              message={message}
              rejected={rejected.length}
              report={report}
              sending={copying}
              setComment={setComment}
              onSend={() => send(false)}
            />
          )}
        </main>
        <footer className={styles.footer}>
          <Sparkle size={9} soft style={{ marginInlineEnd: 8, verticalAlign: 'middle' }} />
          离线报告 · 证据留在本地 · 验证通过不等于你已验收或同意发布
        </footer>
      </div>
    </MotionConfig>
  );
}
