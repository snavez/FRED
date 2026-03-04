
import { SpeechToken, TrajectoryPoint } from '../types';

const VOWEL_BASE: Record<string, { f1: number, f2: number, f3: number }> = {
  'i': { f1: 300, f2: 2400, f3: 3200 },
  'u': { f1: 300, f2: 900, f3: 2500 },
  'æ': { f1: 750, f2: 1700, f3: 2600 },
  'ɑ': { f1: 800, f2: 1100, f3: 2800 },
  'ai': { f1: 600, f2: 1500, f3: 2700 }, 
  'ou': { f1: 500, f2: 1000, f3: 2500 },
};

export const generateSpeechData = (count: number): SpeechToken[] => {
  const data: SpeechToken[] = [];
  const phonemes = Object.keys(VOWEL_BASE);

  for (let i = 0; i < count; i++) {
    const canonical = phonemes[Math.floor(Math.random() * phonemes.length)];
    const base = VOWEL_BASE[canonical];
    
    // Random variations for base targets
    const f1_mid = base.f1 + (Math.random() - 0.5) * 100;
    const f2_mid = base.f2 + (Math.random() - 0.5) * 300;
    const f3_mid = base.f3 + (Math.random() - 0.5) * 400;

    const trajectory: TrajectoryPoint[] = [];
    for (let p = 0; p <= 100; p += 10) {
      // Create clean trajectory curves (Smooth)
      const f1_clean = f1_mid + Math.sin(p / 50) * 40;
      const f2_clean = f2_mid + Math.cos(p / 50) * 80;
      const f3_clean = f3_mid + Math.sin(p / 30) * 60;

      // Add noise for raw data (Raw)
      const f1_noisy = f1_clean + (Math.random() - 0.5) * 40;
      const f2_noisy = f2_clean + (Math.random() - 0.5) * 60;
      const f3_noisy = f3_clean + (Math.random() - 0.5) * 50;

      trajectory.push({
        time: p,
        f1: f1_noisy,
        f2: f2_noisy,
        f3: f3_noisy,
        f1_smooth: f1_clean,
        f2_smooth: f2_clean,
        f3_smooth: f3_clean,
      });
    }

    data.push({
      id: crypto.randomUUID(),
      file_id: (10000 + Math.floor(Math.random() * 100)).toString(),
      word: ['beat', 'bit', 'bait', 'Maungawhau', 'Ko'][Math.floor(Math.random() * 5)],
      syllable: 'k o',
      syllable_mark: Math.floor(Math.random() * 3).toString(),
      canonical_stress: Math.floor(Math.random() * 2).toString(),
      lexical_stress: Math.floor(Math.random() * 3).toString(),
      canonical,
      produced: canonical, // Simplification
      alignment: ['exact', 'substitution', 'insertion', 'deletion'][Math.floor(Math.random() * 4)],
      type: 'vowel',
      canonical_type: 'vowel',
      voice_pitch: ['high', 'mid', 'low'][Math.floor(Math.random() * 3)],
      xmin: Math.random() * 10,
      duration: 0.1 + Math.random() * 0.3,
      trajectory
    });
  }

  return data;
};
