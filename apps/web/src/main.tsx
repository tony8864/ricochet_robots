import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV) {
  // Setup is outside the match lifecycle; opening it performs no target search.
  void import('./components/SetupPreview').then(({ SetupPreview }) => {
    root.render(<StrictMode><SetupPreview /></StrictMode>);
  }).catch(() => {
    root.render(<main className="board-preview">The board preview could not load. Check the development setup.</main>);
  });
} else {
  root.render(<main className="board-preview">Local match prototype. Run the development server to use the temporary player simulation.</main>);
}
