import { test, expect } from '../support/fixtures';
import { createRoom, observeRooms, renderedBoard } from '../support/lobby';
import { MAX_NICKNAME_CODE_POINTS } from '../../../packages/shared/src/clientRequests';

test('entry reports nickname/code validation and an unknown valid room code inline', async ({ page }) => {
  await page.goto('/room/not-a-code');
  const nickname = page.getByRole('textbox', { name: 'YOUR NICKNAME' });
  const code = page.getByRole('textbox', { name: 'ROOM CODE', exact: true });
  const create = page.getByRole('button', { name: 'Create Room', exact: true });
  const join = page.getByRole('button', { name: 'Join Room', exact: true });
  await expect(page.getByRole('alert')).toHaveText('Enter a valid six-character room code.');
  await nickname.fill('   '); await nickname.blur();
  await expect(page.getByText(`Enter a nickname of 1–${MAX_NICKNAME_CODE_POINTS} characters.`, { exact: true })).toBeVisible();
  await expect(create).toBeDisabled(); await expect(join).toBeDisabled();
  await nickname.fill('x'.repeat(MAX_NICKNAME_CODE_POINTS + 1)); await nickname.blur();
  await expect(create).toBeDisabled();
  await nickname.fill('x'.repeat(MAX_NICKNAME_CODE_POINTS)); await expect(create).toBeEnabled();
  await nickname.fill('Alex');
  await code.fill('abc!'); await code.blur(); await expect(join).toBeDisabled();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await code.fill(' aaaaaa '); await expect(code).toHaveValue('AAAAAA');
  await expect(join).toBeEnabled(); await join.click();
  await expect(page.getByRole('alert')).toHaveText('Room not found. Check the room code and try again.');
  await expect(page.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
  await expect(nickname).toBeEnabled(); await expect(create).toBeEnabled();
});

test('manual code join shares lobby, clipboard and shuffle; Start locks new identities but refresh preserves seats', async ({ page, guestPage, context, browser, baseURL }) => {
  const hostRoom = observeRooms(page); const guestRoom = observeRooms(guestPage);
  const code = await createRoom(page, '  Maria  ');
  await expect(page.getByRole('button', { name: 'Start Match', exact: true })).toBeDisabled();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await page.bringToFront();
  await page.getByRole('button', { name: `Copy room code ${code}`, exact: true }).click();
  await expect(page.getByText('Room code copied.', { exact: true })).toBeAttached();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await guestPage.goto('/');
  await guestPage.getByRole('textbox', { name: 'YOUR NICKNAME' }).fill('Alex');
  await guestPage.getByRole('textbox', { name: 'ROOM CODE', exact: true }).fill(` ${code.toLowerCase()} `);
  await expect(guestPage.getByRole('textbox', { name: 'ROOM CODE', exact: true })).toHaveValue(code);
  await guestPage.getByRole('button', { name: 'Join Room', exact: true }).click();
  for (const player of [page, guestPage]) {
    await expect(player.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
    await expect(player.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible();
    const roster = player.getByRole('region', { name: 'Players', exact: true });
    await expect(roster.getByRole('listitem')).toHaveCount(2);
    await expect(roster.getByRole('listitem').filter({ hasText: 'Maria' })).toContainText('Host');
    await expect(roster.getByRole('listitem').filter({ hasText: player === page ? 'Maria' : 'Alex' })).toContainText('You');
    await expect(roster.getByText('You', { exact: true })).toHaveCount(1);
    await expect(roster.getByText('Host', { exact: true })).toHaveCount(1);
  }
  await expect(guestPage.getByRole('button', { name: 'Shuffle Board', exact: true })).toHaveCount(0);
  await expect(guestPage.getByRole('button', { name: 'Start Match', exact: true })).toHaveCount(0);
  await expect(guestPage.getByText('Waiting for Maria to start the match.', { exact: true })).toBeVisible();
  await expect.poll(() => guestRoom()?.roomId).toBe(hostRoom()!.roomId);
  const seats = hostRoom()!.players.map((player) => player.seatId);
  await expect.poll(() => guestRoom()?.players.map((player) => player.seatId)).toEqual(seats);
  await expect.poll(() => renderedBoard(guestPage)).toEqual(await renderedBoard(page));
  const boardName = page.locator('.lobby-header__board');
  const originalName = await boardName.innerText();
  await page.getByRole('button', { name: 'Shuffle Board', exact: true }).click();
  await expect(boardName).not.toHaveText(originalName);
  const shuffledName = await boardName.innerText();
  await expect(guestPage.locator('.lobby-header__board')).toHaveText(shuffledName);
  await expect.poll(() => renderedBoard(guestPage)).toEqual(await renderedBoard(page));
  await expect(page.getByRole('button', { name: 'Start Match', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Start Match', exact: true }).click();
  for (const player of [page, guestPage]) {
    await expect(player.getByRole('heading', { name: 'Match setup', exact: true })).toHaveCount(0);
    await expect(player.locator('.active-match-header')).toBeVisible();
    await expect(player.locator('.active-match-header__round')).toHaveText('ROUND 1 / 10');
  }
  await expect.poll(() => hostRoom()?.status).toBe('playing');
  const active = hostRoom()!;
  if (active.status !== 'playing') throw new Error('Expected started match');
  const matchId = active.match.matchId;
  await expect.poll(() => { const room = guestRoom(); return room?.status === 'playing' ? room.match.matchId : null; }).toBe(matchId);
  const outsider = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  try {
    const outsiderPage = await outsider.newPage();
    await outsiderPage.goto(`/room/${code}`);
    await outsiderPage.getByRole('textbox', { name: 'YOUR NICKNAME' }).fill('Late player');
    await outsiderPage.getByRole('button', { name: 'Join Room', exact: true }).click();
    await expect(outsiderPage.getByRole('alert')).toHaveText('The match has already started.');
    await expect(outsiderPage.getByRole('heading', { name: 'Robot Puzzle', exact: true })).toBeVisible();
  } finally { await outsider.close(); }
  for (const player of [guestPage, page]) {
    await player.reload();
    await expect(player.locator('.active-match-header')).toBeVisible();
    await expect(player.getByRole('status').filter({ hasText: /^2 online$/ })).toBeVisible();
    await expect(player.getByRole('button', { name: `Copy room code ${code}`, exact: true })).toBeVisible();
    await expect(player.locator('.lobby-roster__row--current, .player-bids__row--current'))
      .toHaveAttribute('data-seat-id', player === page ? seats[0] : seats[1]);
  }
  for (const observation of [hostRoom, guestRoom]) {
    await expect.poll(() => { const room = observation(); return room?.status === 'playing' ? room.match.matchId : null; }).toBe(matchId);
    await expect.poll(() => observation()?.players.map((player) => player.seatId)).toEqual(seats);
    expect(observation()!.hostSeatId).toBe(seats[0]);
    expect(observation()!.puzzle.name).toBe(shuffledName);
  }
});

test('invite link prefills code and joins the same lobby after nickname entry', async ({ page, guestPage }) => {
  const code = await createRoom(page);
  await guestPage.goto(`/room/${code.toLowerCase()}`);
  await expect(guestPage.getByRole('textbox', { name: 'ROOM CODE', exact: true })).toHaveValue(code);
  const join = guestPage.getByRole('button', { name: 'Join Room', exact: true });
  await expect(join).toBeDisabled();
  await guestPage.getByRole('textbox', { name: 'YOUR NICKNAME' }).fill('Invited Alex');
  await expect(join).toBeEnabled(); await join.click();
  for (const player of [page, guestPage]) {
    await expect(player.getByRole('heading', { name: 'Match setup', exact: true })).toBeVisible();
    await expect(player.getByRole('region', { name: 'Players', exact: true }).getByRole('listitem')).toHaveCount(2);
    await expect(player.getByRole('button', { name: `Copy room code ${code}`, exact: true })).toBeVisible();
  }
});
