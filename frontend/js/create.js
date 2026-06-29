const userStr = localStorage.getItem("user");
if (!userStr) {
    window.location.href = "/login";
}
const currentUser = JSON.parse(userStr);

let editor = null;
let isManualLanguage = false;

function detectLanguage(code) {
    if (!code || code.trim().length < 5) return null;
    
    const scores = {
        Python: 0,
        JavaScript: 0,
        Java: 0,
        C: 0,
        "C++": 0,
        HTML: 0,
        CSS: 0,
        SQL: 0
    };
    
    const codeLower = code.toLowerCase();
    
    // HTML checks
    if (/<!doctype html>/i.test(code)) scores.HTML += 100;
    if (/<html/i.test(code)) scores.HTML += 40;
    if (/<head/i.test(code)) scores.HTML += 30;
    if (/<body/i.test(code)) scores.HTML += 30;
    if (/<script/i.test(code)) scores.HTML += 20;
    if (/<div|<span|<p>|<\/a>|<\/div>/i.test(code)) scores.HTML += 30;
    
    // CSS checks
    if (/@media\s*\(/.test(code)) scores.CSS += 50;
    if (/body\s*\{|html\s*\{/.test(code)) scores.CSS += 30;
    if (/margin:|padding:|background-color:|font-family:|border-radius:/i.test(code)) scores.CSS += 20;
    if (/[a-zA-Z0-9_-]+\s*\{\s*[a-zA-Z-]+:/i.test(code)) scores.CSS += 40;
    
    // SQL checks
    if (/select\s+.*?\s+from/i.test(codeLower)) scores.SQL += 80;
    if (/insert\s+into/i.test(codeLower)) scores.SQL += 50;
    if (/create\s+table/i.test(codeLower)) scores.SQL += 50;
    if (/update\s+.*?\s+set/i.test(codeLower)) scores.SQL += 50;
    if (/delete\s+from/i.test(codeLower)) scores.SQL += 50;
    if (/where\s+.*?\s*=/i.test(codeLower)) scores.SQL += 20;
    if (/group\s+by|order\s+by/i.test(codeLower)) scores.SQL += 30;
    
    // Python checks
    if (/def\s+[a-zA-Z_][a-zA-Z0-9_]*\s*\(.*?\)\s*:/i.test(code)) scores.Python += 60;
    if (/import\s+[a-zA-Z_][a-zA-Z0-9_]*\s*$/m.test(code)) scores.Python += 30;
    if (/from\s+[a-zA-Z_][a-zA-Z0-9_]*\s+import/i.test(code)) scores.Python += 40;
    if (/elif\s+.*?:/i.test(code)) scores.Python += 50;
    if (/if\s+__name__\s*==\s*["']__main__["']:/i.test(code)) scores.Python += 80;
    if (/print\s*\(.*?\)/i.test(code) && !/system\.out/i.test(code) && !/printf/i.test(code) && !/console\.log/i.test(code)) scores.Python += 15;
    if (/^\s*#/m.test(code)) scores.Python += 20;
    
    // Java checks
    if (/public\s+class\s+[a-zA-Z_]/i.test(code)) scores.Java += 50;
    if (/public\s+static\s+void\s+main/i.test(code)) scores.Java += 100;
    if (/system\.out\.print/i.test(code)) scores.Java += 90;
    if (/import\s+java\./i.test(code)) scores.Java += 80;
    if (/@override/i.test(code)) scores.Java += 40;
    
    // C++ checks
    if (/#include\s*<iostream>/i.test(code)) scores["C++"] += 100;
    if (/#include\s*<vector>/i.test(code)) scores["C++"] += 50;
    if (/std::/i.test(code)) scores["C++"] += 60;
    if (/cout\s*<</i.test(code)) scores["C++"] += 80;
    if (/cin\s*>>/i.test(code)) scores["C++"] += 80;
    if (/using\s+namespace\s+std\s*;/i.test(code)) scores["C++"] += 95;
    
    // C checks
    if (/#include\s*<stdio\.h>/i.test(code)) scores.C += 100;
    if (/#include\s*<stdlib\.h>/i.test(code)) scores.C += 80;
    if (/printf\s*\(/i.test(code) && !/std::/i.test(code) && !/cout/i.test(code)) scores.C += 40;
    if (/scanf\s*\(/i.test(code)) scores.C += 50;
    if (/int\s+main\s*\(\s*(void)?\s*\)/i.test(code) && !/std::/i.test(code) && !/cout/i.test(code)) scores.C += 40;
    
    // JavaScript checks
    if (/const\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=/i.test(code)) scores.JavaScript += 15;
    if (/let\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=/i.test(code)) scores.JavaScript += 25;
    if (/var\s+[a-zA-Z_][a-zA-Z0-9_]*\s*=/i.test(code)) scores.JavaScript += 15;
    if (/function\s+[a-zA-Z_]/i.test(code) && !/public|private/i.test(code)) scores.JavaScript += 30;
    if (/console\.log\s*\(/i.test(code)) scores.JavaScript += 60;
    if (/\s*=>\s*/i.test(code)) scores.JavaScript += 20;
    if (/document\.getelementbyid/i.test(code)) scores.JavaScript += 50;
    if (/window\./i.test(code)) scores.JavaScript += 30;

    let bestLang = null;
    let maxScore = 0;
    for (const lang in scores) {
        if (scores[lang] > maxScore) {
            maxScore = scores[lang];
            bestLang = lang;
        }
    }
    
    if (maxScore < 10) {
        if (code.trim().startsWith("#include")) {
            return code.includes("std") || code.includes("cout") ? "C++" : "C";
        }
        if (code.includes("def ")) return "Python";
        if (code.includes("function")) return "JavaScript";
        if (code.toUpperCase().includes("SELECT ") && code.toUpperCase().includes("FROM ")) return "SQL";
        return null;
    }
    
    return bestLang;
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("user-name").textContent = currentUser.username;
    document.getElementById("user-email").textContent = currentUser.email;
    document.getElementById("user-avatar").textContent = currentUser.username.charAt(0).toUpperCase();

    // Initialize Monaco Editor with CORS CDN compatibility
    window.MonacoEnvironment = {
        getWorkerUrl: function (workerId, label) {
            const proxy = `
                self.MonacoEnvironment = {
                    baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/'
                };
                importScripts('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs/base/worker/workerMain.js');
            `;
            return URL.createObjectURL(new Blob([proxy], { type: 'text/javascript' }));
        }
    };
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
        editor = monaco.editor.create(document.getElementById('monaco-editor-container'), {
            value: '',
            language: 'javascript',
            theme: 'vs-dark',
            automaticLayout: true,
            fontSize: 14,
            fontFamily: "var(--font-code)",
            minimap: { enabled: false },
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: true, strings: true },
            wordBasedSuggestions: true,
            snippetSuggestions: "inline"
        });

        // Sync initial language dropdown selection if any
        const languageSelect = document.getElementById("language");
        if (languageSelect && languageSelect.value) {
            let lang = languageSelect.value.toLowerCase();
            if (lang === "c++") lang = "cpp";
            monaco.editor.setModelLanguage(editor.getModel(), lang);
            isManualLanguage = true;
        }

        // Change language when dropdown selection changes
        languageSelect.addEventListener("change", () => {
            if (languageSelect.value === "") {
                isManualLanguage = false;
            } else {
                isManualLanguage = true;
            }
            let lang = languageSelect.value.toLowerCase();
            if (lang === "c++") lang = "cpp";
            if (lang) {
                monaco.editor.setModelLanguage(editor.getModel(), lang);
            }
        });

        // Auto-detect language as the user types
        editor.onDidChangeModelContent(() => {
            if (!isManualLanguage) {
                const codeVal = editor.getValue();
                const detected = detectLanguage(codeVal);
                if (detected) {
                    languageSelect.value = detected;
                    let lang = detected.toLowerCase();
                    if (lang === "c++") lang = "cpp";
                    monaco.editor.setModelLanguage(editor.getModel(), lang);
                }
            }
        });

        loadWorkspaceOptions();
    });
});

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

// ==========================================
// WORKSPACE & COLLECTION OPTIONS POPULATION
// ==========================================

async function loadWorkspaceOptions() {
    try {
        const response = await fetch("/workspaces");
        if (!response.ok) throw new Error("Failed to fetch workspaces.");
        const workspaces = await response.json();

        const wsSelect = document.getElementById("workspace-select");
        wsSelect.innerHTML = "";
        
        let defaultWsId = localStorage.getItem("activeWorkspaceId") || "";

        workspaces.forEach(ws => {
            const opt = document.createElement("option");
            opt.value = ws.id;
            opt.textContent = ws.name;
            if (ws.id === defaultWsId) {
                opt.selected = true;
            }
            wsSelect.appendChild(opt);
        });

        if (!wsSelect.value && workspaces.length > 0) {
            wsSelect.value = workspaces[0].id;
        }

        // Fetch collections for default workspace
        await loadCollectionOptions(wsSelect.value);

        // Listen for changes
        wsSelect.addEventListener("change", (e) => {
            loadCollectionOptions(e.target.value);
        });

    } catch (err) {
        showToast(err.message, "error");
    }
}

async function loadCollectionOptions(workspaceId) {
    try {
        const response = await fetch(`/collections?workspace_id=${workspaceId}`);
        if (!response.ok) throw new Error("Failed to fetch collections.");
        const collections = await response.json();

        const collSelect = document.getElementById("collection-select");
        collSelect.innerHTML = '<option value="">None (Root)</option>';
        
        let defaultCollId = localStorage.getItem("activeCollectionId") || "";

        collections.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = c.name;
            if (c.id === defaultCollId) {
                opt.selected = true;
            }
            collSelect.appendChild(opt);
        });
    } catch (err) {
        showToast(err.message, "error");
    }
}

const form = document.getElementById("create-snippet-form");
if (form) {
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const title = document.getElementById("title").value.trim();
        const language = document.getElementById("language").value;
        const tagsInput = document.getElementById("tags").value.trim();
        const code = editor ? editor.getValue() : document.getElementById("code").value;
        const workspace_id = document.getElementById("workspace-select").value;
        const collection_id = document.getElementById("collection-select").value || null;
        
        const tags = tagsInput
            .split(",")
            .map(t => t.trim())
            .filter(t => t.length > 0);
            
        try {
            const response = await fetch("/snippets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, language, tags, code, workspace_id, collection_id })
            });
            
            if (response.status === 401) {
                localStorage.removeItem("user");
                window.location.href = "/login";
                return;
            }
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.detail || "Failed to create snippet.");
            }
            
            // Add activity log
            let notifications = JSON.parse(localStorage.getItem("notifications") || "[]");
            notifications.unshift({
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                message: `Created new snippet: ${title}`,
                type: "success",
                time: new Date().toISOString(),
                read: false
            });
            localStorage.setItem("notifications", JSON.stringify(notifications.slice(0, 15)));

            showToast("Snippet saved successfully!", "success");
            setTimeout(() => {
                window.location.href = "/dashboard";
            }, 1200);
            
        } catch (err) {
            showToast(err.message, "error");
        }
    });
}