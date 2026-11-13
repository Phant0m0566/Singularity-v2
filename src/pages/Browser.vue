<script lang="ts">
type ScramFrame = {
  go: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
};

type ScramController = {
  wait: () => Promise<void>;
  createFrame: (iframe: HTMLIFrameElement) => ScramFrame;
};

const SCRAM_PATHS = {
  scramjetPath: '/scram/scramjet.js',
  wasmPath: '/scram/scramjet.wasm',
  injectPath: '/scram/controller/controller.inject.js',
};
const PREFIX_MARKER = '/~/sj/';

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

function wispUrl() {
  try {
    const saved = localStorage.getItem('singularity_wisp');
    if (saved) return saved;
  } catch {}
  const fromEnv = import.meta.env.VITE_WISP_URL as string | undefined;
  if (fromEnv) return fromEnv;

  return 'wss://singularity-v2.fly.dev/wisp/';
}

// one controller per page load, the service worker + transport don't like being set up twice
let controllerPromise: Promise<ScramController> | null = null;

function getController() {
  if (controllerPromise) return controllerPromise;
  controllerPromise = (async () => {
    if (!('serviceWorker' in navigator)) throw new Error("This browser doesn't support service workers.");

    const transportUrl = '/libcurl/index.mjs';
    const scriptsP = loadScript(SCRAM_PATHS.scramjetPath).then(() =>
      loadScript('/scram/controller/controller.api.js'),
    );
    const swP = navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready);
    const libcurlP = import(/* @vite-ignore */ transportUrl);

    const [, registration, { default: LibcurlTransport }] = await Promise.all([
      scriptsP,
      swP,
      libcurlP,
    ]);

    const g = globalThis as unknown as {
      $scramjet?: { defaultConfig: Record<string, unknown> };
      $scramjetController?: { Controller: new (opts: Record<string, unknown>) => ScramController };
    };
    if (!g.$scramjet || !g.$scramjetController) throw new Error('Scramjet scripts did not load.');

    const serviceworker = navigator.serviceWorker.controller || registration.active;

    const transport = new LibcurlTransport({ wisp: wispUrl() });
    await transport.init();

    // the controller reads these paths from `config`, not `scramjetConfig`,
    // otherwise it falls back to /scramjet/... and gets index.html back
    const controller = new g.$scramjetController.Controller({
      serviceworker,
      transport,
      config: SCRAM_PATHS,
      scramjetConfig: { ...g.$scramjet.defaultConfig, ...SCRAM_PATHS },
    });
    await controller.wait();
    return controller;
  })();
  controllerPromise.catch(() => {
    controllerPromise = null;
  });
  return controllerPromise;
}

function normalize(raw: string) {
  const text = raw.trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^[^.\s]+\.[^\s]{2,}/.test(text)) return 'https://' + text;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(text);
}

function unwrap(raw: string) {
  const idx = raw.indexOf(PREFIX_MARKER);
  if (idx === -1) return '';
  const parts = raw.slice(idx + PREFIX_MARKER.length).split('/');
  if (parts.length < 3) return '';
  let target = parts.slice(2).join('/');
  const q = target.indexOf('?');
  if (q !== -1) target = target.slice(0, q);
  try {
    return decodeURIComponent(target);
  } catch {
    return '';
  }
}
</script>

<script setup lang="ts">
import { ArrowLeft, ArrowRight, Expand, RotateCw } from '@lucide/vue';
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const iframe = ref<HTMLIFrameElement | null>(null);
const address = ref('');
const status = ref<'starting' | 'ready' | 'error'>('starting');
const error = ref('');
const loading = ref(false);
const started = ref(false);
let frame: ScramFrame | null = null;

onMounted(async () => {
  try {
    const controller = await getController();
    if (!iframe.value) return;
    frame = controller.createFrame(iframe.value);
    status.value = 'ready';
    const q = route.query.q;
    if (typeof q === 'string' && q.trim()) open(q);
  } catch (err) {
    status.value = 'error';
    error.value = err instanceof Error ? err.message : String(err);
  }
});

watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string' && q.trim() && status.value === 'ready') open(q);
  },
);

function open(raw: string) {
  const url = normalize(raw);
  if (!url || !frame) return;
  address.value = url;
  started.value = true;
  loading.value = true;
  frame.go(url);
}

function submit() {
  open(address.value);
}

function onLoad() {
  loading.value = false;
  try {
    const live = unwrap(iframe.value?.contentWindow?.location.href || '');
    if (live) address.value = live;
  } catch {}
}

function fullscreen() {
  iframe.value?.requestFullscreen?.().catch(() => {});
}
</script>

<template>
  <div class="browserPage">
    <form class="browserBar" @submit.prevent="submit">
      <button class="barBtn" type="button" aria-label="Back" :disabled="!started" @click="frame?.back()">
        <ArrowLeft :size="18" />
      </button>
      <button class="barBtn" type="button" aria-label="Forward" :disabled="!started" @click="frame?.forward()">
        <ArrowRight :size="18" />
      </button>
      <button class="barBtn" type="button" aria-label="Reload" :disabled="!started" @click="frame?.reload()">
        <RotateCw :size="18" :class="{ spin: loading }" />
      </button>
      <input
        v-model="address"
        class="browserAddress"
        type="text"
        placeholder="Search the web or type a URL..."
        aria-label="Address"
        autocomplete="off"
        spellcheck="false"
        :disabled="status !== 'ready'"
      />
      <button class="barBtn" type="button" aria-label="Fullscreen" :disabled="!started" @click="fullscreen">
        <Expand :size="18" />
      </button>
    </form>

    <div class="browserView">
      <iframe ref="iframe" class="browserFrame" :class="{ hidden: !started }" title="Browser" @load="onLoad"></iframe>
      <div v-if="!started" class="browserEmpty">
        <p v-if="status === 'starting'">Starting the proxy...</p>
        <p v-else-if="status === 'ready'">Type a URL or search above.</p>
        <template v-else>
          <p class="browserError">Proxy failed to start.</p>
          <p class="browserErrorDetail">{{ error }}</p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browserPage {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  gap: 10px;
  box-sizing: border-box;
  padding: 12px;
  animation: fadeIn 200ms ease-out both;
}

.browserBar {
  display: flex;
  align-items: center;
  gap: 8px;
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

.barBtn:hover:not(:disabled) {
  background: var(--sg-surface-hover);
  color: var(--sg-text-soft);
}

.barBtn:disabled {
  opacity: 0.45;
  cursor: default;
}

.browserAddress {
  flex: 1;
  min-width: 0;
  height: 42px;
  box-sizing: border-box;
  padding: 0 16px;
  border: 1px solid var(--sg-border);
  border-radius: 12px;
  background: var(--sg-surface-raised);
  color: var(--sg-text);
  font: inherit;
  font-size: 15px;
  outline: none;
}

.browserAddress::placeholder {
  color: var(--sg-text-muted);
}

.browserAddress:focus {
  border-color: var(--sg-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sg-accent) 28%, transparent);
}

.browserView {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 2px solid var(--sg-border);
  border-radius: 12px;
  background: var(--sg-surface);
}

.browserFrame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
}

.browserFrame.hidden {
  visibility: hidden;
}

.browserEmpty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 6px;
  padding: 16px;
  color: var(--sg-text-muted);
  text-align: center;
}

.browserEmpty p {
  margin: 0;
}

.browserError {
  color: var(--sg-text-soft);
  font-weight: 600;
}

.browserErrorDetail {
  max-width: 520px;
  font-size: 0.9rem;
  word-break: break-word;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
  .browserPage,
  .spin {
    animation: none;
  }
}
</style>
