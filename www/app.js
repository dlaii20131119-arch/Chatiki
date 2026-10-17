// ==========================================
// CHATIKI — основной JavaScript приложения
// Авторизация, профили, поиск друзей и навигация
// ==========================================

(() => {
"use strict";

const $ = (id) => document.getElementById(id);

const config = window.CHATIKI_CONFIG;

let supabaseClient = null;
let currentUser = null;
let currentProfile = null;
let authMode = "login";
let authRequestInProgress = false;

// ------------------------------------------
// Инициализация Supabase
// ------------------------------------------

function initializeSupabase() {
if (!config ||
!config.SUPABASE_URL ||
!config.SUPABASE_PUBLISHABLE_KEY ||
config.SUPABASE_URL.includes("PASTE_") ||
config.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_")) {
showSetupError(
"Не настроен Supabase. Проверь файл config.js."
);
return false;
}

if (!window.supabase ||
    typeof window.supabase.createClient !== "function") {
  showSetupError(
    "Не загрузилась библиотека Supabase. Проверь подключение к интернету."
  );
  return false;
}

try {
  supabaseClient = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_PUBLISHABLE_KEY
  );

  return true;
} catch (error) {
  console.error("Supabase initialization error:", error);

  showSetupError("Не удалось подключиться к Supabase.");
  return false;
}

}

function showSetupError(message) {
const notice = $("setupNotice");

if (notice) {
  notice.textContent = message;
  notice.classList.remove("hidden");
}

setAuthMessage(message, true);

}

// ------------------------------------------
// Сообщения пользователю
// ------------------------------------------

function setAuthMessage(message, isError = false) {
const element = $("authMessage");
if (!element) return;

element.textContent = message;
element.classList.toggle("error", isError);

}

function setFriendMessage(message, isError = false) {
const element = $("friendMessage");
if (!element) return;

element.textContent = message;
element.classList.toggle("error", isError);

}

function setAuthLoading(loading) {
authRequestInProgress = loading;

const button = $("submitAuth");
if (!button) return;

button.disabled = loading;

if (loading) {
  button.textContent = "Подожди…";
} else {
  updateAuthButton();
}

}

// ------------------------------------------
// Переключение входа и регистрации
// ------------------------------------------

function setAuthMode(mode) {
authMode = mode === "register" ? "register" : "login";

$("loginTab")?.classList.toggle(
  "active",
  authMode === "login"
);

$("registerTab")?.classList.toggle(
  "active",
  authMode === "register"
);

$("usernameLabel")?.classList.toggle(
  "hidden",
  authMode !== "register"
);

const password = $("passwordInput");

if (password) {
  password.autocomplete =
    authMode === "register" ? "new-password" : "current-password";
}

setAuthMessage("");
updateAuthButton();

}

function updateAuthButton() {
const button = $("submitAuth");
if (!button || authRequestInProgress) return;

button.innerHTML =
  authMode === "register"
    ? 'Создать аккаунт <span>→</span>'
    : 'Войти <span>→</span>';

}

// ------------------------------------------
// Регистрация и вход
// ------------------------------------------

async function handleAuthSubmit(event) {
event.preventDefault();

if (authRequestInProgress || !supabaseClient) return;

const email = $("emailInput").value.trim();
const password = $("passwordInput").value;
const username = $("usernameInput").value.trim();

if (!email || !password) {
  setAuthMessage("Заполни электронную почту и пароль.", true);
  return;
}

if (password.length < 6) {
  setAuthMessage("Пароль должен содержать минимум 6 символов.", true);
  return;
}

if (authMode === "register") {
  if (username.length < 3) {
    setAuthMessage(
      "Имя пользователя должно содержать минимум 3 символа.",
      true
    );
    return;
  }

  if (username.length > 24) {
    setAuthMessage(
      "Имя пользователя не должно превышать 24 символа.",
      true
    );
    return;
  }
}

setAuthLoading(true);

try {
  if (authMode === "register") {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username
        }
      }
    });

    if (error) throw error;

    if (data.session && data.user) {
      currentUser = data.user;
      await loadProfile();
    } else {
      setAuthMessage(
        "Регистрация выполнена! Проверь почту, если Supabase запросил подтверждение. Затем войди в аккаунт."
      );
    }
  } else {
    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) throw error;

    currentUser = data.user;

    await loadProfile();
  }
} catch (error) {
  console.error("Authentication error:", error);

  setAuthMessage(
    getFriendlyAuthError(error),
    true
  );
} finally {
  setAuthLoading(false);
}

}

