import type { TrajectoryPoint } from '../types';

/**
 * Linearly interpolate a trajectory at an arbitrary time value.
 * Uses bracket search to find the two surrounding points, then lerps all formant channels.
 * Returns null if the trajectory is empty or the target time is outside the trajectory range.
 */
export function interpolateTrajectoryAt(
  trajectory: TrajectoryPoint[],
  time: number,
): TrajectoryPoint | null {
  if (trajectory.length === 0) return null;

  // Exact match — fast path
  const exact = trajectory.find(p => p.time === time);
  if (exact) return exact;

  // Outside range
  if (time < trajectory[0].time || time > trajectory[trajectory.length - 1].time) return null;

  // Bracket search: find j such that trajectory[j].time <= time < trajectory[j+1].time
  let lo = 0;
  let hi = trajectory.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (trajectory[mid].time <= time) lo = mid;
    else hi = mid;
  }

  const p0 = trajectory[lo];
  const p1 = trajectory[hi];
  const span = p1.time - p0.time;
  const alpha = span > 0 ? (time - p0.time) / span : 0;

  const lerp = (a: number, b: number) => a + (b - a) * alpha;

  return {
    time,
    f1: lerp(p0.f1, p1.f1),
    f2: lerp(p0.f2, p1.f2),
    f3: lerp(p0.f3, p1.f3),
    f1_smooth: lerp(p0.f1_smooth, p1.f1_smooth),
    f2_smooth: lerp(p0.f2_smooth, p1.f2_smooth),
    f3_smooth: lerp(p0.f3_smooth, p1.f3_smooth),
  };
}

/**
 * Generate a common time grid for mean trajectory computation.
 * When snapGrid is provided, uses those fixed intervals (filtered by onset/offset).
 * Otherwise uses the union of all trajectory timepoints across all tokens.
 * Falls back to a regular 21-point grid [0, 5, 10, ..., 100] if no data.
 */
export function computeMeanTimeGrid(
  trajectories: TrajectoryPoint[][],
  onset: number = 0,
  offset: number = 100,
  snapGrid?: number[],
): number[] {
  if (snapGrid && snapGrid.length > 0) {
    return snapGrid.filter(t => t >= onset && t <= offset);
  }
  const allTimes = new Set<number>();
  for (const traj of trajectories) {
    for (const p of traj) {
      if (p.time >= onset && p.time <= offset) allTimes.add(p.time);
    }
  }
  if (allTimes.size === 0) {
    const grid: number[] = [];
    for (let t = onset; t <= offset; t += 5) grid.push(t);
    return grid;
  }
  return Array.from(allTimes).sort((a, b) => a - b);
}

/**
 * The trajectory time closest to `target`, or undefined for an empty trajectory.
 * Datasets carry whatever time grid they were exported with, so a requested 50% may not
 * exist verbatim; every plot samples through here so they all pick the same point.
 */
export function findNearestTimePoint(trajectory: { time: number }[], target: number): number | undefined {
  if (trajectory.length === 0) return undefined;
  const exact = trajectory.find(p => p.time === target);
  if (exact) return target;
  let best = trajectory[0].time;
  let bestDist = Math.abs(best - target);
  for (const p of trajectory) {
    const d = Math.abs(p.time - target);
    if (d < bestDist) { best = p.time; bestDist = d; }
  }
  return best;
}
