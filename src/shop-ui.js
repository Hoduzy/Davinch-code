// 상점 / 보관함 화면 (3D 모델 대신 썸네일 이미지로 가볍게)
import { shopItems, SLOTS, SLOT_LABELS, RARITY, ECONOMY } from './catalog.js';
import { makeTileCanvas } from './tile-art.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const formatCoins = (n) => `🪙 ${Number(n || 0).toLocaleString('ko-KR')}`;

/** 아이템 썸네일 (가벼운 이미지/캔버스) */
export function itemThumb(item) {
  const box = el('div', `thumb thumb-${item.category}`);
  if (item.category === 'skin') {
    if (item.thumbnail) {
      const img = el('img');
      img.loading = 'lazy';
      img.alt = item.name;
      img.src = item.thumbnail;
      img.onerror = () => { img.replaceWith(el('div', 'thumb-initial', item.name.slice(0, 1))); };
      box.append(img);
    } else {
      box.append(el('div', 'thumb-initial', item.file ? item.name.slice(0, 1) : '🙂'));
    }
  } else if (item.category === 'tile') {
    const a = makeTileCanvas(item.style, 'black', 7, 64, 92);
    const b = makeTileCanvas(item.style, 'white', 3, 64, 92);
    box.append(a, b);
  } else {
    const fx = item.effect || {};
    const colors = fx.colors && fx.colors.length ? fx.colors : ['#fff'];
    box.style.background = `radial-gradient(circle, ${colors.join(', ')}, transparent 75%)`;
    box.append(el('div', 'thumb-icon', item.icon || '✨'));
  }
  return box;
}

export class ShopUI {
  /**
   * @param {object} opts
   * @param {() => import('./economy.js').Economy | null} opts.getEconomy
   * @param {(text: string, kind?: string) => void} opts.toast
   * @param {() => void} opts.onClose
   */
  constructor({ getEconomy, toast, onClose }) {
    this.getEconomy = getEconomy;
    this.toast = toast;
    this.tab = 'skin';
    this.busy = false;
    $('shop-close').addEventListener('click', onClose);
  }

  open(tab) {
    if (tab) this.tab = tab;
    $('shop').hidden = false;
    this.render();
  }

  close() { $('shop').hidden = true; }

  get isOpen() { return !$('shop').hidden; }

  render() {
    if (!this.isOpen) return;
    const eco = this.getEconomy();
    $('shop-coins').textContent = eco && eco.ready ? formatCoins(eco.coins) : '';
    const note = $('shop-note');
    if (!eco) note.textContent = '상점은 온라인(Firebase) 연결이 필요해요. 지금은 둘러보기만 할 수 있어요.';
    else if (!eco.configured) note.textContent = '관리자가 아직 상점·재화 설정을 서버에 올리지 않았어요. (설정 → 관리자)';
    else note.textContent = '';

    const tabs = $('shop-tabs');
    tabs.replaceChildren();
    for (const key of [...SLOTS, 'inventory']) {
      const b = el('button', `tab${this.tab === key ? ' on' : ''}`, key === 'inventory' ? '보관함' : SLOT_LABELS[key]);
      b.addEventListener('click', () => { this.tab = key; this.render(); });
      tabs.append(b);
    }

    const grid = $('shop-grid');
    grid.replaceChildren();
    if (this.tab === 'inventory') {
      for (const slot of SLOTS) {
        const owned = shopItems(slot).filter((it) => (eco ? eco.owns(it.id) : it.price === 0));
        grid.append(el('h3', 'grid-title', SLOT_LABELS[slot]));
        for (const it of owned) grid.append(this._card(it, eco, true));
      }
    } else {
      for (const it of shopItems(this.tab)) grid.append(this._card(it, eco, false));
    }
  }

  _card(item, eco, inventoryView) {
    const card = el('div', 'item-card');
    const rarity = RARITY[item.rarity] || RARITY.common;
    card.style.setProperty('--rarity', rarity.color);
    card.append(itemThumb(item));
    const info = el('div', 'item-info');
    info.append(el('div', 'item-name', item.name));
    const meta = el('div', 'item-meta');
    meta.append(el('span', 'rarity', rarity.label));
    if (item.sizeMB) meta.append(el('span', '', `${item.sizeMB}MB`));
    info.append(meta);
    if (item.credit) info.append(el('div', 'item-credit', `제작: ${item.credit.author}`));
    card.append(info);

    const price = eco ? eco.price(item.id) : item.price;
    const owned = eco ? eco.owns(item.id) : price === 0;
    const equipped = eco && eco.look()[item.category] === item.id;
    let btn;
    if (equipped) {
      btn = el('button', 'item-btn equipped', '장착 중');
      btn.disabled = true;
    } else if (owned) {
      btn = el('button', 'item-btn', '장착');
      btn.disabled = !eco || !eco.ready;
      btn.addEventListener('click', () => this._do(() => eco.equip(item.category, item.id), `${item.name} 장착`));
    } else {
      btn = el('button', 'item-btn buy', `${formatCoins(price)}`);
      btn.disabled = inventoryView || !eco || !eco.ready || eco.coins < price;
      btn.addEventListener('click', () => {
        if (!confirm(`${item.name}을(를) ${price.toLocaleString('ko-KR')} ${ECONOMY.currencyName}에 살까요?`)) return;
        this._do(() => eco.buy(item.id), `${item.name} 구매 완료! 보관함에서 장착할 수 있어요`);
      });
    }
    card.append(btn);
    return card;
  }

  async _do(fn, okText) {
    if (this.busy) return;
    this.busy = true;
    try {
      await fn();
      this.toast(okText, 'good');
    } catch (e) {
      this.toast(e.message || String(e), 'bad');
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

