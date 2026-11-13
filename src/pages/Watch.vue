<script setup lang="ts">
import { ArrowLeft, ArrowRight } from '@lucide/vue';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

type Genre = { id: number; name: string };
type Title = {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
};
type Detail = Title & {
  runtime?: number;
  number_of_seasons?: number;
  status?: string;
  budget?: number;
  revenue?: number;
  genres?: Genre[];
  production_companies?: { id: number; name: string }[];
};
type Cast = { id: number; name: string; character?: string; profile_path?: string | null };
type Row = { name: string; items: Title[] };
type Listing = { results?: Title[]; total_pages?: number };
type Kind = 'movie' | 'tv';

const TMDB_KEY = (import.meta.env.VITE_TMDB_KEY as string | undefined) || 'fb7bb23f03b6994dafc674c074d01761';
const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p/';

async function tmdb<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(API + path);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB request failed (${res.status})`);
  return res.json() as Promise<T>;
}

function titleOf(t: Title) {
  return t.title || t.name || 'Untitled';
}

function yearOf(t: Title) {
  return (t.release_date || t.first_air_date || '').slice(0, 4);
}

function ratingOf(t: Title) {
  return t.vote_average ? t.vote_average.toFixed(1) : 'N/A';
}

function money(n: number) {
  return '$' + (n / 1_000_000).toFixed(1) + 'M';
}

const tab = ref<'movies' | 'shows'>('movies');
const kind = computed<Kind>(() => (tab.value === 'movies' ? 'movie' : 'tv'));
const query = ref('');
const selectedGenre = ref('');
const sortBy = ref('popularity.desc');
const page = ref(1);
const totalPages = ref(1);
const genres = ref<Genre[]>([]);
const content = ref<Title[]>([]);
const extraRows = ref<Row[]>([]);
const heroSlides = ref<Title[]>([]);
const heroIndex = ref(0);
const heroPaused = ref(false);
const loading = ref(false);
const toast = ref('');
const scroller = ref<HTMLElement | null>(null);
const scrolled = ref(false);

const detailEl = ref<HTMLElement | null>(null);
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
const detail = ref<Detail | null>(null);
const detailKind = ref<Kind>('movie');
const cast = ref<Cast[]>([]);
const similar = ref<Title[]>([]);

// Player
const showPlayer = ref(false);
const showTopBar = ref(false);
let topBarTimer: number | undefined;

let contentSeq = 0;
let rowsSeq = 0;
let detailSeq = 0;
let searchTimer: number | undefined;
let heroTimer: number | undefined;
let toastTimer: number | undefined;

const featured = computed(() => heroSlides.value[heroIndex.value] ?? null);
const showHero = computed(() => !query.value.trim() && heroSlides.value.length > 0);

const playerSrc = computed(() => {
  if (!detail.value) return '';
  const id = detail.value.id;
  if (detailKind.value === 'movie') return `https://vidcore.io/movie/${id}`;
  return `https://vidcore.io/tv/${id}/1/1`;
});

const sections = computed<{ name: string; items: Title[]; grid: boolean }[]>(() => {
  const q = query.value.trim();
  if (q) return [{ name: `Results for “${q}”`, items: content.value, grid: true }];
  const genreName = genres.value.find((g) => String(g.id) === selectedGenre.value)?.name || 'Filtered';
  const mainName = selectedGenre.value ? genreName : tab.value === 'movies' ? 'Popular movies' : 'Popular TV shows';
  const list = [{ name: mainName, items: content.value, grid: false }];
  if (!selectedGenre.value) {
    for (const row of extraRows.value) list.push({ name: row.name, items: row.items, grid: false });
  }
  return list;
});

function showToast(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = '';
  }, 4000);
}

function stopHero() {
  window.clearInterval(heroTimer);
  heroTimer = undefined;
}

function startHero() {
  stopHero();
  if (heroSlides.value.length < 2) return;
  heroTimer = window.setInterval(() => {
    if (!heroPaused.value) heroIndex.value = (heroIndex.value + 1) % heroSlides.value.length;
  }, 7000);
}

function setHero(items: Title[]) {
  heroSlides.value = items.filter((i) => i.backdrop_path).slice(0, 8);
  heroIndex.value = 0;
  startHero();
}

