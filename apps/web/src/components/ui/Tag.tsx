import { STATE_STATUS_TOKENS, type StateStatusToken } from '../../styles/tokens';
import { cn } from './cn';

/** A state or status token name (docs/11), without the leading dashes. */
export type TokenName = StateStatusToken;

export type TagProps = {
  /** The text. Always from props or API data; never from a list in this component. */
  label: string;
  /** Token that colours the dot and border. Omit for a neutral tag. */
  token?: TokenName;
  /** Hollow dot, used for "unknown" so it is not just a different colour. */
  hollow?: boolean;
  className?: string;
};

/** Pill with a coloured dot and always a text label (never colour alone). */
export function Tag({ label, token, hollow, className }: TagProps) {
  if (token !== undefined && !STATE_STATUS_TOKENS.includes(token)) {
    throw new Error(`Tag: "${token}" is not a token name`);
  }
  const color = token ? `var(--${token})` : 'var(--border-strong)';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border bg-surface px-3 py-1 text-xs font-medium text-fg',
        className,
      )}
      style={{ borderColor: color }}
    >
      <span
        aria-hidden="true"
        className="inline-block size-2.5 rounded-full border-2"
        style={{ borderColor: color, background: hollow ? 'transparent' : color }}
      />
      {label}
    </span>
  );
}
