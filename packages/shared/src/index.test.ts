import { expect, test } from 'vitest';
import * as shared from './index';

test('the shared entry point imports without runtime-specific globals', () => {
  expect(Object.keys(shared).sort()).toEqual([
    'MAX_BOARD_ID_LENGTH', 'MAX_CLIENT_MESSAGE_BYTES', 'MAX_NICKNAME_BYTES',
    'MAX_NICKNAME_CODE_POINTS', 'MAX_RAW_NICKNAME_BYTES', 'MAX_RAW_ROOM_CODE_LENGTH',
    'PROTOCOL_VERSION', 'ROOM_CODE_LENGTH', 'parseClientRequest', 'parseClientRequestJson',
    'MAX_SERVER_MESSAGE_BYTES', 'parsePublicRoomState', 'projectLobbyState', 'projectMatchState',
    'PUBLIC_NO_OP_REASONS', 'PUBLIC_REJECTION_REASONS', 'BOOTSTRAP_REJECTION_REASONS', 'PROTOCOL_ERROR_REASONS',
    'parseServerMessage', 'parseServerMessageJson', 'parsePublicServerMessage',
  ].sort());
});
