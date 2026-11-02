import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { RoomCodeControl } from './RoomCode';
import type { RoomCodeCopyState } from '../lobby/copyRoomCode';

const render = (state: RoomCodeCopyState) => renderToStaticMarkup(<RoomCodeControl code="4FQRXS" state={state} onCopy={() => {}} />);

test('compact code hides the visual label without losing copy accessibility or feedback', () => {
  const markup = renderToStaticMarkup(<RoomCodeControl code="4FQRXS" compact state="copied" onCopy={() => {}} />);
  expect(markup).toContain('room-code--compact');
  expect(markup).not.toContain('ROOM CODE');
  expect(markup).toContain('aria-label="Copy room code 4FQRXS"');
  expect(markup).toContain('4FQRXS</strong>');
  expect(markup).toContain('m5 12 4 4L19 6');
  expect(markup).toContain('Room code copied.');
});

test('the code and trailing icon share one full clickable button below the label', () => {
  const markup = render('idle');
  expect(markup.match(/<button\b/g)).toHaveLength(1);
  const button = markup.match(/<button\b[^>]*>.*?<\/button>/)![0];
  expect(button).toContain('class="room-code__button"');
  expect(button).toContain('aria-label="Copy room code 4FQRXS"');
  expect(button).toContain('4FQRXS</strong>');
  expect(button).toContain('width="16" height="16"');
  expect(button.indexOf('4FQRXS</strong>')).toBeLessThan(button.indexOf('<svg'));
  expect(markup.indexOf('ROOM CODE')).toBeLessThan(markup.indexOf('<button'));
  expect(button).not.toContain('>Copy<');
  expect(markup).not.toContain('room-code__row');
});

test('success keeps the code and replaces only the icon with a checkmark', () => {
  const markup = render('copied');
  expect(markup).toContain('4FQRXS</strong>');
  expect(markup).toContain('m5 12 4 4L19 6');
  expect(markup).not.toContain('<rect');
  expect(markup).toContain('class="room-code__announcement" role="status">Room code copied.');
  expect(markup).not.toContain('class="room-code__feedback"');
});

test('pending writes are disabled and failed copies have only conditional inline feedback', () => {
  expect(render('copying')).toContain('disabled=""');
  expect(render('copying')).toContain('aria-busy="true"');
  expect(render('failed')).toContain('Couldn’t copy.');
  expect(render('failed')).not.toContain('m5 12 4 4L19 6');
  expect(render('idle')).not.toContain('Couldn’t copy.');
});