function clearHero() {
  stopHero();
  heroSlides.value = [];
  heroIndex.value = 0;
}

function goHero(i: number) {
  heroIndex.value = i;
  startHero();
}

function openPlayer() {
  showPlayer.value = true;
  showTopBar.value = true;
  window.clearTimeout(topBarTimer);
  topBarTimer = window.setTimeout(() => {
    showTopBar.value = false;
  }, 2500);
}

function closePlayer() {
  showPlayer.value = false;
  showTopBar.value = false;
  window.clearTimeout(topBarTimer);
}

function onPlayerMouseMove() {
  showTopBar.value = true;
  window.clearTimeout(topBarTimer);
  topBarTimer = window.setTimeout(() => {
    showTopBar.value = false;
  }, 2500);
}

function scrollRow(e: Event, direction: number) {
  const btn = e.currentTarget as HTMLElement;
  const track = btn.closest('.row')?.querySelector('.rowTrack') as HTMLElement | null;
  if (!track) return;
  track.scrollBy({ left: direction * 600, behavior: 'smooth' });
}

async function fetchGenres() {
  try {
    const data = await tmdb<{ genres?: Genre[] }>(`/genre/${kind.value}/list`);
    genres.value = data.genres ?? [];
  } catch {
    genres.value = [];
  }
}

async function fetchContent() {
  const seq = ++contentSeq;
  loading.value = true;
  let sort = sortBy.value;
  if (kind.value === 'tv') {
    if (sort === 'release_date.desc') sort = 'first_air_date.desc';
    if (sort === 'revenue.desc') sort = 'popularity.desc';
  }
  try {
    const data = await tmdb<Listing>(`/discover/${kind.value}`, {
      sort_by: sort,
      'vote_count.gte': sort === 'vote_average.desc' ? 300 : undefined,
      page: page.value,
      with_genres: selectedGenre.value || undefined,
    });
    if (seq !== contentSeq) return;
    content.value = data.results ?? [];
    totalPages.value = Math.min(data.total_pages || 500, 500);
    if (page.value === 1 && !selectedGenre.value && content.value.length) setHero(content.value);
    else clearHero();
  } catch (err) {
    if (seq !== contentSeq) return;
    content.value = [];
    showToast(err instanceof Error ? err.message : 'Failed to load content.');
  } finally {
    if (seq === contentSeq) loading.value = false;
  }
}

async function searchContent() {
  const seq = ++contentSeq;
  loading.value = true;
  try {
    const data = await tmdb<Listing>(`/search/${kind.value}`, {
      query: query.value.trim(),
      page: page.value,
    });
    if (seq !== contentSeq) return;
    let list = data.results ?? [];
    if (selectedGenre.value) list = list.filter((i) => i.genre_ids?.includes(Number(selectedGenre.value)));
    content.value = list;
    totalPages.value = Math.min(data.total_pages || 500, 500);
  } catch (err) {
    if (seq !== contentSeq) return;
    content.value = [];
    showToast(err instanceof Error ? err.message : 'Search failed.');
  } finally {
    if (seq === contentSeq) loading.value = false;
  }
}

async function loadExtraRows() {
  const seq = ++rowsSeq;
  const k = kind.value;
  const defs: { name: string; sort?: string; genre?: number }[] =
    k === 'movie'
      ? [
          { name: 'Top rated', sort: 'vote_average.desc' },
          { name: 'Action', genre: 28 },
          { name: 'Comedy', genre: 35 },
          { name: 'Drama', genre: 18 },
          { name: 'Thriller', genre: 53 },
          { name: 'Science fiction', genre: 878 },
          { name: 'Horror', genre: 27 },
        ]
      : [
          { name: 'Top rated', sort: 'vote_average.desc' },
          { name: 'Action & adventure', genre: 10759 },
          { name: 'Comedy', genre: 35 },
          { name: 'Drama', genre: 18 },
          { name: 'Crime', genre: 80 },
          { name: 'Sci-fi & fantasy', genre: 10765 },
          { name: 'Animation', genre: 16 },
        ];
  extraRows.value = [];
  const results = await Promise.all(
    defs.map((d) =>
      tmdb<Listing>(`/discover/${k}`, {
        sort_by: d.sort,
        'vote_count.gte': d.sort ? 300 : undefined,
        with_genres: d.genre,
        page: 1,
      })
        .then((data) => ({ name: d.name, items: (data.results ?? []).slice(0, 12) }))
        .catch(() => ({ name: d.name, items: [] as Title[] })),
    ),
  );
  if (seq !== rowsSeq) return;
  extraRows.value = results.filter((r) => r.items.length);
}

