<script lang="ts">
let luminEl: HTMLElement | null = null;
let luminReady: Promise<void> | null = null;
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

const LUMIN_SRC = 'https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js';

type LuminApi = {
  init: (config: Record<string, unknown>) => Promise<void>;
  endGame: () => void;
  destroy: () => void;
};

const win = window as unknown as { Lumin?: LuminApi };

const SHADOW_CSS = `
:host {
  font-family: inherit;
  background: transparent;
  border-radius: 0;
}
.lumin-root {
  padding: 0;
}
.lumin-header {
  margin-bottom: 14px;
}
.lumin-search {
  height: 48px;
  padding: 0 18px;
  border-radius: 14px;
  font-family: inherit;
  font-size: 16px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.lumin-search:focus {
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--sg-accent) 28%, transparent),
    0 6px 16px rgba(0, 0, 0, 0.22);
}
.lumin-btn {
  height: 48px;
  padding: 0 20px;
  border-radius: 12px;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
}
.lumin-cat {
  font-family: inherit;
}
.lumin-cat:hover:not(.active) {
  background: var(--sg-surface-hover);
  border-color: var(--sg-surface-hover);
}
.lumin-grid {
  gap: 12px;
}
.lumin-card {
  border: 2px solid var(--sg-border);
  border-radius: 12px;
  content-visibility: auto;
  contain-intrinsic-size: auto 150px;
  transition: transform 0.16s ease-out, border-color 0.16s ease-out;
}
.lumin-card:hover,
.lumin-card:focus-visible {
  transform: translateY(-3px) scale(1.03);
  border-color: var(--sg-accent);
  box-shadow: 0 10px 22px var(--sg-shadow-strong);
  outline: none;
}
.lumin-card-overlay {
  background: linear-gradient(to top, rgb(8 6 22 / 90%) 0%, rgb(8 6 22 / 0%) 60%);
}
.lumin-card-title {
  font-size: 12px;
}
.lumin-skeleton {
  border-radius: 12px;
}
.lumin-page-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-family: inherit;
}
.lumin-page-btn:hover:not(.active):not(:disabled) {
  background: var(--sg-surface-hover);
  border-color: var(--sg-surface-hover);
}
@media (prefers-reduced-motion: reduce) {
  .lumin-card { transition: none; }
  .lumin-card:hover, .lumin-card:focus-visible { transform: none; }
}
`;

const slot = ref<HTMLElement | null>(null);
const error = ref('');

function loadLumin() {
  if (win.Lumin) return Promise.resolve(win.Lumin);
  return new Promise<LuminApi>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>('script[data-lumin]');
    if (!script) {
      script = document.createElement('script');
      script.src = LUMIN_SRC;
      script.async = true;
      script.dataset.lumin = '';
      document.head.appendChild(script);
    }
    script.addEventListener('load', () => (win.Lumin ? resolve(win.Lumin) : reject(new Error('no Lumin'))));
    script.addEventListener('error', () => reject(new Error('script failed')));
  });
}

function themeShadow(el: HTMLElement) {
  const root = el.shadowRoot;
  if (!root || root.querySelector('style[data-sg]')) return;
  const style = document.createElement('style');
  style.dataset.sg = '';
  style.textContent = SHADOW_CSS;
  root.appendChild(style);
}

function startLumin(el: HTMLElement) {
  return loadLumin()
    .then((lumin) =>
      lumin.init({
        container: el,
        theme: 'dark',
        columns: 8,
        rows: 4,
        gamesPerPage: 10000,
        onError: (err: Error) => console.error('lumin:', err),
      }),
    )
    .then(() => themeShadow(el));
}

onMounted(() => {
  if (!luminEl) {
    luminEl = document.createElement('div');
    luminEl.className = 'sg-lumin-host';
  }
  slot.value?.appendChild(luminEl);
  if (!luminReady) {
    const el = luminEl;
    luminReady = startLumin(el).catch((err) => {
      console.error(err);
      luminEl = null;
      luminReady = null;
      error.value = "Games couldn't load right now. Try refreshing.";
    });
  }
});

onUnmounted(() => {
  try {
    win.Lumin?.endGame();
  } catch {}
  luminEl?.remove();
});
</script>

<template>
  <div class="gamesPage">
    <p v-if="error" class="gamesError">{{ error }}</p>
    <div ref="slot"></div>
  </div>
</template>

<style scoped>
.gamesPage {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 20px clamp(12px, 3vw, 32px) 32px;
  animation: fadeIn 200ms ease-out both;
}


.gamesError {
  color: var(--sg-text-muted);
  text-align: center;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gamesPage {
    animation: none;
  }
}
</style>

<style>
.sg-lumin-host {
  --lumin-bg: transparent !important;
  --lumin-surface: var(--sg-surface) !important;
  --lumin-surface-hover: var(--sg-surface-hover) !important;
  --lumin-border: var(--sg-border) !important;
  --lumin-text: var(--sg-text) !important;
  --lumin-text-secondary: var(--sg-text-muted) !important;
  --lumin-accent: var(--sg-accent) !important;
  --lumin-accent-hover: color-mix(in srgb, var(--sg-accent) 80%, white) !important;
  --lumin-input-bg: var(--sg-surface-raised) !important;
  --lumin-input-border: var(--sg-border) !important;
  --lumin-card-shadow: 0 6px 16px var(--sg-shadow-soft) !important;
  --lumin-skeleton: var(--sg-surface-raised) !important;
  --lumin-skeleton-shine: var(--sg-surface-hover) !important;
  max-width: 1400px;
  margin: 0 auto;
}

.lumin-player {
  background: var(--sg-page-bg) !important;
}

.lumin-player-flyout {
  background: color-mix(in srgb, var(--sg-surface) 88%, transparent) !important;
  border: 2px solid var(--sg-border) !important;
  box-shadow: 0 6px 24px var(--sg-shadow-strong) !important;
}

.lumin-player-flyout-label {
  color: var(--sg-text-soft) !important;
  font-family: inherit !important;
}

.lumin-player-close {
  background: var(--sg-accent) !important;
  color: var(--sg-text) !important;
}

.lumin-player-close:hover {
  background: #d9466b !important;
}
</style>
