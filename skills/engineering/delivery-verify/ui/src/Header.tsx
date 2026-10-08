import { Flexbox, Icon } from '@lobehub/ui';
import { Tabs, Tag, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeftIcon, CheckIcon, CloseIcon, FolderIcon, HintIcon, MessageIcon, NetworkIcon, PathIcon, TestSuiteIcon } from '@unlocalhosted/dither-icons';
import { GitBranch } from 'lucide-react';

import { Sparkle } from './Backdrop';
import { when } from './format';
import { G } from './icons';

import type { Report } from './types';

export type TabKey = 'checks' | 'flow' | 'process' | 'files' | 'feedback';

const styles = createStaticStyles(({ css }) => ({
  band: css`
    padding-block: 20px 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  crumbs: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    & > span + span::before {
      content: '/';
      margin-inline-end: 6px;
      color: ${cssVar.colorTextQuaternary};
    }
  `,
  prev: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;
    margin-inline-start: 8px;
    color: ${cssVar.colorTextSecondary};
  `,
  pill: css`
    display: inline-flex;
    gap: 5px;
    align-items: center;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 500;
  `,
  meta: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  summary: css`
    font-size: 15px;
    line-height: 1.7;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  revision: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    overflow-wrap: anywhere;
  `,
  note: css`
    padding-block: 8px;
    padding-inline: 12px;
    border-inline-start: 2px solid ${cssVar.colorPrimary};
    border-radius: 0 ${cssVar.borderRadius} ${cssVar.borderRadius} 0;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillQuaternary};
  `,
  tabs: css`
    && {
      box-shadow: none;
    }
  `,
  indicator: css`
    && {
      background: linear-gradient(90deg, var(--brand-soft), var(--brand) 55%, var(--brand-ink));
    }
  `,
  count: css`
    && {
      font-family: ${cssVar.fontFamilyCode};
      font-size: 11px;
    }
  `,
}));

const VERDICT = {
  passed: { icon: CheckIcon, color: cssVar.colorSuccess, bg: cssVar.colorSuccessBg },
  failed: { icon: CloseIcon, color: cssVar.colorError, bg: cssVar.colorErrorBg },
  uncertain: { icon: HintIcon, color: cssVar.colorWarning, bg: cssVar.colorWarningBg },
};

interface HeaderProps {
  report: Report;
  tab: TabKey;
  onTab: (tab: TabKey) => void;
  files: number;
  discussion: number;
  pending: number;
  column: string;
}

export default function Header({ report, tab, onTab, files, discussion, pending, column }: HeaderProps) {
  const verdict = VERDICT[report.verdict.status];
  const tabs = [
    { key: 'checks', icon: TestSuiteIcon, label: '验收项', count: report.cases.length },
    ...(report.flows?.length ? [{ key: 'flow', icon: NetworkIcon, label: '用户流程', count: report.flows.length, alert: false }] : []),
    { key: 'process', icon: PathIcon, label: '过程', count: report.process.length + report.checks.length },
    { key: 'files', icon: FolderIcon, label: '文件', count: files },
    { key: 'feedback', icon: MessageIcon, label: '讨论', count: discussion, alert: pending > 0 },
  ];
  return (
    <header className={styles.band}>
      <Flexbox className={column} gap={12}>
        <Flexbox horizontal align={'center'} className={styles.crumbs} gap={6} wrap={'wrap'}>
          <span>交付验证</span>
          <span>{report.project}</span>
          <span>第 {report.round} 轮</span>
          {report.previous_report && (
            <a className={`${styles.prev} di-trigger`} href={encodeURI(report.previous_report)}>
              <G icon={ArrowLeftIcon} size={12} />
              <span className={'lk'}>上一轮</span>
            </a>
          )}
        </Flexbox>
        <Flexbox horizontal align={'flex-start'} gap={6}>
          <Text as={'h1'} style={{ fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1.35, margin: 0 }}>
            {report.title}
          </Text>
          <Sparkle size={11} style={{ flex: 'none', marginBlockStart: 4 }} />
        </Flexbox>
        <Flexbox horizontal align={'center'} className={styles.meta} gap={12} wrap={'wrap'}>
          <span className={`${styles.pill} di-trigger`} style={{ background: verdict.bg, color: verdict.color }}>
            <G icon={verdict.icon} size={13} />
            {report.verdict.label}
          </span>
          <Tag>待你验收</Tag>
          <time dateTime={report.created_at}>{when(report.created_at)}</time>
        </Flexbox>
        <div className={styles.summary}>{report.summary}</div>
        <Flexbox horizontal align={'center'} className={styles.revision} gap={6}>
          <Icon icon={GitBranch} size={13} style={{ flex: 'none' }} />
          <span>{report.revision}</span>
        </Flexbox>
        {report.feedback && (
          <div className={styles.note}>
            <b style={{ color: cssVar.colorText, marginInlineEnd: 8 }}>本轮依据的反馈</b>
            {report.feedback}
          </div>
        )}
        <Flexbox style={{ paddingBlockStart: 12 }}>
          <Tabs
            activeKey={tab}
            classNames={{ indicator: styles.indicator, list: styles.tabs, tab: 'di-trigger jelly' }}
            style={{ minWidth: 0, overflowX: 'auto' }}
            variant={'square'}
            items={tabs.map((item) => ({
              key: item.key,
              icon: <G icon={item.icon} size={16} />,
              label: (
                <Flexbox horizontal align={'center'} gap={6}>
                  {item.label}
                  <Tag className={styles.count} color={item.alert ? 'error' : undefined} shape={'round'}>
                    {item.count}
                  </Tag>
                </Flexbox>
              ),
            }))}
            onChange={(key) => onTab(key as TabKey)}
          />
        </Flexbox>
      </Flexbox>
    </header>
  );
}
