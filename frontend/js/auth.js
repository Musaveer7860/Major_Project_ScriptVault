function showToast(message, type = 'success') {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-exclamation';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
            <i class="fa-solid ${iconClass}"></i>
            <span>${message}</span>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

const registerForm = document.getElementById("register-form");
const passwordInput = document.getElementById("password");
const btnRegister = document.getElementById("btn-register");

if (passwordInput && registerForm) {
    const reqLength = document.getElementById("req-length");
    const reqLetter = document.getElementById("req-letter");
    const reqNumber = document.getElementById("req-number");

    passwordInput.addEventListener("input", () => {
        const val = passwordInput.value;
        
        const isLengthValid = val.length >= 8;
        toggleChecklistItem(reqLength, isLengthValid);

        const isLetterValid = /[a-zA-Z]/.test(val);
        toggleChecklistItem(reqLetter, isLetterValid);

        const isNumberValid = /[0-9]/.test(val);
        toggleChecklistItem(reqNumber, isNumberValid);

        btnRegister.disabled = !(isLengthValid && isLetterValid && isNumberValid);
    });

    function toggleChecklistItem(elem, isValid) {
        if (!elem) return;
        const icon = elem.querySelector("i");
        if (isValid) {
            elem.classList.add("valid");
            icon.className = "fa-solid fa-circle-check";
        } else {
            elem.classList.remove("valid");
            icon.className = "fa-regular fa-circle-dot";
        }
    }
}

if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const username = document.getElementById("username").value;
        const email = document.getElementById("email").value;
        const password = passwordInput.value;
        
        try {
            const response = await fetch("/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, email, password })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.detail || "Registration failed. Please try again.");
            }
            
            showToast("Registration successful! Redirecting to login...", "success");
            setTimeout(() => {
                window.location.href = "/login";
            }, 1500);
            
        } catch (err) {
            showToast(err.message, "error");
        }
    });
}

const loginForm = document.getElementById("login-form");
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;
        
        try {
            const response = await fetch("/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.detail || "Login failed. Check credentials.");
            }
            
            localStorage.setItem("user", JSON.stringify(data.user));
            
            showToast("Login successful! Unlocking your vault...", "success");
            setTimeout(() => {
                window.location.href = "/dashboard";
            }, 1200);
            
        } catch (err) {
            showToast(err.message, "error");
        }
    });
}

async function handleLogout() {
    try {
        await fetch("/logout", { method: "POST" });
    } catch (e) {
        console.error("Error logging out from server:", e);
    }
    
    localStorage.removeItem("user");
    window.location.href = "/";
}