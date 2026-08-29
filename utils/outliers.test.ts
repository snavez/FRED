import { describe, it, expect } from 'vitest';
import {
  buildOutlierRows,
  collectFormantPoints,
  findEllipseOutliers,
  outlierFileName,
  outlierSdLevels,
  PointGroup,
} from './outliers';
import type { PlotConfig, SpeechToken, TrajectoryPoint } from '../types';

const AXES = { x: 'F2', y: 'F1' };

function tok(id: string, fields: Record<string, string> = {}): SpeechToken {
  return { id, speaker: '', file_id: `${id}.wav`, xmin: 0, duration: 0, trajectory: [], fields };
}

/** A group of points laid out by hand: [x, y] pairs, one token each. */
const group = (key: string, xy: [number, number][]): PointGroup => ({
  key,
  points: xy.map(([x, y], i) => ({ token: tok(`${key}${i}`), x, y })),
});

/**
 * A circular cloud of unit SD, plus whatever extra points are given. Sixteen points,
 * because a group's own spread bounds how far any member of it can be: with n points
 * nothing can exceed sqrt(n-1) SDs, so a 2 SD ellipse needs at least five.
 */
const unitCloud = (
  extra: [number, number][] = [], key = 'cloud', cx = 0, cy = 0,
): PointGroup => {
  const ring: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * Math.SQRT2, cy + Math.sin(a) * Math.SQRT2]);
  }
  return group(key, [...ring, ...extra.map(([x, y]) => [cx + x, cy + y] as [number, number])]);
};

describe('findEllipseOutliers', () => {
  it('finds nothing when every point is inside the ellipse', () => {
    const scan = findEllipseOutliers([unitCloud()], 2, AXES);
    expect(scan.outliers).toEqual([]);
    expect(scan.checked).toBe(16);
  });

  it('flags a point beyond the chosen SD and leaves the rest alone', () => {
    // The ring sits at 1 SD; an extra point at 3 SD on the y axis is well outside 2 SD
    const scan = findEllipseOutliers([unitCloud([[0, 4.5]])], 2, AXES);
    expect(scan.outliers).toHaveLength(1);
    expect(scan.outliers[0].token.id).toBe('cloud16');
    expect(scan.outliers[0].distance).toBeGreaterThan(2);
  });

  it('tightening the ellipse catches more points', () => {
    const cloud = unitCloud([[0, 2.6]]);
    expect(findEllipseOutliers([cloud], 3, AXES).outliers).toHaveLength(0);
    expect(findEllipseOutliers([cloud], 1, AXES).outliers.length).toBeGreaterThan(0);
  });

  it('selects the same points whatever the axis scales are — the ellipse is what matters', () => {
    const plain = unitCloud([[0, 4.5], [3.6, 0]]);
    // The same cloud with the axes stretched, as a different normalisation would give
    const stretched: PointGroup = {
      key: plain.key,
      points: plain.points.map(p => ({ ...p, x: p.x * 500 + 1500, y: p.y * 90 - 40 })),
    };
    const ids = (g: PointGroup) => findEllipseOutliers([g], 2, AXES).outliers.map(o => o.token.id).sort();
    expect(ids(stretched)).toEqual(ids(plain));
  });

  it('names the axis and direction of the divergence', () => {
    const scan = findEllipseOutliers([unitCloud([[0, 4.5], [0, -4.5], [3.6, 0]])], 2, AXES);
    const byId = Object.fromEntries(scan.outliers.map(o => [o.token.id, o.divergence]));
    expect(byId['cloud16']).toBe('high F1');
    expect(byId['cloud17']).toBe('low F1');
    expect(byId['cloud18']).toBe('high F2');
  });

  it('names both axes when a token is extreme on both, worst first', () => {
    const scan = findEllipseOutliers([unitCloud([[-3.2, 4.5]])], 2, AXES);
    expect(scan.outliers[0].divergence).toBe('high F1; low F2');
  });

  it('still names the dominant axis when only the combination is extreme', () => {
    // Tight positive correlation: this point is ordinary on each axis alone, but far off
    // the diagonal the ellipse is drawn along
    const diagonal: [number, number][] = [];
    for (let i = 0; i < 20; i++) { const v = (i - 10) / 4; diagonal.push([v, v]); }
    const scan = findEllipseOutliers([group('d', [...diagonal, [-1.5, 1.5]])], 2, AXES);
    expect(scan.outliers).toHaveLength(1);
    expect(scan.outliers[0].divergence).toBe('high F1');
    expect(Math.abs(scan.outliers[0].zY)).toBeLessThan(2);
  });

  it('judges each group against its own ellipse', () => {
    const low = unitCloud([[0, 4.5]], 'low', 0, 0);
    const high = unitCloud([[0, 4.5]], 'high', 100, 100);
    const scan = findEllipseOutliers([low, high], 2, AXES);
    expect(scan.outliers.map(o => o.group).sort()).toEqual(['high', 'low']);
    // Each flagged token is the far one added to its own cloud, not a member of the other
    expect(scan.outliers.every(o => o.token.id.endsWith('16'))).toBe(true);
  });

  it('skips groups too small to draw an ellipse around, and says so', () => {
    const scan = findEllipseOutliers([group('pair', [[0, 0], [50, 50]]), unitCloud()], 2, AXES);
    expect(scan.skipped).toEqual([{ key: 'pair', count: 2 }]);
    expect(scan.checked).toBe(16);
    expect(scan.outliers).toEqual([]);
  });

  it('labels the ungrouped case with an empty group name', () => {
    const scan = findEllipseOutliers([unitCloud([[0, 4.5]], 'default')], 2, AXES);
    expect(scan.outliers[0].group).toBe('');
  });

  it('handles a collinear group without dividing by zero', () => {
    // Every point on one line: there is no ellipse, only a spread along the x axis
    const flat: [number, number][] = [];
    for (let i = 0; i < 16; i++) flat.push([i / 8 - 1, 0]);
    const scan = findEllipseOutliers([group('flat', [...flat, [9, 0]])], 2, AXES);
    expect(scan.outliers).toHaveLength(1);
    expect(Number.isFinite(scan.outliers[0].distance)).toBe(true);
    expect(scan.outliers[0].divergence).toBe('high F2');
  });

  it('records the layer each outlier came from', () => {
    const scan = findEllipseOutliers([unitCloud([[0, 4.5]])], 2, AXES, 'Layer 2');
    expect(scan.outliers[0].layer).toBe('Layer 2');
  });
});

