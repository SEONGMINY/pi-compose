import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { focusGhosttyTerminal, listGhosttyTerminals } from '../src/ghostty-native.ts';

/**
 * Temporary native Ghostty terminal navigator.
 * The real product Overview will consume the same native terminal inventory,
 * enriched by explicitly recorded Agent relationships (never by cwd guessing).
 */
export async function showGhosttySurfaces(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify('Ghostty terminal navigation requires an interactive TUI.', 'warning');
    return;
  }
  try {
    const terminals = await listGhosttyTerminals();
    if (terminals.length === 0) {
      ctx.ui.notify('No Ghostty terminals were returned.', 'warning');
      return;
    }
    const labels = terminals.map((term, index) =>
      (index + 1) + '. ' + (term.name || 'Terminal').replace(/\s+/g, ' ').slice(0, 45) +
      ' [' + term.id.slice(0, 8) + '] ' + (term.cwd || 'working directory unavailable').slice(0, 60)
    );
    const selected = await ctx.ui.select('Ghostty terminals (exact native IDs)', labels);
    if (!selected) return;
    const terminal = terminals[labels.indexOf(selected)];
    if (!terminal) return;

    // Ghostty itself owns Tab movement and focus. We never recreate a Pi process.
    await focusGhosttyTerminal(terminal.id);
  } catch (error) {
    ctx.ui.notify('Cannot focus the Ghostty terminal: ' + String(error), 'error');
  }
}
