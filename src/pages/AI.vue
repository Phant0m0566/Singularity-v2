<script setup lang="ts">
import { Send, ChevronDown, Paperclip, Plus, X } from '@lucide/vue';
import { nextTick, onMounted, ref } from 'vue';

const API_URL = '/api';
const CHAT_STORAGE_KEY = 'sg-ai-chat-saves-v1';
const MAX_SAVED_CHATS = 50;
const MAX_IMAGES = 4;
const MAX_IMAGE_SIDE = 1280;
const HISTORY_LIMIT = 30;
const IMAGE_PLACEHOLDER = 'Image upload';

type ChatMessage = { role: 'user' | 'assistant'; content: string; images?: string[] };
type ProviderModels = { provider: string; models: string[] };
type SavedChat = { id: string; name: string; updatedAt: number; messages: ChatMessage[] };
type ApiResponse = {
  error?: string | { message?: string };
  hint?: string;
  providers?: ProviderModels[];
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

const message = ref('');
const loading = ref(false);
const error = ref('');
const history = ref<ChatMessage[]>([]);
const providers = ref<ProviderModels[]>([]);
const selected = ref('');
const messagesEl = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedImages = ref<{ file: File; dataUrl: string }[]>([]);
const chats = ref<SavedChat[]>([]);
const activeChatId = ref<string | null>(null);

onMounted(async () => {
  loadSavedChats();

  try {
    const res = await fetch(API_URL + '?models', { cache: 'no-store' });
    if (!res.ok) throw new Error('server answered ' + res.status);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new Error('/api/worker did not return JSON, so the request is not reaching the worker');
    }

    const data = (await res.json()) as ApiResponse;
    providers.value = Array.isArray(data.providers) ? data.providers : [];
    const first = providers.value[0];
    if (first && Array.isArray(first.models) && first.models.length) {
      selected.value = first.provider + '|' + first.models[0];
    } else {
      error.value = data.hint || 'No models are available. Check your API keys on the server.';
    }
  } catch (err) {
    error.value = 'Could not load models: ' + (err instanceof Error ? err.message : 'network error');
  }
});

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'chat-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function makeChatName(messages: ChatMessage[]) {
  const firstText = messages
    .find((entry) => (entry.content || '').trim())
    ?.content
    .replace(/\s+/g, ' ')
    .trim();

  return firstText ? firstText.slice(0, 30) : 'New chat';
}

function loadSavedChats() {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return;

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    chats.value = (parsed as SavedChat[])
      .filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages))
      .map((c) => {
        const cleanMessages = c.messages.filter(
          (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string',
        );
        return {
          id: c.id,
          name: typeof c.name === 'string' && c.name ? c.name : makeChatName(cleanMessages),
          updatedAt: Number(c.updatedAt) || 0,
          messages: cleanMessages,
        };
      })
      .filter((c) => c.messages.length)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    chats.value = [];
  }
}

function saveChats() {
  let ordered = [...chats.value].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SAVED_CHATS);
  chats.value = ordered;

  while (true) {
    try {
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(ordered));
      return;
    } catch {
      if (ordered.length <= 1) return;
      ordered = ordered.slice(0, ordered.length - 1);
      chats.value = ordered;
    }
  }
}

function persistChat(id: string, messages: ChatMessage[]) {
  const candidate = messages
    .filter((entry) => (entry.content || '').trim())
    .map((entry) => ({ role: entry.role, content: entry.content }));
  if (!candidate.length) return;

  const existing = chats.value.filter((chat) => chat.id !== id);
  chats.value = [{ id, name: makeChatName(candidate), updatedAt: Date.now(), messages: candidate }, ...existing];
  saveChats();
}

function startNewChat() {
  if (loading.value) return;
  history.value = [];
  activeChatId.value = null;
  error.value = '';
  message.value = '';
  selectedImages.value = [];
  if (fileInput.value) fileInput.value.value = '';
}

function openChat(chat: SavedChat) {
  if (loading.value) return;
  history.value = [...(chat.messages || [])];
  activeChatId.value = chat.id;
  error.value = '';
  message.value = '';
  selectedImages.value = [];
  if (fileInput.value) fileInput.value.value = '';
  scrollDown();
}

