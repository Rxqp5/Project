// "Share team": draws a raid team as an image (boss, weaknesses, six Pokémon and their moves) and
// hands it to the phone's share sheet, or saves it.

const TYPE_COLORS = {
  Normal: '#9099a1', Fighting: '#ce4069', Flying: '#8fa8dd', Poison: '#ab6ac8', Ground: '#d97746', Rock: '#c5b78c',
  Bug: '#90c12c', Ghost: '#5269ac', Steel: '#5a8ea1', Fire: '#ff9c54', Water: '#4d90d5', Grass: '#63bb5b',
  Electric: '#f3d23b', Psychic: '#f97176', Ice: '#74cec0', Dragon: '#0a6dc4', Dark: '#5a5366', Fairy: '#ec8fe6',
};
const W = 1080;
const H = 1350;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function pill(g, text, x, y, color, size = 30) {
  g.font = `600 ${size}px ${FONT}`;
  const w = g.measureText(text).width + size;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, y, w, size * 1.5, size * 0.75);
  g.fill();
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText(text, x + size / 2, y + size * 0.77);
  return w;
}

// Shrinks the font (down to `min` px) until `text` fits, then cuts it if it still doesn't.
function fitFont(g, text, maxWidth, weight, size, min) {
  let px = size;
  g.font = `${weight} ${px}px ${FONT}`;
  while (px > min && g.measureText(text).width > maxWidth) {
    px -= 1;
    g.font = `${weight} ${px}px ${FONT}`;
  }
  return fitText(g, text, maxWidth);
}

function fitText(g, text, maxWidth) {
  if (g.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

// card: { title, subtitle, weak: [{ type, mult }], heading, members: [{ dex, name, detail?, moves: [{ name, type }] }],
//         sprite: (dex) => url, footer }
export async function drawTeamCard(card) {
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1f2937');
  bg.addColorStop(1, '#0b1120');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const sprites = await Promise.all([card.sprite(card.bossDex), ...card.members.map((m) => card.sprite(m.dex, m.shiny))].map(loadImage));

  // Header: boss name, tier, sprite, weaknesses.
  g.fillStyle = '#9ca3af';
  g.font = `600 28px ${FONT}`;
  g.textBaseline = 'alphabetic';
  g.fillText('RAID BOSS GUIDE', 60, 80);
  g.fillStyle = '#fff';
  g.fillText(fitFont(g, card.title, 700, 800, 72, 44), 60, 160);
  g.fillStyle = '#d1d5db';
  g.font = `500 36px ${FONT}`;
  g.fillText(card.subtitle, 60, 215);
  if (sprites[0]) g.drawImage(sprites[0], W - 300, 30, 240, 240);
  g.fillStyle = '#9ca3af';
  g.font = `600 28px ${FONT}`;
  g.fillText('WEAK TO', 60, 290);
  let x = 60;
  for (const w of card.weak.slice(0, 6)) {
    x += pill(g, `${w.type}${w.mult > 2 ? ' 2.56×' : ''}`, x, 310, TYPE_COLORS[w.type] || '#666', 28) + 12;
  }

  // Team
  g.fillStyle = '#fff';
  g.font = `700 44px ${FONT}`;
  g.textBaseline = 'alphabetic';
  g.fillText(card.heading, 60, 440);
  const cols = 2;
  const tileW = (W - 60 * 2 - 30) / cols;
  const tileH = 255;
  card.members.slice(0, 6).forEach((m, i) => {
    const tx = 60 + (i % cols) * (tileW + 30);
    const ty = 470 + Math.floor(i / cols) * (tileH + 25);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    g.roundRect(tx, ty, tileW, tileH, 24);
    g.fill();
    if (sprites[i + 1]) g.drawImage(sprites[i + 1], tx + 6, ty + 30, 192, 192);
    const textX = tx + 205;
    const textW = tileW - 220;
    g.fillStyle = '#fff';
    g.fillText(fitFont(g, m.name, textW, 700, 34, 22), textX, ty + 62);
    if (m.detail) {
      g.fillStyle = '#9ca3af';
      g.font = `500 24px ${FONT}`;
      g.fillText(fitText(g, m.detail, textW), textX, ty + 98);
    }
    m.moves.forEach((mv, j) => {
      const my = ty + 135 + j * 46;
      g.fillStyle = TYPE_COLORS[mv.type] || '#666';
      g.beginPath();
      g.arc(textX + 12, my - 9, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#e5e7eb';
      g.fillText(fitFont(g, mv.name, textW - 34, 500, 28, 20), textX + 34, my);
    });
  });

  g.fillStyle = '#6b7280';
  g.font = `500 26px ${FONT}`;
  g.fillText(card.footer, 60, H - 50);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// The share sheet: pick which team, see the picture, then share or save it.
// options: [{ label, card }]
export function openShareDialog(options, filename) {
  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.innerHTML = `
    <div class="share-box" role="dialog" aria-modal="true" aria-label="Share team">
      <div class="party-head"><h2>Share team</h2><button type="button" class="share-close" aria-label="Close">✕</button></div>
      ${options.length > 1 ? `<div class="tabs">${options.map((o, i) => `<button type="button" data-opt="${i}" aria-selected="${i === 0}">${o.label}</button>`).join('')}</div>` : ''}
      <div class="share-preview"><p class="hint">Drawing…</p></div>
      <div class="form-actions">
        <button type="button" class="button primary" id="share-go">Share</button>
        <button type="button" class="button" id="share-save">Save image</button>
      </div>
    </div>`;
  document.body.append(overlay);
  let blob = null;
  let url = null;
  const close = () => {
    if (url) URL.revokeObjectURL(url);
    overlay.remove();
  };
  async function show(i) {
    overlay.querySelectorAll('[data-opt]').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.opt) === i)));
    blob = await drawTeamCard(options[i].card);
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    overlay.querySelector('.share-preview').innerHTML = `<img src="${url}" alt="${options[i].label}">`;
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.share-close')) close();
    const opt = e.target.closest('[data-opt]');
    if (opt) show(Number(opt.dataset.opt));
  });
  const save = () => {
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
  };
  overlay.querySelector('#share-save').addEventListener('click', () => blob && save());
  overlay.querySelector('#share-go').addEventListener('click', async () => {
    if (!blob) return;
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: options[0].card.title });
      } catch {
        // Cancelled.
      }
    } else {
      save();
    }
  });
  show(0);
}
