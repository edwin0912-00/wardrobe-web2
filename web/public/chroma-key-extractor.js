/* Chroma Key Extractor Module (#00ff00 Keying Engine) */

export class ChromaKeyExtractor {
  static async extractTransparentCanvas(imageUrl, options = {}) {
    const {
      keyColor = [0, 255, 0],
      threshold = 95,
      smoothness = 25,
    } = options;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const imgData = ctx.getImageData(0, 0, img.width, img.height);
        const data = imgData.data;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Distance from pure key green [0, 255, 0]
          const dist = Math.sqrt(
            Math.pow(r - keyColor[0], 2) +
            Math.pow(g - keyColor[1], 2) +
            Math.pow(b - keyColor[2], 2)
          );

          if (dist < threshold) {
            data[i + 3] = 0; // Pure transparent
          } else if (dist < threshold + smoothness) {
            // Feather edge
            const alpha = (dist - threshold) / smoothness;
            data[i + 3] = Math.floor(alpha * 255);
          }
        }

        ctx.putImageData(imgData, 0, 0);
        resolve({
          canvas,
          dataDataUrl: canvas.toDataURL('image/png'),
          width: img.width,
          height: img.height,
        });
      };

      img.onerror = (err) => reject(err);
      img.src = imageUrl;
    });
  }
}

if (typeof window !== 'undefined') {
  window.ChromaKeyExtractor = ChromaKeyExtractor;
}
