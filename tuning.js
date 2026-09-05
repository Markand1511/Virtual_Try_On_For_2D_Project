// Live tuning panel — enabled with ?tune=1
import { clearSavedTuning } from './engine2d.js';

const FIELDS = [
  { key: 'scale', label: 'Size', min: 0.2, max: 3, step: 0.01, def: 1, unit: '×' },
  { key: 'offsetX', label: 'Move X', min: -1.5, max: 1.5, step: 0.01, def: 0 },
  { key: 'offsetY', label: 'Move Y', min: -2, max: 2, step: 0.01, def: 0 },
  { key: 'rotationOffset', label: 'Rotate', min: -180, max: 180, step: 1, def: 0, unit: '°' },
  { key: 'earDrop', label: 'Ear ↓', min: -0.8, max: 1.2, step: 0.01, def: 0.18, only: 'earring', group: 'Earring fit' },
  { key: 'earOut', label: 'Ear ↔', min: -0.4, max: 0.8, step: 0.01, def: 0.14, only: 'earring', group: 'Earring fit' },
  { key: 'earBack', label: 'Ear depth', min: -0.6, max: 0.6, step: 0.01, def: 0.08, only: 'earring', group: 'Earring fit' },
];

const CSS = `
#vto-tuner {
  position: fixed; top: 12px; right: 12px; z-index: 10000;
  width: 250px; max-height: 88vh; overflow-y: auto;
  padding: 12px 14px 14px;
  background: rgba(14,14,14,0.94);
  border: 1px solid rgba(212,175,55,0.5); border-radius: 12px;
  font-family: 'Poppins', system-ui, sans-serif; font-size: 12px; color: #F5F0E8;
  box-shadow: 0 10px 40px rgba(0,0,0,0.6);
}
#vto-tuner h3 { margin: 0 0 2px; font-size: 13px; color: #E8C860; }
#vto-tuner .vt-sub { margin: 0 0 10px; opacity: .6; font-size: 10.5px; }
#vto-tuner select, #vto-tuner button {
  width: 100%; padding: 6px 8px; margin-bottom: 8px;
  background: rgba(255,255,255,.06); color: #F5F0E8;
  border: 1px solid rgba(212,175,55,.35); border-radius: 7px;
  font: inherit; cursor: pointer;
}
#vto-tuner .vt-row { margin-bottom: 7px; }
#vto-tuner .vt-row label { display: flex; justify-content: space-between; margin-bottom: 2px; font-size: 11px; }
#vto-tuner .vt-row label b { color: #E8C860; font-weight: 500; }
#vto-tuner input[type=range] { width: 100%; accent-color: #D4AF37; }
#vto-tuner .vt-empty { opacity: .55; padding: 10px 0; }
#vto-tuner .vt-group {
  margin: 10px 0 5px; padding-top: 8px;
  border-top: 1px solid rgba(212,175,55,.22);
  font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #E8C860;
}
#vto-tuner .vt-anchor { display: flex; gap: 6px; margin-bottom: 8px; }
#vto-tuner .vt-anchor button { margin: 0; }
#vto-tuner .vt-anchor button.on { background: rgba(212,175,55,.3); border-color: #D4AF37; }
`;

function fmt(v, f) {
  if (f.unit === '°') return `${Math.round(v)}°`;
  if (f.unit === '×') return `${Number(v).toFixed(2)}×`;
  return Number(v).toFixed(2);
}

export function createTuner(engine, getActiveItems) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'vto-tuner';
  document.body.appendChild(panel);

  let currentId = null;

  function render() {
    const items = getActiveItems();
    panel.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = '2D Image Tuning';
    panel.appendChild(h);
    const sub = document.createElement('p');
    sub.className = 'vt-sub';
    sub.textContent = 'Adjust PNG/JPG placement. Values persist in localStorage.';
    panel.appendChild(sub);

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'vt-empty';
      empty.textContent = 'Turn on a piece of jewellery to tune it.';
      panel.appendChild(empty);
      return;
    }

    if (!items.some((i) => i.id === currentId)) currentId = items[0].id;

    const picker = document.createElement('select');
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.label;
      opt.selected = item.id === currentId;
      picker.appendChild(opt);
    }
    picker.addEventListener('change', () => { currentId = picker.value; render(); });
    panel.appendChild(picker);

    const tuning = engine.getTuning(currentId);
    if (!tuning) return;

    const anchorRow = document.createElement('div');
    anchorRow.className = 'vt-anchor';
    for (const mode of ['top', 'center']) {
      const b = document.createElement('button');
      b.textContent = mode === 'top' ? 'Hang from top' : 'Centred';
      if ((tuning.anchor || 'center') === mode) b.classList.add('on');
      b.addEventListener('click', () => {
        engine.updateTuning(currentId, { anchor: mode });
        render();
      });
      anchorRow.appendChild(b);
    }
    panel.appendChild(anchorRow);

    let shownGroup = null;
    for (const f of FIELDS) {
      if (f.only && tuning.category !== f.only) continue;
      if (f.group && f.group !== shownGroup) {
        shownGroup = f.group;
        const heading = document.createElement('p');
        heading.className = 'vt-group';
        heading.textContent = f.group;
        panel.appendChild(heading);
      }
      const row = document.createElement('div');
      row.className = 'vt-row';
      const label = document.createElement('label');
      const name = document.createElement('span');
      name.textContent = f.label;
      const val = document.createElement('b');
      const current = tuning[f.key] ?? f.def;
      val.textContent = fmt(current, f);
      label.append(name, val);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = f.min;
      slider.max = f.max;
      slider.step = f.step;
      slider.value = current;
      slider.addEventListener('input', () => {
        const num = Number(slider.value);
        val.textContent = fmt(num, f);
        engine.updateTuning(currentId, { [f.key]: num });
      });
      row.append(label, slider);
      panel.appendChild(row);
    }

    const copy = document.createElement('button');
    copy.textContent = 'Copy config';
    copy.addEventListener('click', async () => {
      const t = engine.getTuning(currentId);
      const folder = items.find((i) => i.id === currentId)?.folder || currentId;
      const line = `'${folder}': ${JSON.stringify({
        scale: t.scale, offsetX: t.offsetX, offsetY: t.offsetY,
        rotationOffset: t.rotationOffset, anchor: t.anchor,
        earDrop: t.earDrop, earOut: t.earOut, earBack: t.earBack,
      }, null, 0)},`;
      try {
        await navigator.clipboard.writeText(line);
        copy.textContent = 'Copied!';
        setTimeout(() => { copy.textContent = 'Copy config'; }, 1200);
      } catch {
        copy.textContent = 'Copy failed';
      }
    });
    panel.appendChild(copy);

    const reset = document.createElement('button');
    reset.textContent = 'Clear saved tuning';
    reset.addEventListener('click', () => {
      clearSavedTuning(engine);
      render();
    });
    panel.appendChild(reset);
  }

  render();
  return { refresh: render };
}
