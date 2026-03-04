
import { GoogleGenAI } from "@google/genai";
import { SpeechToken } from "../types";

export const getGeminiInsights = async (sampleData: SpeechToken[]): Promise<string> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Prepare a summary of the sample for the model
    // Fix: Use 'canonical' instead of missing 'phoneme' and calculate mean F1/F2 from trajectory data
    const summary = sampleData.slice(0, 50).map(t => {
      const f1_mean = t.trajectory.length > 0 ? t.trajectory.reduce((acc, p) => acc + p.f1, 0) / t.trajectory.length : 0;
      const f2_mean = t.trajectory.length > 0 ? t.trajectory.reduce((acc, p) => acc + p.f2, 0) / t.trajectory.length : 0;
      return `${t.canonical} (${t.lexical_stress}): F1=${Math.round(f1_mean)}, F2=${Math.round(f2_mean)}`;
    }).join('; ');

    const prompt = `
      As a senior acoustic phonetician, analyze this vowel data sample:
      ${summary}
      
      Provide a concise 3-paragraph summary covering:
      1. Overall distribution in the vowel space.
      2. Noticeable patterns related to lexical stress (e.g., centralization).
      3. Potential areas for further investigation or outlier detection.
      Keep it professional and academic.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });

    return response.text || "No insights available.";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "The AI analyst is currently unavailable. Please check your connection.";
  }
};
