import type { ReactNode } from 'react';

export function AppShell({ children }: { readonly children: ReactNode }) {
  return <div className="app-shell">
    {children}
    <footer className="app-version" aria-label={`App version v${__APP_VERSION__}`}>
      v{__APP_VERSION__}
    </footer>
  </div>;
}
