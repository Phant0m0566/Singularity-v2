<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { proxyImage, proxySettings } from '../scram';

const props = defineProps<{ src: string }>();
const el = ref<HTMLImageElement | null>(null);
const resolved = ref('');
let observer: IntersectionObserver | null = null;
let seq = 0;

async function load() {
  const current = ++seq;
  const url = props.src;
  if (!proxySettings.images) {
    resolved.value = url;
    return;
  }
  try {
    const blobUrl = await proxyImage(url);
    if (current === seq) resolved.value = blobUrl;
  } catch {
    if (current === seq) resolved.value = url;
  }
}

function watchVisible() {
  observer?.disconnect();
  seq++;
  resolved.value = '';
  if (!el.value) return;
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer?.disconnect();
        void load();
      }
    },
    { rootMargin: '300px' },
  );
  observer.observe(el.value);
}

onMounted(watchVisible);
watch(() => props.src, watchVisible);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <img ref="el" :src="resolved || undefined" />
</template>
