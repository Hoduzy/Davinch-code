// items.config.js(사람이 고치는 설정)를 게임 코드가 쓰기 쉽게 감싼 모듈
import { ITEMS, ECONOMY, RARITY, AI_SKINS } from '../items.config.js';

export { ECONOMY, RARITY };

/** 장착 칸 = 아이템 카테고리 */
export const SLOTS = ['skin', 'tile', 'effectCorrect', 'effectWin'];
export const SLOT_LABELS = {
  skin: '캐릭터 스킨',
  tile: '타일 디자인',
  effectCorrect: '정답 이펙트',
  effectWin: '승리 이펙트',
};

const byId = new Map(ITEMS.map((it) => [it.id, it]));

export function getItem(id) { return byId.get(id) || null; }
export function isEnabled(item) { return item && item.enabled !== false; }
export function isFree(item) { return item && item.price === 0; }

export function shopItems(category) {
  return ITEMS.filter((it) => it.category === category && isEnabled(it));
}

/** 칸마다 기본 아이템 (가격 0인 첫 아이템) */
export function defaultItem(slot) {
  return ITEMS.find((it) => it.category === slot && isFree(it) && isEnabled(it));
}

export function defaultLook() {
  const look = {};
  for (const s of SLOTS) look[s] = defaultItem(s).id;
  return look;
}

/** 저장된/받은 장착 정보를 안전한 값으로 (없거나 꺼진 아이템은 기본으로) */
export function normalizeLook(look) {
  const out = defaultLook();
  if (look) {
    for (const s of SLOTS) {
      const it = getItem(look[s]);
      if (it && it.category === s && isEnabled(it)) out[s] = it.id;
    }
  }
  return out;
}

export function randomAiLook(rng = Math.random) {
  const skins = AI_SKINS.map(getItem).filter((it) => it && it.category === 'skin' && isEnabled(it));
  const look = defaultLook();
  if (skins.length) look.skin = skins[Math.floor(rng() * skins.length)].id;
  return look;
}

/** 서버(보안 규칙)가 쓰는 값: 가격/카테고리와 재화 수치 */
export function serverCatalog() {
  const items = {};
  for (const it of ITEMS) {
    if (isEnabled(it)) items[it.id] = { price: it.price, category: it.category };
  }
  return {
    items,
    economy: {
      startCoins: ECONOMY.startCoins,
      dailyBonus: ECONOMY.dailyBonus,
      bailoutBelow: ECONOMY.bailoutBelow,
      bailoutAmount: ECONOMY.bailoutAmount,
      aiWinReward: ECONOMY.aiWinReward,
      aiDailyCap: ECONOMY.aiDailyCap,
      aiMinIntervalMs: ECONOMY.aiMinIntervalSec * 1000,
      // day = floor((서버시간 + dayOffsetMs) / 하루). 한국 시간(UTC+9) 기준, dayResetHour 시에 날짜가 바뀜
      dayOffsetMs: (9 - ECONOMY.dayResetHour) * 3600000,
    },
  };
}

export const DAY_MS = 86400000;
export function dayIndex(serverNow, dayOffsetMs) {
  return Math.floor((serverNow + dayOffsetMs) / DAY_MS);
}

/** 설정 파일 오류 찾기 (테스트와 관리자 화면에서 사용) */
export function validateConfig() {
  const errors = [];
  const ids = new Set();
  for (const it of ITEMS) {
    if (!/^[a-z0-9_]+$/.test(it.id)) errors.push(`${it.id}: id는 영문 소문자/숫자/_만`);
    if (ids.has(it.id)) errors.push(`${it.id}: id 중복`);
    ids.add(it.id);
    if (!SLOTS.includes(it.category)) errors.push(`${it.id}: category가 잘못됨`);
    if (!Number.isInteger(it.price) || it.price < 0) errors.push(`${it.id}: price는 0 이상의 정수`);
    if (!RARITY[it.rarity]) errors.push(`${it.id}: rarity가 잘못됨`);
    if (!it.name) errors.push(`${it.id}: name이 없음`);
    if (it.category === 'tile' && !(it.style && it.style.black && it.style.white)) errors.push(`${it.id}: style.black / style.white 필요`);
    if (it.category.startsWith('effect') && !(it.effect && it.effect.type)) errors.push(`${it.id}: effect.type 필요`);
  }
  for (const s of SLOTS) if (!defaultItem(s)) errors.push(`${s}: 가격 0인 기본 아이템이 하나는 있어야 함`);
  for (const id of AI_SKINS) if (!getItem(id)) errors.push(`AI_SKINS: ${id} 없음`);
  return errors;
}
