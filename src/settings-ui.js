// 설정 화면: 내 계정, 크레딧, 관리자(상점·재화 설정 올리기)
import { ITEMS } from '../items.config.js';
import { validateConfig } from './catalog.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function link(url, text) {
  const a = el('a', '', text || url);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

const LIBRARIES = [
  { name: 'three.js', license: 'MIT License', url: 'https://github.com/mrdoob/three.js/blob/dev/LICENSE' },
  { name: '@pixiv/three-vrm', license: 'MIT License', url: 'https://github.com/pixiv/three-vrm/blob/dev/LICENSE' },
  { name: 'Firebase JavaScript SDK', license: 'Apache License 2.0', url: 'https://github.com/firebase/firebase-js-sdk/blob/main/LICENSE' },
];

export class SettingsUI {
  /**
   * @param {object} opts
   * @param {() => import('./economy.js').Economy | null} opts.getEconomy
   * @param {(text: string, kind?: string) => void} opts.toast
   * @param {() => void} opts.onClose
   */
  constructor({ getEconomy, toast, onClose }) {
    this.getEconomy = getEconomy;
    this.toast = toast;
    this.page = 'main';
    $('settings-close').addEventListener('click', () => {
      if (this.page !== 'main') { this.page = 'main'; this.render(); } else onClose();
    });
  }

  open(page = 'main') {
    this.page = page;
    $('settings').hidden = false;
    this.render();
  }

  close() { $('settings').hidden = true; }

  get isOpen() { return !$('settings').hidden; }

  render() {
    if (!this.isOpen) return;
    const body = $('settings-body');
    body.replaceChildren();
    $('settings-title').textContent = this.page === 'credits' ? '크레딧' : '설정';
    $('settings-close').textContent = this.page === 'main' ? '닫기' : '뒤로';
    if (this.page === 'credits') this._credits(body);
    else this._main(body);
  }

  _main(body) {
    const eco = this.getEconomy();

    const credits = el('button', 'big wide secondary', '크레딧 (만든 사람 · 라이선스)');
    credits.addEventListener('click', () => { this.page = 'credits'; this.render(); });
    body.append(credits);

    const acc = el('section', 'set-section');
    acc.append(el('h3', '', '내 계정'));
    if (eco) {
      acc.append(el('p', '', '이 기기(브라우저)에 익명 계정으로 저장돼요. 브라우저 데이터를 지우면 코인과 보관함이 사라질 수 있어요.'));
      const id = el('code', 'uid', eco.uid);
      acc.append(el('p', 'small', '계정 ID'), id);
    } else {
      acc.append(el('p', '', '온라인(Firebase)에 연결되지 않아 계정 기능을 쓸 수 없어요.'));
    }
    body.append(acc);

    if (eco) {
      const admin = el('section', 'set-section');
      admin.append(el('h3', '', '관리자'));
      admin.append(el('p', 'small', '불러오는 중…'));
      body.append(admin);
      this._admin(admin, eco).catch((e) => { admin.lastChild.textContent = e.message; });
    }
  }

  async _admin(box, eco) {
    const st = await eco.adminState();
    box.lastChild.remove();
    if (!st.exists) {
      box.append(el('p', '', '아직 관리자가 없어요. 게임 주인이라면 먼저 관리자로 등록하세요. (처음 한 명만 가능)'));
      const b = el('button', 'big wide', '내 계정을 관리자로 등록');
      b.addEventListener('click', async () => {
        try { await eco.claimAdmin(); this.toast('관리자로 등록했어요', 'good'); } catch (e) { this.toast(e.message, 'bad'); }
        this.render();
      });
      box.append(b);
      return;
    }
    if (!st.me) {
      box.append(el('p', 'small', '관리자만 상점·재화 설정을 바꿀 수 있어요.'));
      return;
    }
    const errors = validateConfig();
    if (errors.length) {
      box.append(el('p', 'error', `items.config.js 오류: ${errors.join(' / ')}`));
      return;
    }
    const status = await eco.catalogStatus();
    const text = {
      same: '서버 설정이 items.config.js와 같아요.',
      different: 'items.config.js가 바뀌었어요. 서버에 올려야 새 가격·보상이 적용돼요.',
      missing: '아직 서버에 설정이 없어요. 올려야 코인·상점이 동작해요.',
    }[status];
    box.append(el('p', status === 'same' ? 'small' : 'warn', text));
    const b = el('button', 'big wide', '상점·재화 설정 서버에 올리기');
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await eco.syncCatalog();
        this.toast('설정을 올렸어요', 'good');
      } catch (e) {
        this.toast(e.message, 'bad');
      }
      this.render();
    });
    box.append(b);
  }

  _credits(body) {
    const game = el('section', 'set-section');
    game.append(el('h3', '', '다빈치 코드 3D'));
    game.append(el('p', '', '보드게임 "다빈치 코드(Algo)"를 바탕으로 만든 팬 게임입니다.'));
    body.append(game);

    const skins = el('section', 'set-section');
    skins.append(el('h3', '', '캐릭터 모델'));
    for (const it of ITEMS) {
      if (it.category !== 'skin' || it.enabled === false || !it.credit) continue;
      const row = el('div', 'credit-row');
      row.append(el('div', 'credit-name', it.name));
      row.append(el('div', '', `제작: ${it.credit.author}`));
      if (it.credit.license) row.append(el('div', 'small', it.credit.license));
      if (it.credit.note) row.append(el('div', 'small', it.credit.note));
      if (it.credit.url) row.append(link(it.credit.url, '라이선스 보기'));
      skins.append(row);
    }
    body.append(skins);

    const libs = el('section', 'set-section');
    libs.append(el('h3', '', '사용한 라이브러리'));
    for (const l of LIBRARIES) {
      const row = el('div', 'credit-row');
      row.append(el('div', 'credit-name', l.name), el('div', 'small', l.license), link(l.url, '라이선스 보기'));
      libs.append(row);
    }
    body.append(libs);
  }
}
