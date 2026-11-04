import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomEntry } from './components/RoomEntry';
import { AppShell } from './components/AppShell';
import './styles.css';
import { registerStaticWorker } from './pwa/registerStaticWorker';

if (import.meta.env.PROD) registerStaticWorker();

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === 'local') {
  // Setup is outside the match lifecycle; opening it performs no target search.
  void import('./components/SetupPreview').then(({ SetupPreview }) => {
    root.render(<StrictMode><AppShell><SetupPreview /></AppShell></StrictMode>);
  }).catch(() => {
    root.render(<AppShell><main className="board-preview">The board preview could not load. Check the development setup.</main></AppShell>);
  });
} else {
  root.render(<StrictMode><AppShell><RoomEntry pathname={location.pathname} showSimulator={import.meta.env.DEV} /></AppShell></StrictMode>);
}
