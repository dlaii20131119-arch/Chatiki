(() => {
  "use strict";

  // ==========================================
  // CHATIKI — ПОЛНЫЙ КОД ПРИЛОЖЕНИЯ
  // ==========================================

  let sb = null;
  let currentUser = null;
  let currentProfile = null;
  let activeChatId = null;
  let activeChatName = "";
  let refreshTimer = null;
  let busy = false;

  const $ = (id) => document.getElementById(id);

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function showMessage(id, message, success = false) {
    const element = $(id);
    if (!element) return;

    element.textContent = message;
    element.style.color = success ? "#36b37e" : "#ff7373";
  }

  function errorText(error) {
    const message = error?.message || String(error || "Неизвестная ошибка");

    if (/Invalid login credentials/i.test(message)) {
      return "Неверная почта или пароль.";
    }

    if (/Email not confirmed/i.test(message)) {
      return "Подтверди почту или проверь настройки подтверждения email в Supabase.";
    }

    if (/User already registered/i.test(message)) {
      return "Этот email уже зарегистрирован. Попробуй войти.";
    }

    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
      return "Не удалось подключиться к Supabase. Проверь интернет и config.js.";
    }

    if (/infinite recursion/i.test(message)) {
      return "Ошибка политик доступа RLS в Supabase.";
    }

    return message;
  }

  // ==========================================
  // SUPABASE
  // ==========================================

  function initSupabase() {
    const config = window.CHATIKI_CONFIG;

    if (!config?.SUPABASE_URL ||
        !config?.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Проверь настройки Supabase в config.js.");
    }

    if (!window.supabase?.createClient) {
      throw new Error("Библиотека Supabase не загрузилась.");
    }

    sb = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_PUBLISHABLE_KEY
    );
  }

  // ==========================================
  // ВХОД / РЕГИСТРАЦИЯ
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

    showMessage("authMessage", "");
  }

  function setBusy(value) {
    busy = value;

    const button = $("submitAuth");
    if (!button) return;

    button.disabled = value;

    if (value) {
      button.textContent = "Подожди...";
    } else {
      button.textContent = $("registerBox").hidden
        ? "Войти"
        : "Создать аккаунт";
    }
  }

  async function login() {
    if (busy) return;

    const email = $("emailInput").value.trim();
    const password = $("passwordInput").value;

    if (!email || !password) {
      showMessage("authMessage", "Введи почту и пароль.");
      return;
    }

    setBusy(true);
    showMessage("authMessage", "Подключаемся к аккаунту...", true);

    try {
      if (!sb) initSupabase();

      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      currentUser = data.user;
      await finishLogin();
    } catch (error) {
      console.error("Ошибка входа:", error);
      showMessage("authMessage", errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    if (busy) return;

    const email = $("emailInput").value.trim();
    const password = $("passwordInput").value;
    const username = $("usernameInput").value.trim();

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      showMessage(
        "authMessage",
        "Имя должно содержать 3–24 символа: английские буквы, цифры или _."
      );
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMessage("authMessage", "Введи правильную электронную почту.");
      return;
    }

    if (password.length < 6) {
      showMessage("authMessage", "Пароль должен содержать минимум 6 символов.");
      return;
    }

    setBusy(true);
    showMessage("authMessage", "Создаём аккаунт...", true);

    try {
      if (!sb) initSupabase();

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
        await finishLogin();
      } else {
        setAuthMode("login");
        $("emailInput").value = email;
        $("passwordInput").value = "";

        showMessage(
          "authMessage",
          "Аккаунт создан! Теперь войди. Если требуется подтверждение почты, сначала подтверди email.",
          true
        );
      }
    } catch (error) {
      console.error("Ошибка регистрации:", error);
      showMessage("authMessage", errorText(error));
    } finally {
      setBusy(false);
    }
  }

  // ==========================================
  // ПРОФИЛЬ И ОСНОВНОЙ ЭКРАН
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

    currentProfile = {
      id: currentUser.id,
      username:
        currentUser.user_metadata?.username ||
        currentUser.email?.split("@")[0] ||
        "User",
      role: "user",
      friend_id: null
    };

    showMessage(
      "setupNotice",
      "Профиль не найден в базе Supabase. Нужно проверить создание профиля."
    );
  }

  async function finishLogin() {
    $("authView").hidden = true;
    $("mainView").hidden = false;

    try {
      await loadProfile();

      $("welcomeName").textContent =
        currentProfile.username || "друг";

      $("profileName").textContent =
        currentProfile.username || "Пользователь";

      $("profileEmail").textContent =
        currentUser.email || "Не указана";

      $("profileId").textContent =
        currentProfile.friend_id || currentUser.id;

      $("roleBadge").textContent =
        currentProfile.role === "admin"
          ? "🛡️ Администратор"
          : "👤 Пользователь";

      const notice = $("setupNotice");

      if (!currentProfile.friend_id && notice) {
        notice.textContent =
          "Твой ID: " + currentUser.id;
      }

      await refreshFriends();
      await refreshChats();
    } catch (error) {
      console.error("Ошибка загрузки профиля:", error);

      $("setupNotice").textContent =
        "Ошибка загрузки данных: " + errorText(error);
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
    const allowed = [
      "chatsPanel",
      "friendsPanel",
      "profilePanel"
    ];

    if (!allowed.includes(panelId)) return;

    allowed.forEach((id) => {
      $(id).hidden = id !== panelId;
    });

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

    const value = $("friendIdInput").value.trim();

    if (!value) {
      showMessage("friendMessage", "Введи ID пользователя.");
      return;
    }

    if (value === currentUser.id ||
        value === currentProfile?.friend_id) {
      showMessage("friendMessage", "Это твой собственный ID.");
      return;
    }

    showMessage("friendMessage", "Ищем пользователя...", true);
    $("friendResult").replaceChildren();

    try {
      let { data, error } = await sb
        .from("profiles")
        .select("id, username, friend_id, role")
        .eq("friend_id", value)
        .maybeSingle();

      if (error) throw error;

      if (!data &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        const result = await sb
          .from("profiles")
          .select("id, username, friend_id, role")
          .eq("id", value)
          .maybeSingle();

        if (result.error) throw result.error;
        data = result.data;
      }

      if (!data) {
        showMessage("friendMessage", "Пользователь не найден.");
        return;
      }

      if (data.id === currentUser.id) {
        showMessage("friendMessage", "Это твой собственный профиль.");
        return;
      }

      const card = document.createElement("div");
      card.className = "profile-detail";

      const title = document.createElement("h3");
      title.textContent = "👤 " + data.username;

      const id = document.createElement("p");
      id.textContent = "ID: " + (data.friend_id || data.id);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "primary-btn";
      button.textContent = "💌 Отправить заявку";
      button.addEventListener("click", () => sendFriendRequest(data.id));

      card.append(title, id, button);
      $("friendResult").appendChild(card);

      showMessage("friendMessage", "Пользователь найден!", true);
    } catch (error) {
      showMessage("friendMessage", errorText(error));
    }
  }

  // ==========================================
  // ЗАЯВКИ В ДРУЗЬЯ
  // ==========================================

  async function sendFriendRequest(targetId) {
    if (!currentUser || targetId === currentUser.id) return;

    try {
      const { data: existing, error: lookupError } = await sb
        .from("friends")
        .select("*")
        .or(
          `and(user_id.eq.${currentUser.id},friend_user_id.eq.${targetId}),and(user_id.eq.${targetId},friend_user_id.eq.${currentUser.id})`
        );

      if (lookupError) throw lookupError;

      if (existing?.some((item) => item.status === "accepted")) {
        showMessage("friendMessage", "Вы уже друзья.", true);
        return;
      }

      if (existing?.some((item) => item.status === "pending")) {
        showMessage("friendMessage", "Заявка уже существует.");
        return;
      }

      const { error } = await sb.from("friends").insert({
        user_id: currentUser.id,
        friend_user_id: targetId,
        status: "pending"
      });

      if (error) throw error;

      showMessage("friendMessage", "Заявка отправлена! 💌", true);
      await refreshFriends();
    } catch (error) {
      showMessage("friendMessage", errorText(error));
    }
  }

  async function refreshFriends() {
    if (!currentUser) return;

    let list = $("friendsList");

    if (!list) {
      list = document.createElement("div");
      list.id = "friendsList";
      list.className = "friends-list";

      $("friendsPanel")
        .querySelector(".chatiki-section")
        .appendChild(list);
    }

    const { data, error } = await sb
      .from("friends")
      .select("*")
      .or(
        `user_id.eq.${currentUser.id},friend_user_id.eq.${currentUser.id}`
      )
      .order("created_at", { ascending: false });

    if (error) {
      list.textContent = "Ошибка загрузки друзей: " + errorText(error);
      return;
    }

    list.replaceChildren();

    if (!data?.length) {
      const empty = document.createElement("p");
      empty.textContent = "Пока нет друзей и заявок.";
      list.appendChild(empty);
      return;
    }

    for (const relation of data) {
      const incoming =
        relation.friend_user_id === currentUser.id &&
        relation.user_id !== currentUser.id;

      const otherId = incoming
        ? relation.user_id
        : relation.friend_user_id;

      const { data: person } = await sb
        .from("profiles")
        .select("username")
        .eq("id", otherId)
        .maybeSingle();

      const card = document.createElement("div");
      card.className = "profile-detail";

      const title = document.createElement("h3");
      title.textContent = "👤 " + (person?.username || "Пользователь");

      const status = document.createElement("p");

      if (relation.status === "accepted") {
        status.textContent = "✅ Вы друзья";
      } else if (incoming && relation.status === "pending") {
        status.textContent = "💌 Входящая заявка";
      } else if (relation.status === "pending") {
        status.textContent = "⏳ Заявка отправлена";
      } else {
        status.textContent = "Заявка отклонена";
      }

      card.append(title, status);

      if (incoming && relation.status === "pending") {
        const accept = document.createElement("button");
        accept.type = "button";
        accept.className = "primary-btn";
        accept.textContent = "Принять";
        accept.addEventListener("click", () =>
          respondToFriendRequest(relation.id, true)
        );

        const reject = document.createElement("button");
        reject.type = "button";
        reject.className = "secondary-btn";
        reject.textContent = "Отклонить";
        reject.addEventListener("click", () =>
          respondToFriendRequest(relation.id, false)
        );

        card.append(accept, reject);
      }

      if (relation.status === "accepted") {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "primary-btn";
        open.textContent = "💬 Написать";

        open.addEventListener("click", () =>
          openDirectChat(otherId, person?.username || "Личный чат")
        );

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
      showMessage("friendMessage", errorText(error));
    }
  }

  // ==========================================
  // СОЗДАНИЕ И ОТКРЫТИЕ ЧАТОВ
  // ==========================================

  async function openDirectChat(otherId, name) {
    try {
      const { data, error } = await sb.rpc("create_direct_chat", {
        target_friend_id: otherId
      });

      if (error) throw error;

      let chatId = data;

      if (Array.isArray(data)) {
        chatId = data[0]?.chat_id || data[0]?.id || data[0];
      } else if (data && typeof data === "object") {
        chatId = data.chat_id || data.id;
      }

      if (!chatId) {
        throw new Error("Не удалось получить ID чата.");
      }

      activeChatId = chatId;
      activeChatName = name;

      showPanel("chatsPanel");
      await renderActiveChat();
      await refreshChats();
    } catch (error) {
      showMessage("friendMessage", errorText(error));
    }
  }

  async function refreshChats() {
    if (!currentUser) return;

    const list = $("chatList");

    const { data, error } = await sb
      .from("chat_members")
      .select("chat_id, joined_at")
      .eq("user_id", currentUser.id)
      .order("joined_at", { ascending: false });

    if (error) {
      list.textContent = "Ошибка загрузки чатов: " + errorText(error);
      return;
    }

    list.replaceChildren();

    if (!data?.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";

      const title = document.createElement("h3");
      title.textContent = "✉️ Тут будет уютно";

      const text = document.createElement("p");
      text.textContent = "Добавь друга и начни общаться после принятия заявки.";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-btn";
      button.textContent = "Найти друга";
      button.addEventListener("click", () => showPanel("friendsPanel"));

      empty.append(title, text, button);
      list.appendChild(empty);
      return;
    }

    for (const membership of data) {
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
      button.className = "secondary-btn";
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

    if (activeChatId) await renderActiveChat();
  }

  // ==========================================
  // СООБЩЕНИЯ
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
      <textarea id="messageInput"
        maxlength="5000"
        rows="3"
        placeholder="Напиши сообщение..."></textarea>

      <button id="sendMessageBtn"
        class="primary-btn"
        type="button">Отправить 💌</button>

      <p id="chatMessage" role="status" aria-live="polite"></p>
    `;

    $("chatsPanel").appendChild(box);

    $("sendMessageBtn").addEventListener("click", sendMessage);

    $("messageInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    return box;
  }

  async function renderActiveChat() {
    if (!activeChatId) return;

    ensureMessengerUI();

    $("activeChatTitle").textContent = "💬 " + activeChatName;

    await loadMessages(activeChatId);
  }

  async function loadMessages(chatId) {
    if (!currentUser || !chatId) return;

    ensureMessengerUI();

    const { data, error } = await sb
      .from("messages")
      .select("id, chat_id, sender_id, content, created_at")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      showMessage("chatMessage", errorText(error));
      return;
    }

    const list = $("messageList");
    list.replaceChildren();

    if (!data?.length) {
      const empty = document.createElement("p");
      empty.textContent = "Начни переписку! Напиши первое сообщение 💜";
      list.appendChild(empty);
      return;
    }

    for (const message of data) {
      const item = document.createElement("div");
      item.className = "message-item";
      item.style.padding = "10px";
      item.style.margin = "8px 0";
      item.style.borderRadius = "12px";
      item.style.background =
        message.sender_id === currentUser.id
          ? "rgba(135,90,230,0.22)"
          : "rgba(255,255,255,0.06)";

      const author = document.createElement("strong");
      author.textContent =
        message.sender_id === currentUser.id ? "Ты" : activeChatName;

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

    $("sendMessageBtn").disabled = true;

    try {
      const { error } = await sb.from("messages").insert({
        chat_id: activeChatId,
        sender_id: currentUser.id,
        content
      });

      if (error) throw error;

      input.value = "";
      showMessage("chatMessage", "Сообщение отправлено! 💜", true);

      await loadMessages(activeChatId);
    } catch (error) {
      showMessage("chatMessage", errorText(error));
    } finally {
      $("sendMessageBtn").disabled = false;
    }
  }

  // ==========================================
  // ПРОФИЛЬ: КОПИРОВАНИЕ ID
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
  // ВЫХОД ИЗ АККАУНТА
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

      setAuthMode("login");
      showMessage("authMessage", "Ты вышел из аккаунта.", true);
    } catch (error) {
      alert("Ошибка выхода: " + errorText(error));
    }
  }

  // ==========================================
  // КНОПКИ — ПОДКЛЮЧАЕМ ДО SUPABASE
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

    [
      "emailInput",
      "passwordInput",
      "usernameInput"
    ].forEach((id) => {
      $(id).addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || busy) return;

        if ($("registerBox").hidden) {
          login();
        } else {
          register();
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
  // ЗАПУСК ПРИЛОЖЕНИЯ
  // ==========================================

  async function startApp() {
    // ВАЖНО: сначала подключаем кнопки.
    // Даже если Supabase не загрузится, кнопки
    // переключения входа и регистрации будут работать.
    try {
      wireEvents();
      setAuthMode("login");
    } catch (error) {
      console.error("Ошибка подключения кнопок:", error);
      showMessage(
        "authMessage",
        "Не удалось подключить кнопки: " + errorText(error)
      );
      return;
    }

    // Затем подключаем Supabase и восстанавливаем сессию.
    try {
      initSupabase();
      await restoreSession();
    } catch (error) {
      console.error("Ошибка запуска Chatiki:", error);

      $("authView").hidden = false;
      $("mainView").hidden = true;

      showMessage(
        "authMessage",
        "Ошибка запуска: " + errorText(error)
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
