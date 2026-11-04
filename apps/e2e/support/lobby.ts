import type { Page } from '@playwright/test';
import type { PublicRoomState } from '../../../packages/shared/src';
import { expect } from './fixtures';

/** Observe public snapshots only; never retain binding replies, headers or cookies. */
export function observeRooms(page: Page): () => PublicRoomState | undefined {
  let room: PublicRoomState | undefined;
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(typeof payload === 'string' ? payload : payload.toString());
        if (message.type === 'room.snapshot') room = message.state;
      } catch { /* Non-JSON frames are not room observations. */ }
    });
  });
  return () => room;
}

export async function createRoom(page: Page, nickname = 'Maria'): Promise<string> {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'YOUR NICKNAME' }).fill(nickname);
  await page.getByRole('button', { name: 'Create Room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shuffle Board', exact: true })).toBeEnabled();
  const button = page.getByRole('button', { name: /^Copy room code / });
  const code = (await button.innerText()).trim();
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  return code;
}

export async function renderedBoard(page: Page): Promise<string[]> {
  return page.locator('.game-board__walls, .game-board__blocked-cell, .game-board__targets, .game-board__robots')
    .evaluateAll((nodes) => nodes.map((node) => node.outerHTML));
}
