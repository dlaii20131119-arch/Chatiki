(() => {
  "use strict";

  // =========================================
  // PVZ MARKET
  // =========================================

  let sb = null;
  let currentUser = null;
  let currentProfile = null;
  let products = [];
  let refreshTimer = null;

  const $ = id => document.getElementById(id);

  // =========================================
  // СООБЩЕНИЯ И ОТОБРАЖЕНИЕ
  // =========================================

  function message(id, text, error = false) {
    const el = $(id);
    if (!el) return;

    el.textContent = text;
    el.style.color = error ? "#dc2626" : "#16a34a";
  }

  function show(el, visible = true) {
    if (!el) return;

    el.hidden = !visible;
    el.style.display = visible ? "" : "none";
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function formatPrice(value) {
    return Number(value).toLocaleString("ru-RU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // =========================================
  // SUPABASE
  // =========================================

  function initializeSupabase() {
    const config =
      window.PVZ_MARKET_CONFIG ||
      window.CHATIKI_CONFIG;

    if (!config) {
      alert("Не найден config.js");
      return false;
    }

    if (!window.supabase) {
      alert("Не загружена библиотека Supabase");
      return false;
    }

    const url = config.SUPABASE_URL;
    const key = config.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      alert("Проверь настройки Supabase в config.js");
      return false;
    }

    sb = window.supabase.createClient(url, key);
    return true;
  }

  // =========================================
  // АВТОРИЗАЦИЯ
  // =========================================

  function usernameToEmail(username) {
    return username.toLowerCase() + "@pvz-market.example.com";
  }

  function showLogin() {
    show($("loginBox"), true);
    show($("registerBox"), false);

    $("loginTab")?.classList.add("active");
    $("registerTab")?.classList.remove("active");

    const button = $("submitAuth");
    if (button) button.textContent = "Войти";

    message("authMessage", "");
  }

  function showRegister() {
    show($("loginBox"), false);
    show($("registerBox"), true);

    $("loginTab")?.classList.remove("active");
    $("registerTab")?.classList.add("active");

    const button = $("submitAuth");
    if (button) button.textContent = "Зарегистрироваться";

    message("authMessage", "");
  }

  async function register() {
    const username = $("registerUsername")?.value.trim();
    const password = $("registerPassword")?.value;
    const displayName =
      $("registerName")?.value.trim() || username;

    if (!username || !password) {
      message("authMessage", "Заполни логин и пароль", true);
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      message("authMessage", "Логин: 3–24 символа, только буквы, цифры и _", true);
      return;
    }

    if (password.length < 6) {
      message("authMessage", "Пароль должен быть не короче 6 символов", true);
      return;
    }

    const button = $("submitAuth");
    if (button) button.disabled = true;

    message("authMessage", "Создаём аккаунт...");

    try {
      const { data, error } = await sb.auth.signUp({
        email: usernameToEmail(username),
        password,
        options: {
          data: {
            username,
            display_name: displayName
          }
        }
      });

      if (error) throw error;

      if (!data.session) {
        showLogin();
        message("authMessage", "Аккаунт создан. Теперь войди в него.");
        return;
      }

      currentUser = data.user;

      await loadProfile();
      await enterApplication();

    } catch (error) {
      console.error(error);
      message("authMessage", error.message || "Ошибка регистрации", true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function login() {
    const username = $("loginUsername")?.value.trim();
    const password = $("loginPassword")?.value;

    if (!username || !password) {
      message("authMessage", "Заполни логин и пароль", true);
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      message("authMessage", "Неверный формат логина", true);
      return;
    }

    const button = $("submitAuth");
    if (button) button.disabled = true;

    message("authMessage", "Входим...");

    try {
      const { data, error } = await sb.auth.signInWithPassword({
        email: usernameToEmail(username),
        password
      });

      if (error) throw error;

      currentUser = data.user;

      await loadProfile();
      await enterApplication();

    } catch (error) {
      console.error(error);
      message("authMessage", error.message || "Не удалось войти", true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function logout() {
    if (!confirm("Выйти из аккаунта?")) return;

    clearInterval(refreshTimer);

    await sb.auth.signOut();

    currentUser = null;
    currentProfile = null;

    show($("authView"), true);
    show($("mainView"), false);

    showLogin();
  }

  // =========================================
  // ПРОФИЛЬ
  // =========================================

  async function loadProfile() {
    const { data, error } = await sb
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) throw error;

    currentProfile = data;
  }

  function renderProfile() {
    const username =
      currentProfile?.username ||
      currentUser?.user_metadata?.username ||
      "Пользователь";

    const displayName =
      currentUser?.user_metadata?.display_name ||
      username;

    if ($("profileName")) {
      $("profileName").textContent = displayName;
    }

    if ($("profileId")) {
      $("profileId").textContent = username;
    }

    if ($("welcomeName")) {
      $("welcomeName").textContent = displayName;
    }
  }

  // =========================================
  // ГЛАВНОЕ ПРИЛОЖЕНИЕ
  // =========================================

  async function enterApplication() {
    show($("authView"), false);
    show($("mainView"), true);

    renderProfile();
    openPanel("homePanel");

    await loadProducts();
    await loadOrders();

    clearInterval(refreshTimer);

    refreshTimer = setInterval(async () => {
      await loadProducts();
      await loadOrders();
    }, 15000);
  }

  // =========================================
  // НАВИГАЦИЯ
  // =========================================

  function openPanel(panelId) {
    const panels = [
      "homePanel",
      "shopPanel",
      "ordersPanel",
      "readyPanel",
      "profilePanel"
    ];

    panels.forEach(id => {
      const panel = $(id);

      if (panel) {
        panel.hidden = id !== panelId;
        panel.style.display = id === panelId ? "" : "none";
      }
    });

    document.querySelectorAll("[data-panel]").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.panel === panelId
      );
    });
  }

  // =========================================
  // ТОВАРЫ
  // =========================================

  async function loadProducts() {
    const { data, error } = await sb
      .from("products")
      .select("*")
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    products = data || [];
    renderProducts();
  }

  function productImageUrl(path) {
    if (!path) return "";

    const { data } = sb.storage
      .from("product-photos")
      .getPublicUrl(path);

    return data.publicUrl;
  }

  function productCard(product) {
    const image = productImageUrl(product.image_path);
    const isMine = product.seller_id === currentUser.id;

    return `
      <article class="product-card">

        ${
          image
            ? `<img src="${escapeHTML(image)}" alt="Фото товара" class="product-image">`
            : `<div class="product-placeholder">📦</div>`
        }

        <div class="product-card-content">

          <h3>${escapeHTML(product.name)}</h3>

          <div class="product-price">
            ${formatPrice(product.price)}
          </div>

          <p>${escapeHTML(product.description || "")}</p>

          <small>
            ${isMine ? "Ваш товар" : "Продавец: " + product.seller_id.slice(0, 8)}
          </small>

          ${
            isMine
              ? `
                <button class="secondary-btn" disabled>
                  Ваш товар
                </button>

                <button
                  class="secondary-btn"
                  data-delete="${escapeHTML(product.id)}"
                  style="background:#dc2626;color:white;margin-top:8px;"
                >
                  🗑️ Удалить товар
                </button>
              `
              : `
                <button
                  class="primary-btn"
                  data-buy="${escapeHTML(product.id)}"
                >
                  Заказать
                </button>
              `
          }

        </div>
      </article>
    `;
  }

  function renderProducts() {
    const home = $("homeProducts");
    const shop = $("productList");

    const search = ($("productSearch")?.value || "").toLowerCase();

    const filtered = products.filter(product =>
      product.name.toLowerCase().includes(search)
    );

    if (home) {
      home.innerHTML = products.length
        ? products.slice(0, 6).map(productCard).join("")
        : "<p>Пока товаров нет.</p>";
    }

    if (shop) {
      shop.innerHTML = filtered.length
        ? filtered.map(productCard).join("")
        : "<p>Ничего не найдено.</p>";
    }
  }

  // =========================================
  // УДАЛЕНИЕ ТОВАРА ПРОДАВЦОМ
  // =========================================

  async function deleteProduct(productId) {
    const product = products.find(p => p.id === productId);

    if (!product) {
      alert("Товар уже отсутствует в каталоге.");
      return;
    }

    // Проверяем, что товар принадлежит текущему пользователю
    if (product.seller_id !== currentUser.id) {
      alert("Можно удалять только собственные товары.");
      return;
    }

    if (!confirm(
      `Удалить товар "${product.name}"?\n\nОн исчезнет из магазина у всех пользователей. История заказов сохранится.`
    )) {
      return;
    }

    try {
      const { data, error } = await sb
        .from("products")
        .update({ active: false })
        .eq("id", productId)
        .eq("seller_id", currentUser.id)
        .select("id");

      if (error) throw error;

      if (!data || data.length === 0) {
        throw new Error("Не удалось удалить товар. Проверь права доступа.");
      }

      alert("Товар успешно удалён из магазина!");

      await loadProducts();

    } catch (error) {
      console.error(error);
      alert(error.message || "Не удалось удалить товар");
    }
  }

  // =========================================
  // ДОБАВЛЕНИЕ ТОВАРА
  // =========================================

  async function addProduct() {
    const name = $("productName")?.value.trim();
    const price = Number($("productPrice")?.value);
    const description = $("productDescription")?.value.trim() || "";
    const file = $("productImage")?.files?.[0];

    if (!name) {
      message("productMessage", "Введи название товара", true);
      return;
    }

    if (name.length > 80) {
      message("productMessage", "Название слишком длинное", true);
      return;
    }

    if (!Number.isFinite(price) || price <= 0) {
      message("productMessage", "Укажи правильную цену", true);
      return;
    }

    if (description.length > 500) {
      message("productMessage", "Описание слишком длинное", true);
      return;
    }

    if (file && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      message("productMessage", "Можно загружать JPG, PNG или WEBP", true);
      return;
    }

    if (file && file.size > 5 * 1024 * 1024) {
      message("productMessage", "Фото должно быть меньше 5 МБ", true);
      return;
    }

    const button = $("addProductBtn");
    if (button) button.disabled = true;

    let imagePath = null;

    try {
      message("productMessage", "Добавляем товар...");

      if (file) {
        const extension = file.type === "image/png"
          ? "png"
          : file.type === "image/webp"
            ? "webp"
            : "jpg";

        imagePath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await sb.storage
          .from("product-photos")
          .upload(imagePath, file, {
            contentType: file.type,
            upsert: false
          });

        if (uploadError) throw uploadError;
      }

      const { error } = await sb
        .from("products")
        .insert({
          seller_id: currentUser.id,
          name,
          price,
          description,
          image_path: imagePath
        });

      if (error) throw error;

      $("productName").value = "";
      $("productPrice").value = "";
      $("productDescription").value = "";
      $("productImage").value = "";

      message("productMessage", "Товар успешно добавлен!");

      await loadProducts();

    } catch (error) {
      console.error(error);

      message("productMessage", error.message || "Не удалось добавить товар", true);

      if (imagePath) {
        await sb.storage.from("product-photos").remove([imagePath]);
      }

    } finally {
      if (button) button.disabled = false;
    }
  }

  // =========================================
  // ЗАКАЗЫ
  // =========================================

  async function createOrder(productId) {
    const product = products.find(p => p.id === productId);

    if (!product) return;

    if (product.seller_id === currentUser.id) {
      alert("Нельзя заказать собственный товар.");
      return;
    }

    if (!confirm(`Заказать "${product.name}" за ${formatPrice(product.price)}?`)) {
      return;
    }

    try {
      const { error } = await sb
        .from("orders")
        .insert({
          product_id: product.id,
          buyer_id: currentUser.id,
          seller_id: product.seller_id,
          status: "pending"
        });

      if (error) throw error;

      alert("Заказ успешно оформлен!");

      await loadOrders();
      openPanel("ordersPanel");

    } catch (error) {
      console.error(error);
      alert(error.message || "Не удалось оформить заказ");
    }
  }

  async function loadOrders() {
    const { data, error } = await sb
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    const orders = data || [];
    const productIds = [...new Set(orders.map(order => order.product_id))];

    let productMap = {};

    if (productIds.length) {
      const { data: productData } = await sb
        .from("products")
        .select("id,name,price")
        .in("id", productIds);

      (productData || []).forEach(product => {
        productMap[product.id] = product;
      });
    }

    const myOrders = orders.filter(order =>
      order.buyer_id === currentUser.id
    );

    const sellerOrders = orders.filter(order =>
      order.seller_id === currentUser.id
    );

    const readyOrders = myOrders.filter(order =>
      order.status === "ready"
    );

    renderOrders("myOrders", myOrders, productMap, "buyer");
    renderOrders("sellerOrders", sellerOrders, productMap, "seller");
    renderOrders("readyOrders", readyOrders, productMap, "buyer");
  }

  function statusName(status) {
    return {
      pending: "Ожидает подтверждения",
      ready: "Можно забирать",
      done: "Заказ выдан",
      cancelled: "Отменён"
    }[status] || status;
  }

  function renderOrders(containerId, orders, productMap, role) {
    const container = $(containerId);
    if (!container) return;

    if (!orders.length) {
      container.innerHTML = "<p>Пока заказов нет.</p>";
      return;
    }

    container.innerHTML = orders.map(order => {
      const product = productMap[order.product_id];
      const title = product ? product.name : "Товар";
      const price = product ? formatPrice(product.price) : "";

      let buttons = "";

      if (role === "seller" && order.status === "pending") {
        buttons = `<button class="primary-btn" data-ready="${order.id}">Можно забирать</button>`;
      }

      if (role === "buyer" && order.status === "ready") {
        buttons = `<button class="primary-btn" data-done="${order.id}">Забрал</button>`;
      }

      return `
        <article class="order-card">
          <h3>${escapeHTML(title)}</h3>
          <p>Цена: ${price}</p>
          <p>Статус: <strong>${statusName(order.status)}</strong></p>
          <small>Заказ: ${order.id.slice(0, 8)}</small>
          ${buttons}
        </article>
      `;
    }).join("");
  }

  async function updateOrder(orderId, status) {
    try {
      const { error } = await sb
        .from("orders")
        .update({ status })
        .eq("id", orderId);

      if (error) throw error;

      await loadOrders();

    } catch (error) {
      console.error(error);
      alert(error.message || "Не удалось изменить статус");
    }
  }

  // =========================================
  // СОБЫТИЯ
  // =========================================

  function bindEvents() {
    $("loginTab")?.addEventListener("click", showLogin);
    $("registerTab")?.addEventListener("click", showRegister);

    $("submitAuth")?.addEventListener("click", () => {
      if ($("registerBox") && !$("registerBox").hidden) {
        register();
      } else {
        login();
      }
    });

    $("addProductBtn")?.addEventListener("click", addProduct);
    $("productSearch")?.addEventListener("input", renderProducts);
    $("profileLogoutBtn")?.addEventListener("click", logout);

    $("copyMyIdBtn")?.addEventListener("click", async () => {
      const username =
        currentProfile?.username ||
        currentUser?.user_metadata?.username ||
        "";

      try {
        await navigator.clipboard.writeText(username);
        alert("Логин скопирован!");
      } catch {
        alert("Не удалось скопировать логин");
      }
    });

    document.querySelectorAll("[data-panel]").forEach(button => {
      button.addEventListener("click", () => {
        openPanel(button.dataset.panel);
      });
    });

    document.addEventListener("click", event => {
      const buyButton = event.target.closest("[data-buy]");
      const readyButton = event.target.closest("[data-ready]");
      const doneButton = event.target.closest("[data-done]");
      const deleteButton = event.target.closest("[data-delete]");

      if (buyButton) {
        createOrder(buyButton.dataset.buy);
      }

      if (readyButton) {
        updateOrder(readyButton.dataset.ready, "ready");
      }

      if (doneButton) {
        updateOrder(doneButton.dataset.done, "done");
      }

      if (deleteButton) {
        deleteProduct(deleteButton.dataset.delete);
      }
    });
  }

  // =========================================
  // ЗАПУСК
  // =========================================

  async function start() {
    if (!initializeSupabase()) return;

    bindEvents();

    const { data, error } = await sb.auth.getSession();

    if (error) {
      console.error(error);
      alert("Ошибка авторизации: " + error.message);
      return;
    }

    if (data.session) {
      currentUser = data.session.user;

      try {
        await loadProfile();
        await enterApplication();
      } catch (error) {
        console.error(error);
        alert("Не удалось загрузить профиль: " + error.message);
      }
    } else {
      show($("authView"), true);
      show($("mainView"), false);
      showLogin();
    }

    sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        currentUser = null;
        currentProfile = null;

        clearInterval(refreshTimer);

        show($("authView"), true);
        show($("mainView"), false);
        showLogin();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", start);

})();
