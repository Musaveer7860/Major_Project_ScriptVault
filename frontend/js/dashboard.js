let currentLanguage = "";
let currentSearch = "";
let currentTag = "";
let currentFilterFavorites = false;
let showArchived = false;
let currentSort = "newest";
let searchDebounceTimer = null;

let activeWorkspaceId = localStorage.getItem("activeWorkspaceId") || "";
let activeCollectionId = localStorage.getItem("activeCollectionId") || "none";
let allSnippets = [];

let currentView = "snippets";
let allNotes = [];
let activeNoteId = null;
let noteSearchQuery = "";
let noteAutosaveTimer = null;
let playgroundEditor = null;
let activePlaygroundLang = "Python";

function switchView(viewName) {
    currentView = viewName;
    
    // Update sidebar navigation
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
    navItems.forEach(item => item.classList.remove("active"));
    
    const activeNav = document.getElementById(`nav-${viewName}`);
    if (activeNav) activeNav.classList.add("active");
    
    // Toggle view containers
    const viewSnippets = document.getElementById("snippets-view");
    const viewNotes = document.getElementById("notes-view");
    const viewPlayground = document.getElementById("playground-view");
    const viewSheets = document.getElementById("sheets-view");
    
    if (viewSnippets) viewSnippets.style.display = "none";
    if (viewNotes) viewNotes.style.display = "none";
    if (viewPlayground) viewPlayground.style.display = "none";
    if (viewSheets) viewSheets.style.display = "none";
    
    if (viewName === "snippets") {
        if (viewSnippets) viewSnippets.style.display = "block";
        fetchSnippets();
    } else if (viewName === "notes") {
        if (viewNotes) viewNotes.style.display = "block";
        fetchNotes();
        selectNote(null);
    } else if (viewName === "playground") {
        if (viewPlayground) viewPlayground.style.display = "block";
        initPlayground();
    } else if (viewName === "sheets") {
        if (viewSheets) viewSheets.style.display = "block";
        initExcelGrid();
    }
}

const userStr = localStorage.getItem("user");
if (!userStr) {
    window.location.href = "/login";
}
const currentUser = JSON.parse(userStr);

let runEditor = null;

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("user-name").textContent = currentUser.username;
    document.getElementById("user-email").textContent = currentUser.email;
    document.getElementById("user-avatar").textContent = currentUser.username.charAt(0).toUpperCase();

    // Load initial Workspace and Collection state
    loadWorkspaceData();
    updateNotificationsUI();

    // Initialize Monaco Editor for Run Modal with CORS CDN compatibility
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
        runEditor = monaco.editor.create(document.getElementById('run-monaco-container'), {
            value: '',
            language: 'javascript',
            theme: 'vs-dark',
            automaticLayout: true,
            fontSize: 12,
            fontFamily: "var(--font-code)",
            minimap: { enabled: false },
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: true, strings: true },
            wordBasedSuggestions: true,
            snippetSuggestions: "inline"
        });
    });

    // Workspace Create form submit
    const wsForm = document.getElementById("workspace-create-form");
    if (wsForm) {
        wsForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = document.getElementById("workspace-name").value.trim();
            if (!name) return;
            try {
                const response = await fetch("/workspaces", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name })
                });
                if (response.status === 401) {
                    handleLogout();
                    return;
                }
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.detail || "Failed to create workspace.");
                }
                showToast("Workspace created successfully!", "success");
                addNotification(`Created workspace: ${name}`, "success");
                document.getElementById("workspace-name").value = "";
                closeWorkspaceModal();

                activeWorkspaceId = data.id;
                localStorage.setItem("activeWorkspaceId", data.id);
                activeCollectionId = "none";
                localStorage.setItem("activeCollectionId", "none");

                await loadWorkspaceData();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // Collection Create form submit
    const collForm = document.getElementById("collection-create-form");
    if (collForm) {
        collForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = document.getElementById("collection-name").value.trim();
            if (!name) return;
            try {
                const response = await fetch("/collections", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name, workspace_id: activeWorkspaceId })
                });
                if (response.status === 401) {
                    handleLogout();
                    return;
                }
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.detail || "Failed to create collection.");
                }
                showToast("Folder collection created successfully!", "success");
                addNotification(`Created folder collection: ${name}`, "success");
                document.getElementById("collection-name").value = "";
                closeCollectionModal();

                await loadWorkspaceData();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // Workspace Rename form submit
    const wsRenameForm = document.getElementById("workspace-rename-form");
    if (wsRenameForm) {
        wsRenameForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = document.getElementById("workspace-rename-name").value.trim();
            if (!name || !activeWorkspaceId) return;
            try {
                const response = await fetch(`/workspace/${activeWorkspaceId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name })
                });
                if (response.status === 401) {
                    handleLogout();
                    return;
                }
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.detail || "Failed to rename workspace.");
                }
                showToast("Workspace renamed successfully!", "success");
                addNotification(`Renamed workspace to: ${name}`, "success");
                closeRenameWorkspaceModal();
                await loadWorkspaceData();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // Collection Rename form submit
    const collRenameForm = document.getElementById("collection-rename-form");
    if (collRenameForm) {
        collRenameForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const name = document.getElementById("collection-rename-name").value.trim();
            if (!name || !renameCollectionId) return;
            try {
                const response = await fetch(`/collection/${renameCollectionId}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ name })
                });
                if (response.status === 401) {
                    handleLogout();
                    return;
                }
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.detail || "Failed to rename collection.");
                }
                showToast("Folder collection renamed successfully!", "success");
                addNotification(`Renamed folder collection to: ${name}`, "success");
                closeRenameCollectionModal();
                await loadWorkspaceData();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    // Click outside notification dropdown handler
    const notifBtn = document.getElementById("notification-bell-btn");
    const notifMenu = document.getElementById("notification-dropdown");
    if (notifBtn && notifMenu) {
        const closeNotifs = (e) => {
            if (!notifBtn.contains(e.target) && !notifMenu.contains(e.target)) {
                notifMenu.style.display = "none";
                document.removeEventListener("click", closeNotifs);
            }
        };
        notifBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (notifMenu.style.display === "flex") {
                document.addEventListener("click", closeNotifs);
            }
        });
    }
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
// WORKSPACE & COLLECTIONS STATE MANAGERS
// ==========================================

async function loadWorkspaceData() {
    try {
        const wsResponse = await fetch("/workspaces");
        if (wsResponse.status === 401) {
            handleLogout();
            return;
        }
        if (!wsResponse.ok) throw new Error("Failed to load workspaces.");
        const workspaces = await wsResponse.json();

        const wsSelect = document.getElementById("workspace-select");
        if (wsSelect) {
            wsSelect.innerHTML = "";
            workspaces.forEach(ws => {
                const opt = document.createElement("option");
                opt.value = ws.id;
                opt.textContent = ws.name;
                if (ws.id === activeWorkspaceId) {
                    opt.selected = true;
                }
                wsSelect.appendChild(opt);
            });
        }

        if (!activeWorkspaceId || !workspaces.some(w => w.id === activeWorkspaceId)) {
            if (workspaces.length > 0) {
                activeWorkspaceId = workspaces[0].id;
                localStorage.setItem("activeWorkspaceId", activeWorkspaceId);
                if (wsSelect) wsSelect.value = activeWorkspaceId;
            }
        }

        await fetchCollections();
        await fetchSnippets();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function fetchCollections() {
    try {
        const response = await fetch(`/collections?workspace_id=${activeWorkspaceId}`);
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) throw new Error("Failed to fetch collections.");
        const collections = await response.json();
        renderCollections(collections);
    } catch (err) {
        console.error("Error fetching collections:", err);
    }
}

function renderCollections(collections) {
    const listDiv = document.getElementById("collections-list");
    if (!listDiv) return;

    listDiv.innerHTML = "";

    // Add Root button
    const rootBtn = document.createElement("button");
    rootBtn.className = `nav-item ${(!activeCollectionId || activeCollectionId === 'none') ? 'active' : ''}`;
    rootBtn.style.padding = "0.35rem 0.5rem";
    rootBtn.style.fontSize = "0.75rem";
    rootBtn.style.width = "100%";
    rootBtn.style.textAlign = "left";
    rootBtn.innerHTML = `<i class="fa-solid fa-folder-open"></i> All Folders (Root)`;
    rootBtn.onclick = () => filterCollection("none");
    listDiv.appendChild(rootBtn);

    collections.forEach(c => {
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.width = "100%";
        item.style.borderRadius = "4px";

        const btn = document.createElement("button");
        btn.className = `nav-item ${activeCollectionId === c.id ? 'active' : ''}`;
        btn.style.flex = "1";
        btn.style.padding = "0.35rem 0.5rem";
        btn.style.fontSize = "0.75rem";
        btn.style.textAlign = "left";
        btn.style.border = "none";
        btn.style.background = "none";
        btn.innerHTML = `<i class="fa-solid fa-folder"></i> ${escapeHtml(c.name)}`;
        btn.onclick = () => filterCollection(c.id);

        const editBtn = document.createElement("button");
        editBtn.style.background = "none";
        editBtn.style.border = "none";
        editBtn.style.cursor = "pointer";
        editBtn.style.color = "var(--text-muted)";
        editBtn.style.padding = "0.25rem";
        editBtn.style.fontSize = "0.75rem";
        editBtn.title = "Rename Folder Collection";
        editBtn.innerHTML = `<i class="fa-regular fa-pen-to-square"></i>`;
        editBtn.onclick = (e) => {
            e.stopPropagation();
            openRenameCollectionModal(c.id, c.name);
        };
        editBtn.onmouseenter = () => editBtn.style.color = "var(--text-primary)";
        editBtn.onmouseleave = () => editBtn.style.color = "var(--text-muted)";

        const delBtn = document.createElement("button");
        delBtn.style.background = "none";
        delBtn.style.border = "none";
        delBtn.style.cursor = "pointer";
        delBtn.style.color = "var(--text-muted)";
        delBtn.style.padding = "0.25rem";
        delBtn.style.fontSize = "0.75rem";
        delBtn.title = "Delete Folder Collection";
        delBtn.innerHTML = `<i class="fa-regular fa-trash-can"></i>`;
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteCollection(c.id);
        };
        delBtn.onmouseenter = () => delBtn.style.color = "var(--color-danger)";
        delBtn.onmouseleave = () => delBtn.style.color = "var(--text-muted)";

        item.appendChild(btn);
        item.appendChild(editBtn);
        item.appendChild(delBtn);
        listDiv.appendChild(item);
    });
}

function filterCollection(collId) {
    if (currentView !== "snippets") {
        currentView = "snippets";
        document.getElementById("snippets-view").style.display = "block";
        document.getElementById("notes-view").style.display = "none";
        document.getElementById("playground-view").style.display = "none";
    }
    
    // Reset active sidebar items
    const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
    navItems.forEach(item => item.classList.remove("active"));
    
    const activeNav = document.getElementById("nav-snippets");
    if (activeNav) activeNav.classList.add("active");

    activeCollectionId = collId;
    localStorage.setItem("activeCollectionId", collId);
    
    // Clear archived, tags, language and search filters
    showArchived = false;
    currentLanguage = "";
    currentTag = "";
    currentSearch = "";
    document.getElementById("search-bar").value = "";

    document.getElementById("dashboard-title").textContent = "All Snippets";

    fetchSnippets();
    fetchCollections();
}

async function switchWorkspace(wsId) {
    activeWorkspaceId = wsId;
    localStorage.setItem("activeWorkspaceId", wsId);
    activeCollectionId = "none";
    localStorage.setItem("activeCollectionId", "none");

    currentLanguage = "";
    currentSearch = "";
    currentTag = "";
    showArchived = false;
    currentFilterFavorites = false;

    const sidebar = document.querySelector(".sidebar-nav");
    if (sidebar) {
        const buttons = sidebar.querySelectorAll(".nav-item");
        buttons.forEach(btn => btn.classList.remove("active"));
        
        const viewBtn = document.getElementById(`nav-${currentView}`);
        if (viewBtn) viewBtn.classList.add("active");
        
        if (currentView === "snippets") {
            const allBtn = document.getElementById("filter-all");
            if (allBtn) allBtn.classList.add("active");
        }
    }
    document.getElementById("search-bar").value = "";
    document.getElementById("dashboard-title").textContent = "All Snippets";

    await loadWorkspaceData();
    
    if (currentView === "notes") {
        await fetchNotes();
        selectNote(null);
    }
}