function readImageData(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth || img.width || 1;
      const height = img.naturalHeight || img.height || 1;
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas unavailable'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to read image'));
    };
    img.src = url;
  });
}

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const room = MAX_IMAGES - selectedImages.value.length;
  const picked = Array.from(input.files || []).filter((file) => file.type.startsWith('image/'));

  if (!picked.length) {
    input.value = '';
    return;
  }

  if (room <= 0) {
    error.value = 'You can attach up to ' + MAX_IMAGES + ' images.';
    input.value = '';
    return;
  }

  const files = picked.slice(0, room);

  const settled = await Promise.allSettled(
    files.map(async (file) => ({
      file,
      dataUrl: await readImageData(file),
    })),
  );

  const results = settled
    .filter((entry): entry is PromiseFulfilledResult<{ file: File; dataUrl: string }> => entry.status === 'fulfilled')
    .map((entry) => entry.value);

  if (results.length) {
    selectedImages.value = [...selectedImages.value, ...results].slice(0, MAX_IMAGES);
  }

  if (results.length < files.length) {
    error.value = results.length ? 'Some images could not be read.' : 'Could not read images.';
  } else if (picked.length > room) {
    error.value = 'You can attach up to ' + MAX_IMAGES + ' images.';
  }

  input.value = '';
}

function removeImage(index: number) {
  selectedImages.value.splice(index, 1);
}

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };

function buildGeminiParts(turns: ChatMessage[]) {
  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = [];

  for (const turn of turns) {
    const parts: GeminiPart[] = [];
    const hasImages = Boolean(turn.images && turn.images.length);
    const isPlaceholder = hasImages && turn.content === IMAGE_PLACEHOLDER;

    if (turn.content && turn.content.trim() && !isPlaceholder) parts.push({ text: turn.content });

    for (const image of turn.images || []) {
      const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1] as string,
            data: match[2] as string,
          },
        });
      }
    }

    if (parts.length) {
      contents.push({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts,
      });
    }
  }

  return contents;
}

function recentTurns() {
  const turns = history.value.slice(-HISTORY_LIMIT);
  while (turns.length && turns[0]?.role === 'assistant') turns.shift();
  return turns;
}

async function scrollDown() {
  await nextTick();
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
}

function onEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  send();
}

async function send() {
  const text = message.value.trim();
  const draftImages = selectedImages.value;
  const hasImages = draftImages.length > 0;
  if ((!text && !hasImages) || loading.value || !selected.value) return;

  const [provider = '', model = ''] = selected.value.split('|');

  if (hasImages && provider !== 'gemini') {
    error.value = 'Image uploads dont work or smth';
    return;
  }

  error.value = '';
  const chatId = activeChatId.value ?? uid();

  const imageUrls = draftImages.map((item) => item.dataUrl);
  const userIndex = history.value.length;
  history.value.push({
    role: 'user',
    content: text || IMAGE_PLACEHOLDER,
    images: imageUrls.length ? imageUrls : undefined,
  });
  message.value = '';
  selectedImages.value = [];
  if (fileInput.value) fileInput.value.value = '';
  loading.value = true;
  scrollDown();

  try {
    const recent = recentTurns();

    const useContents = provider === 'gemini' && recent.some((turn) => turn.images && turn.images.length);

    const payload = useContents
      ? { provider, model, contents: buildGeminiParts(recent) }
      : { provider, model, messages: recent.map((turn) => ({ role: turn.role, content: turn.content })) };

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let data: ApiResponse | null = null;
    try {
      data = (await res.json()) as ApiResponse;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const apiError = data?.error;
      const apiMessage = typeof apiError === 'string' ? apiError : apiError?.message;
      throw new Error(apiMessage || 'Request failed (' + res.status + ')');
    }

    if (!data) throw new Error('Invalid response from server.');

    const reply = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');

    history.value.push({ role: 'assistant', content: reply || '(empty response ig)' });
    activeChatId.value = chatId;
    persistChat(chatId, history.value);
  } catch (err) {
    if (history.value[userIndex]?.role === 'user') {
      history.value.splice(userIndex, 1);
    }

    if (!message.value) message.value = text;
    if (!selectedImages.value.length) selectedImages.value = draftImages;
    error.value = err instanceof Error ? err.message : 'Something went wrong ( of course ).';
  } finally {
    loading.value = false;
    scrollDown();
  }
}
</script>

