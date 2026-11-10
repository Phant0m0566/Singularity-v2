export function initializeChatSocket() {
  const MESSAGE_COOLDOWN_MS = 500;
  const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;
  const MAX_MESSAGE_HISTORY = 200;
  const SCROLL_THRESHOLD_PX = 80;
  const DISPLAY_NAME_STORAGE_KEY = "aurelium-chat-display-name";
  const PRODUCTION_CHAT_BACKEND_URL = "https://aurelium.pages.dev";
  const root = document.querySelector("[data-chat-root]");
  if (!root) {
    throw new Error("Chat root element was not found.");
  }

  function getRequiredElement(id) {
    const element = root.querySelector(`#${id}`);
    if (!element) {
      throw new Error(`Chat element #${id} was not found.`);
    }
    return element;
  }

  const joinPanel = getRequiredElement("chatJoinPanel");
  const joinForm = getRequiredElement("chatJoinForm");
  const nameInput = getRequiredElement("chatName");
  const passwordInput = getRequiredElement("chatPassword");
  const joinButton = getRequiredElement("chatJoinButton");
  const joinError = getRequiredElement("chatJoinError");
  const room = getRequiredElement("chatRoom");
  const roomError = getRequiredElement("chatRoomError");
  const messages = getRequiredElement("chatMessages");
  const messageForm = getRequiredElement("chatMessageForm");
  const messageInput = getRequiredElement("chatMessage");
  const sendButton = getRequiredElement("chatSendButton");
  const listeners = new AbortController();
  const state = {
    active: false,
    displayName: "",
    password: "",
    joined: false,
    lastMessageSentAt: 0,
    nameKey: "",
    nameSaveFailed: false,
    reconnectTimer: null,
    sendTimer: null,
    socket: null
  };

  function setSendEnabled(enabled) {
    messageInput.disabled = !enabled;
    sendButton.disabled = !enabled;
  }

  function showJoinError(message) {
    joinError.textContent = message;
  }

  function normalizeDisplayName(value) {
    if (typeof value !== "string") return "";
    return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()).slice(0, 24).join("");
  }

  function getDisplayNameKey(value) {
    return normalizeDisplayName(value).normalize("NFKC").toLowerCase();
  }

  function saveDisplayName(name) {
    try {
      localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, name);
      return true;
    } catch (error) {
      console.error("Unable to save username.", error);
      return false;
    }
  }

  function showRoomError(message) {
    roomError.textContent = message;
    roomError.hidden = !message;
  }

  function showConnectionError(message) {
    if (joinPanel.hidden) {
      showRoomError(message);
    } else {
      showJoinError(message);
    }
  }

  function resetMessages() {
    messages.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "chatEmpty";
    empty.id = "chatEmpty";
    empty.textContent = "No messages yet, say hi.";
    messages.appendChild(empty);
  }

  function createMessageMeta(displayName, timestamp) {
    const header = document.createElement("div");
    header.className = "messageMeta";

    const name = document.createElement("span");
    name.className = "messageName";
    name.textContent = displayName;
    header.appendChild(name);

    if (Number.isFinite(timestamp)) {
      const messageDate = new Date(timestamp);
      if (!Number.isNaN(messageDate.getTime())) {
        const separator = document.createElement("span");
        separator.className = "messageSeparator";
        separator.textContent = "\u2022";

        const time = document.createElement("time");
        time.className = "messageTime";
        time.dateTime = messageDate.toISOString();
        time.textContent = messageDate.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit"
        });

        header.append(separator, time);
      }
    }
    return header;
  }

  function isNearBottom() {
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight <= SCROLL_THRESHOLD_PX;
  }

  function appendMessage(message, forceScroll) {
    if (!message || typeof message.name !== "string" || typeof message.text !== "string") return;
    const displayName = normalizeDisplayName(message.name);
    if (!displayName) return;

    const shouldScroll = Boolean(forceScroll) || isNearBottom();

    const empty = root.querySelector("#chatEmpty");
    if (empty) empty.remove();

    const authorKey = getDisplayNameKey(displayName);
    const isOwnMessage = state.nameKey !== "" && authorKey === state.nameKey;
    const timestamp = Number(message.timestamp);
    const previous = messages.lastElementChild;
    const previousTimestamp = Number(previous && previous.dataset.timestamp);
    const isContinuation = Boolean(
      previous
      && previous.classList.contains("message")
      && previous.dataset.authorKey === authorKey
      && previous.classList.contains(isOwnMessage ? "user" : "bot")
      && Number.isFinite(timestamp)
      && Number.isFinite(previousTimestamp)
      && timestamp >= previousTimestamp
      && timestamp - previousTimestamp <= MESSAGE_GROUP_WINDOW_MS
    );
    const item = document.createElement("div");
    item.className = `message ${isOwnMessage ? "user" : "bot"}${isContinuation ? " is-continuation" : ""}`;
    item.dataset.authorKey = authorKey;
    item.dataset.displayName = displayName;
    if (typeof message.id === "string") {
      item.dataset.messageId = message.id;
    }
    if (Number.isFinite(timestamp)) {
      item.dataset.timestamp = String(timestamp);
    }

    const content = document.createElement("div");
    content.className = "messageContent";
    if (!isContinuation) {
      content.appendChild(createMessageMeta(displayName, timestamp));
    }

    const bubble = document.createElement("div");
    bubble.className = "messageBubble";
    bubble.textContent = message.text;

    content.appendChild(bubble);
    item.appendChild(content);
    messages.appendChild(item);

    while (messages.querySelectorAll(".message").length > MAX_MESSAGE_HISTORY) {
      messages.querySelector(".message").remove();
      const firstRemaining = messages.querySelector(".message");
      if (firstRemaining && firstRemaining.classList.contains("is-continuation")) {
        firstRemaining.classList.remove("is-continuation");
        const firstContent = firstRemaining.querySelector(".messageContent");
        if (firstContent && !firstContent.querySelector(".messageMeta")) {
          firstContent.prepend(createMessageMeta(
            firstRemaining.dataset.displayName,
            Number(firstRemaining.dataset.timestamp)
          ));
        }
      }
    }

    if (shouldScroll) {
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function renderHistory(history) {
    messages.replaceChildren();
    if (!Array.isArray(history) || history.length === 0) {
      resetMessages();
      return;
    }
    history.forEach(function(entry) {
      appendMessage(entry, true);
    });
    messages.scrollTop = messages.scrollHeight;
  }

  function updateMessage(message) {
    if (!message || typeof message.id !== "string" || typeof message.text !== "string") return;
    for (const item of messages.querySelectorAll(".message")) {
      if (item.dataset.messageId !== message.id) continue;
      const bubble = item.querySelector(".messageBubble");
      if (bubble) bubble.textContent = message.text;
      return;
    }
  }

  function sendJoin(socket, name, password) {
    socket.send(JSON.stringify({
      type: "join",
      name,
      password
    }));
  }

  function sendWatch(socket) {
    socket.send(JSON.stringify({
      type: "watch"
    }));
  }

  function showJoinPanel() {
    joinPanel.hidden = false;
    room.setAttribute("inert", "");
    setSendEnabled(false);
  }

  function rejectJoin(message) {
    state.displayName = "";
    state.password = "";
    state.joined = false;
    joinButton.disabled = false;
    showJoinPanel();
    showRoomError("");
    showJoinError(message);
    passwordInput.value = "";
    passwordInput.focus();
  }

  function getChatSiteScope() {
    const scope = new URL(window.location.href);
    scope.search = "";
    scope.hash = "";
    scope.pathname = scope.pathname.replace(/\/chat(?:\/index\.html|\.html)?\/?$/i, "/") || "/";
    return scope.href;
  }

  function getChatBackendUrl() {
    if (window.__AURELIUM_CANONICAL_URL) return window.__AURELIUM_CANONICAL_URL;
    return PRODUCTION_CHAT_BACKEND_URL;
  }

  function connect() {
    if (!state.active) return;
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    state.joined = false;
    setSendEnabled(false);

    const chatUrl = new URL("/api/chat", getChatBackendUrl());
    chatUrl.protocol = chatUrl.protocol === "https:" ? "wss:" : "ws:";
    chatUrl.searchParams.set("scope", getChatSiteScope());
    const socket = new WebSocket(chatUrl.href);
    state.socket = socket;

    socket.addEventListener("open", function() {
      if (state.socket !== socket || !state.active) return;
      showJoinError("");
      showRoomError("");
      if (state.displayName && state.password) {
        sendJoin(socket, state.displayName, state.password);
      } else {
        sendWatch(socket);
      }
    });

    socket.addEventListener("message", function(event) {
      if (state.socket !== socket || !state.active) return;

      let packet;
      try {
        packet = JSON.parse(event.data);
      } catch (error) {
        showConnectionError("invalid chat response.");
        return;
      }

      if (!packet || typeof packet !== "object") return;

      if (packet.type === "history") {
        const joinedName = normalizeDisplayName(packet.name);
        state.joined = Boolean(joinedName);
        if (joinedName) {
          state.nameKey = getDisplayNameKey(joinedName);
        } else if (!state.displayName) {
          state.nameKey = "";
        }
        state.lastMessageSentAt = 0;
        renderHistory(packet.messages);
        messageForm.hidden = false;
        if (state.joined) {
          state.displayName = joinedName;
          state.nameSaveFailed = !saveDisplayName(joinedName);
          joinPanel.hidden = true;
          joinButton.disabled = false;
          passwordInput.value = "";
          room.removeAttribute("inert");
          showJoinError("");
          showRoomError(state.nameSaveFailed ? "Your username could not be saved." : "");
          setSendEnabled(true);
          messageInput.focus();
        } else {
          room.setAttribute("inert", "");
          showRoomError("");
          setSendEnabled(false);
        }
      } else if (packet.type === "message-update") {
        updateMessage(packet.message);
      } else if (packet.type === "message") {
        appendMessage(packet.message, false);
        showRoomError("");
      } else if (packet.type === "error") {
        if (!state.joined && state.displayName) {
          rejectJoin(packet.message || "Could not join the chat.");
        } else {
          showConnectionError(packet.message || "Chat request failed.");
        }
      }
    });

    socket.addEventListener("close", function() {
      if (state.socket !== socket || !state.active) return;
      state.socket = null;
      showConnectionError("Chat connection lost. Retrying...");
      state.joined = false;
      setSendEnabled(false);
      state.reconnectTimer = setTimeout(function() {
        connect();
      }, 1500);
    });
  }

  joinForm.addEventListener("submit", function(event) {
    event.preventDefault();
    const name = normalizeDisplayName(nameInput.value);
    const password = passwordInput.value;
    if (!name) {
      showJoinError("Enter a username to join.");
      nameInput.focus();
      return;
    }
    if (!password) {
      showJoinError("Enter a password to join.");
      passwordInput.focus();
      return;
    }
    state.displayName = name;
    state.password = password;
    state.active = true;
    joinButton.disabled = true;
    room.setAttribute("inert", "");
    showJoinError("");
    showRoomError("");
    setSendEnabled(false);
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      sendJoin(state.socket, name, password);
    } else if (!state.socket || state.socket.readyState >= WebSocket.CLOSING) {
      connect();
    }
  }, { signal: listeners.signal });

  messageForm.addEventListener("submit", function(event) {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !state.joined || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    if (Date.now() - state.lastMessageSentAt < MESSAGE_COOLDOWN_MS) return;

    const socket = state.socket;
    try {
      socket.send(JSON.stringify({
        type: "message",
        text
      }));
      state.lastMessageSentAt = Date.now();
      sendButton.disabled = true;
      clearTimeout(state.sendTimer);
      state.sendTimer = setTimeout(function() {
        state.sendTimer = null;
        if (state.socket === socket && state.joined && socket.readyState === WebSocket.OPEN) {
          sendButton.disabled = false;
        }
      }, MESSAGE_COOLDOWN_MS + 50);
      messageInput.value = "";
      messageInput.focus();
    } catch (error) {
      showRoomError("Message could not be sent.");
    }
  }, { signal: listeners.signal });

  function cleanup() {
    state.active = false;
    state.joined = false;
    state.password = "";
    listeners.abort();
    clearTimeout(state.reconnectTimer);
    clearTimeout(state.sendTimer);
    state.reconnectTimer = null;
    state.sendTimer = null;
    const socket = state.socket;
    state.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, "Navigated away");
    }
  }

  let savedName = "";
  try {
    savedName = normalizeDisplayName(localStorage.getItem(DISPLAY_NAME_STORAGE_KEY) || "");
  } catch (error) {
    console.error("Unable to read the username.", error);
    showJoinError("Could not load your username.");
  }

  if (savedName) {
    nameInput.value = savedName;
    passwordInput.focus();
  }

  state.active = true;
  connect();

  return cleanup;
}