function openNewWorkspaceModal() {
    document.getElementById("workspace-name").value = "";
    document.getElementById("workspace-modal").style.display = "flex";
}

function closeWorkspaceModal() {
    document.getElementById("workspace-modal").style.display = "none";
}

let renameCollectionId = "";

function openRenameWorkspaceModal() {
    const wsSelect = document.getElementById("workspace-select");
    if (!wsSelect || !activeWorkspaceId) return;
    const selectedText = wsSelect.options[wsSelect.selectedIndex].text;
    document.getElementById("workspace-rename-name").value = selectedText;
    document.getElementById("workspace-rename-modal").style.display = "flex";
}

function closeRenameWorkspaceModal() {
    document.getElementById("workspace-rename-modal").style.display = "none";
}

function openRenameCollectionModal(id, name) {
    renameCollectionId = id;
    document.getElementById("collection-rename-name").value = name;
    document.getElementById("collection-rename-modal").style.display = "flex";
}

function closeRenameCollectionModal() {
    document.getElementById("collection-rename-modal").style.display = "none";
}

async function deleteActiveWorkspace() {
    const wsSelect = document.getElementById("workspace-select");
    const count = wsSelect ? wsSelect.options.length : 1;
    if (count <= 1) {
        showToast("Cannot delete your only workspace.", "error");
        return;
    }

    if (!confirm("Are you sure you want to permanently delete the active workspace? This will delete all folder collections and code snippets stored inside it!")) {
        return;
    }

    try {
        const response = await fetch(`/workspace/${activeWorkspaceId}`, {
            method: "DELETE"
        });
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Failed to delete workspace.");
        }
        showToast("Workspace deleted successfully.", "success");
        addNotification("Deleted active workspace", "warning");

        activeWorkspaceId = "";
        localStorage.setItem("activeWorkspaceId", "");
        activeCollectionId = "none";
        localStorage.setItem("activeCollectionId", "none");

        await loadWorkspaceData();
    } catch (err) {
        showToast(err.message, "error");
    }
}

function openNewCollectionModal() {
    document.getElementById("collection-name").value = "";
    document.getElementById("collection-modal").style.display = "flex";
}

function closeCollectionModal() {
    document.getElementById("collection-modal").style.display = "none";
}

async function deleteCollection(collId) {
    if (!confirm("Are you sure you want to delete this folder? Snippets inside it will be moved to the root folder of the workspace.")) {
        return;
    }

    try {
        const response = await fetch(`/collection/${collId}`, {
            method: "DELETE"
        });
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Failed to delete collection.");
        }
        showToast("Folder deleted successfully.", "success");
        addNotification("Deleted folder collection", "info");

        if (activeCollectionId === collId) {
            activeCollectionId = "none";
            localStorage.setItem("activeCollectionId", "none");
        }

        await loadWorkspaceData();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================
// SNIPPETS CRUD & FILTERS
// ==========================================

async function fetchSnippets() {
    let url = `/snippets?workspace_id=${activeWorkspaceId}`;
    if (activeCollectionId && activeCollectionId !== "none" && activeCollectionId !== "null") {
        url += `&collection_id=${activeCollectionId}`;
    }
    
    if (currentSearch || currentLanguage || currentTag) {
        const params = new URLSearchParams();
        if (currentSearch) params.append("q", currentSearch);
        if (currentLanguage) params.append("language", currentLanguage);
        if (currentTag) params.append("tag", currentTag);
        params.append("workspace_id", activeWorkspaceId);
        if (activeCollectionId && activeCollectionId !== "none" && activeCollectionId !== "null") {
            params.append("collection_id", activeCollectionId);
        }
        url = `/search?${params.toString()}`;
    }
    
    try {
        const response = await fetch(url);
        
        if (response.status === 401) {
            handleLogout();
            return;
        }
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Failed to fetch snippets.");
        }
        
        const snippets = await response.json();
        allSnippets = snippets;
        
        // Sync stats cards
        syncStatsCards(snippets);
        
        let filtered = snippets;
        if (currentFilterFavorites) {
            filtered = filtered.filter(s => s.favorite);
        }

        // Apply Archived Filter
        if (showArchived) {
            filtered = filtered.filter(s => s.archived);
        } else {
            filtered = filtered.filter(s => !s.archived);
        }

        // Apply Sorting
        if (currentSort === "newest") {
            filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } else if (currentSort === "oldest") {
            filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        } else if (currentSort === "title-asc") {
            filtered.sort((a, b) => a.title.localeCompare(b.title));
        } else if (currentSort === "title-desc") {
            filtered.sort((a, b) => b.title.localeCompare(a.title));
        }
        
        renderSnippets(filtered);
        renderRecentSnippets(snippets);
        fetchSnippetStats();
    } catch (err) {
        showToast(err.message, "error");
    }
}

function syncStatsCards(snippets) {
    const totalCount = snippets.length;
    const favoriteCount = snippets.filter(s => s.favorite).length;
    const pinnedCount = snippets.filter(s => s.pinned).length;
    const archivedCount = snippets.filter(s => s.archived).length;

    const t = document.getElementById("card-stat-total");
    const f = document.getElementById("card-stat-favorites");
    const p = document.getElementById("card-stat-pinned");
    const a = document.getElementById("card-stat-archived");

    if (t) t.textContent = totalCount;
    if (f) f.textContent = favoriteCount;
    if (p) p.textContent = pinnedCount;
    if (a) a.textContent = archivedCount;
}

function renderSnippets(snippets) {
    const container = document.getElementById("snippets-container");
    const countLabel = document.getElementById("snippet-count");
    const pinnedContainer = document.getElementById("pinned-snippets-container");
    const pinnedSection = document.getElementById("pinned-snippets-section");
    
    container.innerHTML = "";
    if (pinnedContainer) pinnedContainer.innerHTML = "";
    
    countLabel.textContent = `${snippets.length} snippet${snippets.length === 1 ? '' : 's'} found`;
    
    // Separate pinned and non-pinned
    const pinned = snippets.filter(s => s.pinned && !s.archived);
    const others = snippets.filter(s => !s.pinned || s.archived);

    if (pinned.length > 0 && pinnedSection && pinnedContainer && !showArchived) {
        pinnedSection.style.display = "block";
        pinned.forEach(snippet => {
            const card = createSnippetCard(snippet);
            pinnedContainer.appendChild(card);
            Prism.highlightElement(card.querySelector("code"));
        });
    } else if (pinnedSection) {
        pinnedSection.style.display = "none";
    }

    const displaySnippets = (pinned.length > 0 && !showArchived) ? others : snippets;

    if (displaySnippets.length === 0 && pinned.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-code empty-state-icon"></i>
                <h3>No snippets found</h3>
                <p>Start by creating a new code snippet or adjusting your filters.</p>
                <a href="/create" class="btn btn-primary">
                    <i class="fa-solid fa-plus"></i> Add First Snippet
                </a>
            </div>
        `;
        return;
    }
    
    displaySnippets.forEach(snippet => {
        const card = createSnippetCard(snippet);
        container.appendChild(card);
        Prism.highlightElement(card.querySelector("code"));
    });
}

function createSnippetCard(snippet) {
    const card = document.createElement("div");
    card.className = "snippet-card";
    
    const date = new Date(snippet.created_at);
    const formattedDate = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    
    const langClass = `lang-${snippet.language.toLowerCase()}`;
    const PRISM_LANG_MAP = {
        "Python": "python",
        "JavaScript": "javascript",
        "Java": "java",
        "C": "c",
        "C++": "cpp",
        "HTML": "html",
        "CSS": "css",
        "SQL": "sql"
    };
    const prismClass = `language-${PRISM_LANG_MAP[snippet.language] || 'clike'}`;
    
    const heartClass = snippet.favorite ? "fa-solid fa-heart fav-active" : "fa-regular fa-heart";
    const pinClass = snippet.pinned ? "fa-solid fa-thumbtack" : "fa-regular fa-thumbtack";
    const pinColor = snippet.pinned ? "#d97706" : "var(--text-secondary)";
    const pinStyle = snippet.pinned ? "transform: rotate(45deg);" : "";
    
    card.innerHTML = `
        <div class="card-header">
            <div style="display: flex; align-items: center; gap: 0.35rem; flex: 1; min-width: 0;">
                <button class="btn-fav" title="Toggle Favorite" onclick="toggleFavorite('${snippet.id}', this)" style="background: none; border: none; cursor: pointer; color: ${snippet.favorite ? 'var(--color-danger)' : 'var(--text-secondary)'}; padding: 0.25rem; font-size: 1.1rem; display: flex; align-items: center;">
                    <i class="${heartClass}"></i>
                </button>
                <button class="btn-fav" title="Toggle Pin" onclick="togglePin('${snippet.id}', this)" style="background: none; border: none; cursor: pointer; color: ${pinColor}; padding: 0.25rem; font-size: 1rem; display: flex; align-items: center;">
                    <i class="${pinClass}" style="${pinStyle}"></i>
                </button>
                <h3 class="snippet-title" title="${escapeHtml(snippet.title)}" style="margin: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(snippet.title)}</h3>
            </div>
            <span class="lang-badge ${langClass}">${snippet.language}</span>
        </div>
        
        <div class="card-meta" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <span><i class="fa-regular fa-calendar"></i> Created ${formattedDate}</span>
            ${snippet.description ? `<span style="color: var(--text-secondary); font-size: 0.75rem;"><i class="fa-regular fa-message"></i> ${escapeHtml(snippet.description)}</span>` : ""}
        </div>
        
        <div class="tag-list">
            ${snippet.tags.map(tag => `<span class="tag-pill" style="cursor:pointer;" onclick="filterTag('${escapeHtml(tag)}')">#${escapeHtml(tag)}</span>`).join("")}
        </div>
        
        <div class="code-container">
            <pre class="${prismClass}"><code class="${prismClass}"></code></pre>
            <div class="code-actions-overlay">
                <button class="btn-icon" title="Copy to Clipboard" onclick="copySnippetCode(this, ${JSON.stringify(snippet.code).replace(/"/g, '&quot;')})">
                    <i class="fa-regular fa-copy"></i>
                </button>
            </div>
        </div>
        
        <div class="card-footer" style="display: flex; flex-direction: column; gap: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 0.5rem;">
                <div class="card-actions-left" style="gap: 0.35rem; display: flex; align-items: center;">
                    <button class="btn btn-secondary btn-icon" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;" title="Clone snippet" onclick="cloneSnippet('${snippet.id}')">
                        <i class="fa-solid fa-clone"></i> Clone
                    </button>
                    <button class="btn btn-primary btn-icon" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;" title="Run / Test code" onclick="openRunModal('${escapeHtml(snippet.title)}', ${JSON.stringify(snippet.code).replace(/"/g, '&quot;')}, '${snippet.language}')">
                        <i class="fa-solid fa-play"></i> Run
                    </button>
                    <div style="position: relative; display: inline-block;">
                        <button class="btn btn-secondary btn-icon" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;" title="Export Snippet" onclick="toggleExportDropdown(this)">
                            <i class="fa-solid fa-download"></i> Export
                        </button>
                        <div class="export-dropdown-menu" style="display: none; position: absolute; bottom: 100%; left: 0; background: #ffffff; border: 1px solid var(--border-color); border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); z-index: 100; min-width: 100px; flex-direction: column;">
                            <button onclick="exportSnippetJSON('${snippet.id}')" style="background: none; border: none; padding: 0.5rem 0.75rem; text-align: left; font-size: 0.75rem; cursor: pointer; width: 100%; color: #09090b; font-family: var(--font-ui);">JSON</button>
                            <button onclick="exportSnippetPDF('${snippet.id}')" style="background: none; border: none; padding: 0.5rem 0.75rem; text-align: left; font-size: 0.75rem; cursor: pointer; width: 100%; color: #09090b; font-family: var(--font-ui); border-top: 1px solid var(--border-color);">PDF</button>
                        </div>
                    </div>
                </div>
                <div class="card-actions-right" style="gap: 0.35rem; display: flex; align-items: center;">
                    <button class="btn btn-secondary btn-icon" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;" title="View Version History" onclick="openVersionsModal('${snippet.id}')">
                        <i class="fa-solid fa-history"></i> History
                    </button>
                    <button class="btn btn-secondary btn-icon" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;" title="${snippet.archived ? 'Restore from Archive' : 'Archive snippet'}" onclick="toggleArchive('${snippet.id}', this)">
                        <i class="${snippet.archived ? 'fa-solid fa-box-open' : 'fa-solid fa-box-archive'}"></i> ${snippet.archived ? 'Restore' : 'Archive'}
                    </button>
                    <a href="/edit?id=${snippet.id}" class="btn btn-secondary btn-icon" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;" title="Edit snippet">
                        <i class="fa-regular fa-pen-to-square"></i> Edit
                    </a>
                    <button class="btn btn-danger btn-icon" style="padding: 0.35rem 0.6rem; font-size: 0.75rem;" title="Delete snippet" onclick="deleteSnippet('${snippet.id}')">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
            </div>
            <div style="width: 100%; display: flex; justify-content: flex-end;">
                <button class="btn btn-secondary btn-icon" style="padding: 0.35rem 0.6rem; font-size: 0.75rem; background: #faf5ff; border-color: #e9d5ff; color: #6b21a8; width: 100%; justify-content: center; font-weight: 600;" title="Run AI Analysis Assistant" onclick="openAiModal('${snippet.id}', ${JSON.stringify(snippet.code).replace(/"/g, '&quot;')}, '${snippet.language}')">
                    <i class="fa-solid fa-brain" style="color: #8b5cf6;"></i> AI Code Assistant
                </button>
            </div>
        </div>
    `;
    
    card.querySelector("code").textContent = snippet.code;
    return card;
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function copySnippetCode(btn, codeText) {
    try {
        await navigator.clipboard.writeText(codeText);
        
        const icon = btn.querySelector("i");
        icon.className = "fa-solid fa-check";
        btn.style.color = "var(--color-success)";
        btn.style.borderColor = "var(--color-success)";
        
        showToast("Code copied to clipboard!", "success");
        addNotification("Copied code snippet to clipboard", "info");
        
        setTimeout(() => {
            icon.className = "fa-regular fa-copy";
            btn.style.color = "";
            btn.style.borderColor = "";
        }, 2000);
    } catch (err) {
        showToast("Failed to copy code: " + err.message, "error");
    }
}

async function cloneSnippet(snippetId) {
    try {
        const response = await fetch(`/snippet/${snippetId}/clone`, {
            method: "POST"
        });
        
        if (response.status === 401) {
            handleLogout();
            return;
        }
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Failed to clone snippet.");
        }
        
        showToast("Snippet cloned successfully!", "success");
        addNotification("Cloned a code snippet", "success");
        fetchSnippets();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function deleteSnippet(snippetId) {
    if (!confirm("Are you sure you want to permanently delete this snippet?")) {
        return;
    }
    
    try {
        const response = await fetch(`/snippet/${snippetId}`, {
            method: "DELETE"
        });
        
        if (response.status === 401) {
            handleLogout();
            return;
        }
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Failed to delete snippet.");
        }
        
        showToast("Snippet deleted successfully.", "success");
        addNotification("Deleted a code snippet", "warning");
        fetchSnippets();
    } catch (err) {
        showToast(err.message, "error");
    }
}

function handleSearchInput(val) {
    currentSearch = val.trim();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        fetchSnippets();
        updateSearchSuggestions();
    }, 300);
}

function updateSearchSuggestions() {
    const suggestionsDiv = document.getElementById("search-suggestions");
    if (!suggestionsDiv) return;
    
    if (!currentSearch) {
        suggestionsDiv.style.display = "none";
        return;
    }
    
    const matches = allSnippets.filter(s => 
        s.title.toLowerCase().includes(currentSearch.toLowerCase()) ||
        s.tags.some(t => t.toLowerCase().includes(currentSearch.toLowerCase()))
    ).slice(0, 5);
    
    suggestionsDiv.innerHTML = "";
    if (matches.length === 0) {
        suggestionsDiv.innerHTML = `<div style="padding: 0.5rem 0.75rem; color: var(--text-muted); font-size: 0.8rem;">No suggestions.</div>`;
        suggestionsDiv.style.display = "flex";
        return;
    }
    
    matches.forEach(m => {
        const item = document.createElement("button");
        item.style.background = "none";
        item.style.border = "none";
        item.style.padding = "0.5rem 0.75rem";
        item.style.textAlign = "left";
        item.style.cursor = "pointer";
        item.style.fontSize = "0.8rem";
        item.style.color = "#09090b";
        item.style.width = "100%";
        item.style.fontFamily = "var(--font-ui)";
        item.innerHTML = `<i class="fa-solid fa-magnifying-glass" style="color: var(--text-muted); margin-right: 0.5rem;"></i> ${escapeHtml(m.title)}`;
        
        item.onmousedown = () => {
            document.getElementById("search-bar").value = m.title;
            currentSearch = m.title;
            fetchSnippets();
            suggestionsDiv.style.display = "none";
        };
        suggestionsDiv.appendChild(item);
    });
    suggestionsDiv.style.display = "flex";
}

function showSearchSuggestions() {
    updateSearchSuggestions();
}

function hideSearchSuggestions() {
    setTimeout(() => {
        const suggestionsDiv = document.getElementById("search-suggestions");
        if (suggestionsDiv) suggestionsDiv.style.display = "none";
    }, 200);
}

function handleSortChange(val) {
    currentSort = val;
    fetchSnippets();
}

function filterLanguage(lang) {
    if (currentView !== "snippets") {
        currentView = "snippets";
        document.getElementById("snippets-view").style.display = "block";
        document.getElementById("notes-view").style.display = "none";
        document.getElementById("playground-view").style.display = "none";
    }

    currentLanguage = lang;
    currentTag = "";
    showArchived = false;
    
    document.getElementById("search-bar").value = "";
    currentSearch = "";
    
    const sidebar = document.querySelector(".sidebar-nav");
    const buttons = sidebar.querySelectorAll(".nav-item");
    buttons.forEach(btn => btn.classList.remove("active"));
    
    const activeNav = document.getElementById("nav-snippets");
    if (activeNav) activeNav.classList.add("active");
    
    const activeId = lang ? `filter-${lang.toLowerCase().replace('+', 'p')}` : 'filter-all';
    const activeBtn = document.getElementById(activeId);
    if (activeBtn) activeBtn.classList.add("active");
    
    const titleLabel = document.getElementById("dashboard-title");
    titleLabel.textContent = lang ? `${lang} Snippets` : "All Snippets";
    
    fetchSnippets();
}

function filterTag(tagName) {
    if (currentView !== "snippets") {
        currentView = "snippets";
        document.getElementById("snippets-view").style.display = "block";
        document.getElementById("notes-view").style.display = "none";
        document.getElementById("playground-view").style.display = "none";
    }

    currentTag = tagName;
    showArchived = false;
    
    const titleLabel = document.getElementById("dashboard-title");
    titleLabel.textContent = `Snippets with #${tagName}`;
    
    const sidebar = document.querySelector(".sidebar-nav");
    const buttons = sidebar.querySelectorAll(".nav-item");
    buttons.forEach(btn => btn.classList.remove("active"));
    
    const activeNav = document.getElementById("nav-snippets");
    if (activeNav) activeNav.classList.add("active");
    
    fetchSnippets();
}

