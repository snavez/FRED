import { describe, it, expect } from 'vitest';
import { interpolateTrajectoryAt, computeMeanTimeGrid } from './trajectory';
import type { TrajectoryPoint } from '../types';

function pt(time: number, f1: number, f2: number, f3 = 0): TrajectoryPoint {
  return { time, f1, f2, f3, f1_smooth: f1, f2_smooth: f2, f3_smooth: f3 };
}

describe('interpolateTrajectoryAt', () => {
  const traj = [pt(0, 300, 2500), pt(50, 400, 2000), pt(100, 500, 1500)];

  it('returns null for empty trajectory', () => {
    expect(interpolateTrajectoryAt([], 50)).toBeNull();
  });

  it('returns null for time below range', () => {
    expect(interpolateTrajectoryAt(traj, -10)).toBeNull();
  });

  it('returns null for time above range', () => {
    expect(interpolateTrajectoryAt(traj, 110)).toBeNull();
  });

  it('returns exact match for existing timepoint', () => {
    const result = interpolateTrajectoryAt(traj, 50);
    expect(result).not.toBeNull();
    expect(result!.f1).toBe(400);
    expect(result!.f2).toBe(2000);
  });

  it('returns exact match for first point', () => {
    const result = interpolateTrajectoryAt(traj, 0);
    expect(result).not.toBeNull();
    expect(result!.f1).toBe(300);
  });

  it('returns exact match for last point', () => {
    const result = interpolateTrajectoryAt(traj, 100);
    expect(result).not.toBeNull();
    expect(result!.f1).toBe(500);
  });

  it('interpolates midpoint between two points', () => {
    const result = interpolateTrajectoryAt(traj, 25);
    expect(result).not.toBeNull();
    expect(result!.f1).toBeCloseTo(350, 5);
    expect(result!.f2).toBeCloseTo(2250, 5);
  });

  it('interpolates at 75%', () => {
    const result = interpolateTrajectoryAt(traj, 75);
    expect(result).not.toBeNull();
    expect(result!.f1).toBeCloseTo(450, 5);
    expect(result!.f2).toBeCloseTo(1750, 5);
  });

  it('handles single-point trajectory at exact time', () => {
    const single = [pt(50, 400, 2000)];
    const result = interpolateTrajectoryAt(single, 50);
    expect(result).not.toBeNull();
    expect(result!.f1).toBe(400);
  });

  it('returns null for single-point trajectory at different time', () => {
    const single = [pt(50, 400, 2000)];
    expect(interpolateTrajectoryAt(single, 25)).toBeNull();
  });

  it('interpolates smooth channels independently', () => {
    const trajWithSmooth: TrajectoryPoint[] = [
      { time: 0, f1: 300, f2: 2500, f3: 0, f1_smooth: 310, f2_smooth: 2510, f3_smooth: 0 },
      { time: 100, f1: 500, f2: 1500, f3: 0, f1_smooth: 490, f2_smooth: 1490, f3_smooth: 0 },
    ];
    const result = interpolateTrajectoryAt(trajWithSmooth, 50);
    expect(result).not.toBeNull();
    expect(result!.f1).toBeCloseTo(400, 5);
    expect(result!.f1_smooth).toBeCloseTo(400, 5);
    expect(result!.f2_smooth).toBeCloseTo(2000, 5);
  });

  it('handles many-point trajectory with non-uniform spacing', () => {
    const dense = [pt(0, 100, 1000), pt(10, 200, 900), pt(30, 300, 800), pt(100, 700, 400)];
    const result = interpolateTrajectoryAt(dense, 20);
    expect(result).not.toBeNull();
    // Between pt(10, 200, 900) and pt(30, 300, 800), alpha = (20-10)/(30-10) = 0.5
    expect(result!.f1).toBeCloseTo(250, 5);
    expect(result!.f2).toBeCloseTo(850, 5);
  });
});

describe('computeMeanTimeGrid', () => {
  it('returns fallback grid for empty input', () => {
    const grid = computeMeanTimeGrid([]);
    expect(grid).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]);
  });

  it('returns union of all timepoints sorted', () => {
    const t1 = [pt(0, 0, 0), pt(50, 0, 0), pt(100, 0, 0)];
    const t2 = [pt(0, 0, 0), pt(25, 0, 0), pt(75, 0, 0), pt(100, 0, 0)];
    const grid = computeMeanTimeGrid([t1, t2]);
    expect(grid).toEqual([0, 25, 50, 75, 100]);
  });

  it('respects onset/offset filtering', () => {
    const t1 = [pt(0, 0, 0), pt(25, 0, 0), pt(50, 0, 0), pt(75, 0, 0), pt(100, 0, 0)];
    const grid = computeMeanTimeGrid([t1], 20, 80);
    expect(grid).toEqual([25, 50, 75]);
  });

  it('deduplicates shared timepoints', () => {
    const t1 = [pt(0, 0, 0), pt(50, 0, 0), pt(100, 0, 0)];
    const t2 = [pt(0, 0, 0), pt(50, 0, 0), pt(100, 0, 0)];
    const grid = computeMeanTimeGrid([t1, t2]);
    expect(grid).toEqual([0, 50, 100]);
  });
});
