(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const config = window.CHATIKI_CONFIG || {};

  let sb = null;
  let currentUser = null;
  let currentProfile = null;
  let activeChatId = null;
  let refreshTimer = null;
  let busy = false;

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  function notify(message, type = "info") {
    const authView = $("authView");
    const authMessage = $("authMessage");

    if (authView && !authView.hidden && authMessage) {
      authMessage.textContent = message;
      authMessage.dataset.type = type;
      return;
    }

    const friendMessage = $("friendMessage");

    if (
      $("friendsPanel") &&
      !$("friendsPanel").hidden &&
      friendMessage
    ) {
      friendMessage.textContent = message;
      friendMessage.dataset.type = type;
      return;
    }

    alert(message);
  }

  function initSupabase() {
    if (!window.supabase?.createClient) {
      throw new Error(
        "Supabase не загрузился. Проверь интернет и подключение библиотеки в index.html."
      );
    }

    if (
      !config.SUPABASE_URL ||
      !config.SUPABASE_PUBLISHABLE_KEY
    ) {
      throw new Error(
        "Не найдены настройки Supabase в config.js."
      );
    }

    sb = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_PUBLISHABLE_KEY
    );
  }

  // =========================
  // АВТОРИЗАЦИЯ
  // =========================

  function setAuthMode(mode) {
    const isRegister = mode === "register";

    if ($("loginBox")) {
      $("loginBox").hidden = false;
    }

    if ($("registerBox")) {
      $("registerBox").hidden = !isRegister;
    }

    $("loginTab")?.classList.toggle(
      "active",
      !isRegister
    );

    $("registerTab")?.classList.toggle(
      "active",
      isRegister
    );

    if ($("submitAuth")) {
      $("submitAuth").textContent = isRegister
        ? "Создать аккаунт"
        : "Войти";
    }

    if ($("authMessage")) {
      $("authMessage").textContent = "";
    }
  }

  function setBusy(value) {
    busy = value;

    if ($("submitAuth")) {
      $("submitAuth").disabled = value;
      $("submitAuth").textContent = value
        ? "Подождите..."
        : "Войти";
    }
  }

  async function handleAuth(event) {
    event?.preventDefault();

    if (busy) return;

    const isRegister =
      $("registerBox") &&
      !$("registerBox").hidden;

    if (isRegister) {
      await register();
    } else {
      await login();
    }
  }

  async function register() {
    const username =
      $("usernameInput")?.value.trim() || "";

    const email =
      $("emailInput")?.value.trim() || "";

    const password =
      $("passwordInput")?.value || "";

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      notify(
        "Имя должно содержать 3–24 символа: латинские буквы, цифры или _."
      );
      return;
    }

    if (!email || password.length < 6) {
      notify(
        "Введи почту и пароль минимум из 6 символов."
      );
      return;
    }

    try {
      setBusy(true);

      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { username }
        }
      });

      if (error) throw error;

      if (data.session && data.user) {
        currentUser = data.user;

        await loadProfile();
        showMainView();
      } else {
        setAuthMode("login");

        if ($("passwordInput")) {
          $("passwordInput").value = "";
        }

        notify(
          "Аккаунт создан! Теперь попробуй войти."
        );
      }
    } catch (error) {
      console.error("register:", error);

      notify(
        "Ошибка регистрации: " + error.message,
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    const email =
      $("emailInput")?.value.trim() || "";

    const password =
      $("passwordInput")?.value || "";

    if (!email || !password) {
      notify("Введи почту и пароль.");
      return;
    }

    try {
      setBusy(true);

      const { data, error } =
        await sb.auth.signInWithPassword({
          email,
          password
        });

      if (error) throw error;

      currentUser = data.user;

      await loadProfile();
      showMainView();

    } catch (error) {
      console.error("login:", error);

      notify(
        "Ошибка входа: " + error.message,
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreSession() {
    const { data, error } =
      await sb.auth.getSession();

    if (error) throw error;

    if (!data.session?.user) return;

    currentUser = data.session.user;

    try {
      await loadProfile();
      showMainView();
    } catch (error) {
      console.error("restoreSession:", error);
      notify(
        "Не удалось загрузить профиль: " +
        error.message
      );
    }
  }

  // =========================
  // ПРОФИЛЬ
  // =========================

  async function loadProfile() {
    if (!currentUser) {
      throw new Error("Пользователь не авторизован.");
    }

    const { data, error } = await sb
      .from("profiles")
      .select(
        "id, username, friend_id, avatar_url, role, created_at"
      )
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error(
        "Профиль не найден. Проверь функцию создания профиля в Supabase."
      );
    }

    currentProfile = data;
    renderProfile();
  }

  function myIdentifier() {
    return currentProfile?.friend_id ||
      currentUser?.id ||
      "";
  }

  function renderProfile() {
    if (!currentProfile) return;

    const username =
      currentProfile.username || "Пользователь";

    if ($("welcomeName")) {
      $("welcomeName").textContent = username;
    }

    if ($("profileName")) {
      $("profileName").textContent = username;
    }

    if ($("profileEmail")) {
      $("profileEmail").textContent =
        currentUser?.email || "";
    }

    if ($("profileId")) {
      $("profileId").textContent = myIdentifier();
    }

    if ($("avatar")) {
      $("avatar").textContent =
        username.charAt(0).toUpperCase();
    }

    if ($("roleBadge")) {
      $("roleBadge").textContent =
        currentProfile.role === "admin"
          ? "Администратор"
          : "Пользователь";
    }
  }

  // =========================
  // ЭКРАНЫ И НАВИГАЦИЯ
  // =========================

  function showMainView() {
    if ($("authView")) {
      $("authView").hidden = true;
    }

    if ($("mainView")) {
      $("mainView").hidden = false;
    }

    if ($("authScreen")) {
      $("authScreen").hidden = true;
    }

    if ($("mainScreen")) {
      $("mainScreen").hidden = false;
    }

    renderProfile();
    ensureMessengerUI();
    showPanel("chatsPanel");

    refreshAll();

    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshAll, 5000);
  }

  function showPanel(panelId) {
    const panels = [
      "chatsPanel",
      "friendsPanel",
      "profilePanel"
    ];

    panels.forEach(id => {
      const panel = $(id);

      if (panel) {
        panel.hidden = id !== panelId;
      }
    });

    document
      .querySelectorAll("[data-panel]")
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.panel === panelId
        );
      });

    if (panelId === "chatsPanel") {
      refreshChats();
    }

    if (panelId === "friendsPanel") {
      refreshFriends();
    }
  }

  function ensureMessengerUI() {
    const chatsPanel = $("chatsPanel");

    if (chatsPanel && !$("chatMessages")) {
      const area = document.createElement("div");

      area.id = "chatMessages";
      area.className = "chat-messages";

      chatsPanel.appendChild(area);
    }

    if (chatsPanel && !$("messageInput")) {
      const form = document.createElement("form");

      form.id = "messageForm";
      form.innerHTML = `
        <input
          id="messageInput"
          type="text"
          maxlength="4000"
          placeholder="Напиши сообщение..."
          autocomplete="off"
          required
        >
        <button type="submit">Отправить</button>
      `;

      chatsPanel.appendChild(form);

      form.addEventListener("submit", sendMessage);
    }
  }

  // =========================
  // ПОИСК ПОЛЬЗОВАТЕЛЕЙ
  // =========================

  async function searchUsers() {
    const input =
      $("friendSearchInput") ||
      $("searchFriendInput");

    const query = input?.value.trim() || "";

    if (query.length < 3) {
      notify(
        "Введи минимум 3 символа для поиска."
      );
      return;
    }

    try {
      const { data, error } = await sb
        .from("profiles")
        .select("id, username, friend_id, avatar_url")
        .ilike("username", `%${query}%`)
        .neq("id", currentUser.id)
        .limit(20);

      if (error) throw error;

      renderSearchResults(data || []);

      if (!data?.length) {
        notify("Пользователи не найдены.");
      }
    } catch (error) {
      console.error("searchUsers:", error);

      notify(
        "Ошибка поиска: " + error.message,
        "error"
      );
    }
  }

  function renderSearchResults(users) {
    const container =
      $("friendSearchResults") ||
      $("searchResults") ||
      $("friendsList");

    if (!container) return;

    container.innerHTML = users.map(user => `
      <div class="user-card">
        <div class="user-info">
          <strong>${escapeHTML(user.username)}</strong>
          <small>${escapeHTML(user.friend_id || "")}</small>
        </div>
        <button
          type="button"
          data-add-friend="${escapeHTML(user.id)}"
        >
          Добавить
        </button>
      </div>
    `).join("");

    container
      .querySelectorAll("[data-add-friend]")
      .forEach(button => {
        button.addEventListener("click", () => {
          sendFriendRequest(button.dataset.addFriend);
        });
      });
  }

  // =========================
  // ДРУЗЬЯ И ЗАЯВКИ
  // =========================

  async function sendFriendRequest(targetUserId) {
    if (!targetUserId || targetUserId === currentUser.id) {
      notify("Нельзя добавить самого себя.");
      return;
    }

    try {
      const { error } = await sb
        .from("friends")
        .insert({
          user_id: currentUser.id,
          friend_user_id: targetUserId,
          status: "pending"
        });

      if (error) throw error;

      notify("Заявка в друзья отправлена!");
      await refreshFriends();

    } catch (error) {
      console.error("sendFriendRequest:", error);

      notify(
        "Не удалось отправить заявку: " +
        error.message,
        "error"
      );
    }
  }

  async function refreshFriends() {
    if (!currentUser) return;

    const container = $("friendsList");

    try {
      const { data, error } = await sb
        .from("friends")
        .select(`
          id,
          user_id,
          friend_user_id,
          status,
          created_at
        `)
        .or(
          `user_id.eq.${currentUser.id},friend_user_id.eq.${currentUser.id}`
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rows = data || [];
      const userIds = [
        ...new Set(
          rows.map(row =>
            row.user_id === currentUser.id
              ? row.friend_user_id
              : row.user_id
          )
        )
      ];

      let profiles = [];

      if (userIds.length) {
        const result = await sb
          .from("profiles")
          .select("id, username, friend_id, avatar_url")
          .in("id", userIds);

        if (result.error) throw result.error;

        profiles = result.data || [];
      }

      const byId = new Map(
        profiles.map(profile => [profile.id, profile])
      );

      if (!container) return;

      container.innerHTML = rows.map(row => {
        const otherId =
          row.user_id === currentUser.id
            ? row.friend_user_id
            : row.user_id;

        const person = byId.get(otherId);
        const name = person?.username || "Пользователь";

        const incoming =
          row.friend_user_id === currentUser.id &&
          row.status === "pending";

        let buttons = "";

        if (incoming) {
          buttons = `
            <button
              type="button"
              data-accept="${escapeHTML(row.id)}"
            >Принять</button>
            <button
              type="button"
              data-reject="${escapeHTML(row.id)}"
            >Отклонить</button>
          `;
        } else if (row.status === "accepted") {
          buttons = `
            <button
              type="button"
              data-open-chat="${escapeHTML(otherId)}"
            >Написать</button>
          `;
        }

        return `
          <div class="user-card">
            <div class="user-info">
              <strong>${escapeHTML(name)}</strong>
              <small>${escapeHTML(row.status)}</small>
            </div>
            <div class="user-actions">${buttons}</div>
          </div>
        `;
      }).join("");

      container
        .querySelectorAll("[data-accept]")
        .forEach(button => {
          button.addEventListener("click", () =>
            respondToFriendRequest(
              button.dataset.accept,
              true
            )
          );
        });

      container
        .querySelectorAll("[data-reject]")
        .forEach(button => {
          button.addEventListener("click", () =>
            respondToFriendRequest(
              button.dataset.reject,
              false
            )
          );
        });

      container
        .querySelectorAll("[data-open-chat]")
        .forEach(button => {
          button.addEventListener("click", () =>
            openDirectChat(button.dataset.openChat)
          );
        });

    } catch (error) {
      console.error("refreshFriends:", error);

      if (container) {
        container.textContent =
          "Не удалось загрузить друзей: " +
          error.message;
      }
    }
  }

  async function respondToFriendRequest(requestId, accept) {
    try {
      const { error } = await sb.rpc(
        "respond_to_friend_request",
        {
          p_request_id: requestId,
          p_accept: accept
        }
      );

      if (error) throw error;

      notify(
        accept
          ? "Заявка принята!"
          : "Заявка отклонена."
      );

      await refreshFriends();

      if (accept) {
        await refreshChats();
      }

    } catch (error) {
      console.error("respondToFriendRequest:", error);

      notify(
        "Ошибка обработки заявки: " +
        error.message,
        "error"
      );
    }
  }

  // =========================
  // ЧАТЫ
  // =========================

  async function openDirectChat(targetFriendId) {
    try {
      const { data, error } = await sb.rpc(
        "create_direct_chat",
        {
          target_friend_id: targetFriendId
        }
      );

      if (error) throw error;

      activeChatId = typeof data === "string"
        ? data
        : data?.chat_id || data?.id || null;

      if (!activeChatId) {
        throw new Error(
          "Функция не вернула ID чата."
        );
      }

      showPanel("chatsPanel");
      await refreshChats();
      await refreshMessages();

    } catch (error) {
      console.error("openDirectChat:", error);

      notify(
        "Не удалось открыть чат: " +
        error.message,
        "error"
      );
    }
  }

  async function refreshChats() {
    if (!currentUser) return;

    const container = $("chatList");

    try {
      const { data: memberships, error } = await sb
        .from("chat_members")
        .select("chat_id, joined_at")
        .eq("user_id", currentUser.id)
        .order("joined_at", { ascending: false });

      if (error) throw error;

      const chats = memberships || [];

      if (!container) return;

      if (!chats.length) {
        container.innerHTML =
          "<p>Пока нет чатов. Добавь друга и начни переписку!</p>";
        return;
      }

      container.innerHTML = chats.map(chat => `
        <button
          type="button"
          class="chat-item"
          data-chat-id="${escapeHTML(chat.chat_id)}"
        >
          💬 Чат
        </button>
      `).join("");

      container
        .querySelectorAll("[data-chat-id]")
        .forEach(button => {
          button.addEventListener("click", async () => {
            activeChatId = button.dataset.chatId;
            await refreshMessages();
          });
        });

      if (!activeChatId && chats.length) {
        activeChatId = chats[0].chat_id;
        await refreshMessages();
      }

    } catch (error) {
      console.error("refreshChats:", error);

      if (container) {
        container.textContent =
          "Ошибка загрузки чатов: " +
          error.message;
      }
    }
  }

  // =========================
  // СООБЩЕНИЯ
  // =========================

  async function refreshMessages() {
    if (!currentUser || !activeChatId) return;

    const container = $("chatMessages");

    if (!container) return;

    try {
      const { data, error } = await sb
        .from("messages")
        .select(
          "id, chat_id, sender_id, content, created_at, edited_at"
        )
        .eq("chat_id", activeChatId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw error;

      const messages = data || [];

      container.innerHTML = messages.map(message => {
        const own =
          message.sender_id === currentUser.id;

        const time = message.created_at
          ? new Date(message.created_at)
              .toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
              })
          : "";

        return `
          <div class="message ${own ? "own" : ""}">
            <div class="message-content">
              ${escapeHTML(message.content)}
            </div>
            <small>${escapeHTML(time)}</small>
          </div>
        `;
      }).join("");

      container.scrollTop = container.scrollHeight;

    } catch (error) {
      console.error("refreshMessages:", error);

      container.textContent =
        "Не удалось загрузить сообщения: " +
        error.message;
    }
  }

  async function sendMessage(event) {
    event?.preventDefault();

    const input = $("messageInput");
    const content = input?.value.trim();

    if (!content) return;

    if (!activeChatId) {
      notify("Сначала открой чат.");
      return;
    }

    try {
      const { error } = await sb
        .from("messages")
        .insert({
          chat_id: activeChatId,
          sender_id: currentUser.id,
          content
        });

      if (error) throw error;

      input.value = "";

      await refreshMessages();

    } catch (error) {
      console.error("sendMessage:", error);

      notify(
        "Не удалось отправить сообщение: " +
        error.message,
        "error"
      );
    }
  }

  // =========================
  // ОБНОВЛЕНИЕ
  // =========================

  async function refreshAll() {
    if (!currentUser) return;

    try {
      await Promise.allSettled([
        refreshFriends(),
        refreshChats()
      ]);

      if (activeChatId) {
        await refreshMessages();
      }
    } catch (error) {
      console.error("refreshAll:", error);
    }
  }

  // =========================
  // ВЫХОД
  // =========================

  async function logout() {
    clearInterval(refreshTimer);

    try {
      const { error } = await sb.auth.signOut();

      if (error) throw error;

      currentUser = null;
      currentProfile = null;
      activeChatId = null;

      if ($("mainView")) {
        $("mainView").hidden = true;
      }

      if ($("authView")) {
        $("authView").hidden = false;
      }

      if ($("mainScreen")) {
        $("mainScreen").hidden = true;
      }

      if ($("authScreen")) {
        $("authScreen").hidden = false;
      }

      setAuthMode("login");

    } catch (error) {
      console.error("logout:", error);

      notify(
        "Ошибка выхода: " + error.message,
        "error"
      );
    }
  }

  // =========================
  // ЗАПУСК И СОБЫТИЯ
  // =========================

  function bindEvents() {
    $("loginTab")?.addEventListener(
      "click",
      () => setAuthMode("login")
    );

    $("registerTab")?.addEventListener(
      "click",
      () => setAuthMode("register")
    );

    $("submitAuth")?.addEventListener(
      "click",
      handleAuth
    );

    $("friendSearchBtn")?.addEventListener(
      "click",
      searchUsers
    );

    $("searchFriendBtn")?.addEventListener(
      "click",
      searchUsers
    );

    $("friendSearchInput")?.addEventListener(
      "keydown",
      event => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchUsers();
        }
      }
    );

    $("searchFriendInput")?.addEventListener(
      "keydown",
      event => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchUsers();
        }
      }
    );

    document
      .querySelectorAll("[data-panel]")
      .forEach(button => {
        button.addEventListener("click", () => {
          showPanel(button.dataset.panel);
        });
      });

    $("logoutBtn")?.addEventListener(
      "click",
      logout
    );

    $("logoutButton")?.addEventListener(
      "click",
      logout
    );

    $("messageForm")?.addEventListener(
      "submit",
      sendMessage
    );
  }

  async function start() {
    bindEvents();

    try {
      initSupabase();
      setAuthMode("login");
      await restoreSession();
    } catch (error) {
      console.error("Chatiki startup:", error);

      notify(
        "Ошибка запуска Chatiki: " + error.message,
        "error"
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