async function applyFilters() {
  page.value = 1;
  if (query.value.trim()) {
    clearHero();
    await searchContent();
  } else {
    await fetchContent();
    if (!selectedGenre.value) void loadExtraRows();
  }
}

async function switchTab(next: 'movies' | 'shows') {
  if (tab.value === next) return;
  tab.value = next;
  selectedGenre.value = '';
  sortBy.value = 'popularity.desc';
  page.value = 1;
  clearHero();
  extraRows.value = [];
  content.value = [];
  scroller.value?.scrollTo({ top: 0 });
  await fetchGenres();
  await applyFilters();
}

async function changePage(next: number) {
  if (next < 1 || next > totalPages.value) return;
  page.value = next;
  if (query.value.trim()) await searchContent();
  else await fetchContent();
  scroller.value?.querySelectorAll('.rowTrack').forEach((el) => {
    (el as HTMLElement).scrollLeft = 0;
  });
  scroller.value?.scrollTo({ top: 0, behavior: 'smooth' });
}

async function openDetail(id: number, k: Kind) {
  const seq = ++detailSeq;
  detailKind.value = k;
  detailOpen.value = true;
  showPlayer.value = false;
  detailLoading.value = true;
  detailError.value = '';
  detail.value = null;
  cast.value = [];
  similar.value = [];
  await nextTick();
  detailEl.value?.scrollTo({ top: 0 });
  try {
    const [info, credits, more] = await Promise.all([
      tmdb<Detail>(`/${k}/${id}`),
      tmdb<{ cast?: Cast[] }>(`/${k}/${id}/credits`).catch(() => ({ cast: [] as Cast[] })),
      tmdb<Listing>(`/${k}/${id}/similar`).catch(() => ({ results: [] as Title[] })),
    ]);
    if (seq !== detailSeq) return;
    detail.value = info;
    cast.value = credits.cast ?? [];
    similar.value = more.results ?? [];
  } catch (err) {
    if (seq !== detailSeq) return;
    detailError.value = err instanceof Error ? err.message : 'Could not load this title.';
  } finally {
    if (seq === detailSeq) detailLoading.value = false;
  }
}

function closeDetail() {
  detailSeq++;
  detailOpen.value = false;
  detail.value = null;
  showPlayer.value = false;
}

function onScroll(e: Event) {
  scrolled.value = (e.target as HTMLElement).scrollTop > 40;
}

watch(query, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void applyFilters(), 400);
});

onMounted(async () => {
  await fetchGenres();
  await fetchContent();
  void loadExtraRows();
});

onUnmounted(() => {
  stopHero();
  window.clearTimeout(searchTimer);
  window.clearTimeout(toastTimer);
  window.clearTimeout(topBarTimer);
  contentSeq++;
  rowsSeq++;
  detailSeq++;
});
</script>

