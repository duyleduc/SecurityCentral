interface SeverityCount {
  readonly severity: string;
  readonly count: number;
  readonly deduction: number;
}

export interface ScoreResult {
  readonly score: number;
  readonly breakdown: readonly SeverityCount[];
}

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 1,
};

export function calculateScore(findingsBySeverity: Record<string, number>): ScoreResult {
  let score = 100;
  const breakdown: SeverityCount[] = [];

  for (const [severity, count] of Object.entries(findingsBySeverity)) {
    const weight = SEVERITY_WEIGHTS[severity] ?? 0;
    const deduction = weight * count;
    if (deduction > 0) {
      score -= deduction;
      breakdown.push({ severity, count, deduction: -deduction });
    }
  }

  return {
    score: Math.max(0, score),
    breakdown,
  };
}
