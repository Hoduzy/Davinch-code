// 그 판에 필요한 캐릭터 스킨만 받아서 캐릭터를 만듦 (로딩 화면 표시)
import { preloadSkins, createCharacter } from './characters.js';
import { getItem } from './catalog.js';

const AVATAR_COLORS = [0x90a4ae, 0xe57373, 0x64b5f6, 0x81c784];
const $ = (id) => document.getElementById(id);

function showLoading(title, ratio, text) {
  $('loading').hidden = false;
  $('loading-title').textContent = title;
  $('loading-bar').style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
  $('loading-text').textContent = text || '';
}

export function hideLoading() {
  $('loading').hidden = true;
}

/**
 * @param {object[]} looks 플레이어 번호별 장착 정보
 * @param {number} mySeat 내 자리 (1인칭이라 내 캐릭터는 만들지 않음)
 * @returns {Promise<object[]>} 플레이어 번호별 캐릭터
 */
export async function loadCharacters(looks, mySeat) {
  const n = looks.length;
  const skins = looks.map((l, i) => (i === mySeat || !l ? null : l.skin));
  const needFiles = skins.some((id) => id && getItem(id) && getItem(id).file);
  try {
    if (needFiles) {
      await preloadSkins(skins.filter(Boolean), (loaded, total) => {
        const mb = (x) => (x / 1e6).toFixed(1);
        showLoading('캐릭터 불러오는 중…', total ? loaded / total : 0, `${mb(loaded)} / ${mb(total)} MB`);
      });
      showLoading('캐릭터 준비 중…', 1, '');
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      out[i] = i === mySeat || !skins[i] ? null : await createCharacter(skins[i], AVATAR_COLORS[(i - mySeat + n) % n]);
    }
    return out;
  } finally {
    hideLoading();
  }
}