<template>
  <div class="watchRoot">

    <div
      v-if="showPlayer && detail"
      class="playerOverlay"
      @mousemove="onPlayerMouseMove"
      @mouseleave="showTopBar = false"
    >
      <div class="playerTopbar" :class="{ show: showTopBar }">
        <button type="button" class="playerExit" @click="closePlayer">Exit</button>
      </div>
      <iframe
        class="playerIframe"
        :src="playerSrc"
        frameborder="0"
        allowfullscreen
        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      ></iframe>
    </div>

    <div ref="scroller" class="watchPage" :class="{ noHero: !showHero }" @scroll.passive="onScroll">
      <nav class="nav" :class="scrolled ? 'solid' : 'clear'">
        <div class="navLinks">
          <button type="button" :class="{ active: tab === 'movies' }" @click="switchTab('movies')">Movies</button>
          <button type="button" :class="{ active: tab === 'shows' }" @click="switchTab('shows')">TV Shows</button>
        </div>
        <div class="navRight">
          <input
            v-model="query"
            class="field"
            type="text"
            placeholder="Search titles"
            aria-label="Search"
            autocomplete="off"
            spellcheck="false"
          />
          <select v-model="selectedGenre" class="field" aria-label="Genre" @change="applyFilters">
            <option value="">Genres</option>
            <option v-for="g in genres" :key="g.id" :value="String(g.id)">{{ g.name }}</option>
          </select>
          <select v-model="sortBy" class="field" aria-label="Sort by" @change="applyFilters">
            <option value="popularity.desc">Popular</option>
            <option value="vote_average.desc">Top Rated</option>
            <option value="release_date.desc">Newest</option>
            <option value="revenue.desc">Grossing</option>
          </select>
        </div>
      </nav>

      <section v-if="showHero" class="hero" @mouseenter="heroPaused = true" @mouseleave="heroPaused = false">
        <img
          v-for="(s, i) in heroSlides"
          :key="s.id"
          class="heroBg"
          :class="{ active: i === heroIndex }"
          :src="IMG + 'w1280' + s.backdrop_path"
          alt=""
        />
        <div class="heroShade"></div>
        <Transition name="heroFade" mode="out-in">
          <div v-if="featured" :key="featured.id" class="heroText">
            <h2 class="heroTitle">{{ titleOf(featured) }}</h2>
            <p class="heroDesc">{{ featured.overview }}</p>
            <button type="button" class="btn" @click="openDetail(featured.id, kind)">▶ Play</button>
          </div>
        </Transition>
        <div v-if="heroSlides.length > 1" class="heroDots">
          <button
            v-for="(s, i) in heroSlides"
            :key="'dot-' + s.id"
            type="button"
            class="heroDot"
            :class="{ active: i === heroIndex }"
            :aria-label="'Slide ' + (i + 1)"
            @click="goHero(i)"
          ></button>
        </div>
      </section>

      <div v-if="loading && !content.length" class="grid">
        <div v-for="n in 12" :key="n" class="skeleton"></div>
      </div>
      <div v-else-if="!loading && !content.length" class="note">
        <p class="noteBig">No titles found.</p>
        <p>Try a different search or genre.</p>
      </div>
      <template v-else>
        <section v-for="s in sections" :key="s.name" class="row">
          <div class="rowHeader">
            <h2 class="rowTitle">{{ s.name }}</h2>
            <div v-if="!s.grid" class="rowControls">
              <button type="button" class="rowBtn" @click="scrollRow($event, -1)">‹</button>
              <button type="button" class="rowBtn" @click="scrollRow($event, 1)">›</button>
            </div>
          </div>
          <div :class="s.grid ? 'grid' : 'rowTrack'">
            <button v-for="item in s.items" :key="item.id" type="button" class="card" @click="openDetail(item.id, kind)">
              <img
                v-if="item.poster_path"
                class="cardImg"
                :src="IMG + 'w342' + item.poster_path"
                :alt="titleOf(item)"
                loading="lazy"
                decoding="async"
              />
              <span v-else class="cardMono">{{ titleOf(item).charAt(0).toUpperCase() }}</span>
              <span class="cardInfo">
                <strong class="cardName">{{ titleOf(item) }}</strong>
                <span class="cardMeta">{{ yearOf(item) }} · ★ {{ ratingOf(item) }}</span>
              </span>
            </button>
          </div>
        </section>

        <div class="pager">
          <button type="button" class="btn ghost small" :disabled="page === 1" @click="changePage(page - 1)">
            <ArrowLeft :size="16" /> Previous
          </button>
          <span class="muted">Page {{ page }}</span>
          <button type="button" class="btn ghost small" :disabled="page >= totalPages" @click="changePage(page + 1)">
            Next <ArrowRight :size="16" />
          </button>
        </div>
      </template>
    </div>


    <div v-if="detailOpen" ref="detailEl" class="detail">
      <nav class="nav solid">
        <div class="navLinks">
          <button type="button" @click="closeDetail">← Back</button>
        </div>
      </nav>

      <p v-if="detailLoading" class="note">Loading...</p>
      <div v-else-if="detailError" class="note">
        <p class="errorText">{{ detailError }}</p>
        <button type="button" class="btn" @click="closeDetail">Go Back</button>
      </div>

      <template v-else-if="detail">
        <div class="detailHero">
          <img
            v-if="detail.backdrop_path"
            class="detailBackdrop"
            :src="IMG + 'w1280' + detail.backdrop_path"
            alt=""
          />
          <div class="heroShade"></div>
          <div class="detailHeroText">
            <h1 class="detailTitle">{{ titleOf(detail) }}</h1>
            <div class="meta">
              <span class="accent">{{ ratingOf(detail) }} Rating</span>
              <span v-if="yearOf(detail)">{{ yearOf(detail) }}</span>
              <span v-if="detail.runtime">{{ detail.runtime }} min</span>
              <span v-if="detail.number_of_seasons">
                {{ detail.number_of_seasons }} Season{{ detail.number_of_seasons > 1 ? 's' : '' }}
              </span>
            </div>
            <p class="detailOverview">{{ detail.overview || 'No description available.' }}</p>
            <button type="button" class="btn" @click="openPlayer">▶ Play</button>
          </div>
        </div>

        <div class="detailBody">
          <div class="detailMain">
            <section v-if="detail.genres?.length" class="block">
              <h3>Genres</h3>
              <div class="pills">
                <span v-for="g in detail.genres" :key="g.id" class="pill">{{ g.name }}</span>
              </div>
            </section>

            <section v-if="cast.length" class="block">
              <h3>Cast</h3>
              <div class="castRow">
                <div v-for="person in cast.slice(0, 12)" :key="person.id" class="person">
                  <img
                    v-if="person.profile_path"
                    class="personImg"
                    :src="IMG + 'w185' + person.profile_path"
                    :alt="person.name"
                    loading="lazy"
                  />
                  <span v-else class="personImg personMono">{{ person.name.charAt(0) }}</span>
                  <span class="personName">{{ person.name }}</span>
                  <span class="personRole">{{ person.character }}</span>
                </div>
              </div>
            </section>

            <section v-if="similar.length" class="block">
              <h3>More Like This</h3>
              <div class="similarGrid">
                <button
                  v-for="item in similar.slice(0, 8)"
                  :key="item.id"
                  type="button"
                  class="similarCard"
                  @click="openDetail(item.id, detailKind)"
                >
                  <img
                    v-if="item.poster_path"
                    class="similarImg"
                    :src="IMG + 'w342' + item.poster_path"
                    :alt="titleOf(item)"
                    loading="lazy"
                    decoding="async"
                  />
                  <span v-else class="similarImg cardMono">{{ titleOf(item).charAt(0).toUpperCase() }}</span>
                  <span class="similarName">{{ titleOf(item) }}</span>
                </button>
              </div>
            </section>
          </div>

          <aside class="facts">
            <div>
              <span class="muted">Status</span>
              <span class="factValue">{{ detail.status || 'N/A' }}</span>
            </div>
            <div v-if="detail.budget">
              <span class="muted">Budget</span>
              <span class="factValue">{{ money(detail.budget) }}</span>
            </div>
            <div v-if="detail.revenue">
              <span class="muted">Revenue</span>
              <span class="factValue">{{ money(detail.revenue) }}</span>
            </div>
            <div v-if="detail.production_companies?.length">
              <span class="muted">Production</span>
              <span v-for="c in detail.production_companies.slice(0, 4)" :key="c.id" class="factValue">
                {{ c.name }}
              </span>
            </div>
          </aside>
        </div>
      </template>
    </div>

    <p v-if="toast" class="toast">{{ toast }}</p>
  </div>
