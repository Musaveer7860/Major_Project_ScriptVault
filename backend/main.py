import os
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routes import router

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(os.path.dirname(BASE_DIR), "frontend")

app = FastAPI(
    title="ScriptVault",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    init_db()
    try:
        from database import get_db
        from bson import ObjectId
        from datetime import datetime
        db = get_db()
        
        users = list(db.users.find())
        for u in users:

            ws = db.workspaces.find_one({"user_id": u["_id"]})
            if not ws:
                ws_id = db.workspaces.insert_one({
                    "user_id": u["_id"],
                    "name": "Personal Workspace",
                    "created_at": datetime.utcnow()
                }).inserted_id
                print(f"Created default workspace for user {u['username']}.")
            else:
                ws_id = ws["_id"]
            

            res = db.snippets.update_many(
                {"user_id": u["_id"], "workspace_id": {"$exists": False}},
                {"$set": {"workspace_id": ws_id}}
            )
            if res.modified_count > 0:
                print(f"Migrated {res.modified_count} snippets for user {u['username']} to workspace {ws_id}.")
    except Exception as e:
        print(f"Migration error during startup: {str(e)}")

app.include_router(router)

app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")

@app.get("/")
def read_landing():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

@app.get("/login")
def read_login():
    return FileResponse(os.path.join(FRONTEND_DIR, "login.html"))

@app.get("/register")
def read_register():
    return FileResponse(os.path.join(FRONTEND_DIR, "register.html"))

@app.get("/dashboard")
def read_dashboard():
    return FileResponse(os.path.join(FRONTEND_DIR, "dashboard.html"))

@app.get("/create")
def read_create():
    return FileResponse(os.path.join(FRONTEND_DIR, "create.html"))

@app.get("/edit")
def read_edit():
    return FileResponse(os.path.join(FRONTEND_DIR, "edit.html"))

@app.get("/share")
def read_share():
    return FileResponse(os.path.join(FRONTEND_DIR, "share.html"))