<template>
  <div class="aiPage">
    <div class="aiShell">
      <aside class="aiSidebar">
        <button class="newChatBtn" type="button" :disabled="loading" @click="startNewChat">
          <Plus :size="16" />
          <span>New chat</span>
        </button>

        <div class="aiChatList">
          <button
            v-for="chat in chats"
            :key="chat.id"
            type="button"
            class="aiChatItem"
            :class="{ active: activeChatId === chat.id }"
            :title="chat.name"
            :disabled="loading"
            @click="openChat(chat)"
          >
            {{ chat.name }}
          </button>
        </div>
      </aside>

      <main class="aiChat">
        <div class="aiMobileBar">
          <button class="aiMobileNew" type="button" :disabled="loading" @click="startNewChat">
            <Plus :size="16" />
            <span>New chat</span>
          </button>
        </div>

        <div v-if="history.length || error" class="aiMessages" ref="messagesEl">
          <div
            v-for="(m, i) in history"
            :key="i"
            class="aiMsg"
            :class="m.role === 'user' ? 'aiMsgUser' : 'aiMsgBot'"
          >
            <div v-if="m.images && m.images.length" class="aiMsgImages">
              <img v-for="(img, imgIndex) in m.images" :key="imgIndex" :src="img" alt="uploaded image" />
            </div>
            <span>{{ m.content }}</span>
          </div>

          <div v-if="loading" class="aiMsg aiMsgBot">...</div>
          <div v-if="error" class="aiError">{{ error }}</div>
        </div>

        <div v-else class="aiEmptyState">
          <div class="aiEmptyTitle">Ask anything.</div>
        </div>

        <div class="aiInputArea" id="aiInputArea">
          <div v-if="selectedImages.length" class="aiUploadRow">
            <div v-for="(image, index) in selectedImages" :key="image.file.name + index" class="aiUploadCard">
              <button class="aiUploadRemove" type="button" aria-label="Remove image" @click="removeImage(index)">
                <X :size="12" />
              </button>
              <img :src="image.dataUrl" :alt="image.file.name" />
            </div>
          </div>

          <div class="aiComposer">
            <div class="aiModelWrap">
              <select
                v-model="selected"
                class="aiModelSelect"
                id="aiModel"
                name="model"
                aria-label="Choose model"
                :disabled="!providers.length"
              >
                <option v-if="!providers.length" value="" disabled>No models</option>
                <optgroup v-for="p in providers" :key="p.provider" :label="p.provider">
                  <option v-for="m in p.models" :key="m" :value="p.provider + '|' + m">{{ m }}</option>
                </optgroup>
              </select>
              <ChevronDown class="aiModelChevron" :size="16" />
            </div>

            <label class="aiAttachBtn" title="Upload image">
              <input ref="fileInput" type="file" accept="image/*" multiple @change="handleFiles" />
              <Paperclip :size="18" />
            </label>

            <input
              v-model="message"
              class="aiInput"
              id="aiMessage"
              name="message"
              type="text"
              placeholder="Type Here..."
              @keydown.enter="onEnter"
            >

            <button
              class="sendBtn"
              id="aiSendButton"
              type="button"
              aria-label="Send message"
              :disabled="loading || (!message.trim() && !selectedImages.length) || !selected"
              @click="send"
            >
              <Send class="sendIcon" />
            </button>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.aiPage {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

.aiShell {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.aiSidebar {
  display: flex;
  flex-direction: column;
  width: 240px;
  min-width: 240px;
  box-sizing: border-box;
  padding: 12px 10px;
  border-right: 2px solid var(--sg-border);
  background: var(--sg-surface);
  min-height: 0;
}

.newChatBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border: 2px solid var(--sg-border);
  border-radius: 8px;
  background: var(--sg-surface);
  color: var(--sg-text);
  font-size: 0.95rem;
  font-family: inherit;
  cursor: pointer;
}

.newChatBtn:disabled,
.aiChatItem:disabled,
.aiMobileNew:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.aiChatList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  overflow-y: auto;
  min-height: 0;
}

.aiChatItem {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--sg-border);
  border-radius: 8px;
  background: transparent;
  color: var(--sg-text);
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.aiChatItem.active {
  background: var(--sg-surface);
}