function getFriendlyAuthError(error) {
const message = String(error?.message || "").toLowerCase();

if (message.includes("invalid login credentials")) {
  return "Неверная почта или пароль.";
}

if (message.includes("user already registered")) {
  return "Этот email уже зарегистрирован. Попробуй войти.";
}

if (message.includes("password")) {
  return "Проверь пароль. Он должен содержать минимум 6 символов.";
}

if (message.includes("email not confirmed")) {
  return "Подтверди электронную почту и попробуй снова.";
}

if (
  message.includes("failed to fetch") ||
  message.includes("network")
) {
  return "Нет соединения. Проверь интернет и настройки Supabase.";
}

return error?.message || "Не удалось выполнить операцию.";

}

// ------------------------------------------
// Загрузка профиля
// ------------------------------------------

async function loadProfile() {
if (!currentUser || !supabaseClient) return;

const { data, error } = await supabaseClient
  .from("profiles")
  .select("id, username, friend_id, role, created_at")
  .eq("id", currentUser.id)
  .maybeSingle();

if (error) {
  console.error("Profile loading error:", error);

  showSetupError(
    "Аккаунт создан, но профиль не загрузился. Проверь таблицу profiles и её RLS-политики."
  );

  return;
}

if (!data) {
  showSetupError(
    "Профиль пока не найден. Проверь, работает ли триггер on_auth_user_created в Supabase."
  );

  return;
}

currentProfile = data;

renderProfile();
showMainView();

}

function renderProfile() {
if (!currentUser || !currentProfile) return;

const username =
  currentProfile.username ||
  currentUser.user_metadata?.username ||
  currentUser.email?.split("@")[0] ||
  "Пользователь";

const friendId = currentProfile.friend_id || currentProfile.id;

if ($("welcomeName")) {
  $("welcomeName").textContent = `Привет, ${username}!`;
}

if ($("profileName")) {
  $("profileName").textContent = username;
}

if ($("profileEmail")) {
  $("profileEmail").textContent = currentUser.email || "";
}

if ($("profileId")) {
  $("profileId").textContent = friendId;
}

if ($("avatar")) {
  $("avatar").textContent =
    username.charAt(0).toUpperCase();
}

if ($("roleBadge")) {
  $("roleBadge").textContent =
    currentProfile.role === "admin"
      ? "АДМИНИСТРАТОР"
      : "ПОЛЬЗОВАТЕЛЬ";
}

}

// ------------------------------------------
// Переключение экранов
// ------------------------------------------

function showMainView() {
$("authView")?.classList.add("hidden");
$("mainView")?.classList.remove("hidden");

showPanel("chatsPanel");

}

function showAuthView() {
$("mainView")?.classList.add("hidden");
$("authView")?.classList.remove("hidden");
}

function showPanel(panelId) {
const allowedPanels = [
"chatsPanel",
"friendsPanel",
"profilePanel"
];

if (!allowedPanels.includes(panelId)) return;

allowedPanels.forEach((id) => {
  $(id)?.classList.toggle("hidden", id !== panelId);
});

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.classList.toggle(
    "active",
    button.dataset.panel === panelId
  );
});

}

// ------------------------------------------
// Поиск друга по ID
// ------------------------------------------

async function findFriend() {
if (!currentUser || !supabaseClient) {
setFriendMessage("Сначала войди в аккаунт.", true);
return;
}

const input = $("friendIdInput");
const friendId = input?.value.trim();

if (!friendId) {
  setFriendMessage("Введи ID друга.", true);
  return;
}

if (friendId === currentProfile?.friend_id) {
  setFriendMessage("Это твой собственный ID.", true);
  return;
}

const button = $("findFriendBtn");

if (button) {
  button.disabled = true;
  button.textContent = "Ищем…";
}

setFriendMessage("");

$("friendResult")?.classList.add("hidden");

try {
  // Сначала ищем по специальному friend_id.
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, username, friend_id")
    .eq("friend_id", friendId)
    .neq("id", currentUser.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    setFriendMessage(
      "Друг не найден. Проверь ID и попробуй ещё раз.",
      true
    );
    return;
  }

  renderFriendResult(data);
} catch (error) {
  console.error("Friend search error:", error);

  setFriendMessage(
    "Не удалось найти друга. Проверь доступ к таблице profiles в Supabase.",
    true
  );
} finally {
  if (button) {
    button.disabled = false;
    button.innerHTML = 'Найти друга <span>→</span>';
  }
}

}

