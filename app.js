(() => {
  "use strict";

  // ==========================================
  // CHATIKI — ОСНОВНОЙ КОД ПРИЛОЖЕНИЯ
  // ==========================================

  let sb = null;
  let currentUser = null;
  let currentProfile = null;
  let activeChatId = null;
  let activeChatName = "";
  let refreshTimer = null;
  let busy = false;

  const $ = (id) => document.getElementById(id);

  const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  const isUUID = (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value ?? "";
  }

  function showMessage(id, message, success = false) {
    const element = $(id);
    if (!element) return;

    element.textContent = message;
    element.style.color = success ? "#36b37e" : "#ff7373";
  }

  function showAuthMessage(message, success = false) {
    showMessage("authMessage", message, success);
  }

  function friendlyError(error) {
    const message = error?.message || String(error || "Неизвестная ошибка");

    if (/Invalid login credentials/i.test(message)) {
      return "Неверная почта или пароль.";
    }

    if (/Email not confirmed/i.test(message)) {
      return "Подтверди электронную почту или отключи подтверждение email в Supabase.";
    }

    if (/User already registered/i.test(message)) {
      return "Этот email уже зарегистрирован. Попробуй войти.";
    }

    if (/Password should be at least/i.test(message)) {
      return "Пароль слишком короткий.";
    }

    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
      return "Нет соединения с Supabase. Проверь интернет и config.js.";
    }

    if (/infinite recursion/i.test(message)) {
      return "Ошибка правил RLS в Supabase. Нужно проверить политики доступа.";
    }

    return message;
  }

  function initSupabase() {
    const config = window.CHATIKI_CONFIG;

    if (!config?.SUPABASE_URL || !config?.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error(
        "Не найдены настройки Supabase в config.js."
      );
    }

    if (!window.supabase?.createClient) {
      throw new Error(
        "Не загрузилась библиотека Supabase. Проверь интернет."
      );
    }

    sb = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_PUBLISHABLE_KEY
    );
  }

  // ==========================================
  // ПЕРЕКЛЮЧЕНИЕ ВХОДА И РЕГИСТРАЦИИ
  // ==========================================

  function setAuthMode(mode) {
    const registering = mode === "register";

    $("loginBox").hidden = false;
    $("registerBox").hidden = !registering;

    $("loginTab").classList.toggle("active", !registering);
    $("registerTab").classList.toggle("active", registering);

    $("submitAuth").textContent = registering
      ? "Создать аккаунт"
      : "Войти";

    $("passwordInput").autocomplete = registering
      ? "new-password"
      : "current-password";

    showAuthMessage("");
  }

  function setBusy(value) {
    busy = value;

    const button = $("submitAuth");
    if (button) button.disabled = value;

    if (button) {
      button.textContent = value
        ? "Подожди..."
        : ($("registerBox").hidden ? "Войти" : "Создать аккаунт");
    }
  }

  // ==========================================
  // РЕГИСТРАЦИЯ
  // ==========================================

  async function register() {
    if (busy) return;

    const email = $("emailInput").value.trim();
    const password = $("passwordInput").value;
    const username = $("usernameInput").value.trim();

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      showAuthMessage(
        "Имя: 3–24 символа, только английские буквы, цифры и _."
      );
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showAuthMessage("Введи правильный адрес электронной почты.");
      return;
    }

    if (password.length < 6) {
      showAuthMessage("Пароль должен содержать минимум 6 символов.");
      return;
    }

    setBusy(true);
    showAuthMessage("Создаём аккаунт...", true);

    try {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            username
          }
        }
      });

      if (error) throw error;

      if (data.session && data.user) {
        currentUser = data.user;
        await finishLogin();
      } else {
        showAuthMessage(
          "Аккаунт создан! Теперь попробуй войти. Если Supabase требует подтверждение email, сначала подтверди почту.",
          true
        );

        setAuthMode("login");
        $("emailInput").value = email;
        $("passwordInput").value = "";
      }
    } catch (error) {
      showAuthMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  // ==========================================
  // ВХОД
  // ==========================================

  async function login() {
    if (busy) return;

    const email = $("emailInput").value.trim();
    const password = $("passwordInput").value;

    if (!email || !password) {
      showAuthMessage("Введи почту и пароль.");
      return;
    }

    setBusy(true);
    showAuthMessage("Входим в Chatiki...", true);

    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      currentUser = data.user;
      await finishLogin();
    } catch (error) {
      showAuthMessage(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  // ==========================================
  // ЗАГРУЗКА ПРОФИЛЯ И ОСНОВНОГО ЭКРАНА
  // ==========================================

  async function loadProfile() {
    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      currentProfile = data;
      return;
    }

    // Если профиль не создался автоматически,
    // не пытаемся незаметно обходить права доступа.
    currentProfile = {
      id: currentUser.id,
      username:
        currentUser.user_metadata?.username ||
        currentUser.email?.split("@")[0] ||
        "User",
      role: "user",
      friend_id: null
    };

    setText(
      "setupNotice",
      "Профиль ещё не найден в базе. Некоторые функции могут быть недоступны."
    );
  }

  async function finishLogin() {
    $("authView").hidden = true;
    $("mainView").hidden = false;

    try {
      await loadProfile();

      setText(
        "welcomeName",
        currentProfile.username || "друг"
      );

      setText(
        "profileName",
        currentProfile.username || "Пользователь"
      );

      setText(
        "profileEmail",
        currentUser.email || "Не указан"
      );

      setText(
        "profileId",
        currentProfile.friend_id || currentUser.id
      );

      setText(
        "roleBadge",
        currentProfile.role === "admin"
          ? "🛡️ Администратор"
          : "👤 Пользователь"
      );

      if (!currentProfile.friend_id) {
        const notice = $("setupNotice");
        if (notice && !notice.textContent) {
          notice.textContent =
            "Твой ID для поиска друзей: " + currentUser.id;
        }
      }

      await refreshFriends();
      await refreshChats();
    } catch (error) {
      console.error("Ошибка загрузки Chatiki:", error);

      setText(
        "setupNotice",
        "Не удалось загрузить некоторые данные: " +
          friendlyError(error)
      );
    }

    showPanel("chatsPanel");

    if (refreshTimer) clearInterval(refreshTimer);

    refreshTimer = setInterval(async () => {
      if (!currentUser) return;

      try {
        await refreshFriends();
        await refreshChats();

        if (activeChatId) {
          await loadMessages(activeChatId);
        }
      } catch (error) {
        console.error("Ошибка обновления:", error);
      }
    }, 10000);
  }

  async function restoreSession() {
    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    if (data.session?.user) {
      currentUser = data.session.user;
      await finishLogin();
    } else {
      $("authView").hidden = false;
      $("mainView").hidden = true;
    }
  }

  // ==========================================
  // НАВИГАЦИЯ
  // ==========================================

  function showPanel(panelId) {
    const panels = [
      "chatsPanel",
      "friendsPanel",
      "profilePanel"
    ];

    if (!panels.includes(panelId)) return;

    for (const id of panels) {
      const panel = $(id);
      if (panel) panel.hidden = id !== panelId;
    }

    document.querySelectorAll("[data-panel]").forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.panel === panelId
      );
    });
  }

  // ==========================================
  // ПОИСК ДРУГА
  // ==========================================

  async function findFriend() {
    if (!currentUser) {
      showMessage("friendMessage", "Сначала войди в аккаунт.");
      return;
    }

    const friendId = $("friendIdInput").value.trim();

    if (!friendId) {
      showMessage("friendMessage", "Введи ID пользователя.");
      return;
    }

    if (
      friendId === currentUser.id ||
      friendId === currentProfile?.friend_id
    ) {
      showMessage("friendMessage", "Это твой собственный ID.");
      return;
    }

    showMessage("friendMessage", "Ищем пользователя...", true);
    $("friendResult").replaceChildren();

    try {
      let query = sb
        .from("profiles")
        .select("id, username, friend_id, avatar_url, role")
        .eq("friend_id", friendId);

      let { data, error } = await query.maybeSingle();

      if (error) throw error;

      // Поддерживаем поиск по UUID, если friend_id не найден.
      if (!data && isUUID(friendId)) {
        const result = await sb
          .from("profiles")
          .select("id, username, friend_id, avatar_url, role")
          .eq("id", friendId)
          .maybeSingle();

        if (result.error) throw result.error;
        data = result.data;
      }

      if (!data) {
        showMessage(
          "friendMessage",
          "Пользователь не найден. Проверь ID."
        );
        return;
      }

      if (data.id === currentUser.id) {
        showMessage("friendMessage", "Это твой собственный профиль.");
        return;
      }

      const card = document.createElement("div");
      card.className = "profile-detail";

      card.innerHTML = `
        <h3>👤 ${escapeHTML(data.username)}</h3>
        <p>ID: ${escapeHTML(data.friend_id || data.id)}</p>
        <button id="sendFriendRequestBtn"
                class="primary-btn"
                type="button">
          💌 Отправить заявку
        </button>
      `;

      $("friendResult").appendChild(card);

      $("sendFriendRequestBtn").addEventListener("click", () => {
        sendFriendRequest(data.id);
      });

      showMessage("friendMessage", "Пользователь найден!", true);
    } catch (error) {
      showMessage("friendMessage", friendlyError(error));
    }
  }

  // ==========================================
  // ЗАЯВКА В ДРУЗЬЯ
  // ==========================================

  async function sendFriendRequest(targetUserId) {
    if (!currentUser || targetUserId === currentUser.id) return;

    try {
      const { data: existing, error: lookupError } = await sb
        .from("friends")
        .select("id, status")
        .or(
          `and(user_id.eq.${currentUser.id},friend_user_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_user_id.eq.${currentUser.id})`
        );

      if (lookupError) throw lookupError;

      if (existing?.some((item) => item.status === "accepted")) {
        showMessage("friendMessage", "Вы уже друзья.", true);
        return;
      }

      const incoming = existing?.find(
        (item) =>
          item.user_id === targetUserId &&
          item.friend_user_id === currentUser.id &&
          item.status === "pending"
      );

      if (incoming) {
        showMessage(
          "friendMessage",
          "Этот пользователь уже отправил тебе заявку. Открой список друзей.",
          true
        );
        await refreshFriends();
        return;
      }

      if (existing?.some((item) => item.status === "pending")) {
        showMessage("friendMessage", "Заявка уже отправлена.", true);
        return;
      }

      const { error } = await sb.from("friends").insert({
        user_id: currentUser.id,
        friend_user_id: targetUserId,
        status: "pending"
      });

      if (error) throw error;

      showMessage("friendMessage", "Заявка отправлена! 💌", true);
      await refreshFriends();
    } catch (error) {
      showMessage("friendMessage", friendlyError(error));
    }
  }

  // ==========================================
  // СПИСОК ДРУЗЕЙ И ЗАЯВОК
  // ==========================================

  async function refreshFriends() {
    if (!currentUser) return;

    const container = $("friendsPanel");
    if (!container) return;

    const section = container.querySelector(".chatiki-section");
    if (!section) return;

    let list = $("friendsList");

    if (!list) {
      list = document.createElement("div");
      list.id = "friendsList";
      list.className = "friends-list";
      section.appendChild(list);
    }

    const { data: relations, error } = await sb
      .from("friends")
      .select("*")
      .or(
        `user_id.eq.${currentUser.id},friend_user_id.eq.${currentUser.id}`
      )
      .order("created_at", { ascending: false });

    if (error) {
      list.textContent = "Не удалось загрузить друзей: " +
        friendlyError(error);
      return;
    }

    list.replaceChildren();

    const items = relations || [];

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Пока нет друзей и заявок.";
      list.appendChild(empty);
      return;
    }

    for (const relation of items) {
      const incoming =
        relation.friend_user_id === currentUser.id &&
        relation.user_id !== currentUser.id;

      const otherId = incoming
        ? relation.user_id
        : relation.friend_user_id;

      const { data: person } = await sb
        .from("profiles")
        .select("username, friend_id")
        .eq("id", otherId)
        .maybeSingle();

      const name = person?.username || "Пользователь";
      const card = document.createElement("div");
      card.className = "profile-detail";

      const heading = document.createElement("h3");
      heading.textContent = "👤 " + name;
      card.appendChild(heading);

      const status = document.createElement("p");

      if (relation.status === "accepted") {
        status.textContent = "✅ Вы друзья";
      } else if (relation.status === "pending" && incoming) {
        status.textContent = "💌 Входящая заявка";
      } else if (relation.status === "pending") {
        status.textContent = "⏳ Заявка отправлена";
      } else {
        status.textContent = "Заявка отклонена";
      }

      card.appendChild(status);

      if (relation.status === "pending" && incoming) {
        const accept = document.createElement("button");
        accept.type = "button";
        accept.className = "primary-btn";
        accept.textContent = "Принять";

        accept.addEventListener("click", () => {
          respondToFriendRequest(relation.id, true);
        });

        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "secondary-btn";
        reject.textContent = "Отклонить";

        reject.addEventListener("click", () => {
          respondToFriendRequest(relation.id, false);
        });

        card.append(accept, reject);
      }

      if (relation.status === "accepted") {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "primary-btn";
        open.textContent = "💬 Написать";

        open.addEventListener("click", () => {
          openDirectChat(otherId, name);
        });

        card.appendChild(open);
      }

      list.appendChild(card);
    }
  }

  async function respondToFriendRequest(requestId, accept) {
    try {
      const { error } = await sb.rpc("respond_to_friend_request", {
        p_request_id: requestId,
        p_accept: accept
      });

      if (error) throw error;

      showMessage(
        "friendMessage",
        accept ? "Заявка принята! 🎉" : "Заявка отклонена.",
        true
      );

      await refreshFriends();
      await refreshChats();
    } catch (error) {
      showMessage("friendMessage", friendlyError(error));
    }
  }

  // ==========================================
  // ЧАТЫ
  // ==========================================

  async function openDirectChat(otherUserId, name) {
    try {
      const { data, error } = await sb.rpc("create_direct_chat", {
        target_friend_id: otherUserId
      });

      if (error) throw error;

      let chatId = data;

      if (Array.isArray(data)) {
        chatId = data[0]?.chat_id || data[0]?.id || data[0];
      } else if (data && typeof data === "object") {
        chatId = data.chat_id || data.id;
      }

      if (!chatId) {
        throw new Error(
          "Supabase не вернул ID чата. Проверь функцию create_direct_chat."
        );
      }

      activeChatId = chatId;
      activeChatName = name;

      showPanel("chatsPanel");
      await renderActiveChat();
      await refreshChats();
    } catch (error) {
      showMessage("friendMessage", friendlyError(error));
    }
  }

  async function refreshChats() {
    if (!currentUser) return;

    const list = $("chatList");
    if (!list) return;

    const { data: memberships, error } = await sb
      .from("chat_members")
      .select("chat_id, joined_at")
      .eq("user_id", currentUser.id)
      .order("joined_at", { ascending: false });

    if (error) {
      list.innerHTML = "";
      const warning = document.createElement("p");
      warning.textContent = "Не удалось загрузить чаты: " +
        friendlyError(error);
      list.appendChild(warning);
      return;
    }

    list.replaceChildren();

    const rows = memberships || [];

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `
        <div class="empty-icon">✉️</div>
        <h3>Тут будет уютно</h3>
        <p>Добавь друга и начни общаться после принятия заявки.</p>
        <button type="button" class="secondary-btn" data-go="friendsPanel">
          Найти друга
        </button>
      `;

      empty.querySelector("[data-go]").addEventListener("click", () => {
        showPanel("friendsPanel");
      });

      list.appendChild(empty);
      return;
    }

    for (const membership of rows) {
      const { data: members } = await sb
        .from("chat_members")
        .select("user_id")
        .eq("chat_id", membership.chat_id);

      const other = (members || []).find(
        (member) => member.user_id !== currentUser.id
      );

      let name = "Личный чат";

      if (other) {
        const { data: profile } = await sb
          .from("profiles")
          .select("username")
          .eq("id", other.user_id)
          .maybeSingle();

        name = profile?.username || name;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-item secondary-btn";
      button.textContent =
        (activeChatId === membership.chat_id ? "🟣 " : "💬 ") + name;

      button.addEventListener("click", async () => {
        activeChatId = membership.chat_id;
        activeChatName = name;
        await renderActiveChat();
        await refreshChats();
      });

      list.appendChild(button);
    }

    if (activeChatId) {
      await renderActiveChat();
    }
  }

  // ==========================================
  // ОКНО ПЕРЕПИСКИ
  // ==========================================

  function ensureMessengerUI() {
    let box = $("activeChatBox");

    if (box) return box;

    box = document.createElement("section");
    box.id = "activeChatBox";
    box.className = "chatiki-section";

    box.innerHTML = `
      <h2 id="activeChatTitle">💬 Переписка</h2>
      <div id="messageList" aria-live="polite"></div>

      <label for="messageInput">Сообщение</label>
      <textarea
        id="messageInput"
        maxlength="5000"
        rows="3"
        placeholder="Напиши сообщение..."
      ></textarea>

      <button id="sendMessageBtn" class="primary-btn" type="button">
        Отправить 💌
      </button>

      <p id="chatMessage" role="status" aria-live="polite"></p>
    `;

    $("chatsPanel").appendChild(box);

    $("sendMessageBtn").addEventListener("click", sendMessage);

    $("messageInput").addEventListener("keydown", (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        sendMessage();
      }
    });

    return box;
  }

  async function renderActiveChat() {
    if (!activeChatId) return;

    ensureMessengerUI();
    setText("activeChatTitle", "💬 " + activeChatName);

    await loadMessages(activeChatId);
  }

  async function loadMessages(chatId) {
    if (!currentUser || !chatId) return;

    ensureMessengerUI();

    const list = $("messageList");

    const { data, error } = await sb
      .from("messages")
      .select("id, chat_id, sender_id, content, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      showMessage("chatMessage", friendlyError(error));
      return;
    }

    list.replaceChildren();

    if (!data?.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Начни переписку! Напиши первое сообщение 💜";
      list.appendChild(empty);
      return;
    }

    for (const message of data) {
      const item = document.createElement("div");
      item.className = "message-item";

      const mine = message.sender_id === currentUser.id;

      item.style.padding = "10px";
      item.style.margin = "8px 0";
      item.style.borderRadius = "12px";
      item.style.background = mine
        ? "rgba(135, 90, 230, 0.22)"
        : "rgba(255, 255, 255, 0.06)";

      const author = document.createElement("strong");
      author.textContent = mine ? "Ты" : activeChatName;

      const content = document.createElement("p");
      content.style.whiteSpace = "pre-wrap";
      content.style.overflowWrap = "anywhere";
      content.textContent = message.content;

      const time = document.createElement("small");
      time.textContent = new Date(message.created_at).toLocaleString();

      item.append(author, content, time);
      list.appendChild(item);
    }

    list.scrollTop = list.scrollHeight;
  }

  async function sendMessage() {
    if (!currentUser || !activeChatId) {
      showMessage("chatMessage", "Сначала открой чат.");
      return;
    }

    const input = $("messageInput");
    const content = input.value.trim();

    if (!content) return;

    const button = $("sendMessageBtn");
    button.disabled = true;

    try {
      const { error } = await sb.from("messages").insert({
        chat_id: activeChatId,
        sender_id: currentUser.id,
        content
      });

      if (error) throw error;

      input.value = "";
      showMessage("chatMessage", "Сообщение отправлено 💜", true);

      await loadMessages(activeChatId);
    } catch (error) {
      showMessage("chatMessage", friendlyError(error));
    } finally {
      button.disabled = false;
    }
  }

  // ==========================================
  // КОПИРОВАНИЕ ID
  // ==========================================

  async function copyMyId() {
    const id = currentProfile?.friend_id || currentUser?.id;

    if (!id) return;

    try {
      await navigator.clipboard.writeText(id);
      alert("ID скопирован! 📋");
    } catch {
      prompt("Скопируй свой ID:", id);
    }
  }

  // ==========================================
  // ВЫХОД
  // ==========================================

  async function logout() {
    if (!sb) return;

    try {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }

      const { error } = await sb.auth.signOut();

      if (error) throw error;

      currentUser = null;
      currentProfile = null;
      activeChatId = null;
      activeChatName = "";

      $("mainView").hidden = true;
      $("authView").hidden = false;

      $("passwordInput").value = "";
      showAuthMessage("Ты вышел из аккаунта.", true);
      setAuthMode("login");
    } catch (error) {
      alert("Не удалось выйти: " + friendlyError(error));
    }
  }

  // ==========================================
  // ПОДКЛЮЧЕНИЕ КНОПОК
  // ==========================================

  function wireEvents() {
    $("loginTab").addEventListener("click", () => {
      setAuthMode("login");
    });

    $("registerTab").addEventListener("click", () => {
      setAuthMode("register");
    });

    $("submitAuth").addEventListener("click", () => {
      if (busy) return;

      if ($("registerBox").hidden) {
        login();
      } else {
        register();
      }
    });

    ["emailInput", "passwordInput", "usernameInput"].forEach((id) => {
      $(id).addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !busy) {
          if ($("registerBox").hidden) {
            login();
          } else {
            register();
          }
        }
      });
    });

    document.querySelectorAll("[data-panel]").forEach((button) => {
      button.addEventListener("click", () => {
        showPanel(button.dataset.panel);
      });
    });

    document.querySelectorAll("[data-go]").forEach((button) => {
      button.addEventListener("click", () => {
        showPanel(button.dataset.go);
      });
    });

    $("findFriendBtn").addEventListener("click", findFriend);

    $("friendIdInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") findFriend();
    });

    $("profileLogoutBtn").addEventListener("click", logout);
    $("copyMyIdBtn").addEventListener("click", copyMyId);
  }

  // ==========================================
  // ЗАПУСК CHATIKI
  // ==========================================

  async function startApp() {
    try {
      initSupabase();
      wireEvents();
      setAuthMode("login");
      await restoreSession();
    } catch (error) {
      console.error("Chatiki startup error:", error);

      $("authView").hidden = false;
      $("mainView").hidden = true;

      showAuthMessage(
        "Ошибка запуска: " + friendlyError(error)
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp, {
      once: true
    });
  } else {
    startApp();
  }
})();