.aiChat {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.aiMobileBar {
  display: none;
}

.aiMobileNew {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  border: 2px solid var(--sg-border);
  border-radius: 8px;
  background: var(--sg-surface);
  color: var(--sg-text);
  font-size: 0.9rem;
  font-family: inherit;
  cursor: pointer;
}

.aiMessages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 18px clamp(14px, 3vw, 32px) 14px;
}

.aiMsg {
  max-width: 85%;
  padding: 10px 14px;
  border: 2px solid var(--sg-border);
  border-radius: 12px;
  background: var(--sg-surface);
  color: var(--sg-text);
  font-size: 1rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.aiMsgUser {
  align-self: flex-end;
}

.aiMsgBot {
  align-self: flex-start;
}

.aiMsgImages {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}

.aiMsgImages img {
  width: 128px;
  height: 128px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--sg-border);
}

.aiError {
  color: var(--sg-text-muted);
  font-size: 0.9rem;
}

.aiEmptyState {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 20px;
  color: var(--sg-text-muted);
}

.aiEmptyTitle {
  font-size: clamp(1.2rem, 2vw, 2rem);
}

.aiInputArea {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 0 clamp(14px, 3vw, 32px) 20px;
  animation: fadeIn 200ms ease-out 200ms both;
}

.aiUploadRow {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  width: min(100%, 900px);
  margin: 0 auto;
}

.aiUploadCard {
  position: relative;
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  border: 2px solid var(--sg-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--sg-surface);
}

.aiUploadCard img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.aiUploadRemove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  cursor: pointer;
  padding: 0;
}

.aiComposer {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 900px);
  margin: 0 auto;
}

.aiModelWrap {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
}

.aiModelChevron {
  position: absolute;
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
  color: var(--sg-text-muted);
  pointer-events: none;
}

.aiModelSelect {
  -webkit-appearance: none;
  appearance: none;
  flex-shrink: 0;
  max-width: 160px;
  height: 50px;
  padding: 0 34px 0 14px;
  line-height: 46px;
  box-sizing: border-box;
  border: 2px solid var(--sg-border);
  border-radius: 6px;
  background: var(--sg-surface);
  color: var(--sg-text);
  font-size: 1rem;
  font-family: inherit;
  cursor: pointer;
}

.aiModelSelect:focus {
  outline: none;
}

.aiAttachBtn {
  width: 42px;
  height: 42px;
  border: 2px solid var(--sg-border);
  border-radius: 6px;
  background: var(--sg-surface);
  color: var(--sg-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.aiAttachBtn input {
  display: none;
}

.aiInput {
  flex: 1;
  min-width: 0;
  resize: none;
  padding: 12px 16px;
  border: 2px solid var(--sg-border);
  border-radius: 6px;
  background: var(--sg-surface);
  color: var(--sg-text);
  font-size: 1rem;
  font-family: inherit;
  height: 50px;
  max-height: 50px;
  width: 100%;
  overflow: hidden;
  box-sizing: border-box;
  line-height: 26px;
}

.aiInput::placeholder {
  color: var(--sg-text-muted);
  opacity: 1;
}

.aiInput:focus {
  outline: none;
}

.sendBtn {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  padding: 0;
  box-sizing: border-box;
  border: 2px solid var(--sg-border);
  border-radius: 6px;
  background: var(--sg-surface);
  color: var(--sg-accent-soft);
  font-size: 1.1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.sendBtn .sendIcon {
  color: var(--sg-text-muted);
}

.sendBtn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 900px) {
  .aiSidebar {
    display: none;
  }

  .aiMobileBar {
    display: flex;
    justify-content: flex-end;
    padding: 10px clamp(14px, 3vw, 32px) 0;
  }
}

@media (max-width: 600px) {
  .aiInputArea {
    gap: 8px;
    padding: 0 10px 12px;
  }

  .aiMessages {
    padding: 12px 10px 10px;
  }

  .aiMobileBar {
    padding: 8px 10px 0;
  }

  .aiModelSelect {
    max-width: 110px;
    padding: 0 28px 0 10px;
  }

  .aiComposer {
    gap: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aiInputArea { animation: none; }
}
</style>
