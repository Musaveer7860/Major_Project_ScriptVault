# ScriptVault - Automated Multi-Language Code Snippet Manager

ScriptVault is a secure cloud-based web application designed for developers to save, organize, search, edit, clone, and manage code snippets. It supports multiple programming languages, offers real-time syntax highlighting via Prism.js, and implements full-text search indexing with MongoDB.

---

## Features

1. **User Authentication:** Registration, Login, and Logout routes with passwords hashed via Bcrypt and sessions managed securely via HTTPOnly JWT cookies.
2. **Snippet Management:** Complete CRUD interface (Create, Read, Update, Delete) for custom code snippets.
3. **Multi-Language Support:** Full formatting support for **Python, Java, C, C++, JavaScript, HTML, CSS, and SQL**.
4. **Syntax Highlighting:** Real-time, automatic syntax highlighting matching the selected language using Prism.js themes.
5. **Smart Search:** Fast queries matching titles, tags, and source code content. Powered by **MongoDB Full Text Search Indexing** with a regex substring fallback.
6. **Snippet Cloning:** Instantly copy existing snippet templates to create a duplicate version.
7. **Copy to Clipboard:** One-click copying with quick UI success animations.
8. **Premium Interface:** High-end, developer-centric responsive dark mode layout utilizing glassmorphism and subtle glow transitions.
9. **XSS Protection:** Backend sanitization of title and tags, combined with frontend text rendering via browser `textContent` to ensure code execution exploits are fully blocked.

---

## Tech Stack

- **Frontend:** HTML5, CSS3 (Vanilla Custom Properties), JavaScript (ES6+), FontAwesome Icons, Prism.js
- **Backend:** Python, FastAPI, Uvicorn, Pydantic, PyJWT, Bcrypt
- **Database:** MongoDB (via PyMongo client)

---

## Project Structure

```
scriptvault/
├── backend/
│   ├── main.py              # Application entry point, static mount, page routes
│   ├── database.py          # MongoDB connection pool & text search indexes
│   ├── auth.py              # Password hashing, JWT token parsing, regex checks
│   ├── routes.py            # API REST endpoints (Auth, Snippet CRUD, Clone, Search)
│   └── requirements.txt     # Python requirements manifest
├── frontend/
│   ├── index.html           # Landing teaser page
│   ├── login.html           # Login card page
│   ├── register.html        # Sign up page with password strength checklist
│   ├── dashboard.html       # Snippet search workspace and cards layout
│   ├── create.html          # New snippet creation form
│   ├── edit.html            # Pre-filled edit form
│   ├── css/
│   │   └── style.css        # Unified dark styling system and responsive breakpoints
│   └── js/
│       ├── auth.js          # Authentication handlers & password check triggers
│       ├── dashboard.js     # Snippet rendering, search debounce, clone & copy utilities
│       ├── create.js        # Snippet creation form submission
│       └── edit.js          # Pre-filling and updating snippet records
└── README.md                # Project documentation
```

---

## Database Design

### users collection
```json
{
  "_id": "ObjectId",
  "username": "string",
  "email": "string",
  "password": "hashed_password"
}
```

### snippets collection
```json
{
  "_id": "ObjectId",
  "user_id": "ObjectId",
  "title": "string",
  "language": "string",
  "tags": ["string"],
  "code": "string",
  "created_at": "datetime"
}
```

---

## API Documentation

### Authentication Enpoints
- `POST /register` - Registers a new user account. Validates inputs using regular expressions.
- `POST /login` - Signs in and sets an HTTPOnly cookie `access_token` containing the session JWT.
- `POST /logout` - Clears the authentication cookies.

### Snippets CRUD Endpoints
- `GET /snippets` - Returns all snippets owned by the logged-in user, ordered by creation date.
- `POST /snippets` - Creates a new snippet. Sanitizes title and tag fields.
- `GET /snippet/{id}` - Returns detail for a specific snippet.
- `PUT /snippet/{id}` - Updates editable fields of a specific snippet.
- `DELETE /snippet/{id}` - Permanently removes a snippet from the database.

### Search & Clone Endpoints
- `GET /search?q={query}&language={lang}&tag={tag}` - Retrieves snippets matching filter terms using MongoDB Full Text search index and regex.
- `POST /snippet/{id}/clone` - Duplicates a snippet with a `(Clone)` title suffix.

---

## Installation & Setup

### 1. Prerequisites
- **Python 3.8+** installed on your system.
- **MongoDB** running locally on standard port `27017` (or provide a connection string).

### 2. Database Verification
Ensure your local MongoDB instance is started. On Windows, you can start the service or run:
```bash
mongod
```

### 3. Backend Setup
1. Open your terminal and navigate to the project backend directory:
   ```bash
   cd scriptvault/backend
   ```
2. Create a virtual environment:
   ```bash
   python -m venv venv
   ```
3. Activate the virtual environment:
   - **Windows (Command Prompt):**
     ```cmd
     venv\Scripts\activate.bat
     ```
   - **Windows (PowerShell):**
     ```powershell
     .\venv\Scripts\Activate.ps1
     ```
   - **macOS/Linux:**
     ```bash
     source venv/bin/activate
     ```
4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### 4. Running the Web Application
Start the development server with:
```bash
uvicorn main:app --reload
```
The application will launch. Open your browser and navigate to:
[http://localhost:8000](http://localhost:8000)

---

## Security Highlights

- **Bcrypt Hashing:** Secures user password records against data breaches.
- **Input Filtering & Sanitization:** Filters HTML out of titles and tags to eliminate script-injection storage threats.
- **Prism textContent Binding:** Snippet code contents are set into HTML elements via `textContent` rather than `innerHTML`. The browser treats it strictly as safe text, completely eliminating DOM XSS pathways.
- **Strict User Boundaries:** Database queries verify resource ownership (`user_id` matches JWT bearer token) for all snippet operations.
