import { afterEach, expect, test, vi } from 'vitest';
import { registerStaticWorker } from './registerStaticWorker';

afterEach(() => { vi.unstubAllGlobals(); });

function setup(existing?: object, readyState = 'complete') {
  const register = vi.fn().mockResolvedValue({});
  const getRegistration = vi.fn().mockResolvedValue(existing);
  const addEventListener = vi.fn();
  vi.stubGlobal('window', { isSecureContext: true, addEventListener });
  vi.stubGlobal('navigator', { serviceWorker: { register, getRegistration } });
  vi.stubGlobal('document', { readyState });
  vi.stubGlobal('location', { origin: 'https://game.example' });
  return { register, getRegistration, addEventListener };
}

test('registers only its stable root script with uncached update checks', async () => {
  const f = setup(); registerStaticWorker();
  await vi.waitFor(() => expect(f.register).toHaveBeenCalledWith('https://game.example/robot-puzzle-sw.js',
    { scope: '/', updateViaCache: 'none' }));
});
test('waits for load without blocking application rendering', async () => {
  const f = setup(undefined, 'loading'); registerStaticWorker();
  expect(f.register).not.toHaveBeenCalled();
  expect(f.addEventListener).toHaveBeenCalledWith('load', expect.any(Function), { once: true });
  f.addEventListener.mock.calls[0][1]();
  await vi.waitFor(() => expect(f.register).toHaveBeenCalledOnce());
});
test('leaves other root registrations untouched', async () => {
  const f = setup({ active: { scriptURL: 'https://game.example/another-app.js' } }); registerStaticWorker();
  await vi.waitFor(() => expect(f.getRegistration).toHaveBeenCalledOnce());
  expect(f.register).not.toHaveBeenCalled();
});
test('unsupported/insecure contexts remain usable without registration', () => {
  const f = setup(); vi.stubGlobal('window', { isSecureContext: false }); registerStaticWorker();
  expect(f.getRegistration).not.toHaveBeenCalled();
  vi.stubGlobal('window', { isSecureContext: true }); vi.stubGlobal('navigator', {}); registerStaticWorker();
  expect(f.register).not.toHaveBeenCalled();
});
test('registration/storage denial does not reject app startup', async () => {
  const f = setup(); f.register.mockRejectedValue(new Error('Denied')); registerStaticWorker();
  await vi.waitFor(() => expect(f.register).toHaveBeenCalledOnce());
});
