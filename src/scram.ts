export type ScramFrame = {
  go: (url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
};

export type ScramController = {
  wait: () => Promise<void>;
  createFrame: (iframe: HTMLIFrameElement) => ScramFrame;
};

const SCRAM_PATHS = {
  scramjetPath: '/scram/scramjet.js',
  wasmPath: '/scram/scramjet.wasm',
  injectPath: '/scram/controller/controller.inject.js',
};

const DEFAULT_WISP = 'wss://singularity-v2.fly.dev/wisp/';

function loadScripts(srcs: string[]) {
  return Promise.all(
    srcs.map(
      (src) =>
        new Promise<void>((resolve, reject) => {
          if (document.querySelector(`script[src="${src}"]`)) return resolve();
          const s = document.createElement('script');
          s.src = src;
          s.async = false;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('Could not load ' + src));
          document.head.appendChild(s);
        }),
    ),
  );
}

function wispUrl() {
  try {
    const saved = localStorage.getItem('singularity_wisp');
    if (saved) return saved;
  } catch {}
  const fromEnv = import.meta.env.VITE_WISP_URL as string | undefined;
  if (fromEnv) return fromEnv;
  return DEFAULT_WISP;
}

let controllerPromise: Promise<ScramController> | null = null;

export function getController() {
  if (controllerPromise) return controllerPromise;
  controllerPromise = (async () => {
    if (!('serviceWorker' in navigator)) throw new Error("This browser doesn't support service workers.");
    const transportUrl = '/libcurl/index.mjs';
    const scriptsP = loadScripts([SCRAM_PATHS.scramjetPath, '/scram/controller/controller.api.js']);
    const swP = navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready);
    const transportP = import(/* @vite-ignore */ transportUrl).then(
      async ({ default: LibcurlTransport }) => {
        const transport = new LibcurlTransport({ wisp: wispUrl() });
        await transport.init();
        return transport;
      },
    );

    const [, registration, transport] = await Promise.all([scriptsP, swP, transportP]);

    const g = globalThis as unknown as {
      $scramjet?: { defaultConfig: Record<string, unknown> };
      $scramjetController?: { Controller: new (opts: Record<string, unknown>) => ScramController };
    };
    if (!g.$scramjet || !g.$scramjetController) throw new Error('Scramjet scripts did not load.');

    const serviceworker = navigator.serviceWorker.controller || registration.active;

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

export function warmUp() {
  const start = () => {
    getController().catch(() => {});
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(start);
  else setTimeout(start, 1500);
}
