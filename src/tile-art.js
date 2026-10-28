// 타일 디자인 그리기 (3D 텍스처와 상점 미리보기가 같은 코드를 씀)
import { JOKER } from './game.js';

const FONTS = {
  sans: '-apple-system, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  round: '"Arial Rounded MT Bold", "Trebuchet MS", sans-serif',
};

function drawPattern(x, w, h, style, colors) {
  if (!style.pattern) return;
  x.save();
  x.globalAlpha = 0.18;
  x.fillStyle = colors.ink;
  x.strokeStyle = colors.ink;
  if (style.pattern === 'petals') {
    const spots = [[0.18, 0.15], [0.82, 0.2], [0.2, 0.86], [0.8, 0.82], [0.5, 0.06]];
    for (const [px, py] of spots) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        x.beginPath();
        x.ellipse(px * w + Math.cos(a) * 7, py * h + Math.sin(a) * 7, 6, 3.5, a, 0, Math.PI * 2);
        x.fill();
      }
    }
  } else if (style.pattern === 'stars') {
    const spots = [[0.15, 0.12], [0.85, 0.12], [0.15, 0.88], [0.85, 0.88]];
    for (const [px, py] of spots) {
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 4 : 10;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        x.lineTo(px * w + Math.cos(a) * r, py * h + Math.sin(a) * r);
      }
      x.closePath();
      x.fill();
    }
  } else if (style.pattern === 'lines') {
    x.lineWidth = 2;
    for (let y = 8; y < h; y += 14) {
      x.beginPath();
      x.moveTo(0, y);
      x.lineTo(w, y);
      x.stroke();
    }
  }
  x.restore();
}

/** 타일 앞면을 캔버스에 그림. value가 null이면 숫자 없이 (뒷면/미리보기) */
export function drawTileFace(x, w, h, style, color, value) {
  const colors = style[color];
  x.fillStyle = colors.body;
  x.fillRect(0, 0, w, h);
  drawPattern(x, w, h, style, colors);
  if (style.border) {
    x.strokeStyle = style.border;
    x.lineWidth = Math.max(3, w * 0.05);
    x.strokeRect(x.lineWidth / 2 + 3, x.lineWidth / 2 + 3, w - x.lineWidth - 6, h - x.lineWidth - 6);
  }
  if (value === null || value === undefined) return;
  x.fillStyle = colors.ink;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  if (style.glow) {
    x.shadowColor = colors.ink;
    x.shadowBlur = w * 0.12;
  }
  const font = FONTS[style.font] || FONTS.sans;
  if (value === JOKER) {
    x.fillRect(w * 0.17, h * 0.46, w * 0.66, h * 0.087);
    x.font = `bold ${Math.round(w * 0.17)}px ${font}`;
    x.fillText('JOKER', w / 2, h * 0.82);
  } else {
    x.font = `bold ${Math.round(w * (value >= 10 ? 0.66 : 0.875))}px ${font}`;
    x.fillText(String(value), w / 2, h * 0.5);
    if (value === 6 || value === 9) x.fillRect(w * 0.31, h * 0.815, w * 0.375, h * 0.043);
  }
  x.shadowBlur = 0;
}

export function makeTileCanvas(style, color, value, w = 128, h = 184) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawTileFace(c.getContext('2d'), w, h, style, color, value);
  return c;
}
