import { ui } from '../store/state';

/** Imperative business workflows request a React render through this tiny bridge. */
let listener: (() => void) | null = null;
export function registerRenderListener(callback: (() => void) | null) { listener = callback; }
export function renderApp() { listener?.(); }
export function navigateTo(tab: string) { ui.currentTab = tab; renderApp(); }