function handleLogout() {
    localStorage.removeItem("user");
    window.location.href = "/login";
}

// ==========================================
// MONACO EDITOR & RUN MODAL ACTIONS
// ==========================================

let runModalLang = "";

function openRunModal(title, code, language) {
    runModalLang = language;
    document.getElementById("run-modal-title").textContent = `Run Snippet - ${title} (${language})`;
    document.getElementById("run-modal-code").value = code;
    
    if (runEditor) {
        runEditor.setValue(code);
        let lang = language.toLowerCase();
        if (lang === "c++") lang = "cpp";
        monaco.editor.setModelLanguage(runEditor.getModel(), lang);
    }
    
    document.getElementById("run-modal-input").value = "";
    document.getElementById("run-modal-output").textContent = "Console output will appear here...";
    
    const inputGroup = document.getElementById("run-input-group");
    const previewGroup = document.getElementById("run-preview-group");
    const iframe = document.getElementById("run-modal-iframe");
    
    iframe.srcdoc = "";
    previewGroup.style.display = "none";
    
    const langLower = language.toLowerCase();
    if (langLower === "html" || langLower === "css" || langLower === "javascript") {
        inputGroup.style.display = "none";
        if (langLower === "html" || langLower === "css") {
            previewGroup.style.display = "block";
        }
    } else {
        inputGroup.style.display = "block";
    }
    
    document.getElementById("run-modal").style.display = "flex";
}

function closeRunModal() {
    document.getElementById("run-modal").style.display = "none";
}

async function executeSnippetCode() {
    const code = runEditor ? runEditor.getValue() : document.getElementById("run-modal-code").value;
    const input = document.getElementById("run-modal-input").value;
    const outputDiv = document.getElementById("run-modal-output");
    const iframe = document.getElementById("run-modal-iframe");
    const langLower = runModalLang.toLowerCase();
    
    outputDiv.textContent = "Executing...";
    addNotification(`Executed code snippet (${runModalLang})`, "info");
    
    if (langLower === "javascript") {
        try {
            let logs = [];
            const customConsole = {
                log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')),
                error: (...args) => logs.push("[ERROR] " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')),
                warn: (...args) => logs.push("[WARN] " + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '))
            };
            
            const runFn = new Function('console', code);
            runFn(customConsole);
            
            outputDiv.textContent = logs.length > 0 ? logs.join("\n") : "Script ran successfully.";
        } catch (err) {
            outputDiv.textContent = `Runtime Error: ${err.message}`;
        }
    } else if (langLower === "html" || langLower === "css") {
        try {
            let srcdoc = "";
            if (langLower === "html") {
                srcdoc = code;
            } else {
                srcdoc = `<html><head><style>${code}</style></head><body><h1>CSS Preview</h1><p>This is a style preview box.</p></body></html>`;
            }
            iframe.srcdoc = srcdoc;
            outputDiv.textContent = "Rendered preview successfully.";
        } catch (err) {
            outputDiv.textContent = `Render Error: ${err.message}`;
        }
    } else {
        try {
            const response = await fetch("/snippets/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, language: runModalLang, input })
            });
            
            if (response.status === 401) {
                handleLogout();
                return;
            }
            
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.detail || "Failed to execute snippet.");
            }
            
            let outText = "";
            if (data.stdout) {
                outText += data.stdout;
            }
            if (data.stderr) {
                if (outText) outText += "\n";
                outText += data.stderr;
            }
            if (!outText) {
                outText = "Code executed with no output.";
            }
            
            outputDiv.textContent = outText + `\n\n[Process exited with code ${data.exit_code}]`;
        } catch (err) {
            outputDiv.textContent = `Execution failed: ${err.message}`;
        }
    }
}

// ==========================================
// FAVORITES & STATS
// ==========================================

function toggleFavoritesFilter() {
    if (currentView !== "snippets") {
        currentView = "snippets";
        document.getElementById("snippets-view").style.display = "block";
        document.getElementById("notes-view").style.display = "none";
        document.getElementById("playground-view").style.display = "none";
    }

    currentFilterFavorites = !currentFilterFavorites;
    
    const btn = document.getElementById("filter-favorites");
    const titleLabel = document.getElementById("dashboard-title");
    
    currentLanguage = "";
    currentTag = "";
    document.getElementById("search-bar").value = "";
    currentSearch = "";
    showArchived = false;
    
    const sidebar = document.querySelector(".sidebar-nav");
    const buttons = sidebar.querySelectorAll(".nav-item");
    buttons.forEach(b => b.classList.remove("active"));
    
    const activeNav = document.getElementById("nav-snippets");
    if (activeNav) activeNav.classList.add("active");
    
    if (currentFilterFavorites) {
        btn.classList.add("active");
        titleLabel.textContent = "Favorite Snippets";
    } else {
        document.getElementById("filter-all").classList.add("active");
        titleLabel.textContent = "All Snippets";
    }
    
    fetchSnippets();
}

