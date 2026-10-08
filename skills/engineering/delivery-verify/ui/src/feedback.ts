import type { Note } from './types';

export const TAGS = ['布局', '颜色', '文案', '功能不对', '没做到', '证据不够'] as const;

/** What the reader wrote against one check they sent back. */
export interface Draft { reason: string; tags: string[]; lesson: boolean }
export interface Rejection extends Draft { id: string; notes: Note[] }

export interface FeedbackSubmission {
  id: string;
  task: string;
  round: number;
  decision: 'accept' | 'reject';
  accepted: string[];
  ignored: string[];
  rejected: Rejection[];
  comment: string;
}
export type SendOutcome =
  | { kind: 'empty' }
  | { kind: 'sent'; message: string }
  | { kind: 'unknown'; message: string }
  | { kind: 'error'; message: string };

export async function submitFeedback(body: FeedbackSubmission, pageUrl: string, send: typeof fetch = fetch): Promise<SendOutcome> {
  if (body.decision === 'reject' && !body.rejected.length && !body.comment.trim()) return { kind: 'empty' };
  const page = new URL(pageUrl);
  if (page.protocol !== 'https:') return { kind: 'error', message: '请打开本次交付的 HTTPS 链接提交反馈。意见已留在页面中。' };
  try {
    const response = await send(new URL('feedback', page), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const receipt = await response.json();
    if (!response.ok) return { kind: 'error', message: receipt.error || '提交未成功，意见已保留。' };
    if (receipt.id === body.id && receipt.status === 'delivered' && typeof receipt.user_turn_id === 'string' && receipt.user_turn_id.length > 0) return { kind: 'sent', message: '已交回 Agent，反馈已保存在本轮报告。' };
    return { kind: 'unknown', message: receipt.message || '反馈已保存，尚未确认 Agent 收到。请保留页面，不要重复发送。' };
  } catch {
    return { kind: 'error', message: '连接中断，意见已保留。恢复连接后可重试，提交编号保持不变。' };
  }
}
