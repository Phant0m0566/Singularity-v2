<script lang="ts">
type LuminGame = {
  id: string | number;
  name?: string;
  title?: string;
  image_token?: string;
};

type LuminApi = {
  init: (config: Record<string, unknown>) => Promise<void>;
  getGames: (opts: {
    page: number;
    limit: number;
    q?: string;
  }) => Promise<{ games?: LuminGame[]; total?: number } | LuminGame[]>;
  getImageUrl: (token: string) => Promise<string>;
  getGameUrl: (id: string | number) => Promise<{ url: string } | string>;
};

const LUMIN_SRC = 'https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js';

function loadLumin() {
  const win = window as unknown as { Lumin?: LuminApi };
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

let luminReady: Promise<LuminApi> | null = null;

function getLumin() {
  if (luminReady) return luminReady;
  luminReady = (async () => {
    const lumin = await loadLumin();
    await lumin.init({ headless: true });
    return lumin;
  })();
  luminReady.catch(() => {
    luminReady = null;
  });
  return luminReady;
}
</script>

<script setup lang="ts">
import { ArrowLeft, Expand, RotateCw } from '@lucide/vue';
import { nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { getController, type ScramFrame } from '../scram';

const query = ref('');
const games = ref<LuminGame[]>([]);
const total = ref(0);
const status = ref<'loading' | 'ready' | 'error'>('loading');
const error = ref('');
const covers = reactive<Record<string, string>>({});
const scroller = ref<HTMLElement | null>(null);
const grid = ref<HTMLElement | null>(null);

const playing = ref<{ key: number; name: string } | null>(null);
const playerStatus = ref<'starting' | 'playing' | 'error'>('starting');
const playerError = ref('');
const iframe = ref<HTMLIFrameElement | null>(null);
let frame: ScramFrame | null = null;
let playKey = 0;

const byId = new Map<string, LuminGame>();
const pending = new Set<string>();
let observer: IntersectionObserver | null = null;
let loadSeq = 0;
let timer: number | undefined;

function gameName(g: LuminGame) {
  return String(g.name ?? g.title ?? g.id);
}

async function loadCover(game: LuminGame) {
  const id = String(game.id);
  if (covers[id] || pending.has(id) || !game.image_token) return;
  pending.add(id);
  try {
    const lumin = await getLumin();
    covers[id] = await lumin.getImageUrl(game.image_token);
  } catch {
  } finally {
    pending.delete(id);
  }
}

function watchCards() {
  observer?.disconnect();
  observer = null;
  const root = grid.value;
  if (!root) return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        const game = byId.get((entry.target as HTMLElement).dataset.id || '');
        if (game) void loadCover(game);
      }
    },
    { root: scroller.value, rootMargin: '400px' },
  );
  root.querySelectorAll('.gameCard').forEach((el) => observer?.observe(el));
}

async function load() {
  const seq = ++loadSeq;
  if (!games.value.length) status.value = 'loading';
  try {
    const lumin = await getLumin();
    const q = query.value.trim();
    const res = await lumin.getGames({ page: 1, limit: 10000, q: q || undefined });
    if (seq !== loadSeq) return;
    const list = Array.isArray(res) ? res : (res.games ?? []);
    byId.clear();
    for (const g of list) byId.set(String(g.id), g);
    games.value = list;
    total.value = Array.isArray(res) ? list.length : (res.total ?? list.length);
    status.value = 'ready';
    await nextTick();
    watchCards();
  } catch (err) {
    if (seq !== loadSeq) return;
    console.error(err);
    status.value = 'error';
    error.value = "Games couldn't load right now. Try refreshing.";
  }
}

watch(query, () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(load, 300);
});

onMounted(() => {
  void load();
  getController().catch(() => {});
});

onUnmounted(() => {
  window.clearTimeout(timer);
  observer?.disconnect();
});

async function play(game: LuminGame) {
  const key = ++playKey;
  playing.value = { key, name: gameName(game) };
  playerStatus.value = 'starting';
  playerError.value = '';
  frame = null;
  await nextTick();
  try {
    const lumin = await getLumin();
    const [controller, res] = await Promise.all([getController(), lumin.getGameUrl(game.id)]);
    if (!playing.value || playing.value.key !== key || !iframe.value) return;
    const url = typeof res === 'string' ? res : res.url;
    frame = controller.createFrame(iframe.value);
    frame.go(url);
  } catch (err) {
    if (!playing.value || playing.value.key !== key) return;
    playerStatus.value = 'error';
    playerError.value = err instanceof Error ? err.message : String(err);
  }
}

function closePlayer() {
  playing.value = null;
  frame = null;
}

function onLoad() {
  if (!frame) return;
  playerStatus.value = 'playing';
  iframe.value?.focus();
}

function fullscreen() {
  iframe.value?.requestFullscreen?.().catch(() => {});
}
</script>