async function toggleFavorite(snippetId, btn) {
    try {
        const response = await fetch(`/snippet/${snippetId}/favorite`, {
            method: "POST"
        });
        if (response.status === 401) {
            handleLogout();
            return;
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || "Failed to toggle favorite.");
        }
        
        const icon = btn.querySelector("i");
        if (data.favorite) {
            icon.className = "fa-solid fa-heart fav-active";
            btn.style.color = "var(--color-danger)";
            showToast("Added to favorites!", "success");
            addNotification("Added snippet to favorites", "success");
        } else {
            icon.className = "fa-regular fa-heart";
            btn.style.color = "var(--text-secondary)";
            showToast("Removed from favorites.", "info");
            addNotification("Removed snippet from favorites", "info");
        }
        
        fetchSnippetStats();
        fetchSnippets();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function fetchSnippetStats() {
    try {
        const response = await fetch("/snippets/stats");
        if (response.status === 401) return;
        if (!response.ok) return;
        
        const data = await response.json();
        const tCount = document.getElementById("stats-total-count");
        const fCount = document.getElementById("stats-fav-count");
        
        if (tCount) tCount.textContent = data.total;
        if (fCount) fCount.textContent = data.favorites;
        
        const listDiv = document.getElementById("stats-languages-list");
        if (!listDiv) return;
        listDiv.innerHTML = "";
        
        const languages = data.languages;
        const total = data.total;
        
        if (total === 0) {
            listDiv.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem;">No snippets recorded yet.</div>`;
            return;
        }
        
        const sortedLangs = Object.entries(languages).sort((a, b) => b[1] - a[1]);
        
        const LANG_COLOR_MAP = {
            "Python": "#3572A5",
            "JavaScript": "#f1e05a",
            "Java": "#b07219",
            "C": "#555555",
            "C++": "#f34b7d",
            "HTML": "#e34c26",
            "CSS": "#563d7c",
            "SQL": "#e38c00"
        };
        
        sortedLangs.forEach(([lang, count]) => {
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const color = LANG_COLOR_MAP[lang] || "#71717a";
            
            const barRow = document.createElement("div");
            barRow.style.display = "flex";
            barRow.style.flexDirection = "column";
            barRow.style.gap = "0.25rem";
            barRow.innerHTML = `
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; font-weight: 500;">
                    <span style="color: #09090b;">${lang}</span>
                    <span style="color: var(--text-secondary);">${count} (${pct}%)</span>
                </div>
                <div style="background: #e4e4e7; height: 8px; border-radius: 4px; overflow: hidden; width: 100%;">
                    <div style="background: ${color}; width: ${pct}%; height: 100%; border-radius: 4px; transition: width 0.3s ease;"></div>
                </div>
            `;
            listDiv.appendChild(barRow);
        });
    } catch (err) {
        console.error("Error fetching stats:", err);
    }
}

function openStatsModal() {
    fetchSnippetStats();
    document.getElementById("stats-modal").style.display = "flex";
}

function closeStatsModal() {
    document.getElementById("stats-modal").style.display = "none";
}

function renderRecentSnippets(snippets) {
    const recentListDiv = document.getElementById("recent-snippets-list");
    if (!recentListDiv) return;
    
    recentListDiv.innerHTML = "";
    
    const sorted = [...snippets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    
    if (sorted.length === 0) {
        recentListDiv.innerHTML = `<div style="font-size: 0.75rem; color: var(--text-muted); padding: 0.25rem 0;">No snippets.</div>`;
        return;
    }
    
    sorted.forEach(s => {
        const langClass = `lang-${s.language.toLowerCase()}`;
        const item = document.createElement("div");
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "space-between";
        item.style.padding = "0.35rem 0.5rem";
        item.style.borderRadius = "4px";
        item.style.border = "1px solid var(--border-color)";
        item.style.background = "#ffffff";
        item.style.cursor = "pointer";
        item.style.transition = "all 0.15s ease";
        item.title = `Click to view: ${s.title}`;
        
        item.innerHTML = `
            <span style="font-size: 0.75rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; color: #09090b; text-align: left;">${escapeHtml(s.title)}</span>
            <span class="lang-badge ${langClass}" style="font-size: 0.6rem; padding: 0.1rem 0.3rem; margin-left: 0.5rem; flex-shrink: 0;">${s.language}</span>
        `;
        
        item.addEventListener("mouseenter", () => {
            item.style.borderColor = "var(--border-focus)";
            item.style.background = "#f4f4f5";
        });
        item.addEventListener("mouseleave", () => {
            item.style.borderColor = "var(--border-color)";
            item.style.background = "#ffffff";
        });
        
        item.addEventListener("click", () => {
            const cards = document.querySelectorAll(".snippet-card");
            let found = false;
            cards.forEach(card => {
                const cardTitle = card.querySelector(".snippet-title");
                if (cardTitle && cardTitle.textContent === s.title) {
                    card.scrollIntoView({ behavior: "smooth", block: "center" });
                    card.style.borderColor = "var(--color-success)";
                    setTimeout(() => {
                        card.style.borderColor = "";
                    }, 1500);
                    found = true;
                }
            });
            if (!found) {
                filterLanguage("");
                setTimeout(() => {
                    const recheckCards = document.querySelectorAll(".snippet-card");
                    recheckCards.forEach(card => {
                        const cardTitle = card.querySelector(".snippet-title");
                        if (cardTitle && cardTitle.textContent === s.title) {
                            card.scrollIntoView({ behavior: "smooth", block: "center" });
                            card.style.borderColor = "var(--color-success)";
                            setTimeout(() => {
                                card.style.borderColor = "";
                            }, 1500);
                        }
                    });
                }, 300);
            }
        });
        
        recentListDiv.appendChild(item);
    });
}

function toggleExportDropdown(btn) {
    const menu = btn.nextElementSibling;
    if (!menu) return;
    
    document.querySelectorAll(".export-dropdown-menu").forEach(m => {
        if (m !== menu) m.style.display = "none";
    });
    
    if (menu.style.display === "none" || menu.style.display === "") {
        menu.style.display = "flex";
    } else {
        menu.style.display = "none";
    }
    
    const closeDropdown = (e) => {
        if (!btn.contains(e.target) && !menu.contains(e.target)) {
            menu.style.display = "none";
            document.removeEventListener("click", closeDropdown);
        }
    };
    document.addEventListener("click", closeDropdown);
}

async function exportSnippetJSON(snippetId) {
    try {
        const response = await fetch(`/snippet/${snippetId}`);
        if (!response.ok) throw new Error("Failed to fetch snippet details.");
        
        const snippet = await response.json();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(snippet, null, 2));
        
        const downloadAnchor = document.createElement("a");
        downloadAnchor.setAttribute("href", dataStr);
        downloadAnchor.setAttribute("download", `${snippet.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        
        showToast("JSON downloaded successfully!", "success");
        addNotification(`Exported snippet JSON: ${snippet.title}`, "success");
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function exportSnippetPDF(snippetId) {
    try {
        const response = await fetch(`/snippet/${snippetId}`);
        if (!response.ok) throw new Error("Failed to fetch snippet details.");
        
        const snippet = await response.json();
        
        let jsPDFClass;
        if (window.jspdf && window.jspdf.jsPDF) {
            jsPDFClass = window.jspdf.jsPDF;
        } else if (window.jsPDF) {
            jsPDFClass = window.jsPDF;
        } else {
            throw new Error("jsPDF library is not fully loaded. Please check your connection and refresh.");
        }
        const doc = new jsPDFClass();

        // Helper to sanitize non-Latin1 / emoji characters to prevent PDF corruption symbols
        const sanitizeForPDF = (str) => {
            if (!str) return "";
            return str.replace(/[^\x00-\xFF]/g, "");
        };
        
        // Title as the main header (removed brand 'Code Export' line)
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(9, 9, 11);
        doc.text(sanitizeForPDF(snippet.title), 15, 20);
        
        doc.setDrawColor(228, 228, 231);
        doc.setLineWidth(0.5);
        doc.line(15, 24, 195, 24);
        
        // Metadata
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(113, 113, 122);
        doc.text(`Language: ${sanitizeForPDF(snippet.language)}`, 15, 32);
        doc.text(`Tags: ${snippet.tags.map(t => sanitizeForPDF(t)).join(", ") || 'none'}`, 15, 37);
        doc.text(`Exported On: ${new Date().toLocaleDateString()}`, 15, 42);
        
        doc.line(15, 46, 195, 46);
        
        // Code Content
        doc.setFont("courier", "normal");
        doc.setFontSize(9);
        doc.setTextColor(9, 9, 11);
        
        const codeLines = doc.splitTextToSize(sanitizeForPDF(snippet.code), 180);
        let y = 54;
        const pageHeight = doc.internal.pageSize.height;
        
        codeLines.forEach((line) => {
            if (y > pageHeight - 15) {
                doc.addPage();
                y = 20;
            }
            doc.text(line, 15, y);
            y += 5;
        });
        
        doc.save(`${snippet.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`);
        showToast("PDF downloaded successfully!", "success");
        addNotification(`Exported snippet PDF: ${snippet.title}`, "success");
    } catch (err) {
        showToast(err.message, "error");
    }
}

function openProfileModal() {
    document.getElementById("profile-username").value = currentUser.username;
    document.getElementById("profile-email").value = currentUser.email;
    document.getElementById("profile-password").value = "";
    document.getElementById("profile-modal").style.display = "flex";
}

function closeProfileModal() {
    document.getElementById("profile-modal").style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
    const profileForm = document.getElementById("profile-update-form");
    if (profileForm) {
        profileForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = document.getElementById("profile-email").value.trim();
            const password = document.getElementById("profile-password").value;
            
            const payload = { email };
            if (password) {
                payload.password = password;
            }
            
            try {
                const response = await fetch("/user/profile", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                
                if (response.status === 401) {
                    handleLogout();
                    return;
                }
                
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.detail || "Failed to update profile.");
                }
                
                showToast("Profile updated successfully!", "success");
                addNotification("Updated profile settings", "success");
                
                currentUser.email = data.user.email;
                localStorage.setItem("user", JSON.stringify(currentUser));
                document.getElementById("user-email").textContent = data.user.email;
                
                closeProfileModal();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }
});

// ==========================================
// SNIPPET VERSIONS
// ==========================================

let activeVersionSnippetId = "";

async function openVersionsModal(snippetId) {
    activeVersionSnippetId = snippetId;
    const listContainer = document.getElementById("versions-list-container");
    if (!listContainer) return;
    
    listContainer.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Loading versions...</div>`;
    document.getElementById("versions-modal").style.display = "flex";
    
    try {
        const response = await fetch(`/snippet/${snippetId}/versions`);
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || "Failed to load versions.");
        }
        const versions = await response.json();
        
        listContainer.innerHTML = "";
        if (versions.length === 0) {
            listContainer.innerHTML = `<div style="text-align: center; padding: 1.5rem; color: var(--text-muted);">No version history available.</div>`;
            return;
        }
        
        // Show versions descending (latest first)
        [...versions].reverse().forEach(v => {
            const item = document.createElement("div");
            item.style.padding = "0.75rem";
            item.style.border = "1px solid var(--border-color)";
            item.style.borderRadius = "6px";
            item.style.background = "#f8fafc";
            item.style.display = "flex";
            item.style.flexDirection = "column";
            item.style.gap = "0.5rem";
            
            const date = new Date(v.updated_at);
            const dateStr = date.toLocaleString();
            
            item.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; font-size: 0.8rem; color: #09090b;">Version #${v.version_id}</span>
                    <span style="font-size: 0.7rem; color: var(--text-secondary);">${dateStr}</span>
                </div>
                <pre style="background: #09090b; padding: 0.5rem; border-radius: 4px; font-size: 0.7rem; max-height: 85px; overflow-y: auto; white-space: pre-wrap; font-family: var(--font-code); color: #00ff00;">${escapeHtml(v.code)}</pre>
                <div style="display: flex; justify-content: flex-end;">
                    <button class="btn btn-primary" style="font-size: 0.7rem; padding: 0.25rem 0.55rem; height: 26px;" onclick="restoreVersion('${snippetId}', ${v.version_id})">
                        <i class="fa-solid fa-rotate-left"></i> Restore Version
                    </button>
                </div>
            `;
            listContainer.appendChild(item);
        });
    } catch (err) {
        showToast(err.message, "error");
    }
}

function closeVersionsModal() {
    document.getElementById("versions-modal").style.display = "none";
}

async function restoreVersion(snippetId, versionId) {
    if (!confirm("Are you sure you want to restore this snippet to this version? A new history entry will be saved.")) {
        return;
    }
    
    try {
        const response = await fetch(`/snippet/${snippetId}/versions/${versionId}/restore`, {
            method: "POST"
        });
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || "Failed to restore version.");
        }
        
        showToast("Snippet version restored successfully!", "success");
        addNotification(`Restored snippet to version #${versionId}`, "success");
        closeVersionsModal();
        fetchSnippets();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================
// AI CODE ASSISTANT
// ==========================================

let activeAiTab = "explain";
let currentAiAnalysis = null;

async function openAiModal(snippetId, code, language) {
    document.getElementById("ai-modal").style.display = "flex";
    
    const explainDiv = document.getElementById("ai-explain-text");
    explainDiv.innerHTML = `<div style="text-align: center; padding: 2rem;"><i class="fa-solid fa-brain fa-spin" style="font-size: 2rem; color: #8b5cf6;"></i><div style="margin-top: 1rem; font-weight: 500;">Analyzing snippet code with ScriptVault AI...</div></div>`;
    
    document.getElementById("ai-complexity-time").textContent = "Analyzing...";
    document.getElementById("ai-complexity-space").textContent = "Analyzing...";
    
    document.getElementById("ai-bugs-list").innerHTML = `<div style="text-align: center; padding: 1rem; color: var(--text-muted);">Analyzing...</div>`;
    document.getElementById("ai-optimizations-list").innerHTML = `<div style="text-align: center; padding: 1rem; color: var(--text-muted);">Analyzing...</div>`;
    document.getElementById("ai-duplicate-alert").innerHTML = `<div style="text-align: center; padding: 1rem; color: var(--text-muted);">Analyzing...</div>`;
    
    switchAiTab("explain");
    
    try {
        const response = await fetch("/snippets/ai-analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, language, id: snippetId })
        });
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) {
            let errorMsg = "AI analysis failed.";
            try {
                const data = await response.json();
                errorMsg = data.detail || errorMsg;
            } catch (jsonErr) {
                errorMsg = `Server error (${response.status}): ${response.statusText || "Internal Server Error"}`;
            }
            throw new Error(errorMsg);
        }
        
        currentAiAnalysis = await response.json();
        renderAiAnalysis();
        addNotification(`Ran AI Assistant code analysis`, "success");
    } catch (err) {
        explainDiv.textContent = `Analysis failed: ${err.message}`;
    }
}

function closeAiModal() {
    document.getElementById("ai-modal").style.display = "none";
}

function switchAiTab(tabName) {
    activeAiTab = tabName;
    
    const tabNames = ["explain", "complexity", "bugs", "optimizations", "duplicate"];
    tabNames.forEach(t => {
        const content = document.getElementById(`ai-content-${t}`);
        const btn = document.getElementById(`tab-ai-${t}`);
        
        if (content) content.style.display = (t === tabName) ? "block" : "none";
        if (btn) {
            if (t === tabName) {
                btn.classList.add("active");
                btn.style.background = "#8b5cf6";
                btn.style.color = "white";
                btn.style.borderColor = "#8b5cf6";
            } else {
                btn.classList.remove("active");
                btn.style.background = "";
                btn.style.color = "";
                btn.style.borderColor = "";
            }
        }
    });
}

function renderAiAnalysis() {
    if (!currentAiAnalysis) return;
    
    document.getElementById("ai-explain-text").innerHTML = formatMarkdown(currentAiAnalysis.explanation);
    
    document.getElementById("ai-complexity-time").textContent = currentAiAnalysis.time_complexity;
    document.getElementById("ai-complexity-space").textContent = currentAiAnalysis.space_complexity;
    
    const bugsList = document.getElementById("ai-bugs-list");
    bugsList.innerHTML = "";
    if (!currentAiAnalysis.bugs || currentAiAnalysis.bugs.length === 0) {
        bugsList.innerHTML = `<div style="color: var(--color-success); font-weight: 500; font-size: 0.85rem; padding: 0.5rem;"><i class="fa-solid fa-circle-check"></i> No syntactical bugs or style warnings detected!</div>`;
    } else {
        currentAiAnalysis.bugs.forEach(bug => {
            const item = document.createElement("div");
            item.style.padding = "0.5rem 0.75rem";
            item.style.background = "#fee2e2";
            item.style.color = "#b91c1c";
            item.style.border = "1px solid #fca5a5";
            item.style.borderRadius = "4px";
            item.style.fontSize = "0.8rem";
            item.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(bug)}`;
            bugsList.appendChild(item);
        });
    }
    
    const optsList = document.getElementById("ai-optimizations-list");
    optsList.innerHTML = "";
    if (!currentAiAnalysis.optimizations || currentAiAnalysis.optimizations.length === 0) {
        optsList.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; padding: 0.5rem;">No optimizations needed.</div>`;
    } else {
        currentAiAnalysis.optimizations.forEach(opt => {
            const item = document.createElement("div");
            item.style.padding = "0.5rem 0.75rem";
            item.style.background = "#f0fdf4";
            item.style.color = "#166534";
            item.style.border = "1px solid #bbf7d0";
            item.style.borderRadius = "4px";
            item.style.fontSize = "0.8rem";
            item.innerHTML = `<i class="fa-solid fa-lightbulb" style="color: #15803d;"></i> ${escapeHtml(opt)}`;
            optsList.appendChild(item);
        });
    }
    
    const dupAlert = document.getElementById("ai-duplicate-alert");
    dupAlert.innerHTML = "";
    const dup = currentAiAnalysis.duplicate_detection;
    if (dup && dup.duplicate) {
        dupAlert.style.background = "#fffbeb";
        dupAlert.style.color = "#b45309";
        dupAlert.style.border = "1px solid #fde68a";
        dupAlert.style.padding = "0.75rem";
        dupAlert.style.borderRadius = "6px";
        dupAlert.innerHTML = `
            <div style="font-weight: 600; font-size: 0.85rem;"><i class="fa-solid fa-copy"></i> High Similarity Duplicate Found!</div>
            <div style="font-size: 0.8rem; margin-top: 0.25rem;">This code is **${dup.similarity}%** similar to your snippet: **${escapeHtml(dup.matching_title)}**.</div>
        `;
    } else {
        dupAlert.style.background = "#f0fdf4";
        dupAlert.style.color = "#166534";
        dupAlert.style.border = "1px solid #bbf7d0";
        dupAlert.style.padding = "0.75rem";
        dupAlert.style.borderRadius = "6px";
        dupAlert.innerHTML = `
            <div style="font-weight: 600; font-size: 0.85rem;"><i class="fa-solid fa-circle-check"></i> Unique snippet code!</div>
            <div style="font-size: 0.8rem; margin-top: 0.25rem;">No duplicate code pattern found in your account.</div>
        `;
    }
}

function formatMarkdown(text) {
    if (!text) return "";
    return text
        .replace(/^#### (.*?)\r?$/gm, '<h4 style="font-size: 0.85rem; margin-top: 0.6rem; color: #1e293b; font-weight:600;">$1</h4>')
        .replace(/^### (.*?)\r?$/gm, '<h3 style="font-size: 1rem; margin-top: 0.85rem; color: #09090b; font-weight:600;">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/`(.*?)`/g, '<code style="background: #f1f5f9; padding: 0.1rem 0.3rem; border-radius: 4px; font-family: var(--font-code); font-size: 0.75rem; color: #0f172a; border: 1px solid #e2e8f0;">$1</code>')
        .replace(/^\s*-\s*(.*?)\r?$/gm, '<li style="margin-left: 1.25rem; font-size: 0.8rem; list-style-type: disc; margin-bottom: 0.25rem;">$1</li>');
}

// ==========================================
// CLIENT-SIDE ACTIVITY LOGS (NOTIFICATIONS)
// ==========================================

function addNotification(message, type = "info") {
    let notifications = JSON.parse(localStorage.getItem("notifications") || "[]");
    const newNotif = {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        message,
        type,
        time: new Date().toISOString(),
        read: false
    };
    notifications.unshift(newNotif);
    notifications = notifications.slice(0, 15); // Keep last 15
    localStorage.setItem("notifications", JSON.stringify(notifications));
    updateNotificationsUI();
}

function updateNotificationsUI() {
    const list = document.getElementById("notification-list");
    const badge = document.getElementById("notification-badge");
    if (!list) return;
    
    const notifications = JSON.parse(localStorage.getItem("notifications") || "[]");
    const unreadCount = notifications.filter(n => !n.read).length;
    
    if (unreadCount > 0 && badge) {
        badge.textContent = unreadCount;
        badge.style.display = "flex";
    } else if (badge) {
        badge.style.display = "none";
    }
    
    list.innerHTML = "";
    if (notifications.length === 0) {
        list.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-muted);">No activity logs.</div>`;
        return;
    }
    
    notifications.forEach(n => {
        const item = document.createElement("div");
        item.style.padding = "0.5rem 0.75rem";
        item.style.borderBottom = "1px solid var(--border-color)";
        item.style.display = "flex";
        item.style.flexDirection = "column";
        item.style.gap = "0.15rem";
        if (!n.read) item.style.background = "#f0f9ff";
        
        const date = new Date(n.time);
        const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        
        item.innerHTML = `
            <div style="color: #09090b; font-weight: 500; font-size: 0.75rem;">${escapeHtml(n.message)}</div>
            <div style="font-size: 0.6rem; color: var(--text-muted);">${timeStr}</div>
        `;
        list.appendChild(item);
    });
}

function toggleNotificationDropdown() {
    const menu = document.getElementById("notification-dropdown");
    if (!menu) return;
    
    if (menu.style.display === "none" || menu.style.display === "") {
        menu.style.display = "flex";
        let notifications = JSON.parse(localStorage.getItem("notifications") || "[]");
        notifications.forEach(n => n.read = true);
        localStorage.setItem("notifications", JSON.stringify(notifications));
        updateNotificationsUI();
    } else {
        menu.style.display = "none";
    }
}

function clearNotifications() {
    localStorage.setItem("notifications", "[]");
    updateNotificationsUI();
}

function toggleArchivedFilter() {
    if (currentView !== "snippets") {
        currentView = "snippets";
        document.getElementById("snippets-view").style.display = "block";
        document.getElementById("notes-view").style.display = "none";
        document.getElementById("playground-view").style.display = "none";
    }

    showArchived = !showArchived;
    
    const btn = document.getElementById("filter-archived");
    const titleLabel = document.getElementById("dashboard-title");
    
    currentLanguage = "";
    currentTag = "";
    document.getElementById("search-bar").value = "";
    currentSearch = "";
    currentFilterFavorites = false;
    
    const sidebar = document.querySelector(".sidebar-nav");
    const buttons = sidebar.querySelectorAll(".nav-item");
    buttons.forEach(b => b.classList.remove("active"));
    
    const activeNav = document.getElementById("nav-snippets");
    if (activeNav) activeNav.classList.add("active");
    
    if (showArchived) {
        if (btn) btn.classList.add("active");
        titleLabel.textContent = "Archived Snippets";
    } else {
        const allBtn = document.getElementById("filter-all");
        if (allBtn) allBtn.classList.add("active");
        titleLabel.textContent = "All Snippets";
    }
    
    fetchSnippets();
}

async function togglePin(snippetId, btn) {
    try {
        const response = await fetch(`/snippet/${snippetId}/pin`, {
            method: "POST"
        });
        if (response.status === 401) {
            handleLogout();
            return;
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || "Failed to toggle pin.");
        }
        
        if (data.pinned) {
            showToast("Snippet pinned to top!", "success");
            addNotification("Pinned code snippet", "info");
        } else {
            showToast("Snippet unpinned.", "info");
            addNotification("Unpinned code snippet", "info");
        }
        
        fetchSnippets();
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function toggleArchive(snippetId, btn) {
    try {
        const response = await fetch(`/snippet/${snippetId}/archive`, {
            method: "POST"
        });
        if (response.status === 401) {
            handleLogout();
            return;
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.detail || "Failed to toggle archive.");
        }
        
        if (data.archived) {
            showToast("Snippet moved to archive.", "success");
            addNotification("Archived code snippet", "info");
        } else {
            showToast("Snippet restored from archive.", "success");
            addNotification("Restored snippet from archive", "info");
        }
        
        fetchSnippets();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// ==========================================
// NOTES MANAGEMENT CONTROLLER
// ==========================================

async function fetchNotes() {
    try {
        const response = await fetch(`/notes?workspace_id=${activeWorkspaceId}`);
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) throw new Error("Failed to fetch notes.");
        const notes = await response.json();
        allNotes = notes;
        renderNotesList();
    } catch (err) {
        showToast(err.message, "error");
    }
}

function renderNotesList() {
    const listDiv = document.getElementById("notes-list-container");
    if (!listDiv) return;

    listDiv.innerHTML = "";
    
    let filtered = allNotes;
    if (noteSearchQuery) {
        const q = noteSearchQuery.toLowerCase();
        filtered = filtered.filter(n => 
            n.title.toLowerCase().includes(q) || 
            n.content.toLowerCase().includes(q)
        );
    }
    
    if (filtered.length === 0) {
        listDiv.innerHTML = `
            <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.8rem;">
                No notes found
            </div>
        `;
        return;
    }
    
    filtered.forEach(note => {
        const date = new Date(note.updated_at);
        const formattedDate = date.toLocaleDateString(undefined, { 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const noteSnippet = note.content ? note.content.substring(0, 60).replace(/[\#\*\_`\-\n]/g, " ") : "No content";
        const isActive = activeNoteId === note.id;
        
        const btn = document.createElement("button");
        btn.className = `note-item ${isActive ? 'active' : ''}`;
        btn.innerHTML = `
            <div class="note-item-title">${escapeHtml(note.title || "Untitled Note")}</div>
            <div class="note-item-snippet">${escapeHtml(noteSnippet)}</div>
            <div class="note-item-date">${formattedDate}</div>
        `;
        btn.onclick = () => selectNote(note.id);
        listDiv.appendChild(btn);
    });
}

function handleNoteSearch(query) {
    noteSearchQuery = query;
    renderNotesList();
}

async function selectNote(noteId) {
    if (noteAutosaveTimer) {
        clearTimeout(noteAutosaveTimer);
        await saveCurrentNote();
    }
    
    activeNoteId = noteId;
    renderNotesList();
    
    const emptyState = document.getElementById("note-editor-empty-state");
    const activeState = document.getElementById("note-editor-active-state");
    
    if (!noteId) {
        emptyState.style.display = "flex";
        activeState.style.display = "none";
        return;
    }
    
    emptyState.style.display = "none";
    activeState.style.display = "flex";
    
    try {
        const response = await fetch(`/note/${noteId}`);
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) throw new Error("Failed to load note details.");
        const note = await response.json();
        
        document.getElementById("note-title-input").value = note.title || "";
        document.getElementById("note-content-input").value = note.content || "";
        
        // Reset view tab to edit mode
        toggleNoteTab('edit');
        document.getElementById("note-save-status").textContent = "";
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function createNewNote() {
    try {
        const response = await fetch("/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: "Untitled Note",
                content: "",
                workspace_id: activeWorkspaceId
            })
        });
        
        if (response.status === 401) {
            handleLogout();
            return;
        }
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Failed to create note.");
        
        showToast("Note created", "success");
        activeNoteId = data.id;
        await fetchNotes();
        selectNote(data.id);
    } catch (err) {
        showToast(err.message, "error");
    }
}

async function saveCurrentNote() {
    if (!activeNoteId) return;
    
    const title = document.getElementById("note-title-input").value.trim() || "Untitled Note";
    const content = document.getElementById("note-content-input").value;
    
    const saveStatus = document.getElementById("note-save-status");
    if (saveStatus) saveStatus.textContent = "Saving...";
    
    try {
        const response = await fetch(`/note/${activeNoteId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, content })
        });
        
        if (response.status === 401) {
            handleLogout();
            return;
        }
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Failed to save note.");
        
        if (saveStatus) saveStatus.textContent = "Saved";
        
        // Quietly refresh list to update title/snippets without deselection
        const notesResp = await fetch(`/notes?workspace_id=${activeWorkspaceId}`);
        if (notesResp.ok) {
            allNotes = await notesResp.json();
            renderNotesList();
        }
    } catch (err) {
        if (saveStatus) saveStatus.textContent = "Error saving";
        showToast(err.message, "error");
    }
}

function onNoteContentChange() {
    const saveStatus = document.getElementById("note-save-status");
    if (saveStatus) saveStatus.textContent = "Unsaved changes";
    
    if (noteAutosaveTimer) clearTimeout(noteAutosaveTimer);
    
    // Autosave after 2 seconds of inactivity
    noteAutosaveTimer = setTimeout(() => {
        saveCurrentNote();
    }, 2000);
}

async function deleteCurrentNote() {
    if (!activeNoteId) return;
    if (!confirm("Are you sure you want to delete this note?")) return;
    
    if (noteAutosaveTimer) clearTimeout(noteAutosaveTimer);
    
    try {
        const response = await fetch(`/note/${activeNoteId}`, {
            method: "DELETE"
        });
        
        if (response.status === 401) {
            handleLogout();
            return;
        }
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || "Failed to delete note.");
        }
        
        showToast("Note deleted", "info");
        activeNoteId = null;
        await fetchNotes();
        selectNote(null);
    } catch (err) {
        showToast(err.message, "error");
    }
}

function toggleNoteTab(tabName) {
    const btnEdit = document.getElementById("note-btn-edit");
    const btnPreview = document.getElementById("note-btn-preview");
    const editPane = document.getElementById("note-edit-pane");
    const previewPane = document.getElementById("note-preview-pane");
    
    if (tabName === 'edit') {
        btnEdit.classList.add("active");
        btnPreview.classList.remove("active");
        editPane.style.display = "flex";
        previewPane.style.display = "none";
    } else {
        btnEdit.classList.remove("active");
        btnPreview.classList.add("active");
        editPane.style.display = "none";
        previewPane.style.display = "block";
        
        // Render Markdown content
        const markdownContent = document.getElementById("note-content-input").value;
        if (window.marked) {
            previewPane.innerHTML = marked.parse(markdownContent || "*No content written yet.*");
        } else {
            previewPane.innerHTML = escapeHtml(markdownContent || "No content").replace(/\n/g, "<br>");
        }
    }
}

// ==========================================
// PLAYGROUND IDE CONTROLLER
// ==========================================

function initPlayground() {
    if (playgroundEditor) return; // already initialized
    
    const container = document.getElementById('playground-monaco-container');
    if (!container) return;
    
    if (typeof monaco === 'undefined') {
        setTimeout(initPlayground, 100);
        return;
    }
    
    const initialCode = `// ScriptVault Code Playground\n// Write code here and click "Run Code" to run without saving.\n\nfunction greet() {\n    console.log("Hello, ScriptVault Playground!");\n}\n\ngreet();`;
    
    playgroundEditor = monaco.editor.create(container, {
        value: initialCode,
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "var(--font-code)",
        minimap: { enabled: false },
        suggestOnTriggerCharacters: true,
        quickSuggestions: { other: true, comments: true, strings: true },
        wordBasedSuggestions: true,
        snippetSuggestions: "inline"
    });
    
    activePlaygroundLang = "JavaScript";
    document.getElementById("playground-lang").value = "JavaScript";
    updatePlaygroundPreviewTabVisibility();
}

function changePlaygroundLanguage(lang) {
    activePlaygroundLang = lang;
    if (!playgroundEditor) return;
    
    const model = playgroundEditor.getModel();
    if (!model) return;
    
    const MONACO_LANG_MAP = {
        "Python": "python",
        "JavaScript": "javascript",
        "Java": "java",
        "C": "c",
        "C++": "cpp",
        "HTML": "html",
        "CSS": "css",
        "SQL": "sql"
    };
    
    const monacoLang = MONACO_LANG_MAP[lang] || "plaintext";
    monaco.editor.setModelLanguage(model, monacoLang);
    
    const currentVal = playgroundEditor.getValue();
    const commentOnlyRegex = /^(?:\/\/|#).*$/gm;
    if (!currentVal || currentVal.replace(commentOnlyRegex, "").trim() === "") {
        let template = "";
        if (lang === "Python") {
            template = "# Python Playground Scratchpad\nprint('Hello from Python!')";
        } else if (lang === "JavaScript") {
            template = "// Javascript Playground Scratchpad\nconsole.log('Hello from Javascript!');";
        } else if (lang === "Java") {
            template = "// Java Playground Scratchpad\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println(\"Hello from Java!\");\n    }\n}";
        } else if (lang === "C") {
            template = "/* C Playground Scratchpad */\n#include <stdio.h>\n\nint main() {\n    printf(\"Hello from C!\\n\");\n    return 0;\n}";
        } else if (lang === "C++") {
            template = "/* C++ Playground Scratchpad */\n#include <iostream>\n\nint main() {\n    std::cout << \"Hello from C++!\\n\";\n    return 0;\n}";
        } else if (lang === "HTML") {
            template = "<!-- HTML Playground Scratchpad -->\n<!DOCTYPE html>\n<html>\n<head>\n    <style>\n        body { font-family: sans-serif; background: #eef2f6; text-align: center; padding: 2rem; }\n    </style>\n</head>\n<body>\n    <h1>Hello from Web Live Preview!</h1>\n    <p>Modify code and click Run Code to update this view.</p>\n</body>\n</html>";
        }
        playgroundEditor.setValue(template);
    }
    
    updatePlaygroundPreviewTabVisibility();
}

function updatePlaygroundPreviewTabVisibility() {
    const previewBtn = document.getElementById("pg-tab-btn-preview");
    if (["JavaScript", "HTML", "CSS"].includes(activePlaygroundLang)) {
        previewBtn.style.display = "flex";
    } else {
        previewBtn.style.display = "none";
        const activeTab = document.querySelector(".playground-tab-btn.active");
        if (activeTab && activeTab.id === "pg-tab-btn-preview") {
            switchPlaygroundTab("output");
        }
    }
}

function changePlaygroundTheme(theme) {
    if (typeof monaco !== 'undefined') {
        monaco.editor.setTheme(theme);
    }
}

function switchPlaygroundTab(tabName) {
    const btnOutput = document.getElementById("pg-tab-btn-output");
    const btnInput = document.getElementById("pg-tab-btn-input");
    const btnPreview = document.getElementById("pg-tab-btn-preview");
    
    const paneOutput = document.getElementById("pg-tab-pane-output");
    const paneInput = document.getElementById("pg-tab-pane-input");
    const panePreview = document.getElementById("pg-tab-pane-preview");
    
    btnOutput.classList.remove("active");
    btnInput.classList.remove("active");
    btnPreview.classList.remove("active");
    
    paneOutput.style.display = "none";
    paneInput.style.display = "none";
    panePreview.style.display = "none";
    
    if (tabName === "output") {
        btnOutput.classList.add("active");
        paneOutput.style.display = "flex";
    } else if (tabName === "input") {
        btnInput.classList.add("active");
        paneInput.style.display = "flex";
    } else if (tabName === "preview") {
        btnPreview.classList.add("active");
        panePreview.style.display = "flex";
    }
}

async function runPlaygroundCode() {
    if (!playgroundEditor) return;
    
    const code = playgroundEditor.getValue();
    const lang = activePlaygroundLang;
    const stdin = document.getElementById("playground-stdin").value;
    
    const statusSpan = document.getElementById("playground-run-status");
    const outputConsole = document.getElementById("playground-console-output");
    
    statusSpan.textContent = "Executing...";
    outputConsole.textContent = "Running program...\n";
    outputConsole.style.color = "#a3e635";
    
    if (["javascript", "html", "css"].includes(lang.toLowerCase())) {
        switchPlaygroundTab("preview");
        const iframe = document.getElementById("playground-web-preview");
        if (lang.toLowerCase() === "html") {
            iframe.srcdoc = code;
        } else if (lang.toLowerCase() === "javascript") {
            iframe.srcdoc = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body { background: #000; color: #fff; font-family: monospace; padding: 10px; font-size: 13px; }
                        #console { white-space: pre-wrap; line-height: 1.5; }
                    </style>
                </head>
                <body>
                    <div id="console"></div>
                    <script>
                        const _log = console.log;
                        const consoleDiv = document.getElementById('console');
                        console.log = function(...args) {
                            consoleDiv.innerHTML += args.join(' ') + '\\n';
                            _log.apply(console, args);
                        };
                        console.error = function(...args) {
                            consoleDiv.innerHTML += '<span style="color: #ef4444;">[ERROR] ' + args.join(' ') + '</span>\\n';
                        };
                        try {
                            ${code}
                        } catch(err) {
                            console.error(err.message);
                        }
                    </script>
                </body>
                </html>
            `;
        } else if (lang.toLowerCase() === "css") {
            iframe.srcdoc = `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>${code}</style>
                </head>
                <body>
                    <h1 style="text-align:center;">CSS Preview Sandbox</h1>
                    <div style="max-width:400px; margin:20px auto; padding:20px; border:1px solid #ccc; border-radius:5px;">
                        <h3>Styled Elements</h3>
                        <p>This sandbox renders your CSS code globally.</p>
                        <button style="padding:5px 10px;">Sample Button</button>
                    </div>
                </body>
                </html>
            `;
        }
        
        statusSpan.textContent = "Rendered";
        outputConsole.textContent = "Rendered inside Live Preview tab.";
        return;
    }
    
    try {
        const response = await fetch("/snippets/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                code: code,
                language: lang,
                input: stdin
            })
        });
        
        if (response.status === 401) {
            handleLogout();
            return;
        }
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "Execution request failed.");
        
        let terminalText = "";
        if (data.stderr) {
            terminalText += `[STDERR]\n${data.stderr}\n`;
            outputConsole.style.color = "#fca5a5";
        }
        if (data.stdout !== undefined) {
            terminalText += data.stdout;
        }
        
        if (!data.stderr && !data.stdout) {
            terminalText = "(No output program terminated successfully)";
        }
        
        outputConsole.textContent = terminalText;
        statusSpan.textContent = `Completed (exit code ${data.exit_code})`;
    } catch (err) {
        statusSpan.textContent = "Error executing";
        outputConsole.textContent = `Execution Error: ${err.message}`;
        outputConsole.style.color = "#fca5a5";
    }
}

// ====================================================
// INTERACTIVE EXCEL SPREADSHEET GRID ENGINE
// ====================================================
let excelRows = 20;
let excelCols = 10;
let excelGridData = {};
let activeCellRef = "A1";

function colIndexToLetter(idx) {
    let temp, letter = '';
    while (idx >= 0) {
        temp = idx % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        idx = (idx - temp) / 26 - 1;
    }
    return letter;
}

function letterToColIndex(letter) {
    let col = 0;
    for (let i = 0; i < letter.length; i++) {
        col = col * 26 + (letter.charCodeAt(i) - 64);
    }
    return col - 1;
}

function initExcelGrid() {
    const table = document.getElementById("excel-grid-table");
    if (!table) return;

    if (Object.keys(excelGridData).length === 0) {
        loadExcelTemplate("blank");
    } else {
        renderExcelGrid();
    }
}

function renderExcelGrid() {
    const table = document.getElementById("excel-grid-table");
    if (!table) return;

    let html = "<thead><tr><th class='row-header'>#</th>";
    for (let c = 0; c < excelCols; c++) {
        html += `<th>${colIndexToLetter(c)}</th>`;
    }
    html += "</tr></thead><tbody>";

    for (let r = 1; r <= excelRows; r++) {
        html += `<tr><th class='row-header'>${r}</th>`;
        for (let c = 0; c < excelCols; c++) {
            const colLetter = colIndexToLetter(c);
            const ref = `${colLetter}${r}`;
            const cell = excelGridData[ref] || { raw: "", val: "" };
            
            let displayVal = cell.val !== undefined ? cell.val : cell.raw;
            if (cell.raw && String(cell.raw).startsWith("=")) {
                displayVal = evaluateExcelFormula(cell.raw);
                excelGridData[ref].val = displayVal;
            }

            let styleStr = "";
            if (cell.bold) styleStr += "font-weight: bold; ";
            if (cell.italic) styleStr += "font-style: italic; ";
            if (cell.align) styleStr += `text-align: ${cell.align}; `;
            if (cell.bg) styleStr += `background-color: ${cell.bg}; `;
            if (cell.color) styleStr += `color: ${cell.color}; `;

            const activeClass = ref === activeCellRef ? "active-cell" : "";

            html += `<td class="${activeClass}" style="${styleStr}">
                <input type="text" data-ref="${ref}" value="${escapeHtmlAttr(displayVal)}" 
                    onfocus="onExcelCellFocus('${ref}')" 
                    oninput="onExcelCellInput('${ref}', this.value)" 
                    onblur="renderExcelGrid()">
            </td>`;
        }
        html += "</tr>";
    }
    html += "</tbody>";
    table.innerHTML = html;

    const cellRefEl = document.getElementById("excel-cell-ref");
    if (cellRefEl) cellRefEl.textContent = activeCellRef;

    const formulaBar = document.getElementById("excel-formula-bar");
    if (formulaBar && excelGridData[activeCellRef]) {
        formulaBar.value = excelGridData[activeCellRef].raw || "";
    }
}

function escapeHtmlAttr(str) {
    if (str === undefined || str === null) return "";
    return String(str).replace(/"/g, '&quot;');
}

function onExcelCellFocus(ref) {
    activeCellRef = ref;
    const cellRefEl = document.getElementById("excel-cell-ref");
    if (cellRefEl) cellRefEl.textContent = ref;

    const cell = excelGridData[ref] || { raw: "" };
    const formulaBar = document.getElementById("excel-formula-bar");
    if (formulaBar) formulaBar.value = cell.raw || "";
}

function onExcelCellInput(ref, value) {
    if (!excelGridData[ref]) excelGridData[ref] = {};
    excelGridData[ref].raw = value;
    if (String(value).startsWith("=")) {
        excelGridData[ref].val = evaluateExcelFormula(value);
    } else {
        excelGridData[ref].val = value;
    }
}

function onFormulaBarInput(value) {
    if (!activeCellRef) return;
    onExcelCellInput(activeCellRef, value);
    const cellInput = document.querySelector(`input[data-ref="${activeCellRef}"]`);
    if (cellInput) {
        cellInput.value = String(value).startsWith("=") ? evaluateExcelFormula(value) : value;
    }
}

function evaluateExcelFormula(formula) {
    try {
        let clean = String(formula).substring(1).toUpperCase().trim();

        const sumMatch = clean.match(/^SUM\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
        if (sumMatch) {
            const values = getCellRangeValues(sumMatch[1], sumMatch[2]);
            return values.reduce((acc, num) => acc + (parseFloat(num) || 0), 0);
        }

        const avgMatch = clean.match(/^AVERAGE\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
        if (avgMatch) {
            const values = getCellRangeValues(avgMatch[1], avgMatch[2]).map(v => parseFloat(v) || 0);
            if (values.length === 0) return 0;
            return (values.reduce((acc, n) => acc + n, 0) / values.length).toFixed(2);
        }

        const countMatch = clean.match(/^COUNT\(([A-Z]+\d+):([A-Z]+\d+)\)$/);
        if (countMatch) {
            const values = getCellRangeValues(countMatch[1], countMatch[2]);
            return values.filter(v => v !== "" && !isNaN(v)).length;
        }

        clean = clean.replace(/([A-Z]+\d+)/g, (match) => {
            const cell = excelGridData[match];
            const v = cell ? (cell.val !== undefined ? cell.val : cell.raw) : 0;
            return isNaN(v) ? 0 : v;
        });

        const evalResult = Function(`"use strict"; return (${clean})`)();
        return isNaN(evalResult) ? "#VALUE!" : evalResult;
    } catch (e) {
        return "#ERROR!";
    }
}

function getCellRangeValues(startRef, endRef) {
    const startCol = letterToColIndex(startRef.replace(/\d+/g, ''));
    const startRow = parseInt(startRef.replace(/\D+/g, ''));
    const endCol = letterToColIndex(endRef.replace(/\d+/g, ''));
    const endRow = parseInt(endRef.replace(/\D+/g, ''));

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    const values = [];
    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const ref = `${colIndexToLetter(c)}${r}`;
            const cell = excelGridData[ref];
            if (cell) {
                values.push(cell.val !== undefined ? cell.val : cell.raw);
            }
        }
    }
    return values;
}

function addExcelRow() {
    excelRows++;
    renderExcelGrid();
}

function deleteExcelRow() {
    if (excelRows > 1) {
        excelRows--;
        renderExcelGrid();
    }
}

function addExcelCol() {
    excelCols++;
    renderExcelGrid();
}

function deleteExcelCol() {
    if (excelCols > 1) {
        excelCols--;
        renderExcelGrid();
    }
}

function formatExcelCell(type, val) {
    if (!activeCellRef) return;
    if (!excelGridData[activeCellRef]) excelGridData[activeCellRef] = { raw: "", val: "" };
    
    if (type === "bold") excelGridData[activeCellRef].bold = !excelGridData[activeCellRef].bold;
    if (type === "italic") excelGridData[activeCellRef].italic = !excelGridData[activeCellRef].italic;
    if (type.startsWith("align-")) excelGridData[activeCellRef].align = type.replace("align-", "");
    if (type === "bg") excelGridData[activeCellRef].bg = val;
    if (type === "color") excelGridData[activeCellRef].color = val;

    renderExcelGrid();
}

function clearExcelGrid() {
    if (confirm("Are you sure you want to clear all cells in this spreadsheet?")) {
        excelGridData = {};
        renderExcelGrid();
        showToast("Excel spreadsheet cleared.", "info");
    }
}

function loadExcelTemplate(templateKey) {
    excelGridData = {};
    if (templateKey === "snippets") {
        excelGridData = {
            "A1": { raw: "Title", bold: true, bg: "#e2e8f0" },
            "B1": { raw: "Language", bold: true, bg: "#e2e8f0" },
            "C1": { raw: "Tags", bold: true, bg: "#e2e8f0" },
            "D1": { raw: "Description", bold: true, bg: "#e2e8f0" },
            "A2": { raw: "Fetch Wrapper" }, "B2": { raw: "JavaScript" }, "C2": { raw: "api, fetch" }, "D2": { raw: "Async HTTP GET helper" },
            "A3": { raw: "Quick Sort" }, "B3": { raw: "Python" }, "C3": { raw: "algo, sorting" }, "D3": { raw: "Divide & Conquer O(n log n)" },
            "A4": { raw: "Database Connection" }, "B4": { raw: "Java" }, "C4": { raw: "sql, jdbc" }, "D4": { raw: "JDBC Driver setup" }
        };
    } else if (templateKey === "budget") {
        excelGridData = {
            "A1": { raw: "Expense Item", bold: true, bg: "#fef3c7" },
            "B1": { raw: "Category", bold: true, bg: "#fef3c7" },
            "C1": { raw: "Amount ($)", bold: true, bg: "#fef3c7" },
            "A2": { raw: "Cloud Hosting" }, "B2": { raw: "Infrastructure" }, "C2": { raw: "45" },
            "A3": { raw: "Domain Renewal" }, "B3": { raw: "Domain" }, "C3": { raw: "15" },
            "A4": { raw: "API Credits" }, "B4": { raw: "AI Tooling" }, "C4": { raw: "30" },
            "A5": { raw: "TOTAL", bold: true, bg: "#fee2e2" },
            "C5": { raw: "=SUM(C2:C4)", bold: true, bg: "#fee2e2" }
        };
    } else if (templateKey === "tasks") {
        excelGridData = {
            "A1": { raw: "Task Name", bold: true, bg: "#eff6ff" },
            "B1": { raw: "Assignee", bold: true, bg: "#eff6ff" },
            "C1": { raw: "Status", bold: true, bg: "#eff6ff" },
            "D1": { raw: "Priority", bold: true, bg: "#eff6ff" },
            "A2": { raw: "Excel Integration" }, "B2": { raw: "Dev Team" }, "C2": { raw: "Done" }, "D2": { raw: "High" },
            "A3": { raw: "Notepad Suite Upgrade" }, "B3": { raw: "Dev Team" }, "C3": { raw: "Done" }, "D3": { raw: "High" },
            "A4": { raw: "Share & PDF/ZIP Export" }, "B4": { raw: "Dev Team" }, "C4": { raw: "Completed" }, "D4": { raw: "Medium" }
        };
    }
    renderExcelGrid();
}

function importExcelFileToGrid(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!window.XLSX) {
        showToast("Excel reader library loading...", "info");
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            excelGridData = {};

            excelRows = Math.max(20, jsonData.length);
            excelCols = Math.max(10, jsonData.reduce((max, row) => Math.max(max, row ? row.length : 0), 0));

            jsonData.forEach((row, rIdx) => {
                if (row) {
                    row.forEach((cellVal, cIdx) => {
                        const colLetter = colIndexToLetter(cIdx);
                        const ref = `${colLetter}${rIdx + 1}`;
                        const valStr = String(cellVal !== undefined && cellVal !== null ? cellVal : "");
                        excelGridData[ref] = {
                            raw: valStr,
                            val: valStr,
                            bold: rIdx === 0
                        };
                    });
                }
            });

            renderExcelGrid();
            showToast(`Imported ${jsonData.length} row(s) into Excel Grid!`, "success");
        } catch (err) {
            showToast(`Could not read Excel file: ${err.message}`, "error");
        }
    };
    reader.readAsArrayBuffer(file);
}

function exportGridToExcel() {
    if (!window.XLSX) {
        showToast("SheetJS library not loaded.", "error");
        return;
    }

    const titleInput = document.getElementById("excel-sheet-title");
    const title = ((titleInput ? titleInput.value : "") || "scriptvault_spreadsheet").replace(/[^a-zA-Z0-9_-]/g, "_");
    
    const data = [];
    for (let r = 1; r <= excelRows; r++) {
        const row = [];
        let hasData = false;
        for (let c = 0; c < excelCols; c++) {
            const ref = `${colIndexToLetter(c)}${r}`;
            const cell = excelGridData[ref];
            const val = cell ? (cell.val !== undefined ? cell.val : cell.raw) : "";
            if (val !== "") hasData = true;
            row.push(val);
        }
        if (hasData || r <= 10) data.push(row);
    }

    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    XLSX.writeFile(workbook, `${title}.xlsx`);
    showToast("Excel spreadsheet downloaded successfully!", "success");
}

function exportGridToCSV() {
    const titleInput = document.getElementById("excel-sheet-title");
    const title = ((titleInput ? titleInput.value : "") || "scriptvault_spreadsheet").replace(/[^a-zA-Z0-9_-]/g, "_");
    let csvContent = "";
    for (let r = 1; r <= excelRows; r++) {
        const row = [];
        for (let c = 0; c < excelCols; c++) {
            const ref = `${colIndexToLetter(c)}${r}`;
            const cell = excelGridData[ref];
            const val = cell ? (cell.val !== undefined ? cell.val : cell.raw) : "";
            row.push(`"${String(val).replace(/"/g, '""')}"`);
        }
        csvContent += row.join(",") + "\n";
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported successfully!", "success");
}

// ====================================================
// RICH NOTEPAD TOOLBAR & FORMATTING SUITE
// ====================================================
function applyNotepadFormat(type) {
    const textarea = document.getElementById("note-content-input");
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);

    let replacement = "";
    if (type === "bold") replacement = `**${selectedText || "Bold text"}**`;
    else if (type === "italic") replacement = `*${selectedText || "Italic text"}*`;
    else if (type === "underline") replacement = `<u>${selectedText || "Underlined text"}</u>`;
    else if (type === "strikethrough") replacement = `~~${selectedText || "Strikethrough text"}~~`;
    else if (type === "h1") replacement = `\n# ${selectedText || "Heading 1"}\n`;
    else if (type === "h2") replacement = `\n## ${selectedText || "Heading 2"}\n`;
    else if (type === "h3") replacement = `\n### ${selectedText || "Heading 3"}\n`;
    else if (type === "ul") replacement = `\n- ${selectedText || "List item"}\n`;
    else if (type === "ol") replacement = `\n1. ${selectedText || "List item"}\n`;
    else if (type === "checklist") replacement = `\n- [ ] ${selectedText || "Task item"}\n`;
    else if (type === "code") replacement = `\`${selectedText || "code"}\``;
    else if (type === "codeblock") replacement = `\n\`\`\`javascript\n${selectedText || "// Code block"}\n\`\`\`\n`;
    else if (type === "quote") replacement = `\n> ${selectedText || "Quote"}\n`;
    else if (type === "timestamp") replacement = ` [${new Date().toLocaleString()}] `;

    textarea.setRangeText(replacement, start, end, 'select');
    textarea.focus();
    onNoteContentChange();
}

function changeNotepadFont(fontVal) {
    const textarea = document.getElementById("note-content-input");
    const preview = document.getElementById("note-preview-pane");
    let fontCss = "var(--font-ui)";
    if (fontVal === "serif") fontCss = "Georgia, serif";
    if (fontVal === "mono") fontCss = "var(--font-code)";

    if (textarea) textarea.style.fontFamily = fontCss;
    if (preview) preview.style.fontFamily = fontCss;
}

function changeNotepadFontSize(sizeVal) {
    const textarea = document.getElementById("note-content-input");
    const preview = document.getElementById("note-preview-pane");
    if (textarea) textarea.style.fontSize = sizeVal;
    if (preview) preview.style.fontSize = sizeVal;
}

function updateNotepadStats() {
    const textarea = document.getElementById("note-content-input");
    if (!textarea) return;
    const text = textarea.value || "";

    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    const paras = text.trim() ? text.split(/\n\s*\n/).length : 0;
    const readTime = Math.ceil(words / 200);

    const elWords = document.getElementById("notepad-stat-words");
    const elChars = document.getElementById("notepad-stat-chars");
    const elParas = document.getElementById("notepad-stat-paras");
    const elRead = document.getElementById("notepad-stat-readtime");

    if (elWords) elWords.textContent = words;
    if (elChars) elChars.textContent = chars.toLocaleString();
    if (elParas) elParas.textContent = paras;
    if (elRead) elRead.textContent = readTime;
}

function toggleFocusWritingMode() {
    const pane = document.querySelector(".notes-editor-pane");
    if (!pane) return;
    pane.classList.toggle("focus-writing-mode");
    showToast("Focus mode toggled (Click button again to exit)", "info");
}

// Wrap onNoteContentChange to update stats
if (typeof onNoteContentChange === "function") {
    const origChange = onNoteContentChange;
    onNoteContentChange = function() {
        origChange();
        updateNotepadStats();
    };
} else {
    window.onNoteContentChange = function() {
        updateNotepadStats();
    };
}

// ====================================================
// MULTI-CHANNEL SHARE SUITE
// ====================================================
let currentShareObj = { type: 'note', id: null, title: '', content: '' };

function openShareModal(type = 'note', id = null) {
    const modal = document.getElementById("share-modal");
    if (!modal) return;

    let targetId = id;
    let title = "Shared Item";
    let contentText = "";

    if (type === 'note') {
        targetId = activeNoteId;
        const titleInput = document.getElementById("note-title-input");
        const contentInput = document.getElementById("note-content-input");
        title = titleInput ? titleInput.value : "Shared Note";
        contentText = contentInput ? contentInput.value : "";
    } else if (type === 'sheet') {
        const titleInput = document.getElementById("excel-sheet-title");
        title = titleInput ? titleInput.value : "Shared Spreadsheet";
        contentText = JSON.stringify(excelGridData);
    }

    if (!targetId && type === 'note') {
        showToast("Please save note first before sharing.", "warning");
        return;
    }

    currentShareObj = { type, id: targetId, title, content: contentText };

    const shareUrl = `${window.location.origin}/share?type=${type}&id=${targetId || 'active'}`;
    const urlInput = document.getElementById("share-modal-url");
    if (urlInput) urlInput.value = shareUrl;

    modal.style.display = "flex";
}

function closeShareModal() {
    const modal = document.getElementById("share-modal");
    if (modal) modal.style.display = "none";
}

function copyShareModalLink() {
    const input = document.getElementById("share-modal-url");
    if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
            showToast("Share link copied to clipboard!", "success");
        });
    }
}

function shareToWhatsApp() {
    const urlInput = document.getElementById("share-modal-url");
    const url = encodeURIComponent(urlInput ? urlInput.value : window.location.href);
    const text = encodeURIComponent(`Check out this note on ScriptVault: ${currentShareObj.title}\n`);
    window.open(`https://api.whatsapp.com/send?text=${text}${url}`, "_blank");
}

function shareToTwitter() {
    const urlInput = document.getElementById("share-modal-url");
    const url = encodeURIComponent(urlInput ? urlInput.value : window.location.href);
    const text = encodeURIComponent(`Check out "${currentShareObj.title}" on ScriptVault!\n`);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
}

function shareToEmail() {
    const urlInput = document.getElementById("share-modal-url");
    const url = urlInput ? urlInput.value : window.location.href;
    const subject = encodeURIComponent(`ScriptVault Share: ${currentShareObj.title}`);
    const body = encodeURIComponent(`Hi,\n\nI wanted to share this note with you:\n${currentShareObj.title}\n\nView link: ${url}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
}

function triggerWebShare() {
    const urlInput = document.getElementById("share-modal-url");
    const url = urlInput ? urlInput.value : window.location.href;
    if (navigator.share) {
        navigator.share({
            title: currentShareObj.title,
            text: `ScriptVault Shared Content: ${currentShareObj.title}`,
            url: url
        }).catch(() => {});
    } else {
        copyShareModalLink();
    }
}

function toggleExportMenu(dropdownId) {
    const menu = document.getElementById(dropdownId);
    if (!menu) return;
    const isOpen = menu.style.display === "block";
    
    document.querySelectorAll(".export-dropdown-menu").forEach(m => m.style.display = "none");
    menu.style.display = isOpen ? "none" : "block";
}

document.addEventListener("click", (e) => {
    if (!e.target.closest(".export-dropdown-menu") && !e.target.closest("button[onclick*='toggleExportMenu']")) {
        document.querySelectorAll(".export-dropdown-menu").forEach(m => m.style.display = "none");
    }
});

// ====================================================
// MULTI-FORMAT EXPORT ENGINE (PDF, ZIP, EXCEL, TXT)
// ====================================================
function exportCurrentNotePDF() {
    const titleInput = document.getElementById("note-title-input");
    const contentInput = document.getElementById("note-content-input");
    const title = ((titleInput ? titleInput.value : "") || "notepad_note").replace(/[^a-zA-Z0-9_-]/g, "_");
    const content = contentInput ? contentInput.value : "";

    const exportDiv = document.createElement("div");
    exportDiv.style.padding = "20px";
    exportDiv.style.fontFamily = "Arial, sans-serif";
    exportDiv.innerHTML = `
        <h1 style="color:#09090b; border-bottom:2px solid #6366f1; padding-bottom:8px;">${titleInput ? titleInput.value : "Untitled Note"}</h1>
        <p style="color:#64748b; font-size:12px;">ScriptVault Notepad Export &bull; Date: ${new Date().toLocaleDateString()}</p>
        <hr style="border:0; border-top:1px solid #e2e8f0; margin:15px 0;">
        <div style="font-size:14px; line-height:1.6; color:#1e293b; white-space:pre-wrap;">${window.marked ? marked.parse(content) : content}</div>
    `;

    if (window.html2pdf) {
        const opt = {
            margin: 10,
            filename: `${title}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(exportDiv).save();
        showToast("Exporting PDF...", "info");
    } else {
        showToast("PDF generator loading...", "warning");
    }
}

function exportCurrentNoteZIP() {
    if (!window.JSZip) {
        showToast("ZIP engine loading...", "warning");
        return;
    }

    const titleInput = document.getElementById("note-title-input");
    const contentInput = document.getElementById("note-content-input");
    const title = ((titleInput ? titleInput.value : "") || "notepad_note").replace(/[^a-zA-Z0-9_-]/g, "_");
    const content = contentInput ? contentInput.value : "";

    const zip = new JSZip();
    zip.file(`${title}.txt`, content);
    zip.file(`${title}.md`, `# ${titleInput ? titleInput.value : "Note"}\n\n${content}`);
    zip.file("INFO.txt", `Exported from ScriptVault Notepad\nTitle: ${titleInput ? titleInput.value : "Note"}\nDate: ${new Date().toLocaleString()}`);

    zip.generateAsync({ type: "blob" }).then(function(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("ZIP archive downloaded!", "success");
    });
}

function exportCurrentNoteTXT() {
    const titleInput = document.getElementById("note-title-input");
    const contentInput = document.getElementById("note-content-input");
    const title = ((titleInput ? titleInput.value : "") || "notepad_note").replace(/[^a-zA-Z0-9_-]/g, "_");
    const content = contentInput ? contentInput.value : "";

    const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Text file downloaded!", "success");
}

function exportCurrentNoteExcel() {
    window.location.href = "/notes/export/excel";
}

function exportAllNotesExcel() {
    window.location.href = "/notes/export/excel";
}

function exportAllNotesZip() {
    if (!allNotes || allNotes.length === 0) {
        showToast("No notes found to export.", "warning");
        return;
    }
    if (!window.JSZip) {
        showToast("ZIP engine loading...", "warning");
        return;
    }

    const zip = new JSZip();
    const folder = zip.folder("scriptvault_notes");

    allNotes.forEach((n, idx) => {
        const cleanTitle = (n.title || `note_${idx+1}`).replace(/[^a-zA-Z0-9_-]/g, "_");
        folder.file(`${cleanTitle}.md`, `# ${n.title}\n\nCreated: ${n.created_at}\n\n${n.content || ""}`);
    });

    zip.generateAsync({ type: "blob" }).then(function(blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "all_scriptvault_notes.zip";
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Exported ${allNotes.length} note(s) to ZIP archive!`, "success");
    });
}