
export const generateTexture = (
    ctx: CanvasRenderingContext2D, 
    index: number, 
    color: string = '#000000',
    backgroundColor: string = '#ffffff'
  ): CanvasPattern | string => {
    // 0: Solid
    if (index === 0) return color;

    const patternCanvas = document.createElement('canvas');
    const size = 12;
    patternCanvas.width = size;
    patternCanvas.height = size;
    const pCtx = patternCanvas.getContext('2d');
    if (!pCtx) return color;

    // Fill background
    pCtx.fillStyle = backgroundColor;
    pCtx.fillRect(0, 0, size, size);

    pCtx.strokeStyle = color;
    pCtx.fillStyle = color;
    pCtx.lineWidth = 2;

    // Distinct patterns mapping
    // index 0 is Solid.
    // 1..8 patterns.
    const type = (index - 1) % 8;

    switch (type) {
      case 0: // Forward Slash
        pCtx.beginPath(); pCtx.moveTo(0, size); pCtx.lineTo(size, 0); pCtx.stroke();
        break;
      case 1: // Back Slash
        pCtx.beginPath(); pCtx.moveTo(0, 0); pCtx.lineTo(size, size); pCtx.stroke();
        break;
      case 2: // Cross Hatch
        pCtx.beginPath(); 
        pCtx.moveTo(0, 0); pCtx.lineTo(size, size);
        pCtx.moveTo(size, 0); pCtx.lineTo(0, size);
        pCtx.stroke();
        break;
      case 3: // Dots
        pCtx.beginPath(); pCtx.arc(size/2, size/2, 2.5, 0, Math.PI * 2); pCtx.fill();
        break;
      case 4: // Horizontal
        pCtx.beginPath(); pCtx.moveTo(0, size/2); pCtx.lineTo(size, size/2); pCtx.stroke();
        break;
      case 5: // Vertical
        pCtx.beginPath(); pCtx.moveTo(size/2, 0); pCtx.lineTo(size/2, size); pCtx.stroke();
        break;
      case 6: // Grid (Plus)
        pCtx.beginPath(); 
        pCtx.moveTo(size/2, 0); pCtx.lineTo(size/2, size);
        pCtx.moveTo(0, size/2); pCtx.lineTo(size, size/2);
        pCtx.stroke();
        break;
      case 7: // Circle Open
        pCtx.beginPath(); pCtx.arc(size/2, size/2, 3, 0, Math.PI*2); pCtx.stroke();
        break;
    }
  
    return ctx.createPattern(patternCanvas, 'repeat') || color;
  };