<template>
  <div class="gamesRoot">
    <div ref="scroller" class="gamesPage">
      <div class="gamesBar">
        <input
          v-model="query"
          class="gamesSearch"
          type="text"
          placeholder="Search games..."
          aria-label="Search games"
          autocomplete="off"
          spellcheck="false"
        />
        <span v-if="status === 'ready'" class="gamesCount">{{ total }} games</span>
      </div>

      <p v-if="status === 'error'" class="gamesNote">{{ error }}</p>
      <p v-else-if="status === 'loading'" class="gamesNote">Loading games...</p>
      <p v-else-if="!games.length" class="gamesNote">No games found.</p>
      <div v-else ref="grid" class="gamesGrid">
        <button
          v-for="g in games"
          :key="g.id"
          class="gameCard"
          type="button"
          :data-id="String(g.id)"
          @click="play(g)"
        >
          <img
            v-if="covers[String(g.id)]"
            class="gameCover"
            :src="covers[String(g.id)]"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span v-else class="gameMono">{{ gameName(g).charAt(0).toUpperCase() }}</span>
          <span class="gameTitle">{{ gameName(g) }}</span>
        </button>
      </div>
    </div>

    <div v-if="playing" class="player">
      <div class="playerBar">
        <button class="barBtn" type="button" aria-label="Back to games" @click="closePlayer">
          <ArrowLeft :size="18" />
        </button>
        <span class="playerTitle">{{ playing.name }}</span>
        <button class="barBtn" type="button" aria-label="Reload game" @click="frame?.reload()">
          <RotateCw :size="18" />
        </button>
        <button class="barBtn" type="button" aria-label="Fullscreen" @click="fullscreen">
          <Expand :size="18" />
        </button>
      </div>
      <div class="playerView">
        <iframe
          :key="playing.key"
          ref="iframe"
          class="playerFrame"
          title="Game"
          allow="autoplay; fullscreen; gamepad"
          @load="onLoad"
        ></iframe>
        <div v-if="playerStatus !== 'playing'" class="playerNote">
          <p v-if="playerStatus === 'starting'">Loading game through the proxy...</p>
          <template v-else>
            <p class="playerError">The game couldn't start.</p>
            <p class="playerErrorDetail">{{ playerError }}</p>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gamesRoot {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.gamesPage {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 20px clamp(12px, 3vw, 32px) 32px;
  animation: fadeIn 200ms ease-out both;
}

.gamesBar {
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 1400px;
  margin: 0 auto 16px;
}

.gamesSearch {
  flex: 1;
  min-width: 0;
  height: 48px;
  box-sizing: border-box;
  padding: 0 18px;
  border: 1px solid var(--sg-border);
  border-radius: 14px;
  background: var(--sg-surface-raised);
  color: var(--sg-text);
  font: inherit;
  font-size: 16px;
  outline: none;
}

.gamesSearch::placeholder {
  color: var(--sg-text-muted);
}

.gamesSearch:focus {
  border-color: var(--sg-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sg-accent) 28%, transparent);
}

.gamesCount {
  flex-shrink: 0;
  color: var(--sg-text-muted);
  font-size: 0.9rem;
}

.gamesNote {
  color: var(--sg-text-muted);
  text-align: center;
}

.gamesGrid {
  display: grid;
  max-width: 1400px;
  margin: 0 auto;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}

.gameCard {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  padding: 0;
  overflow: hidden;
  border: 2px solid var(--sg-border);
  border-radius: 12px;
  background: var(--sg-surface);
  color: var(--sg-text);
  cursor: pointer;
  content-visibility: auto;
  contain-intrinsic-size: auto 150px;
  transition:
    transform 0.16s ease-out,
    border-color 0.16s ease-out;
}

.gameCard:hover,
.gameCard:focus-visible {
  transform: translateY(-3px);
  border-color: var(--sg-accent);
  outline: none;
}

.gameCover {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gameMono {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  background: var(--sg-surface-raised);
  color: var(--sg-text-muted);
  font-size: 2rem;
  font-weight: 700;
}

.gameTitle {
  position: absolute;
  inset: auto 0 0;
  padding: 18px 8px 7px;
  overflow: hidden;
  background: linear-gradient(to top, rgb(8 6 22 / 90%) 0%, rgb(8 6 22 / 0%) 100%);
  font-size: 12px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-sizing: border-box;
  padding: 12px;
  background: var(--sg-page-bg);
}

.playerBar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.playerTitle {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--sg-text-soft);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.barBtn {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  padding: 0;
  border: 2px solid var(--sg-border);
  border-radius: 10px;
  background: var(--sg-surface);
  color: var(--sg-accent-soft);
  cursor: pointer;
}

.barBtn:hover {
  background: var(--sg-surface-hover);
  color: var(--sg-text-soft);
}

.playerView {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 2px solid var(--sg-border);
  border-radius: 12px;
  background: var(--sg-surface);
}

.playerFrame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #000;
}

.playerNote {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 6px;
  padding: 16px;
  background: var(--sg-surface);
  color: var(--sg-text-muted);
  text-align: center;
}

.playerNote p {
  margin: 0;
}

.playerError {
  color: var(--sg-text-soft);
  font-weight: 600;
}

.playerErrorDetail {
  max-width: 520px;
  font-size: 0.9rem;
  word-break: break-word;
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

  .gameCard {
    transition: none;
  }

  .gameCard:hover,
  .gameCard:focus-visible {
    transform: none;
  }
}
</style>
