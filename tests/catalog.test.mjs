import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, normalizeLook, defaultLook, getItem, serverCatalog, dayIndex, randomAiLook } from '../src/catalog.js';
import { ITEMS } from '../items.config.js';

test('items.config.js에 오류가 없음', () => {
  assert.deepEqual(validateConfig(), []);
});

test('켜진 스킨의 VRM 파일과 썸네일이 실제로 있음', () => {
  for (const it of ITEMS) {
    if (it.category !== 'skin' || it.enabled === false) continue;
    if (it.file) assert.ok(fs.existsSync(new URL(`../${it.file}`, import.meta.url)), `${it.file} 없음`);
    if (it.thumbnail) assert.ok(fs.existsSync(new URL(`../${it.thumbnail}`, import.meta.url)), `${it.thumbnail} 없음`);
  }
});

test('장착 정보 정리: 없는/꺼진/다른 칸 아이템은 기본으로', () => {
  const look = normalizeLook({ skin: 'skin_odette', tile: 'fx_win_basic', effectCorrect: 'nope' });
  assert.deepEqual(look, defaultLook());
  assert.equal(normalizeLook({ skin: 'skin_shinku' }).skin, 'skin_shinku');
  assert.equal(getItem(randomAiLook().skin).category, 'skin');
});

test('서버용 카탈로그에는 꺼진 아이템이 없음', () => {
  const { items, economy } = serverCatalog();
  assert.equal(items.skin_odette, undefined);
  assert.equal(items.skin_shinku.price, getItem('skin_shinku').price);
  assert.equal(economy.dayOffsetMs, 9 * 3600000);
});

test('하루 계산: 한국 시간 자정 기준', () => {
  const off = 9 * 3600000;
  const kstMidnight = Date.UTC(2026, 9, 28, 15, 0, 0); // 10/29 00:00 KST
  assert.equal(dayIndex(kstMidnight - 1, off) + 1, dayIndex(kstMidnight, off));
});

test('database.rules.json이 tools/build-rules.mjs 결과와 같음 (규칙을 고쳤다면 npm run rules)', async () => {
  const before = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [new URL('../tools/build-rules.mjs', import.meta.url).pathname]);
  const after = fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
  assert.equal(after, before);
});
