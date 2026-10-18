(() => {
  "use strict";

  // ==========================================
  // CHATIKI — ПОЛНЫЙ APP.JS
  // ==========================================

  const $ = id => document.getElementById(id);

  const config = window.CHATIKI_CONFIG || {};

  let sb = null;
  let currentUser = null;
  let currentProfile = null;
  let activeChatId = null;
  let refreshTimer = null;
  let isBusy = false;

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  // ==========================================
  // УВЕДОМЛЕНИЯ
  // ==========================================

  function notify(message, type = "info") {
    const authView = $("authView");
    const mainView = $("mainView");

    if (authView && !authView.hidden) {
      const target = $("authMessage");

      if (target) {
        target.textContent = message;
        target.dataset.type = type;
        return;
      }
    }

    const friendMessage = $("friendMessage");

    if (
      mainView &&
      !mainView.hidden &&
      friendMessage &&
      $("friendsPanel") &&
      !$("friendsPanel").hidden
    ) {
      friendMessage.textContent = message;
      friendMessage.dataset.type = type;
      return;
    }

    alert(message);
  }

  function showError(error, prefix = "Ошибка") {
    console.error(prefix, error);

    notify(
      `${prefix}: ${error?.message || String(error)}`,
      "error"
    );
  }

  // ==========================================
  // ПОДКЛЮЧЕНИЕ SUPABASE
  // ==========================================

  function initSupabase() {
    if (!window.supabase?.createClient) {
      throw new Error(
        "Supabase не загрузился. Проверь интернет."
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

  // ==========================================
  // РЕГИСТРАЦИЯ И ВХОД
  // ==========================================

  function setAuthMode(mode) {
    const registerMode = mode === "register";

    if ($("loginBox")) {
      $("loginBox").hidden = false;
    }

    if ($("registerBox")) {
      $("registerBox").hidden = !registerMode;
    }

    $("loginTab")?.classList.toggle(
      "active",
      !registerMode
    );

    $("registerTab")?.classList.toggle(
      "active",
      registerMode
    );

    if ($("submitAuth")) {
      $("submitAuth").textContent = registerMode
        ? "Создать аккаунт"
        : "Войти";
    }

    if ($("authMessage")) {
      $("authMessage").textContent = "";
    }

    const passwordInput = $("passwordInput");

    if (passwordInput) {
      passwordInput.autocomplete = registerMode
        ? "new-password"
        : "current-password";
    }
  }

  function setBusy(value) {
    isBusy = value;

    const button = $("submitAuth");

    if (button) {
      button.disabled = value;

      button.textContent = value
        ? "Подождите..."
        : $("registerBox") && !$("registerBox").hidden
          ? "Создать аккаунт"
          : "Войти";
    }
  }

  async function handleAuth(event) {
    event?.preventDefault();

    if (isBusy) return;

    const registerMode =
      $("registerBox") &&
      !$("registerBox").hidden;

    if (registerMode) {
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
        "Введи почту и пароль длиной минимум 6 символов."
      );
      return;
    }

    try {
      setBusy(true);

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

        await loadProfile();
        showMainView();

        notify("Добро пожаловать в Chatiki! 💜");
      } else {
        setAuthMode("login");

        if ($("passwordInput")) {
          $("passwordInput").value = "";
        }

        notify(
          "Аккаунт создан! Теперь войди в него. Если потребуется подтверждение почты, проверь настройки Supabase."
        );
      }
    } catch (error) {
      showError(error, "Ошибка регистрации");
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
      notify("Введи электронную почту и пароль.");
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
      showError(error, "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  async function restoreSession() {
    const { data, error } =
      await sb.auth.getSession();

    if (error) throw error;

    if (!data.session?.user) {
      return;
    }

    currentUser = data.session.user;

    await loadProfile();
    showMainView();
  }

  // ==========================================
  // ПРОФИЛЬ
  // ==========================================

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
        "Профиль не найден в таблице profiles. Проверь создание профиля в Supabase."
      );
    }

    currentProfile = data;

    renderProfile();
  }

  function getMyId() {
    return currentProfile?.friend_id ||
      currentUser?.id ||
      "";
  }

  function renderProfile() {
    if (!currentUser || !currentProfile) return;

    const username =
      currentProfile.username || "Пользователь";

    const email =
      currentUser.email || "Не указана";

    const id =
      getMyId();

    if ($("welcomeName")) {
      $("welcomeName").textContent = username;
    }

    /*
      Создаём содержимое профиля автоматически,
      если в index.html пока нет его полей.
    */

    const profilePanel = $("profilePanel");

    if (profilePanel) {
      let profileCard = $("chatikiProfileCard");

      if (!profileCard) {
        profileCard = document.createElement("section");
        profileCard.id = "chatikiProfileCard";
        profileCard.className = "chatiki-section";

        profilePanel.appendChild(profileCard);
      }

      profileCard.innerHTML = `
        <div class="profile-avatar">
          ${escapeHTML(username.charAt(0).toUpperCase())}
        </div>

        <h2>${escapeHTML(username)}</h2>

        <p class="subtitle">
          ${
            currentProfile.role === "admin"
              ? "🛡️ Администратор"
              : "👤 Пользователь Chatiki"
          }
        </p>

        <div class="profile-detail">
          <strong>📧 Электронная почта</strong>
          <p>${escapeHTML(email)}</p>
        </div>

        <div class="profile-detail">
          <strong>🆔 Твой ID</strong>
          <p id="chatikiMyId">${escapeHTML(id)}</p>
          <button
            id="copyMyIdBtn"
            class="secondary-btn"
            type="button"
          >
            📋 Скопировать ID
          </button>
        </div>

        <div class="profile-detail">
          <strong>📅 Дата регистрации</strong>
          <p>
            ${
              currentProfile.created_at
                ? escapeHTML(
                    new Date(
                      currentProfile.created_at
                    ).toLocaleDateString("ru-RU")
                  )
                : "Не указана"
            }
          </p>
        </div>

        <button
          id="profileLogoutBtn"
          class="secondary-btn"
          type="button"
        >
          Выйти из аккаунта
        </button>
      `;

      $("copyMyIdBtn")?.addEventListener(
        "click",
        async () => {
          try {
            await navigator.clipboard.writeText(id);
            notify("ID скопирован! 📋");
          } catch {
            notify("Не удалось скопировать ID.");
          }
        }
      );

      $("profileLogoutBtn")?.addEventListener(
        "click",
        logout
      );
    }

    if ($("profileName")) {
      $("profileName").textContent = username;
    }

    if ($("profileEmail")) {
      $("profileEmail").textContent = email;
    }

    if ($("profileId")) {
      $("profileId").textContent = id;
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

  // ==========================================
  // ОСНОВНОЙ ЭКРАН
  // ==========================================

  function showMainView() {
    if ($("authView")) {
      $("authView").hidden = true;
    }

    if ($("mainView")) {
      $("mainView").hidden = false;
    }

    ensureMessengerUI();
    renderProfile();

    showPanel("chatsPanel");

    refreshAll();

    clearInterval(refreshTimer);

    refreshTimer = setInterval(() => {
      refreshAll();
    }, 7000);
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

    if (panelId === "profilePanel") {
      renderProfile();
    }
  }

  // ==========================================
  // ЭЛЕМЕНТЫ ЧАТА
  // ==========================================

  function ensureMessengerUI() {
    const chatsPanel = $("chatsPanel");

    if (!chatsPanel) return;

    if (!$("chatMessages")) {
      const messages = document.createElement("div");

      messages.id = "chatMessages";
      messages.className = "chat-messages";
      messages.setAttribute("aria-live", "polite");

      chatsPanel.appendChild(messages);
    }

    if (!$("messageForm")) {
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

        <button
          type="submit"
          class="primary-btn"
        >
          Отправить
        </button>
      `;

      chatsPanel.appendChild(form);

      form.addEventListener("submit", sendMessage);
    }
  }

  // ==========================================
  // ПОИСК ДРУГА ПО ID
  // ==========================================

  async function findFriend() {
    const input = $("friendIdInput");
    const query = input?.value.trim() || "";

    if (!query) {
      notify("Введи ID друга.");
      return;
    }

    if (
      query === currentUser.id ||
      query === currentProfile?.friend_id
    ) {
      notify("Это твой собственный ID.");
      return;
    }

    try {
      if ($("friendMessage")) {
        $("friendMessage").textContent = "";
      }

      if ($("friendResult")) {
        $("friendResult").innerHTML =
          "<p>🔎 Ищем пользователя...</p>";
      }

      let person = null;

      // Сначала поиск по friend_id.
      const first = await sb
        .from("profiles")
        .select("id, username, friend_id, avatar_url")
        .eq("friend_id", query)
        .maybeSingle();

      if (first.error) throw first.error;

      person = first.data;

      // Если friend_id не найден, пробуем UUID профиля.
      if (!person) {
        const second = await sb
          .from("profiles")
          .select("id, username, friend_id, avatar_url")
          .eq("id", query)
          .maybeSingle();

        if (second.error) {
          /*
            Если введённый ID не является UUID,
            запрос по id может завершиться ошибкой.
          */
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
              .test(query)
          ) {
            throw new Error(
              "Пользователь не найден. Проверь ID друга."
            );
          }

          throw second.error;
        }

        person = second.data;
      }

      if (!person) {
        if ($("friendResult")) {
          $("friendResult").innerHTML = `
            <div class="empty-state">
              <h3>😕 Пользователь не найден</h3>
              <p>Проверь правильность ID.</p>
            </div>
          `;
        }

        return;
      }

      if ($("friendResult")) {
        $("friendResult").innerHTML = `
          <div class="user-card">
            <div class="user-info">
              <h3>${escapeHTML(person.username)}</h3>
              <p>ID: ${escapeHTML(person.friend_id || person.id)}</p>
            </div>

            <button
              id="sendFriendRequestBtn"
              class="primary-btn"
              type="button"
            >
              💌 Добавить в друзья
            </button>
          </div>
        `;

        $("sendFriendRequestBtn")?.addEventListener(
          "click",
          () => sendFriendRequest(person.id)
        );
      }

    } catch (error) {
      showError(error, "Ошибка поиска");

      if ($("friendResult")) {
        $("friendResult").innerHTML = "";
      }
    }
  }

  // ==========================================
  // ЗАЯВКА В ДРУЗЬЯ
  // ==========================================

 