describe('collectFormantPoints', () => {
  const point = (time: number, f1: number, f2: number): TrajectoryPoint =>
    ({ time, f1, f2, f3: 0, f1_smooth: f1 + 10, f2_smooth: f2 + 10, f3_smooth: 0 });

  const speaking = (id: string, vowel: string, f1: number, f2: number): SpeechToken => ({
    id, speaker: 'spk1', file_id: `${id}.wav`, xmin: 0, duration: 0.1,
    trajectory: [point(0, f1 - 50, f2 - 50), point(50, f1, f2), point(100, f1 + 50, f2 + 50)],
    fields: { vowel },
  });

  const config = (over: Partial<PlotConfig> = {}) =>
    ({ timePoint: 50, useSmoothing: false, ...over }) as PlotConfig;

  it('reads the plotted formants at the configured timepoint, F2 on x and F1 on y', () => {
    const groups = collectFormantPoints(
      [speaking('a', 'i', 300, 2200)], config(), t => t.fields.vowel, 'hz', null);
    expect(groups).toEqual([{ key: 'i', points: [expect.objectContaining({ x: 2200, y: 300 })] }]);
  });

  it('follows the smoothing setting', () => {
    const groups = collectFormantPoints(
      [speaking('a', 'i', 300, 2200)], config({ useSmoothing: true }), t => t.fields.vowel, 'hz', null);
    expect(groups[0].points[0]).toMatchObject({ x: 2210, y: 310 });
  });

  it('falls back to the nearest available timepoint', () => {
    const groups = collectFormantPoints(
      [speaking('a', 'i', 300, 2200)], config({ timePoint: 60 }), t => t.fields.vowel, 'hz', null);
    // 60% is absent; 50% is the nearest sample
    expect(groups[0].points[0].y).toBe(300);
  });

  it('groups by the key the plot draws by, and normalises like the plot', () => {
    const tokens = [speaking('a', 'i', 300, 2200), speaking('b', 'a', 700, 1200)];
    const groups = collectFormantPoints(tokens, config(), t => t.fields.vowel, 'bark', null);
    expect(groups.map(g => g.key)).toEqual(['i', 'a']);
    // Bark values are far below the Hz ones — proof the normalisation was applied
    expect(groups[0].points[0].y).toBeLessThan(10);
  });

  it('drops tokens with no usable formants at that timepoint', () => {
    const empty: SpeechToken = { ...speaking('c', 'u', 0, 0), trajectory: [] };
    const nan: SpeechToken = speaking('d', 'u', NaN, 1000);
    const groups = collectFormantPoints(
      [empty, nan, speaking('e', 'u', 400, 1000)], config(), t => t.fields.vowel, 'hz', null);
    expect(groups).toHaveLength(1);
    expect(groups[0].points).toHaveLength(1);
    expect(groups[0].points[0].token.id).toBe('e');
  });
});

