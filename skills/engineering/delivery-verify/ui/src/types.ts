// Mirrors result.json (references/report-format.md) plus the verdict render.py derives.

export type CaseStatus = 'passed' | 'failed' | 'uncertain' | 'blocked' | 'pending' | 'skipped';
export type EvidenceKind = 'image' | 'video' | 'text';

export interface Evidence {
  kind: EvidenceKind;
  path: string;
  caption: string;
  source: string;
  phase: 'process' | 'final';
  inspected: boolean;
  /** Text evidence only: embedded by render.py so file:// pages can show it. */
  content?: string;
  truncated?: boolean;
  /** Evidence sharing a group is shown side by side (light and dark of one state, before and after); label names each one. */
  group?: string;
  label?: string;
  /** Image evidence only: pixel size read by render.py, reserves layout before load. */
  width?: number;
  height?: number;
}

/** A comment pinned to a spot in one piece of evidence: a region of an image, or a moment of a video. */
export interface Note {
  id: string;
  kind: 'image' | 'video';
  path: string;
  /** Image: x, y, width, height as fractions of the picture; width and height are 0 for a single point. */
  rect?: [number, number, number, number];
  /** Video: seconds from the start. */
  t?: number;
  text: string;
}

export interface Case {
  id: string;
  title: string;
  required: boolean;
  method: string;
  expected: string;
  status: CaseStatus;
  observation: string;
  evidence_required: EvidenceKind[];
  evidence: Evidence[];
}

/** A user journey: checks in the order a user goes through them; `label` is what the user does to get to that step from the one before. */
export interface Flow {
  id: string;
  title: string;
  steps: { case: string; label?: string }[];
}

export interface Check {
  name: string;
  command: string;
  exit_code: number | null;
  log: string;
  content?: string;
  truncated?: boolean;
}

export interface Report {
  title: string;
  summary: string;
  /** The Agent's longer note for this round (Markdown), shown in the discussion. */
  message?: string;
  project: string;
  task: string;
  round: number;
  created_at: string;
  revision: string;
  environment: string;
  entry: string;
  process: string[];
  cases: Case[];
  flows?: Flow[];
  checks: Check[];
  review: string;
  limitations: string[];
  cleanup: { complete: boolean; notes: string };
  feedback?: string;
  previous_report?: string;
  verdict: { status: 'passed' | 'failed' | 'uncertain'; label: string };
}
