import { cssVar } from 'antd-style';
import { CheckIcon, CloseIcon, HintIcon, HistoryIcon, LockIcon, SkipBlockIcon } from '@unlocalhosted/dither-icons';

import type { Glyph } from './icons';

import type { Case, CaseStatus } from './types';

export const STATUS: Record<CaseStatus, { label: string; color: string; icon: Glyph }> = {
  passed: { label: '已通过', color: cssVar.colorSuccess, icon: CheckIcon },
  failed: { label: '未通过', color: cssVar.colorError, icon: CloseIcon },
  uncertain: { label: '不确定', color: cssVar.colorWarning, icon: HintIcon },
  blocked: { label: '已阻塞', color: cssVar.colorWarning, icon: LockIcon },
  pending: { label: '未执行', color: cssVar.colorTextQuaternary, icon: HistoryIcon },
  skipped: { label: '已跳过', color: cssVar.colorTextQuaternary, icon: SkipBlockIcon },
};

export type Filter = 'all' | 'failed' | 'unfinished' | 'passed';

export const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'failed', label: '需修复' },
  { key: 'unfinished', label: '未完成' },
  { key: 'passed', label: '已通过' },
];

export function filterOf(item: Case): Exclude<Filter, 'all'> {
  if (item.status === 'passed' || item.status === 'failed') return item.status;
  return 'unfinished';
}

export const KIND_LABEL = { image: '截图', video: '录像', text: '原始记录' } as const;