describe('buildOutlierRows', () => {
  // An F2/F1 cloud around (2200, 300) with one token 600 Hz high on F1
  const scan = findEllipseOutliers(
    [{
      key: 'i',
      points: [...unitCloud([[0, 6]], 'i').points].map(p => ({
        ...p, x: 2200 + p.x * 50, y: 300 + p.y * 100,
      })),
    }], 2, AXES, 'Layer 1');
  const fields = [{ key: 'file_id', label: 'File ID' }, { key: 'word', label: 'Word' }];

  it('writes the identifying fields, the plotted values and the divergence', () => {
    const { headers, rows } = buildOutlierRows({
      outliers: scan.outliers, fields, axes: AXES, multiLayer: false,
    });
    expect(headers).toEqual(['group', 'file_id', 'word', 'F1', 'F2', 'F1_z', 'F2_z', 'sd_distance', 'divergence']);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row[0]).toBe('i');
    expect(row[1]).toBe('i16.wav');
    expect(row[3]).toBe('900');   // F1 as plotted: 300 + 6 x 100
    expect(row[4]).toBe('2200');  // F2 as plotted
    expect(row[8]).toBe('high F1');
  });

  it('adds a layer column only when several layers contributed', () => {
    const single = buildOutlierRows({ outliers: scan.outliers, fields, axes: AXES, multiLayer: false });
    const multi = buildOutlierRows({ outliers: scan.outliers, fields, axes: AXES, multiLayer: true });
    expect(single.headers).not.toContain('layer');
    expect(multi.headers[0]).toBe('layer');
    expect(multi.rows[0][0]).toBe('Layer 1');
  });

  it('writes an empty cell for a field a token does not carry', () => {
    const { rows } = buildOutlierRows({ outliers: scan.outliers, fields, axes: AXES, multiLayer: false });
    expect(rows[0][2]).toBe('');
  });
});

describe('mixed ellipse settings across layers', () => {
  const cloud = unitCloud([[0, 4.5]]);

  it('names the threshold each row was judged against when layers disagree', () => {
    const strict = findEllipseOutliers([cloud], 1, AXES, 'Layer 1').outliers;
    const loose = findEllipseOutliers([cloud], 2, AXES, 'Layer 2').outliers;
    const mixed = buildOutlierRows({
      outliers: [...strict, ...loose], fields: [], axes: AXES, multiLayer: true,
    });
    expect(mixed.headers).toContain('ellipse_sd');
    expect(outlierSdLevels([...strict, ...loose])).toEqual([1, 2]);
    // …and stays out of the way when every layer uses the same ellipse
    const same = buildOutlierRows({ outliers: loose, fields: [], axes: AXES, multiLayer: true });
    expect(same.headers).not.toContain('ellipse_sd');
  });
});

describe('outlierFileName', () => {
  it('names the file after the ellipse it came from', () => {
    expect(outlierFileName(2)).toBe('fred_outliers_2SD.csv');
    expect(outlierFileName(1.5)).toBe('fred_outliers_1p5SD.csv');
  });
});
