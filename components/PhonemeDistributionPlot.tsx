
import React, { useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { SpeechToken, PlotConfig, PlotHandle, StyleOverrides, ExportConfig } from '../types';
import { generateTexture } from '../utils/textureGenerator';

interface DistributionPlotProps {
  data: SpeechToken[];
  config: PlotConfig;
  styleOverrides?: StyleOverrides;
  onLegendClick?: (category: string, currentStyles: any, event: React.MouseEvent) => void;
}

const COLORS = [
  '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', 
  '#ec4899', '#06b6d4', '#84cc16', '#64748b', '#dc2626',
  '#2563eb', '#059669', '#d97706', '#7c3aed', '#db2777'
];

const getLabel = (t: SpeechToken, key: string): string => {
  if (!key || key === 'none') return '';
  if (key === 'phoneme') return t.canonical;
  if (key === 'syllable_mark') {
    const val = parseInt(t.syllable_mark, 10);
    if (isNaN(val)) return t.syllable_mark;
    return val > 0 ? 'accepted' : 'rejected';
  }
  const val = (t as any)[key];
  return val !== undefined && val !== null ? String(val) : '';
};

const PhonemeDistributionPlot = forwardRef<PlotHandle, DistributionPlotProps>(({ data, config, styleOverrides, onLegendClick }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const plotData = useMemo(() => {
    // 1. Group by Top Level (Group By)
    const groups: Record<string, SpeechToken[]> = {};
    data.forEach(t => {
       const gKey = getLabel(t, config.groupBy || 'phoneme') || 'Undefined';
       if (!groups[gKey]) groups[gKey] = [];
       groups[gKey].push(t);
    });
    
    // Sort Groups based on config
    const groupKeys = Object.keys(groups);
    const sortedGroups = groupKeys.sort((a,b) => {
        let cmp = 0;
        if (config.distGroupOrder === 'alpha') {
            cmp = a.localeCompare(b);
        } else {
            // Count
            cmp = groups[a].length - groups[b].length;
        }
        return config.distGroupDir === 'asc' ? cmp : -cmp;
    });

    // 2. Identify Interaction Mode
    const colorKey = config.colorBy !== 'none' ? config.colorBy : 'phoneme'; // Default fallback
    const textureKey = config.textureBy !== 'none' ? config.textureBy : null;
    const isInteraction = textureKey && colorKey !== textureKey;

    // 3. Process Sub-Data
    const processedGroups: Record<string, any> = {};
    const globalColors: Record<string, string> = {};
    const colorDomain = new Set<string>();
    const textureDomain = new Set<string>();
    
    // Counts for Legend
    const colorCounts: Record<string, number> = {};
    const textureCounts: Record<string, number> = {};

    Object.keys(groups).forEach(gKey => {
        const tokens = groups[gKey];
        if (isInteraction) {
            // Nested: Group -> PrimaryVar -> SecondaryVar -> Count
            // distPrimaryVar determines the first level of nesting
            const primaryKey = config.distPrimaryVar === 'texture' ? textureKey! : colorKey;
            const secondaryKey = config.distPrimaryVar === 'texture' ? colorKey : textureKey!;

            const nested: Record<string, Record<string, number>> = {};
            tokens.forEach(t => {
                const pVal = getLabel(t, primaryKey);
                const sVal = getLabel(t, secondaryKey);
                
                if (!nested[pVal]) nested[pVal] = {};
                nested[pVal][sVal] = (nested[pVal][sVal] || 0) + 1;
                
                // Track domains and counts
                if (config.distPrimaryVar === 'texture') {
                    textureDomain.add(pVal);
                    colorDomain.add(sVal);
                    textureCounts[pVal] = (textureCounts[pVal] || 0) + 1;
                    colorCounts[sVal] = (colorCounts[sVal] || 0) + 1;
                } else {
                    colorDomain.add(pVal);
                    textureDomain.add(sVal);
                    colorCounts[pVal] = (colorCounts[pVal] || 0) + 1;
                    textureCounts[sVal] = (textureCounts[sVal] || 0) + 1;
                }
            });
            processedGroups[gKey] = nested;
        } else {
            // Stacked: Group -> ColorVar -> Count
            const counts: Record<string, number> = {};
            tokens.forEach(t => {
                const cVal = getLabel(t, colorKey);
                counts[cVal] = (counts[cVal] || 0) + 1;
                colorDomain.add(cVal);
                colorCounts[cVal] = (colorCounts[cVal] || 0) + 1;
                
                if (config.textureBy === colorKey) textureDomain.add(cVal);
            });
            processedGroups[gKey] = counts;
        }
    });

    const palette = config.bwMode ? ['#333', '#666', '#999'] : COLORS;
    const colorList = Array.from(colorDomain).sort();
    colorList.forEach((c, i) => {
        globalColors[c] = styleOverrides?.colors[c] || palette[i % palette.length];
    });

    const textureMap: Record<string, number> = {};
    const textureList = Array.from(textureDomain).sort();
    textureList.forEach((t, i) => {
        if (styleOverrides?.textures[t] !== undefined) {
            textureMap[t] = styleOverrides.textures[t];
        } else {
            textureMap[t] = i; // 0..N
        }
    });

    return { groups: sortedGroups, data: processedGroups, colors: globalColors, colorCounts, textureCounts, textureMap, textureList, isInteraction, colorKey, textureKey };
  }, [data, config, styleOverrides]);

  const renderPlot = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, scale: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.scale(scale, scale);

    const { groups, data: pData, colors, textureMap, isInteraction } = plotData as any;
    
    // Dynamic margins based on mode
    const isExport = !!exportConfig;
    const margin = { 
        top: (80 * drawScale) + ((exportConfig?.graphY || 0) * drawScale), 
        right: 40 * drawScale, 
        bottom: (isExport ? 120 : 220) * drawScale, 
        left: ((isExport ? 120 : 200) * drawScale) + ((exportConfig?.graphX || 0) * drawScale)
    };
    const chartW = width - margin.left - margin.right;
    const chartH = height - margin.top - margin.bottom;

    // 1. Calculate Group Totals
    const groupTotals: Record<string, number> = {};
    groups.forEach((g: string) => {
        let sum = 0;
        if (isInteraction) {
             const nested = pData[g];
             Object.values(nested).forEach((sub: any) => {
                 Object.values(sub).forEach((v: any) => sum += Number(v));
             });
        } else {
             const counts = pData[g];
             sum = Object.values(counts).reduce((a: any,b: any) => a+b, 0) as number;
        }
        groupTotals[g] = sum;
    });

    // 2. Determine Max Y
    let maxY = 0;
    const isPercentage = config.distValueMode === 'percentage';
    const isStacked = config.distBarMode === 'stacked'; 

    // Determine if we should show primary labels (to avoid redundancy)
    const groupKey = config.groupBy || 'phoneme';
    const colorKey = config.colorBy !== 'none' ? config.colorBy : 'phoneme';
    const textureKey = config.textureBy !== 'none' ? config.textureBy : null;
    const primaryKey = config.distPrimaryVar === 'texture' ? textureKey : colorKey;
    const showPrimaryLabel = primaryKey !== groupKey;

    if (isPercentage) {
        maxY = 100;
    } else {
        if (isStacked) {
            // Max of Group Totals
            maxY = Math.max(...Object.values(groupTotals));
        } else {
            // Max of Individual Bars
            groups.forEach((g: string) => {
                if (isInteraction) {
                    const nested = pData[g];
                    Object.values(nested).forEach((sub: any) => {
                        Object.values(sub).forEach((v: any) => { 
                            if (Number(v) > maxY) maxY = Number(v); 
                        });
                    });
                } else {
                    const counts = pData[g];
                    Object.values(counts).forEach((v: any) => {
                        if (Number(v) > maxY) maxY = Number(v);
                    });
                }
            });
        }
    }
    
    if (config.countRange[1] > 0 && !isPercentage) maxY = config.countRange[1];
    if (maxY === 0) maxY = 10;

    const mapY = (val: number, localH: number) => localH - (val / maxY) * localH;

    // Font Sizing Logic
    const axisFont = exportConfig ? exportConfig.tickLabelSize : (isExport ? 32 : 12);
    const subLabelFont = exportConfig ? exportConfig.xAxisLabelSize : (isExport ? 26 : 9);
    const barLabelFont = exportConfig ? exportConfig.dataLabelSize : (isExport ? 24 : 9);
    const groupLabelFont = isExport ? 0 : 10; 

    // Axis Offsets
    const xTickOffsetX = (exportConfig?.xAxisTickX || 0) * drawScale;
    const xTickOffsetY = (exportConfig?.xAxisTickY || 0) * drawScale;
    const yTickOffsetX = (exportConfig?.yAxisTickX || 0) * drawScale;
    const yTickOffsetY = (exportConfig?.yAxisTickY || 0) * drawScale; 

    // Helper to draw a bar
    const drawBar = (bx: number, by: number, bw: number, bh: number, color: string, texIdx: number, val: number, labelVal: string) => {
        const fill = generateTexture(ctx, texIdx, color, '#fff') as string | CanvasPattern;
        ctx.fillStyle = fill;
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1 * drawScale;
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeRect(bx, by, bw, bh);

        // Label
        if (val > 0) {
            ctx.textAlign = 'center';
            if (isExport) {
                ctx.fillStyle = 'white';
                ctx.font = `bold ${(barLabelFont * drawScale) / scale}px Inter`;
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = (3 * drawScale)/scale;
                ctx.lineJoin = 'round';
                const segCenterY = by + bh/2;
                ctx.strokeText(labelVal, bx + bw/2, segCenterY + (barLabelFont * 0.4 * drawScale));
                ctx.fillText(labelVal, bx + bw/2, segCenterY + (barLabelFont * 0.4 * drawScale));
            } else {
                ctx.fillStyle = 'white';
                ctx.font = `bold ${(barLabelFont * drawScale) / scale}px Inter`;
                ctx.strokeStyle = 'black';
                ctx.lineWidth = (2 * drawScale)/scale;
                ctx.strokeText(labelVal, bx + bw/2, by + bh/2 + 4);
                ctx.fillText(labelVal, bx + bw/2, by + bh/2 + 4);
            }
        }
    };

    if (config.separatePlots) {
        // FACETED
        const cols = Math.ceil(Math.sqrt(groups.length));
        const rows = Math.ceil(groups.length / cols);
        const cellW = chartW / cols;
        const cellH = chartH / rows;

        groups.forEach((g: string, i: number) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const pad = 20 * drawScale;
            const cx = margin.left + col * cellW + pad;
            const cy = margin.top + row * cellH + pad;
            const cw = cellW - (pad*2);
            const ch = cellH - (pad*2) - (20 * drawScale);
            const total = groupTotals[g];

            // Baseline
            ctx.beginPath(); ctx.moveTo(cx, cy+ch); ctx.lineTo(cx+cw, cy+ch); 
            ctx.lineWidth = 1 * drawScale; ctx.strokeStyle='#e2e8f0'; ctx.stroke();

            // Label for Cell (Group)
            const showCellLabel = groups.length > 1 || !isInteraction || !showPrimaryLabel;
            if (showCellLabel) {
                ctx.fillStyle = '#0f172a';
                ctx.font = `bold ${(exportConfig ? exportConfig.xAxisLabelSize : 12 * drawScale) / scale}px Inter`;
                ctx.textAlign = 'center';
                ctx.fillText(`/${g}/`, cx + cw/2, cy + ch + (subLabelFont * 1.5 * drawScale));
            }

            // Prepare Data for Rendering
            let items: { key: string, val: number, color: string, tex: number, subKey?: string }[] = [];
            
            if (isInteraction) {
                 const nested = pData[g];
                 // nested is now Primary -> Secondary -> Count
                 // distPrimaryVar determines if Primary is Color or Texture
                 const isPrimaryTexture = config.distPrimaryVar === 'texture';

                 // Get Primary Keys and Sort them
                 let pKeys = Object.keys(nested);
                 pKeys.sort((a,b) => {
                     let cmp = 0;
                     if (config.distBarOrder === 'alpha') {
                         cmp = a.localeCompare(b);
                     } else {
                         const sumA = (Object.values(nested[a]) as number[]).reduce((s, n) => s + n, 0);
                         const sumB = (Object.values(nested[b]) as number[]).reduce((s, n) => s + n, 0);
                         cmp = sumA - sumB;
                     }
                     return config.distBarDir === 'asc' ? cmp : -cmp;
                 });

                 // Render Logic for Interaction
                 const numPrimary = pKeys.length;
                 // Calculate width for each Primary Group
                 const primaryGroupW = (cw * 0.9) / numPrimary;
                 const startX = cx + (cw * 0.05);

                 pKeys.forEach((pk, pi) => {
                     const sMap = nested[pk];
                     const sKeys = Object.keys(sMap).sort(); 
                     
                     const stackTotal = (Object.values(sMap) as number[]).reduce((a, b) => a + b, 0);
                     const referenceTotal = (config.distNormalize && isStacked) ? stackTotal : total;
                     
                     const pBx = startX + pi * primaryGroupW;
                     
                     if (isStacked) {
                         // Stacked: One bar per Primary Key, stacked with Secondary Keys
                         const barW = primaryGroupW * 0.7;
                         const bx = pBx + (primaryGroupW - barW)/2;
                         let currentY = cy + ch;
                         
                         sKeys.forEach(sk => {
                             const val = sMap[sk];
                             const dispVal = isPercentage ? (referenceTotal > 0 ? (val / referenceTotal * 100) : 0) : val;
                             const h = (dispVal / maxY) * ch;
                             const label = isPercentage ? `${dispVal.toFixed(1)}%` : val.toString();
                             
                             currentY -= h;
                             
                             const color = isPrimaryTexture ? (colors[sk] || '#999') : (colors[pk] || '#999');
                             const tex = isPrimaryTexture ? (textureMap[pk] || 0) : (textureMap[sk] || 0);
                             
                             drawBar(bx, currentY, barW, h, color, tex, dispVal, label);
                         });

                         // Label for Primary Key
                         if (showPrimaryLabel && barW > (20 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = bx + barW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(pk, labelX, labelY);
                         }

                     } else {
                         // Grouped: Secondary Keys side-by-side within Primary Key area
                         const barW = (primaryGroupW * 0.9) / sKeys.length;
                         const innerStartX = pBx + (primaryGroupW * 0.05);
                         
                         sKeys.forEach((sk, si) => {
                             const val = sMap[sk];
                             const dispVal = isPercentage ? (total > 0 ? (val / total * 100) : 0) : val;
                             const h = (dispVal / maxY) * ch;
                             const label = isPercentage ? `${dispVal.toFixed(0)}%` : val.toString();
                             
                             const bx = innerStartX + si * barW;
                             const by = cy + ch - h;
                             
                             const color = isPrimaryTexture ? (colors[sk] || '#999') : (colors[pk] || '#999');
                             const tex = isPrimaryTexture ? (textureMap[pk] || 0) : (textureMap[sk] || 0);
                             
                             drawBar(bx, by, barW, h, color, tex, dispVal, label);
                         });

                         // Label for Primary Key (Centered under the group)
                         if (showPrimaryLabel && primaryGroupW > (20 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = pBx + primaryGroupW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(pk, labelX, labelY);
                         }
                     }
                 });

            } else {
                 // Standard Mode (Non-Interaction)
                 const counts = pData[g];
                 Object.keys(counts).forEach(k => {
                     items.push({
                         key: k,
                         val: counts[k],
                         color: colors[k] || '#000',
                         tex: config.textureBy !== 'none' ? (textureMap[k] || 0) : 0
                     });
                 });

                 // Sort Items
                 items.sort((a,b) => {
                    // Primary Sort: Bar Order
                    let cmp = 0;
                    if (config.distBarOrder === 'alpha') {
                        cmp = a.key.localeCompare(b.key);
                    } else {
                        cmp = a.val - b.val;
                    }
                    return config.distBarDir === 'asc' ? cmp : -cmp;
                });

                if (isStacked) {
                    // STACKED MODE
                    const barW = cw * 0.6;
                    const bx = cx + (cw - barW)/2;
                    let currentY = cy + ch;

                    items.forEach(item => {
                        const rawVal = item.val;
                        const dispVal = isPercentage ? (total > 0 ? (rawVal / total * 100) : 0) : rawVal;
                        const h = (dispVal / maxY) * ch;
                        const label = isPercentage ? `${dispVal.toFixed(1)}%` : rawVal.toString();
                        
                        currentY -= h;
                        drawBar(bx, currentY, barW, h, item.color, item.tex, dispVal, label);
                    });

                } else {
                    // GROUPED MODE
                    const barW = (cw * 0.9) / items.length;
                    const startX = cx + (cw * 0.05);

                    items.forEach((item, idx) => {
                        const rawVal = item.val;
                        const dispVal = isPercentage ? (total > 0 ? (rawVal / total * 100) : 0) : rawVal;
                        const h = (dispVal / maxY) * ch;
                        const label = isPercentage ? `${dispVal.toFixed(0)}%` : rawVal.toString();
                        
                        const bx = startX + idx * barW;
                        const by = cy + ch - h;
                        
                        drawBar(bx, by, barW, h, item.color, item.tex, dispVal, label);
                    });
                }
            }
        });

    } else {
        // COMBINED (Main Large Plot)
        ctx.strokeStyle = '#e2e8f0';
        ctx.textAlign = 'right';
        ctx.fillStyle = '#64748b';
        ctx.font = `${(axisFont * drawScale)/scale}px Inter`;
        ctx.lineWidth = 1 * drawScale;
        
        // Y Axis Ticks
        for(let i=0; i<=5; i++) {
            const val = maxY * (i/5);
            const y = margin.top + mapY(val, chartH);
            ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + chartW, y); ctx.stroke();
            const label = isPercentage ? `${Math.round(val)}%` : Math.round(val).toString();
            ctx.fillText(label, margin.left - (15 * drawScale) + yTickOffsetX, y + (5 * drawScale) + yTickOffsetY);
        }

        const groupW = chartW / groups.length;
        
        groups.forEach((g: string, i: number) => {
             const cx = margin.left + i * groupW;
             const total = groupTotals[g];
             
             // Prepare Data
             let items: { key: string, val: number, color: string, tex: number, subKey?: string }[] = [];
             
             if (isInteraction) {
                 const nested = pData[g];
                 // nested is Primary -> Secondary -> Count
                 const isPrimaryTexture = config.distPrimaryVar === 'texture';

                 // Get Primary Keys and Sort them
                 let pKeys = Object.keys(nested);
                 pKeys.sort((a,b) => {
                     let cmp = 0;
                     if (config.distBarOrder === 'alpha') {
                         cmp = a.localeCompare(b);
                     } else {
                         const sumA = (Object.values(nested[a]) as number[]).reduce((s, n) => s + n, 0);
                         const sumB = (Object.values(nested[b]) as number[]).reduce((s, n) => s + n, 0);
                         cmp = sumA - sumB;
                     }
                     return config.distBarDir === 'asc' ? cmp : -cmp;
                 });

                 // Render Logic for Interaction
                 const numPrimary = pKeys.length;
                 const primaryGroupW = (groupW * 0.9) / numPrimary;
                 const startX = cx + (groupW * 0.05);

                 pKeys.forEach((pk, pi) => {
                     const sMap = nested[pk];
                     const sKeys = Object.keys(sMap).sort(); 
                     
                     const stackTotal = (Object.values(sMap) as number[]).reduce((a, b) => a + b, 0);
                     const referenceTotal = (config.distNormalize && isStacked) ? stackTotal : total;

                     const pBx = startX + pi * primaryGroupW;
                     
                     if (isStacked) {
                         const barW = primaryGroupW * 0.7;
                         const bx = pBx + (primaryGroupW - barW)/2;
                         let currentY = margin.top + chartH;
                         
                         sKeys.forEach(sk => {
                             const val = sMap[sk];
                             const dispVal = isPercentage ? (referenceTotal > 0 ? (val / referenceTotal * 100) : 0) : val;
                             const h = (dispVal / maxY) * chartH;
                             const label = isPercentage ? `${dispVal.toFixed(1)}%` : val.toString();
                             
                             currentY -= h;
                             const color = isPrimaryTexture ? (colors[sk] || '#999') : (colors[pk] || '#999');
                             const tex = isPrimaryTexture ? (textureMap[pk] || 0) : (textureMap[sk] || 0);
                             drawBar(bx, currentY, barW, h, color, tex, dispVal, label);
                         });
                         
                         // Label for Primary Key
                         if (showPrimaryLabel && barW > (15 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = bx + barW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(pk, labelX, labelY);
                         }

                     } else {
                         const barW = (primaryGroupW * 0.9) / sKeys.length;
                         const innerStartX = pBx + (primaryGroupW * 0.05);
                         
                         sKeys.forEach((sk, si) => {
                             const val = sMap[sk];
                             const dispVal = isPercentage ? (total > 0 ? (val / total * 100) : 0) : val;
                             const h = (dispVal / maxY) * chartH;
                             const label = isPercentage ? `${dispVal.toFixed(0)}%` : val.toString();
                             
                             const bx = innerStartX + si * barW;
                             const by = margin.top + chartH - h;
                             
                             const color = isPrimaryTexture ? (colors[sk] || '#999') : (colors[pk] || '#999');
                             const tex = isPrimaryTexture ? (textureMap[pk] || 0) : (textureMap[sk] || 0);
                             
                             drawBar(bx, by, barW, h, color, tex, dispVal, label);
                         });

                         if (showPrimaryLabel && primaryGroupW > (15 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = pBx + primaryGroupW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(pk, labelX, labelY);
                         }
                     }
                 });

            } else {
                 const counts = pData[g];
                 Object.keys(counts).forEach(k => {
                     items.push({
                         key: k,
                         val: counts[k],
                         color: colors[k] || '#000',
                         tex: config.textureBy !== 'none' ? (textureMap[k] || 0) : 0
                     });
                 });

                 // Sort Items
                 items.sort((a,b) => {
                    // Primary Sort: Bar Order
                    let cmp = 0;
                    if (config.distBarOrder === 'alpha') {
                        cmp = a.key.localeCompare(b.key);
                    } else {
                        cmp = a.val - b.val;
                    }
                    return config.distBarDir === 'asc' ? cmp : -cmp;
                });

                if (isStacked) {
                    // STACKED MODE
                    const barW = groupW * 0.6;
                    const bx = cx + (groupW - barW)/2;
                    let currentY = margin.top + chartH;

                    items.forEach(item => {
                        const rawVal = item.val;
                        const dispVal = isPercentage ? (total > 0 ? (rawVal / total * 100) : 0) : rawVal;
                        const h = (dispVal / maxY) * chartH;
                        const label = isPercentage ? `${dispVal.toFixed(1)}%` : rawVal.toString();
                        
                        currentY -= h;
                        drawBar(bx, currentY, barW, h, item.color, item.tex, dispVal, label);
                    });

                } else {
                    // GROUPED MODE
                    const barW = (groupW * 0.9) / items.length;
                    const startX = cx + (groupW * 0.05);

                    items.forEach((item, idx) => {
                        const rawVal = item.val;
                        const dispVal = isPercentage ? (total > 0 ? (rawVal / total * 100) : 0) : rawVal;
                        const h = (dispVal / maxY) * chartH;
                        const label = isPercentage ? `${dispVal.toFixed(0)}%` : rawVal.toString();
                        
                        const bx = startX + idx * barW;
                        const by = margin.top + chartH - h;
                        
                        drawBar(bx, by, barW, h, item.color, item.tex, dispVal, label);

                        // Sub-label for grouped items (only if enough space)
                        if (barW > (20 * drawScale)) {
                            ctx.fillStyle = '#475569';
                            ctx.font = `${(subLabelFont * drawScale) / scale}px Inter`;
                            ctx.textAlign = 'center';
                            const labelX = bx + barW/2 + xTickOffsetX;
                            const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + xTickOffsetY;
                            ctx.fillText(item.subKey || item.key, labelX, labelY);
                        }
                    });
                }
            }

             // Group Label
             const showGroupLabel = groups.length > 1 || !isInteraction || !showPrimaryLabel;
             if (showGroupLabel && (!isExport || isStacked)) { 
                ctx.fillStyle = '#0f172a';
                ctx.font = `bold ${(groupLabelFont * drawScale) / scale}px Inter`;
                ctx.textAlign = 'center';
                const labelY = margin.top + chartH + (subLabelFont * 1.5 * drawScale) + (groupLabelFont * 1.5 * drawScale) + xTickOffsetY;
                const finalY = isStacked ? labelY - (subLabelFont * drawScale) : labelY;
                ctx.fillText(`/${g}/`, cx + groupW/2, finalY);
             }
        });
    }

  }, [plotData, config]);

  const drawLegend = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, drawScale: number = 1, exportConfig?: ExportConfig) => {
    const { colors, textureList, textureMap, isInteraction, colorKey, textureKey, colorCounts, textureCounts } = plotData;
    let curY = y;
    const isExport = !!exportConfig;

    // If custom position, override x and y
    if (exportConfig && exportConfig.legendPosition === 'custom') {
        // Handled by translation in generateImage
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    
    // Dynamic Font Sizes
    const titleSize = exportConfig ? exportConfig.legendTitleSize : (isExport ? 36 : 16);
    const itemSize = exportConfig ? exportConfig.legendItemSize : (isExport ? 24 : 14);
    
    const spacing = (itemSize * 1.6) * drawScale; 
    const boxSize = (itemSize * 0.8) * drawScale;

    // Determine legend visibility and titles from per-layer config or fallback to old fields
    const layerLegendCfg = exportConfig?.layerLegends?.find(ll => ll.layerId === 'bg');
    const showColor = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showColorLegend !== false);
    const colorLegendTitle = (layerLegendCfg?.colorTitle) || (exportConfig?.colorLegendTitle) || (colorKey ? colorKey.toUpperCase() : 'COLOR');
    const showTexture = layerLegendCfg ? layerLegendCfg.show : (exportConfig?.showTextureLegend !== false);
    const textureLegendTitle = (layerLegendCfg?.textureTitle) || (exportConfig?.textureLegendTitle) || (textureKey ? textureKey.toUpperCase() : 'PATTERN');

    const legendLayerIds = exportConfig?.legendLayers;
    const isInLegend = !legendLayerIds || legendLayerIds.includes('bg');

    // 1. Color Legend
    if (isInLegend && showColor && colorKey) {
        ctx.font = `bold ${(titleSize * drawScale)}px Inter`;
        ctx.fillText(colorLegendTitle, x, curY);
        curY += (titleSize * 1.4) * drawScale;

        ctx.font = `${(itemSize * drawScale)}px Inter`;
        Object.entries(colors).forEach(([key, color]) => {
                const count = colorCounts[key] || 0;
                ctx.fillStyle = color as string;
                ctx.fillRect(x, curY, boxSize, boxSize);
                ctx.fillStyle = '#334155';
                ctx.fillText(`${key} (n=${count})`, x + (boxSize * 1.5), curY + (boxSize/2));
                curY += spacing;
        });
        curY += (titleSize) * drawScale;
    }

    // 2. Texture Legend
    if (isInLegend && showTexture && isInteraction && textureKey) {
        ctx.font = `bold ${(titleSize * drawScale)}px Inter`;
        ctx.fillStyle = '#0f172a';
        ctx.fillText(textureLegendTitle, x, curY);
        curY += (titleSize * 1.4) * drawScale;

        ctx.font = `${(itemSize * drawScale)}px Inter`;

        textureList.forEach((tk: string) => {
             const idx = textureMap[tk];
             const count = textureCounts[tk] || 0;
             const pat = generateTexture(ctx, idx, '#475569', '#fff') as string | CanvasPattern;
             ctx.fillStyle = pat;
             ctx.fillRect(x, curY, boxSize, boxSize);
             ctx.strokeStyle = '#cbd5e1';
             ctx.strokeRect(x, curY, boxSize, boxSize);

             ctx.fillStyle = '#334155';
             ctx.fillText(`${tk} (n=${count})`, x + (boxSize * 1.5), curY + (boxSize/2));
             curY += spacing;
        });
    }
  };

  useImperativeHandle(ref, () => {
    const generateImage = (exportConfig: ExportConfig) => {
       const offscreen = document.createElement('canvas');
       const drawScale = exportConfig.scale;
       
       // Base dimensions
       const baseWidth = 2400;
       const baseHeight = 1600;

       // Apply Graph Geometry
       const graphScaleX = exportConfig.graphScaleX || exportConfig.graphScale || 1.0;
       const graphScaleY = exportConfig.graphScaleY || exportConfig.graphScale || 1.0;
       const plotW = baseWidth * graphScaleX;
       const plotH = baseHeight * graphScaleY;
       
       // Tighter margins for export to reduce whitespace
       const margin = { 
           top: (80 * drawScale) + ((exportConfig.graphY || 0) * drawScale), 
           right: 60 * drawScale, 
           bottom: 160 * drawScale, 
           left: (120 * drawScale) + ((exportConfig.graphX || 0) * drawScale)
       };
       
       // Legend Calculation
       let legendW = 0;
       let lx = 0;
       let ly = 0;

       if (exportConfig.showLegend) {
           if (exportConfig.legendPosition === 'right') {
               legendW = 800 * drawScale;
               lx = margin.left + plotW + (80 * drawScale);
               ly = margin.top + (50 * drawScale);
           } else if (exportConfig.legendPosition === 'bottom') {
               lx = margin.left;
               ly = margin.top + plotH + (100 * drawScale);
           } else if (exportConfig.legendPosition === 'inside-top-right') {
               lx = margin.left + plotW - (300 * drawScale); 
               ly = margin.top + (40 * drawScale);
           } else if (exportConfig.legendPosition === 'inside-top-left') {
               lx = margin.left + (40 * drawScale);
               ly = margin.top + (40 * drawScale);
           } else if (exportConfig.legendPosition === 'custom') {
               lx = (Number(exportConfig.legendX) || 0) * drawScale;
               ly = (Number(exportConfig.legendY) || 0) * drawScale;
           }
       }
       
       let canvasWidth = (exportConfig.canvasWidth ? exportConfig.canvasWidth * drawScale : 0) || (margin.left + plotW + margin.right);
       let canvasHeight = (exportConfig.canvasHeight ? exportConfig.canvasHeight * drawScale : 0) || (margin.top + plotH + margin.bottom);

       if (!exportConfig.canvasWidth && exportConfig.showLegend && exportConfig.legendPosition === 'right') {
           canvasWidth += legendW;
       }
       
       offscreen.width = canvasWidth;
       offscreen.height = canvasHeight;
       
       const ctx = offscreen.getContext('2d');
       if(ctx) {
           ctx.fillStyle = '#fff'; ctx.fillRect(0,0,offscreen.width, offscreen.height);
           
           ctx.save();
           // Translate for plot rendering area
           ctx.translate(margin.left, margin.top);
           renderPlot(ctx, plotW, plotH, 1, drawScale, exportConfig);
           
           // Title
           if (exportConfig.showPlotTitle) {
               ctx.font = `bold ${exportConfig.plotTitleSize * drawScale}px Inter`;
               ctx.fillStyle = '#0f172a';
               ctx.textAlign = 'center';
               
               const titleX = (plotW/2) + ((exportConfig.plotTitleX || 0) * drawScale);
               const titleY = (40 * drawScale) + ((exportConfig.plotTitleY || 0) * drawScale);
               
               ctx.fillText(exportConfig.plotTitle, titleX, titleY);
           }
           
           ctx.restore();

           if (exportConfig.showLegend) {
               ctx.save();
               
               if (exportConfig.legendPosition === 'right') {
                   // Draw divider line only for right legend
                   ctx.beginPath(); 
                   ctx.moveTo(margin.left + plotW + (40 * drawScale), margin.top); 
                   ctx.lineTo(margin.left + plotW + (40 * drawScale), margin.top + plotH); 
                   ctx.strokeStyle = '#e2e8f0'; 
                   ctx.lineWidth = 2 * drawScale;
                   ctx.stroke();
               }
               
               // Draw Legend
               ctx.translate(lx, ly);
               drawLegend(ctx, 0, 0, legendW, drawScale, exportConfig);
               ctx.restore();
           }
           return offscreen.toDataURL();
       }
       return '';
    };

    return {
        exportImage: () => {
            // Legacy support
            const defaultExportConfig: ExportConfig = {
                scale: 3, 
                xAxisLabelSize: 32, yAxisLabelSize: 32, 
                tickLabelSize: 24, dataLabelSize: 24,
                showLegend: true, legendTitleSize: 36, legendItemSize: 24,
                showColorLegend: true, colorLegendTitle: config.colorBy.toUpperCase(),
                showShapeLegend: true, shapeLegendTitle: '',
                showTextureLegend: true, textureLegendTitle: '',
                showLineTypeLegend: true, lineTypeLegendTitle: '',
                showOverlayColorLegend: true, overlayColorLegendTitle: '',
                showOverlayShapeLegend: true, overlayShapeLegendTitle: '',
                showOverlayLineTypeLegend: true, overlayLineTypeLegendTitle: ''
            };
            const url = generateImage(defaultExportConfig);
            if(url) {
                const link = document.createElement('a');
                link.download = 'dist_plot.png';
                link.href = url;
                link.click();
            }
        },
        generateImage
    };
  });

  // ... (rest of the file remains unchanged)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.save();
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        renderPlot(ctx, width, height, 1, 1);
        ctx.restore();
    }
  }, [plotData, config, renderPlot]);

  const handleLegendClickWrapper = (category: string, type: 'color'|'texture', event: React.MouseEvent) => {
      if (onLegendClick) {
          const { colors, textureMap } = plotData as any;
          const currentStyles = {
              color: type === 'color' ? (colors[category] || '#000') : '#000',
              shape: 'circle',
              texture: type === 'texture' ? (textureMap[category] || 0) : 0,
              lineType: 'solid'
          };
          onLegendClick(category, currentStyles, event);
      }
  };

  const renderScreenLegend = () => {
    const { colors, textureList, textureMap, isInteraction, colorKey, textureKey, colorCounts, textureCounts } = plotData as any;
    return (
        <div className="absolute top-4 right-4 bg-white/95 backdrop-blur p-3 rounded-xl border border-slate-200 text-xs shadow-xl flex flex-col space-y-3 max-h-[85%] overflow-y-auto w-48 pointer-events-auto">
            {colorKey && (
                <div className="space-y-1">
                    <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{colorKey}</h4>
                    {Object.entries(colors).map(([k, c]) => (
                        <div key={k} className="flex items-center gap-2 justify-between cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(k, 'color', e)}>
                            <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{backgroundColor: c as string}}></div><span>{k}</span></div>
                            <span className="text-slate-400 text-[10px] font-mono">({colorCounts[k] || 0})</span>
                        </div>
                    ))}
                </div>
            )}
            {isInteraction && textureKey && (
                <div className="space-y-1">
                    <h4 className="font-bold text-slate-400 uppercase text-[10px] border-b pb-1 mb-1">{textureKey}</h4>
                    {textureList.map((t: string) => {
                        const idx = textureMap[t];
                        return (
                            <div key={t} className="flex items-center gap-2 justify-between cursor-pointer hover:bg-slate-100 p-1 rounded" onClick={(e) => handleLegendClickWrapper(t, 'texture', e)}>
                                <div className="flex items-center gap-2"><PatternPreview index={idx} color="#475569" /><span>{t}</span></div>
                                <span className="text-slate-400 text-[10px] font-mono">({textureCounts[t] || 0})</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    );
  };

  return (
    <div ref={containerRef} className="w-full h-full relative p-4 bg-white">
      <canvas ref={canvasRef} className="w-full h-full" />
      {renderScreenLegend()}
    </div>
  );
});

const PatternPreview = ({index, color}: {index:number, color:string}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        if(canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if(ctx) {
                const pat = generateTexture(ctx, index, color, '#fff') as string | CanvasPattern;
                ctx.fillStyle = pat;
                ctx.fillRect(0,0,12,12);
                ctx.strokeStyle = '#cbd5e1';
                ctx.strokeRect(0,0,12,12);
            }
        }
    }, [index, color]);
    return <canvas ref={canvasRef} width={12} height={12} className="rounded-sm" />;
}

export default PhonemeDistributionPlot;
