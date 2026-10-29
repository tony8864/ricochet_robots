import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomEntry } from './components/RoomEntry';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && new URLSearchParams(location.search).get('preview') === 'local') {
  // Setup is outside the match lifecycle; opening it performs no target search.
  void import('./components/SetupPreview').then(({ SetupPreview }) => {
    root.render(<StrictMode><SetupPreview /></StrictMode>);
  }).catch(() => {
    root.render(<main className="board-preview">The board preview could not load. Check the development setup.</main>);
  });
} else {
  root.render(<StrictMode><RoomEntry pathname={location.pathname} showSimulator={import.meta.env.DEV} /></StrictMode>);
}
