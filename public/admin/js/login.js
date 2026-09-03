document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorText = document.getElementById("errorText");
  errorText.textContent = "";

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorText.textContent = data.error || "Не удалось войти";
      return;
    }
    window.location.href = "/admin/index.html";
  } catch (err) {
    errorText.textContent = "Ошибка сети. Проверьте, что сервер запущен.";
  }
});