</template>

<style scoped>
.watchRoot {
  --bh-bg: #0f0a1a;
  --bh-panel: #1a1229;
  --bh-card: #241a36;
  --bh-border: #3d2a55;
  --bh-input: #241a36;
  --bh-input-border: #3d2a55;
  --bh-muted: #b8a9c9;
  --bh-text: #f0e6ff;
  --bh-accent: #c084fc;
  --bh-accent-hover: #d8b4fe;
  --bh-cyan: #a78bfa;
  --bh-line: #a78bfa;
  --sg-page-bg: #0f0a1a;
  --sg-shadow-soft: rgba(0, 0, 0, 0.35);
  --sg-accent: #7c3aed;

  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--bh-bg);
  color: var(--bh-text);
  color-scheme: dark;
  font-family: 'Avenir', 'Helvetica Neue', Helvetica, Arial, sans-serif;
}

.playerOverlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #000;
}
.playerIframe {
  width: 100%;
  height: 100%;
  border: none;
}
.playerTopbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 20px;
  z-index: 20;
  opacity: 0;
  transition: opacity 0.25s;
  pointer-events: none;
}
.playerTopbar.show {
  opacity: 1;
  pointer-events: auto;
}
.playerExit {
  background: #1a1229;
  border: 1px solid #c084fc;
  color: #f0e6ff;
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.playerExit:hover {
  background: #c084fc;
  color: #0f0a1a;
}

.watchPage {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 4rem;
  animation: fadeIn 200ms ease-out both;
}

.nav {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  height: 70px;
  box-sizing: border-box;
  padding: 0 36px;
  transition: background 0.3s ease;
}
.nav.clear {
  background: rgb(26 18 41 / 85%);
}
.nav.solid {
  background: var(--bh-panel);
}
.watchPage:not(.noHero) .nav {
  margin-bottom: -70px;
}
.navLinks {
  display: flex;
  gap: 28px;
}
.navLinks button {
  position: relative;
  padding: 6px 0;
  border: 0;
  background: none;
  color: var(--bh-text);
  font: inherit;
  font-size: 13px;
  letter-spacing: 1.42px;
  text-transform: uppercase;
  cursor: pointer;
}
.navLinks button::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: -2px;
  left: 0;
  height: 2px;
  background: var(--bh-cyan);
  opacity: 0;
  transform: scaleX(0);
  transform-origin: left;
  transition: all 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
.navLinks button:hover::after,
.navLinks button.active::after {
  opacity: 1;
  transform: scaleX(1);
}
.navRight {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.field {
  height: 36px;
  box-sizing: border-box;
  padding: 6px 12px;
  border: 1px solid var(--bh-input-border);
  border-radius: 4px;
  background: var(--bh-input);
  color: var(--bh-text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.field:focus {
  border-color: var(--bh-cyan);
}
.field::placeholder {
  color: var(--bh-muted);
}
select.field {
  cursor: pointer;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0.7rem 1.8rem;
  border: 0;
  border-radius: 4px;
  background: var(--bh-accent);
  color: var(--sg-page-bg);
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 1.8px;
  text-decoration: none;
  text-transform: uppercase;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}
.btn:hover:not(:disabled) {
  background: var(--bh-accent-hover);
}
.btn.ghost {
  border: 1px solid var(--bh-line);
  background: var(--bh-card);
  color: var(--bh-text);
}
.btn.ghost:hover:not(:disabled) {
  background: var(--bh-accent);
  color: var(--sg-page-bg);
}
.btn.small {
  padding: 0.5rem 1.25rem;
  font-size: 0.85rem;
  font-weight: 500;
}
.btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.hero {
  position: relative;
  width: 100%;
  height: clamp(340px, 46vw, 72vh);
  overflow: hidden;
}
.heroBg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 1.2s ease-in-out;
}
.heroBg.active {
  opacity: 1;
}
.heroShade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, rgb(15 10 26 / 85%), rgb(15 10 26 / 15%)),
    linear-gradient(0deg, rgb(15 10 26 / 80%), transparent 75%);
}
.heroText {
  position: absolute;
  bottom: 22%;
  left: 36px;
  z-index: 2;
  max-width: 38%;
}
.heroFade-enter-active,
.heroFade-leave-active {
  transition: opacity 0.4s;
}
.heroFade-enter-from,
.heroFade-leave-to {
  opacity: 0;
}
.heroTitle {
  margin: 0 0 1rem;
  font-size: clamp(1.8rem, 4.2vw, 3.4rem);
  font-weight: 800;
  line-height: 1.1;
}
.heroDesc {
  display: -webkit-box;
  margin: 0 0 1.25rem;
  overflow: hidden;
  color: var(--bh-text);
  font-size: clamp(0.85rem, 1.3vw, 1.05rem);
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.heroDots {
  position: absolute;
  bottom: 14%;
  left: 50%;
  z-index: 3;
  display: flex;
  gap: 8px;
  transform: translateX(-50%);
}
.heroDot {
  width: 8px;
  height: 8px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--sg-accent);
  cursor: pointer;
  transition: all 0.2s;
}
.heroDot.active {
  width: 22px;
  border-radius: 4px;
  background: var(--bh-accent);
}

.row {
  margin-bottom: 1.5rem;
}
.hero + .row {
  position: relative;
  z-index: 10;
  margin-top: -6vw;
}
.rowHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 36px;
  margin-bottom: 0.2rem;
}
.rowHeader .rowTitle {
  padding: 0;
  margin: 0;
}
.rowTitle {
  margin: 0 0 0.2rem;
  padding: 0 36px;
  color: var(--bh-text);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.4px;
}
.rowControls {
  display: flex;
  gap: 8px;
}
.rowBtn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--bh-border);
  background: var(--bh-card);
  color: var(--bh-text);
  font-size: 20px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.15s, border-color 0.15s;
}
.rowBtn:hover {
  background: var(--bh-accent);
  border-color: var(--bh-accent);
  color: var(--bh-bg);
}
.rowTrack {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding: 18px 36px 26px;
  scroll-behavior: smooth;
  scrollbar-width: none;
}
.rowTrack::-webkit-scrollbar {
  display: none;
}
.rowTrack .card {
  flex: 0 0 auto;
  width: 140px;
}
@media (min-width: 500px) {
  .rowTrack .card {
    width: 160px;
  }
}
@media (min-width: 800px) {
  .rowTrack .card {
    width: 185px;
  }
}
@media (min-width: 1100px) {
  .rowTrack .card {
    width: 210px;
  }
}