function renderFriendResult(friend) {
const result = $("friendResult");
if (!result) return;

result.replaceChildren();

const avatar = document.createElement("div");
avatar.className = "avatar";
avatar.textContent =
  (friend.username || "C").charAt(0).toUpperCase();

const name = document.createElement("h3");
name.textContent = friend.username || "Пользователь Chatiki";

const id = document.createElement("p");
id.className = "muted";
id.textContent = `ID: ${friend.friend_id || friend.id}`;

const info = document.createElement("p");
info.textContent = "Пользователь найден!";

result.append(avatar, name, id, info);
result.classList.remove("hidden");

}

// ------------------------------------------
// Копирование ID профиля
// ------------------------------------------

async function copyProfileId() {
if (!currentProfile) return;

const id = currentProfile.friend_id || currentProfile.id;

try {
  await navigator.clipboard.writeText(id);
  showTemporaryMessage("ID скопирован!");
} catch {
  const area = document.createElement("textarea");
  area.value = id;
  area.style.position = "fixed";
  area.style.opacity = "0";

  document.body.appendChild(area);
  area.select();

  const success = document.execCommand("copy");
  area.remove();

  showTemporaryMessage(
    success ? "ID скопирован!" : `Твой ID: ${id}`
  );
}

}

function showTemporaryMessage(message) {
const profileId = $("profileId");
if (!profileId) return;

const previousText = profileId.textContent;
profileId.textContent = message;

setTimeout(() => {
  if (currentProfile) {
    profileId.textContent =
      currentProfile.friend_id || currentProfile.id;
  } else {
    profileId.textContent = previousText;
  }
}, 1800);

}

// ------------------------------------------
// Выход из аккаунта
// ------------------------------------------

async function logout() {
if (!supabaseClient) return;

const button = $("logoutBtn");
if (button) button.disabled = true;

try {
  const { error } = await supabaseClient.auth.signOut();

  if (error) throw error;

  currentUser = null;
  currentProfile = null;

  $("authForm")?.reset();
  setAuthMode("login");
  setAuthMessage("");
  showAuthView();
} catch (error) {
  console.error("Logout error:", error);

  showSetupError("Не удалось выйти. Попробуй ещё раз.");
} finally {
  if (button) button.disabled = false;
}

}

// ------------------------------------------
// Обработчики интерфейса
// ------------------------------------------

function bindEvents() {
$("loginTab")?.addEventListener("click", () => {
setAuthMode("login");
});

$("registerTab")?.addEventListener("click", () => {
  setAuthMode("register");
});

$("authForm")?.addEventListener(
  "submit",
  handleAuthSubmit
);

$("logoutBtn")?.addEventListener("click", logout);

$("findFriendBtn")?.addEventListener(
  "click",
  findFriend
);

$("copyIdBtn")?.addEventListener(
  "click",
  copyProfileId
);

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", () => {
    showPanel(button.dataset.panel);
  });
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => {
    showPanel(button.dataset.go);
  });
});

}

// ------------------------------------------
// Восстановление сессии после перезагрузки
// ------------------------------------------

async function restoreSession() {
if (!supabaseClient) return;

try {
  const { data, error } =
    await supabaseClient.auth.getSession();

  if (error) throw error;

  if (data.session?.user) {
    currentUser = data.session.user;
    await loadProfile();
  } else {
    showAuthView();
  }
} catch (error) {
  console.error("Session restoration error:", error);

  showAuthView();
  setAuthMessage(
    "Не удалось восстановить сессию. Проверь интернет и настройки Supabase.",
    true
  );
}

}

// ------------------------------------------
// Запуск приложения
// ------------------------------------------

async function start() {
bindEvents();
setAuthMode("login");

if (!initializeSupabase()) {
  showAuthView();
  return;
}

supabaseClient.auth.onAuthStateChange(
  (event, session) => {
    if (event === "SIGNED_OUT") {
      currentUser = null;
      currentProfile = null;
      showAuthView();
    }
  }
);

await restoreSession();

}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", start);
} else {
start();
}
})();
