import { useEffect, useState } from 'react';

import type { Rejection } from './feedback';
import type { EvidenceKind, Flow } from './types';

// What the delivery board knows beyond this one page: every round of the task and the decisions saved for it.
// It is fetched next to the report; an offline copy (file://) has none, and the page works without it.

export interface PastEvidence { kind: Exclude<EvidenceKind, 'text'>; caption: string; path: string; group?: string; label?: string }
export interface Submission {
  id: string;
  at: string;
  status?: string;
  decision: 'accept' | 'reject';
  accepted: string[];
  ignored?: string[];
  rejected: Rejection[];
  comment: string;
}
export interface PastRound {
  round: number;
  created_at: string;
  title: string;
  summary: string;
  message?: string | null;
  reactions?: Record<string, string[]>;
  flows?: Flow[];
  cases: { id: string; title: string; status: string; note?: string; files?: number; evidence: PastEvidence[] }[];
  submissions: Submission[];
}
export interface History { rounds: PastRound[] }

/** undefined while loading, null when the board has no history for this page. */
export function useHistory(): History | null | undefined {
  const [history, setHistory] = useState<History | null | undefined>(location.protocol.startsWith('http') ? undefined : null);
  useEffect(() => {
    if (!location.protocol.startsWith('http')) return;
    fetch(new URL('history.json', location.href), { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => setHistory(value && Array.isArray(value.rounds) ? value : null))
      .catch(() => setHistory(null));
  }, []);
  return history;
}

export type Verdict = 'accept' | 'reject' | 'ignore';

export interface Step {
  round: number;
  status: string;
  at?: string;
  decision?: Verdict;
  reason?: string;
  rejection?: Rejection;
}

/** One check's path through the rounds up to `current`: how it stood, and what the reader decided about it. */
export function trail(history: History | null | undefined, id: string, current: number): Step[] {
  const out: Step[] = [];
  for (const round of history?.rounds ?? []) {
    if (round.round > current) continue;
    const item = round.cases.find((entry) => entry.id === id);
    if (!item) continue;
    const step: Step = { round: round.round, status: item.status };
    for (const sub of round.submissions) {
      const rejection = sub.rejected.find((entry) => entry.id === id);
      if (rejection) Object.assign(step, { decision: 'reject', at: sub.at, reason: rejection.reason, rejection });
      else if (sub.accepted.includes(id)) Object.assign(step, { decision: 'accept', at: sub.at, reason: undefined, rejection: undefined });
      else if (sub.ignored?.includes(id)) Object.assign(step, { decision: 'ignore', at: sub.at, reason: undefined, rejection: undefined });
    }
    out.push(step);
  }
  return out;
}

/** Closed: last accepted or ignored in an earlier round and not reopened since; says which round and how. */
export interface Closed { round: number; kind: 'accept' | 'ignore' }
export function closedIn(steps: Step[], current: number): Closed | undefined {
  const earlier = steps.filter((step) => step.round < current && step.decision);
  const last = earlier[earlier.length - 1];
  return last && last.decision !== 'reject' ? { round: last.round, kind: last.decision as 'accept' | 'ignore' } : undefined;
}

export function pastEvidence(history: History | null | undefined, id: string, current: number): { round: number; items: PastEvidence[] } | undefined {
  const rounds = (history?.rounds ?? []).filter((round) => round.round < current).reverse();
  for (const round of rounds) {
    const items = round.cases.find((entry) => entry.id === id)?.evidence.filter((entry) => entry.kind === 'image') ?? [];
    if (items.length) return { round: round.round, items };
  }
  return undefined;
}
