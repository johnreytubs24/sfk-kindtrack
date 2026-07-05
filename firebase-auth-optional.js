(function setupKindTrackOptionalAuth() {
  let pendingResolve = null;
  let latestUser = null;
  let authReadyResolve = null;
  const authReady = new Promise((resolve) => {
    authReadyResolve = resolve;
  });

  function ensureStyles() {
    if (document.getElementById("kindTrackFirebaseAuthStyles")) return;

    const style = document.createElement("style");
    style.id = "kindTrackFirebaseAuthStyles";
    style.textContent = `
      #kindTrackFirebaseAuthModal {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: none;
        place-items: center;
        padding: 18px;
        background: rgba(16, 16, 16, .38);
      }

      #kindTrackFirebaseAuthModal.is-open {
        display: grid;
      }

      .kindtrack-firebase-auth-card {
        width: min(420px, 100%);
        border: 3px solid #101010;
        border-radius: 16px;
        background: #fffbea;
        box-shadow: 7px 7px 0 #101010;
        padding: 22px;
        font-family: Arial, Helvetica, sans-serif;
        color: #101010;
      }

      .kindtrack-firebase-auth-card h2 {
        margin: 0 0 6px;
        font-size: 24px;
      }

      .kindtrack-firebase-auth-card p {
        margin: 0 0 16px;
        line-height: 1.35;
      }

      #kindTrackFirebaseAuthForm {
        display: grid;
        gap: 12px;
      }

      #kindTrackFirebaseAuthForm label {
        display: grid;
        gap: 6px;
        font-weight: 800;
      }

      #kindTrackFirebaseAuthForm input {
        width: 100%;
        border: 2px solid #101010;
        border-radius: 10px;
        padding: 11px;
        font: inherit;
      }

      .kindtrack-firebase-auth-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        flex-wrap: wrap;
      }

      .kindtrack-firebase-auth-actions button {
        border: 3px solid #101010;
        border-radius: 999px;
        background: #ffcc00;
        color: #101010;
        box-shadow: 3px 3px 0 #101010;
        font-weight: 900;
        padding: 10px 14px;
        cursor: pointer;
      }

      .kindtrack-firebase-auth-actions button.secondary {
        background: #fff;
      }

      #kindTrackFirebaseAuthMessage {
        min-height: 20px;
        margin-top: 12px !important;
        color: #b00020;
        font-weight: 800;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    ensureStyles();

    let modal = document.getElementById("kindTrackFirebaseAuthModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "kindTrackFirebaseAuthModal";
    modal.innerHTML = `
      <div class="kindtrack-firebase-auth-card">
        <h2>Admin Login</h2>
        <p>Use the Firebase admin account to open editing tools.</p>

        <form id="kindTrackFirebaseAuthForm">
          <label>
            Email
            <input id="kindTrackFirebaseEmail" type="email" autocomplete="username" required />
          </label>

          <label>
            Password
            <input id="kindTrackFirebasePassword" type="password" autocomplete="current-password" required />
          </label>

          <div class="kindtrack-firebase-auth-actions">
            <button class="secondary" id="kindTrackFirebaseCancel" type="button">Cancel</button>
            <button id="kindTrackFirebaseSubmit" type="submit">Sign In</button>
          </div>
        </form>

        <p id="kindTrackFirebaseAuthMessage"></p>
      </div>
    `;
    document.body.appendChild(modal);

    const form = document.getElementById("kindTrackFirebaseAuthForm");
    const cancel = document.getElementById("kindTrackFirebaseCancel");
    const submit = document.getElementById("kindTrackFirebaseSubmit");
    const email = document.getElementById("kindTrackFirebaseEmail");
    const password = document.getElementById("kindTrackFirebasePassword");
    const message = document.getElementById("kindTrackFirebaseAuthMessage");

    cancel.addEventListener("click", () => {
      modal.classList.remove("is-open");
      if (pendingResolve) pendingResolve(false);
      pendingResolve = null;
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.textContent = "";
      submit.disabled = true;
      submit.textContent = "Signing in...";

      try {
        const credential = await firebase.auth().signInWithEmailAndPassword(email.value.trim(), password.value);
        latestUser = credential.user || firebase.auth().currentUser || null;
        modal.classList.remove("is-open");
        if (pendingResolve) pendingResolve(true);
        pendingResolve = null;
      } catch (error) {
        message.textContent = "Login failed. Check email/password.";
        console.error("Firebase login error:", error);
      } finally {
        submit.disabled = false;
        submit.textContent = "Sign In";
      }
    });

    return modal;
  }

  async function ensureSignedIn() {
    if (!window.firebase || !firebase.auth) {
      throw new Error("Firebase Auth SDK is not loaded.");
    }

    await authReady;

    if (latestUser || firebase.auth().currentUser) return true;

    const modal = ensureModal();
    modal.classList.add("is-open");

    return new Promise((resolve) => {
      pendingResolve = resolve;
    });
  }

  if (!window.firebase || !firebase.auth) {
    console.error("Firebase Auth SDK is not loaded.");
    return;
  }

  ensureStyles();

  const persistence = firebase.auth.Auth && firebase.auth.Auth.Persistence
    ? firebase.auth.Auth.Persistence.LOCAL
    : null;

  const persistenceReady = persistence
    ? firebase.auth().setPersistence(persistence).catch((error) => {
      console.warn("Firebase auth persistence fallback:", error);
    })
    : Promise.resolve();

  persistenceReady.finally(() => {
    firebase.auth().onAuthStateChanged((user) => {
      latestUser = user || null;
      if (authReadyResolve) {
        authReadyResolve();
        authReadyResolve = null;
      }
    });
  });

  window.SFK_KINDTRACK_AUTH = {
    ensureSignedIn,
    getCurrentUser: () => latestUser || firebase.auth().currentUser || null
  };
})();
