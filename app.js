(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const config = window.CHATIKI_CONFIG || {};

  let sb = null;
  let currentUser = null;
  let currentProfile = null;
  let authMode = "login";
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
    const target = $("friendMessage") || $("authMessage");

    if (target) {
      target.textContent = message;
      target.dataset.type = type;
    } else {
      alert(message);
    }
  }

  function initSupabase() {
    if (!window.supabase?.createClient) {
      throw new Error("Не загрузилась библиотека Supabase.");
    }

    if (
      !config.SUPABASE_URL ||
      !config.SUPABASE_PUBLISHABLE_KEY
    ) {
      throw new Error("Проверь настройки файла config.js.");
    }

    sb = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_PUBLISHABLE_KEY
    );
  }

  // ---------- АВТОРИЗАЦИЯ ----------

  function setAuthMode(mode) {
    authMode = mode;

    if ($("loginBox")) {
      $("loginBox").hidden = false;
    }

    if ($("registerBox")) {
      $("registerBox").hidden = mode !== "register";
    }

    $("loginTab")?.classList.toggle("active", mode === "login");
    $("registerTab")?.classList.toggle("active", mode === "register");

    if ($("submitAuth")) {
      $("submitAuth").textContent =
        mode === "register" ? "Создать аккаунт" : "Войти";
    }

    if ($("authMessage")) {
      $("authMessage").textContent = "";
    }
  }

  function showLogin() {
    setAuthMode("login");
  }

  function showRegister() {
    setAuthMode("register");
  }

  function setBusy(value) {
    busy = value;

    if ($("submitAuth")) {
      $("submitAuth").disabled = value;
    }
  }

  async function handleAuth(event) {
    event?.preventDefault();

    if (busy) return;

    if (authMode === "register") {
      await register();
    } else {
      await login();
    }
  }

  async function register() {
    const username = $("usernameInput")?.value.trim() || "";
    const email = $("emailInput")?.value.trim() || "";
    const password = $("passwordInput")?.value || "";

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      notify(
        "Имя должно содержать 3–24 символа: латинские буквы, цифры или _."
      );
      return;
    }

    if (!email || password.length < 6) {
      notify("Введи почту и пароль длиной минимум 6 символов.");
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
        notify(
          "Аккаунт создан. Теперь попробуй войти. Если требуется подтверждение почты, проверь почтовый ящик."
        );

        setAuthMode("login");

        if ($("passwordInput")) {
          $("passwordInput").value = "";
        }
      }
    } catch (error) {
      console.error("register:", error);
      notify("Ошибка регистрации: " + error.message);
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    const email = $("emailInput")?.value.trim() || "";
    const password = $("passwordInput")?.value || "";

    if (!email || !password) {
      notify("Введи электронную почту и пароль.");
      return;
    }

    try {
      setBusy(true);

      const { data, error } = await sb.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      currentUser = data.user;

      await loadProfile();
      showMainView();
    } catch (error) {
      console.error("login:", error);
      notify("Ошибка входа: " + error.message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- ПРОФИЛЬ ----------

  async function loadProfile() {
    if (!currentUser) {
      throw new Error("Пользователь не авторизован.");
    }

    const { data, error } = await sb
      .from("profiles")
      .select("id, username, friend_id, avatar_url, role, created_at")
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

  function getMyId() {
    return currentProfile?.friend_id || currentUser?.id || "";
  }

  function renderProfile() {
    if (!currentProfile || !currentUser) return;

    const username = currentProfile.username || "Пользователь";

    if ($("welcomeName")) {
      $("welcomeName").textContent = username;
    }

    if ($("profileName")) {
      $("profileName").textContent = username;
    }

    if ($("profileEmail")) {
      $("profileEmail").textContent = currentUser.email || "";
    }

    if ($("profileId")) {
      $("profileId").textContent = getMyId();
    }

    if ($("avatar")) {
      $("avatar").textContent = username.charAt(0).toUpperCase();
    }

    if ($("roleBadge")) {
      $("roleBadge").textContent =
        currentProfile.role === "admin"
          ? "Администратор"
          : "Пользователь";
    }
  }

  function showMainView() {
    if ($("authView")) $("authView").hidden = true;
    if ($("mainView")) $("mainView").hidden = false;

    // Совместимость с прежними версиями HTML.
    if ($("authScreen")) $("authScreen").hidden = true;
    if ($("mainScreen")) $("mainScreen").hidden = false;

    renderProfile();
    ensureMessengerUI();
    showPanel("chatsPanel");

    refreshAll();

    clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshAll, 5000);
  }

  // ---------- ИНТЕРФЕЙС ПЕРЕПИСКИ ----------

  function ensureMessengerUI() {
    const panel = $("chatsPanel");

    if (!panel || $("chatikiMessenger")) return;

    panel.innerHTML = `
      <div id="chatikiMessenger">
        <section class="chatiki-section" id="chatListSection">
          <h2>💬 Мои чаты</h2>
          <div id="chatList">
            <p>Загружаем чаты...</p>
          </div>
        </section>

        <section class="chatiki-section" id="conversationSection" hidden>
          <button
            type="button"
            id="backToChats"
            class="secondary-btn"
          >← Назад к чатам</button>

          <h3 id="conversationTitle">Переписка</h3>

          <div id="messageList" aria-live="polite">
            <p>Загружаем сообщения...</p>
          </div>

          <form id="messageForm">
            <textarea
              id="messageInput"
              maxlength="4000"
              rows="2"
              placeholder="Напиши сообщение..."
              required
            ></textarea>

            <button class="primary-btn" type="submit">
              Отправить
            </button>
          </form>
        </section>
      </div>
    `;

    $("backToChats").addEventListener("click", () => {
      activeChatId = null;
      $("conversationSection").hidden = true;
      $("chatListSection").hidden = false;
    });

    $("messageForm").addEventListener("submit", sendMessage);
  }

  function showPanel(panelId) {
    ["chatsPanel", "friendsPanel", "profilePanel"].forEach(id => {
      const panel = $(id);
      if (panel) panel.hidden = id !== panelId;
    });

    document.querySelectorAll("[data-panel]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.panel === panelId
      );
    });

    if (panelId === "friendsPanel") refreshFriends();
    if (panelId === "chatsPanel") refreshChats();
  }

  // ---------- ПОИСК ДРУЗЕЙ ----------

  async function findFriend() {
    const friendId = $("friendIdInput")?.value.trim() || "";

    if (!friendId) {
      notify("Введи ID друга.");
      return;
    }

    if (
      friendId.toUpperCase() ===
      String(getMyId()).toUpperCase()
    ) {
      notify("Нельзя добавить самого себя.");
      return;
    }

    try {
      notify("Ищем пользователя...");

      let { data, error } = await sb
        .from("profiles")
        .select("id, username, friend_id, avatar_url")
        .ilike("friend_id", friendId)
        .neq("id", currentUser.id)
        .limit(1);

      if (error) throw error;

      let friend = data?.[0] || null;

      // Если friend_id не заполнен, разрешаем поиск по UUID.
      if (!friend && /^[0-9a-f-]{36}$/i.test(friendId)) {
        const result = await sb
          .from("profiles")
          .select("id, username, friend_id, avatar_url")
          .eq("id", friendId)
          .neq("id", currentUser.id)
          .limit(1);

        if (result.error) throw result.error;
        friend = result.data?.[0] || null;
      }

      if (!friend) {
        renderFriendResult(null);
        notify("Пользователь не найден. Проверь ID.");
        return;
      }

      renderFriendResult(friend);
      notify("Пользователь найден!");
    } catch (error) {
      console.error("findFriend:", error);
      notify("Ошибка поиска: " + error.message);
    }
  }

  function renderFriendResult(friend) {
    const box = $("friendResult");
    if (!box) return;

    if (!friend) {
      box.innerHTML = "";
      return;
    }

    box.innerHTML = `
      <div class="chatiki-friend-result">
        <div class="chatiki-avatar">
          ${escapeHTML((friend.username || "?").charAt(0).toUpperCase())}
        </div>

        <div>
          <strong>${escapeHTML(friend.username || "Пользователь")}</strong>
          <p>ID: ${escapeHTML(friend.friend_id || friend.id)}</p>
        </div>

        <button
          type="button"
          id="sendFriendRequestBtn"
          class="primary-btn"
        >Добавить</button>
      </div>
    `;

    $("sendFriendRequestBtn").addEventListener("click", () => {
      sendFriendRequest(friend);
    });
  }

  async function sendFriendRequest(friend) {
    try {
      const { data: existing, error: lookupError } = await sb
        .from("friends")
        .select("id, user_id, friend_user_id, status")
        .or(
          `and(user_id.eq.${currentUser.id},friend_user_id.eq.${friend.id}),and(user_id.eq.${friend.id},friend_user_id.eq.${currentUser.id})`
        )
        .limit(1);

      if (lookupError) throw lookupError;

      if (existing?.length) {
        const request = existing[0];

        if (request.status === "accepted") {
          notify("Вы уже друзья! 💜");
          return;
        }

        if (request.status === "pending") {
          notify(
            request.user_id === currentUser.id
              ? "Заявка уже отправлена."
              : "Этот пользователь уже отправил тебе заявку."
          );
          return;
        }
      }

      const { error } = await sb.from("friends").insert({
        user_id: currentUser.id,
        friend_user_id: friend.id,
        status: "pending"
      });

      if (error) throw error;

      notify("Заявка отправлена! 💌");
      await refreshFriends();
    } catch (error) {
      console.error("sendFriendRequest:", error);
      notify("Не удалось отправить заявку: " + error.message);
    }
  }

  // ---------- СПИСОК ДРУЗЕЙ И ЗАЯВКИ ----------

  async function refreshFriends() {
    if (!sb || !currentUser || !$("friendsPanel")) return;

    try {
      const { data, error } = await sb
        .from("friends")
        .select("id, user_id, friend_user_id, status, created_at")
        .or(
          `user_id.eq.${currentUser.id},friend_user_id.eq.${currentUser.id}`
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      const requests = data || [];
      const container = $("friendRequestsList");

      if (!container) return;

      if (!requests.length) {
        container.innerHTML = `
          <h3>👥 Друзья и заявки</h3>
          <p>Пока здесь пусто. Найди друга по его ID!</p>
        `;
        return;
      }

      const ids = [...new Set(
        requests.map(request =>
          request.user_id === currentUser.id
            ? request.friend_user_id
            : request.user_id
        )
      )];

      const { data: profiles, error: profilesError } = await sb
        .from("profiles")
        .select("id, username, friend_id")
        .in("id", ids);

      if (profilesError) throw profilesError;

      const profileMap = new Map(
        (profiles || []).map(profile => [profile.id, profile])
      );

      container.innerHTML = `
        <h3>👥 Друзья и заявки</h3>

        ${requests.map(request => {
          const outgoing = request.user_id === currentUser.id;
          const otherId = outgoing
            ? request.friend_user_id
            : request.user_id;

          const person = profileMap.get(otherId);
          const name = person?.username || "Пользователь";
          const id = person?.friend_id || otherId;

          let actions = "";

          if (request.status === "pending" && !outgoing) {
            actions = `
              <button type="button" data-accept="${escapeHTML(request.id)}">
                Принять
              </button>
              <button type="button" data-reject="${escapeHTML(request.id)}">
                Отклонить
              </button>
            `;
          } else if (request.status === "pending") {
            actions = "<span>Заявка отправлена</span>";
          } else if (request.status === "accepted") {
            actions = "<span>💜 Вы друзья</span>";
          } else {
            actions = "<span>Заявка отклонена</span>";
          }

          return `
            <div class="chatiki-request">
              <div>
                <strong>${escapeHTML(name)}</strong>
                <small>ID: ${escapeHTML(id)}</small>
              </div>
              <div class="chatiki-request-actions">${actions}</div>
            </div>
          `;
        }).join("")}
      `;

      container.querySelectorAll("[data-accept]").forEach(button => {
        button.addEventListener("click", () => {
          respondToFriendRequest(button.dataset.accept, true);
        });
      });

      container.querySelectorAll("[data-reject]").forEach(button => {
        button.addEventListener("click", () => {
          respondToFriendRequest(button.dataset.reject, false);
        });
      });
    } catch (error) {
      console.error("refreshFriends:", error);
    }
  }

  async function respondToFriendRequest(requestId, accept) {
    try {
      const { error } = await sb.rpc("respond_to_friend_request", {
        p_request_id: requestId,
        p_accept: accept
      });

      if (error) throw error;

      notify(accept ? "Заявка принята! 💜" : "Заявка отклонена.");

      await refreshFriends();
      await refreshChats();
    } catch (error) {
      console.error("respondToFriendRequest:", error);
      notify("Не удалось обработать заявку: " + error.message);
    }
  }

  // ---------- ЧАТЫ ----------

  async function refreshChats() {
    if (!sb || !currentUser || !$("chatList")) return;

    try {
      const { data: memberships, error } = await sb
        .from("chat_members")
        .select("chat_id")
        .eq("user_id", currentUser.id);

      if (error) throw error;

      const chatIds = [...new Set(
        (memberships || []).map(item => item.chat_id)
      )];

      const list = $("chatList");
      if (!list) return;

      if (!chatIds.length) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">✉️</div>
            <h3>Пока нет чатов</h3>
            <p>Добавь друга и дождись принятия заявки.</p>
            <button
              type="button"
              class="secondary-btn"
              data-go="friendsPanel"
            >Найти друга</button>
          </div>
        `;

        list.querySelector("[data-go]")?.addEventListener("click", () => {
          showPanel("friendsPanel");
        });

        return;
      }

      const { data: members, error: membersError } = await sb
        .from("chat_members")
        .select("chat_id, user_id")
        .in("chat_id", chatIds);

      if (membersError) throw membersError;

      const otherIds = [...new Set(
        (members || [])
          .filter(member => member.user_id !== currentUser.id)
          .map(member => member.user_id)
      )];

      let profiles = [];

      if (otherIds.length) {
        const result = await sb
          .from("profiles")
          .select("id, username")
          .in("id", otherIds);

        if (result.error) throw result.error;
        profiles = result.data || [];
      }

      const profileMap = new Map(
        profiles.map(profile => [profile.id, profile])
      );

      list.innerHTML = chatIds.map(chatId => {
        const otherMember = (members || []).find(member =>
          member.chat_id === chatId &&
          member.user_id !== currentUser.id
        );

        const person = otherMember
          ? profileMap.get(otherMember.user_id)
          : null;

        const name = person?.username || "Личный чат";

        return `
          <button
            type="button"
            class="chatiki-chat-item"
            data-chat-id="${escapeHTML(chatId)}"
            data-chat-name="${escapeHTML(name)}"
          >
            <span class="chatiki-avatar">
              ${escapeHTML(name.charAt(0).toUpperCase())}
            </span>
            <span>
              <strong>${escapeHTML(name)}</strong>
              <small>Открыть переписку</small>
            </span>
            <span>›</span>
          </button>
        `;
      }).join("");

      list.querySelectorAll("[data-chat-id]").forEach(button => {
        button.addEventListener("click", () => {
          openChat(
            button.dataset.chatId,
            button.dataset.chatName
          );
        });
      });
    } catch (error) {
      console.error("refreshChats:", error);
    }
  }

  async function openChat(chatId, chatName) {
    activeChatId = chatId;

    if ($("conversationTitle")) {
      $("conversationTitle").textContent = chatName || "Переписка";
    }

    if ($("conversationSection")) {
      $("conversationSection").hidden = false;
    }

    if ($("chatListSection")) {
      $("chatListSection").hidden = true;
    }

    await loadMessages();
  }

  // ---------- СООБЩЕНИЯ ----------

  async function loadMessages() {
    if (!activeChatId || !currentUser) return;

    const container = $("messageList");
    if (!container) return;

    try {
      const { data, error } = await sb
        .from("messages")
        .select("id, sender_id, content, created_at, edited_at")
        .eq("chat_id", activeChatId)
        .order("created_at", { ascending: true })
        .limit(200);

      if (error) throw error;

      const messages = data || [];

      container.innerHTML = messages.length
        ? messages.map(message => {
            const mine = message.sender_id === currentUser.id;

            const time = message.created_at
              ? new Date(message.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })
              : "";

            return `
              <div class="chatiki-message ${mine ? "mine" : "theirs"}">
                <div>${escapeHTML(message.content)}</div>
                <small>${escapeHTML(time)}</small>
              </div>
            `;
          }).join("")
        : `<p class="chatiki-no-messages">Напиши первое сообщение! 👋</p>`;

      container.scrollTop = container.scrollHeight;
    } catch (error) {
      console.error("loadMessages:", error);
      container.innerHTML = "<p>Не удалось загрузить сообщения.</p>";
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    const input = $("messageInput");
    const content = input?.value.trim();

    if (!activeChatId || !content) return;

    const button = $("messageForm")?.querySelector("button");
    if (button) button.disabled = true;

    try {
      const { error } = await sb.from("messages").insert({
        chat_id: activeChatId,
        sender_id: currentUser.id,
        content
      });

      if (error) throw error;

      input.value = "";
      await loadMessages();
    } catch (error) {
      console.error("sendMessage:", error);
      notify("Не удалось отправить сообщение: " + error.message);
    } finally {
      if (button) button.disabled = false;
      input?.focus();
    }
  }

  // ---------- ПРОЧЕЕ ----------

  async function copyProfileId() {
    const id = String(getMyId());

    try {
      await navigator.clipboard.writeText(id);
      notify("Твой ID скопирован! 📋");
    } catch {
      notify("Не удалось скопировать ID. Выдели его и скопируй вручную.");
    }
  }

  async function logout() {
    clearInterval(refreshTimer);

    try {
      const { error } = await sb.auth.signOut();
      if (error) throw error;

      currentUser = null;
      currentProfile = null;
      activeChatId = null;

      location.reload();
    } catch (error) {
      notify("Ошибка выхода: " + error.message);
    }
  }

  async function refreshAll() {
    if (!currentUser) return;

    await Promise.allSettled([
      refreshChats(),
      refreshFriends(),
      activeChatId ? loadMessages() : Promise.resolve()
    ]);
  }

  function bindEvents() {
    $("loginTab")?.addEventListener("click", showLogin);
    $("registerTab")?.addEventListener("click", showRegister);

    $("showRegister")?.addEventListener("click", showRegister);
    $("showLogin")?.addEventListener("click", showLogin);

    $("submitAuth")?.addEventListener("click", handleAuth);

    $("loginForm")?.addEventListener("submit", event => {
      event.preventDefault();
      showLogin();
      login();
    });

    $("registerForm")?.addEventListener("submit", event => {
      event.preventDefault();
      showRegister();
      register();
    });

    $("findFriendBtn")?.addEventListener("click", findFriend);

    $("friendIdInput")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        findFriend();
      }
    });

    $("copyIdBtn")?.addEventListener("click", copyProfileId);
    $("logoutBtn")?.addEventListener("click", logout);

    document.querySelectorAll("[data-panel]").forEach(button => {
      button.addEventListener("click", () => {
        showPanel(button.dataset.panel);
      });
    });

    document.querySelectorAll("[data-go]").forEach(button => {
      button.addEventListener("click", () => {
        showPanel(button.dataset.go);
      });
    });
  }

  // ---------- ЗАПУСК ----------

  async function restoreSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    if (data.session?.user) {
      currentUser = data.session.user;
      await loadProfile();
      showMainView();
    }
  }

  async function start() {
    try {
      initSupabase();
      bindEvents();
      await restoreSession();
    } catch (error) {
      console.error("Chatiki startup:", error);
      notify("Не удалось запустить Chatiki: " + error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", start);
})();
