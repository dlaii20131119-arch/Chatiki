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

    if (!config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Проверь настройки в файле config.js.");
    }

    sb = window.supabase.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_PUBLISHABLE_KEY
    );
  }

  function setAuthMode(mode) {
    authMode = mode;

    if ($("loginBox")) {
      $("loginBox").hidden = mode !== "login";
    }

    if ($("registerBox")) {
      $("registerBox").hidden = mode !== "register";
    }

    const loginTab = $("loginTab");
    const registerTab = $("registerTab");

    if (loginTab) loginTab.classList.toggle("active", mode === "login");
    if (registerTab) registerTab.classList.toggle("active", mode === "register");
  }

  function showLogin() {
    setAuthMode("login");
  }

  function showRegister() {
    setAuthMode("register");
  }

  async function register() {
    const username = $("usernameInput")?.value.trim() || "";
    const email = $("emailInput")?.value.trim() || "";
    const password = $("passwordInput")?.value || "";

    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
      notify("Имя должно содержать 3–24 символа: латинские буквы, цифры или _.");
      return;
    }

    if (!email || password.length < 6) {
      notify("Укажи почту и пароль длиной не менее 6 символов.");
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

      if (data.session) {
        currentUser = data.user;
        await loadProfile();
        showMainView();
      } else {
        notify(
          "Регистрация отправлена. Если подтверждение почты отключено, попробуй войти."
        );
        showLogin();
      }
    } catch (error) {
      notify("Ошибка регистрации: " + error.message);
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    const email = $("emailInput")?.value.trim() || "";
    const password = $("passwordInput")?.value || "";

    if (!email || !password) {
      notify("Введи почту и пароль.");
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
      notify("Ошибка входа: " + error.message);
    } finally {
      setBusy(false);
    }
  }

  function setBusy(value) {
    busy = value;

    const button = $("submitAuth");
    if (button) button.disabled = value;
  }

  async function loadProfile() {
    if (!currentUser) return;

    const { data, error } = await sb
      .from("profiles")
      .select("id, username, friend_id, avatar_url, role, created_at")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error(
        "Профиль не найден. Проверь создание профиля после регистрации в Supabase."
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

    if ($("welcomeName")) $("welcomeName").textContent = username;
    if ($("profileName")) $("profileName").textContent = username;
    if ($("profileEmail")) $("profileEmail").textContent = currentUser.email || "";
    if ($("profileId"))
