import { createApp } from 'vue';
import Particles from '@tsparticles/vue3';
import { loadSlim } from '@tsparticles/slim';
import App from './App.vue';
import router from './router';
import { warmUp } from './scram';

const app = createApp(App);

app.use(Particles, {
  init: async (engine) => {
    await loadSlim(engine);
  },
});

app.use(router);

app.mount('#app');

warmUp();
