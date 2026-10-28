// 에뮬레이터 테스트 공용 도우미
import * as app from 'firebase/app';
import * as auth from 'firebase/auth';
import * as database from 'firebase/database';
import { connectFirebase } from '../src/net/firebase.js';

export const PROJECT = process.env.GCLOUD_PROJECT || 'demo-davinci';
const CONFIG = { apiKey: 'demo-key', projectId: PROJECT, databaseURL: `http://127.0.0.1:9000?ns=${PROJECT}` };
const EMU = { dbHost: '127.0.0.1', dbPort: 9000, authUrl: 'http://127.0.0.1:9099' };
let n = 0;

export function client() {
  return connectFirebase(CONFIG, { app, auth, database }, { emulator: EMU, appName: `c${n++}`, persistence: 'memory' });
}

export const TEST_ECONOMY = {
  startCoins: 150, dailyBonus: 20, bailoutBelow: 100, bailoutAmount: 50,
  aiWinReward: 10, aiDailyCap: 2, aiMinIntervalMs: 1000, dayOffsetMs: 9 * 3600000,
};
export const TEST_SHOP = {
  skin_basic: { price: 0, category: 'skin' },
  skin_shinku: { price: 100, category: 'skin' },
  tile_classic: { price: 0, category: 'tile' },
  tile_jade: { price: 30, category: 'tile' },
  fx_correct_basic: { price: 0, category: 'effectCorrect' },
  fx_win_basic: { price: 0, category: 'effectWin' },
};

/** 에뮬레이터를 비우고 관리자 등록 + 테스트용 가격/보상 설정 */
export async function resetWithConfig() {
  await fetch(`http://127.0.0.1:9000/.json?ns=${PROJECT}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  const admin = await client();
  await admin.set(`admins/${admin.uid}`, true);
  await admin.update('', { 'config/economy': TEST_ECONOMY, 'shop/items': TEST_SHOP });
  return admin;
}
