import type { TargetSymbol as SymbolName } from '@robot-puzzle/game-engine';

/** Shared vector artwork, centered inside a single board cell. */
export function TargetSymbol({ symbol }: { readonly symbol: SymbolName }) {
  return (
    <svg
      aria-hidden="true"
      className="target-symbol"
      data-symbol={symbol}
      focusable="false"
      height={0.68}
      viewBox="0 0 100 100"
      width={0.68}
      x={-0.34}
      y={-0.34}
    >
      {symbol === 'star' && (
        <polygon points="50,3 61,35 96,35 68,56 79,91 50,70 21,91 32,56 4,35 39,35" />
      )}
      {symbol === 'crescent' && (
        <path d="M67 6 A45 45 0 1 0 92 74 A40 40 0 0 1 67 6Z" />
      )}
      {symbol === 'triangle' && <polygon points="50,8 94,88 6,88" />}
      {symbol === 'square' && <rect height={72} rx={6} width={72} x={14} y={14} />}
      {symbol === 'vortex' && (
        <path
          d="M50 50 C50 41 63 41 63 52 C63 70 37 72 31 55 C21 27 58 11 78 31 C101 60 71 103 34 88 C3 75 1 45 15 23"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth={9}
        />
      )}
    </svg>
  );
}