.grid {
  display: grid;
  gap: 20px;
  padding: 18px 36px 26px;
  grid-template-columns: repeat(2, 1fr);
}
@media (min-width: 500px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (min-width: 800px) {
  .grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
@media (min-width: 1100px) {
  .grid {
    grid-template-columns: repeat(6, 1fr);
  }
}

.card {
  position: relative;
  display: block;
  width: 100%;
  padding: 0;
  overflow: hidden;
  border: 3px solid var(--bh-border);
  border-radius: 10px;
  background: var(--bh-card);
  box-shadow: 0 8px 24px var(--sg-shadow-soft);
  color: var(--bh-text);
  text-align: left;
  cursor: pointer;
  transition: transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94), border-color 0.25s;
}
.card:hover,
.card:focus-visible {
  z-index: 20;
  border-color: var(--bh-cyan);
  outline: none;
  transform: scale(1.05);
}
.cardImg {
  display: block;
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
}
.cardMono {
  display: grid;
  width: 100%;
  aspect-ratio: 2 / 3;
  place-items: center;
  background: var(--bh-input);
  color: var(--bh-muted);
  font-size: 2rem;
  font-weight: 700;
}
.cardInfo {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  padding: 10px;
  background: rgb(15 10 26 / 92%);
  opacity: 0;
  transition: opacity 0.2s;
}
.card:hover .cardInfo,
.card:focus-visible .cardInfo {
  opacity: 1;
}
.cardName {
  display: block;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.3;
}
.cardMeta {
  display: block;
  margin-top: 4px;
  color: var(--bh-muted);
  font-size: 11px;
}

.skeleton {
  aspect-ratio: 2 / 3;
  border-radius: 12px;
  background: var(--bh-card);
  animation: pulse 1.2s ease infinite;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  margin-top: 2rem;
}

.note {
  padding: 88px 16px 40px;
  color: var(--bh-muted);
  text-align: center;
}
.note p {
  margin: 0;
}
.noteBig {
  margin-bottom: 8px !important;
  font-size: 1.1rem;
}
.errorText {
  margin-bottom: 16px !important;
  color: #ffc1d1;
  font-size: 1.1rem;
}
.muted {
  color: var(--bh-muted);
}
.credit {
  margin: 24px 0 0;
  padding: 0 16px;
  color: var(--bh-muted);
  font-size: 12px;
  text-align: center;
}

.detail {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 3rem;
  background: var(--bh-bg);
}
.detail .nav {
  margin-bottom: 0;
}
.detailHero {
  position: relative;
  width: 100%;
  height: clamp(380px, 65vh, 80vh);
  overflow: hidden;
}
.detailBackdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.detailHeroText {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  max-width: 720px;
  padding: 24px clamp(24px, 4vw, 56px) clamp(40px, 5vw, 72px);
}
.detailTitle {
  margin: 0 0 12px;
  font-size: clamp(1.8rem, 3.6vw, 3rem);
  font-weight: 700;
  line-height: 1.15;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  color: var(--bh-muted);
  font-size: 0.9rem;
}
.accent {
  color: var(--bh-cyan);
  font-weight: 600;
}
.detailOverview {
  max-width: 36rem;
  margin: 0 0 1.5rem;
  color: var(--bh-muted);
  font-size: 1rem;
  line-height: 1.65;
}
.detailBody {
  display: grid;
  max-width: 72rem;
  gap: 40px;
  padding: 40px clamp(24px, 4vw, 56px);
  grid-template-columns: minmax(0, 1fr);
}
@media (min-width: 900px) {
  .detailBody {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }
}
.block {
  margin-bottom: 32px;
}
.block h3 {
  margin: 0 0 14px;
  color: var(--bh-muted);
  font-size: 0.9rem;
  font-weight: 500;
}
.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.pill {
  padding: 4px 12px;
  border: 1px solid var(--bh-input-border);
  border-radius: 4px;
  background: var(--bh-input);
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.pill:hover {
  border-color: var(--bh-cyan);
}

.castRow {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-width: none;
}
.castRow::-webkit-scrollbar {
  display: none;
}
.person {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  width: 80px;
  text-align: center;
}
.personImg {
  width: 80px;
  height: 80px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: var(--bh-input);
  object-fit: cover;
}
.personMono {
  display: grid;
  place-items: center;
  color: var(--bh-muted);
  font-weight: 700;
}
.personName {
  display: -webkit-box;
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}
.personRole {
  display: -webkit-box;
  overflow: hidden;
  color: var(--bh-muted);
  font-size: 11px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.similarGrid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, 1fr);
}
@media (min-width: 500px) {
  .similarGrid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (min-width: 800px) {
  .similarGrid {
    grid-template-columns: repeat(4, 1fr);
  }
}
.similarCard {
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  background: none;
  color: var(--bh-text);
  text-align: left;
  cursor: pointer;
}
.similarImg {
  display: block;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 12px;
  object-fit: cover;
  transition: opacity 0.2s;
}
.similarCard:hover .similarImg {
  opacity: 0.8;
}
.similarName {
  display: -webkit-box;
  margin-top: 6px;
  overflow: hidden;
  color: var(--bh-muted);
  font-size: 12px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.facts {
  display: flex;
  flex-direction: column;
  gap: 20px;
  font-size: 0.9rem;
}
.facts > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.factValue {
  color: var(--bh-text);
}

.toast {
  position: absolute;
  bottom: 24px;
  left: 50%;
  z-index: 100;
  max-width: 90%;
  margin: 0;
  padding: 12px 20px;
  border: 1px solid var(--bh-input-border);
  border-radius: 8px;
  background: var(--bh-panel);
  font-size: 14px;
  transform: translateX(-50%);
}

@media (max-width: 768px) {
  .heroText {
    bottom: 24%;
    left: 20px;
    max-width: 85%;
  }
  .nav {
    padding: 0 16px;
  }
}
@media (max-width: 639px) {
  .nav {
    gap: 8px;
  }
  .navLinks {
    gap: 14px;
  }
  .navRight {
    flex: 1;
    min-width: 0;
    gap: 6px;
  }
  .navRight .field:first-child {
    flex: 1 1 0;
    width: 0;
    min-width: 0;
  }
  .navRight select {
    min-width: 0;
    max-width: 78px;
  }
  .rowHeader,
  .rowTitle {
    padding-left: 16px;
    padding-right: 16px;
  }
  .rowTrack,
  .grid {
    padding-right: 16px;
    padding-left: 16px;
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .watchPage,
  .skeleton {
    animation: none;
  }
  .card,
  .heroBg,
  .heroDot,
  .navLinks button::after {
    transition: none;
  }
  .card:hover,
  .card:focus-visible {
    transform: none;
  }
}
</style>
