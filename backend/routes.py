import re
import html
import os
import sys
import tempfile
import subprocess
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from pydantic import BaseModel, Field
from bson import ObjectId

from database import get_db
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    validate_registration,
)

router = APIRouter()

SUPPORTED_LANGUAGES = {
    "python": "Python",
    "java": "Java",
    "c": "C",
    "c++": "C++",
    "javascript": "JavaScript",
    "html": "HTML",
    "css": "CSS",
    "sql": "SQL"
}

def sanitize_text(text: str) -> str:
    if not text:
        return ""
    clean = re.sub(r'<[^>]*>', '', text)
    return html.escape(clean.strip())

def sanitize_code_string(code: str) -> str:
    if not code:
        return ""
    code = re.sub(r'(?i)<script\b[^>]*>([\s\S]*?)<\/script>', '', code)
    code = re.sub(r'(?i)\bon\w+\s*=\s*(?:(["\'])(.*?)\1|[^>\s]+)', '', code)
    code = re.sub(r'(?i)javascript:\s*[\s\S]*?', '', code)
    return code

class SnippetRunSchema(BaseModel):
    code: str
    language: str
    input: Optional[str] = None

class RegisterSchema(BaseModel):
    username: str
    email: str
    password: str

class LoginSchema(BaseModel):
    username: str
    password: str

class WorkspaceCreateSchema(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)

class WorkspaceUpdateSchema(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)

class CollectionCreateSchema(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    workspace_id: str

class CollectionUpdateSchema(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)

class SnippetCreateSchema(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    language: str
    tags: List[str]
    code: str = Field(..., min_length=1)
    description: Optional[str] = ""
    workspace_id: str
    collection_id: Optional[str] = None

class SnippetUpdateSchema(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    language: Optional[str] = None
    tags: Optional[List[str]] = None
    code: Optional[str] = Field(None, min_length=1)
    description: Optional[str] = None
    workspace_id: Optional[str] = None
    collection_id: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None

class SnippetAIAnalyzeSchema(BaseModel):
    code: str
    language: str
    id: Optional[str] = None

class NoteCreateSchema(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    content: str = Field("")
    workspace_id: str

class NoteUpdateSchema(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=100)
    content: Optional[str] = None

def format_note(note) -> dict:
    return {
        "id": str(note["_id"]),
        "title": note["title"],
        "content": note.get("content", ""),
        "workspace_id": str(note["workspace_id"]) if note.get("workspace_id") else None,
        "created_at": note["created_at"].isoformat() if isinstance(note["created_at"], datetime) else note["created_at"],
        "updated_at": note.get("updated_at", note["created_at"]).isoformat() if isinstance(note.get("updated_at", note["created_at"]), datetime) else note.get("updated_at", note["created_at"]),
        "user_id": str(note["user_id"])
    }

def format_snippet(snippet) -> dict:
    return {
        "id": str(snippet["_id"]),
        "title": snippet["title"],
        "language": snippet["language"],
        "tags": snippet["tags"],
        "code": snippet["code"],
        "favorite": snippet.get("favorite", False),
        "pinned": snippet.get("pinned", False),
        "archived": snippet.get("archived", False),
        "description": snippet.get("description", ""),
        "workspace_id": str(snippet["workspace_id"]) if snippet.get("workspace_id") else None,
        "collection_id": str(snippet["collection_id"]) if snippet.get("collection_id") else None,
        "created_at": snippet["created_at"].isoformat() if isinstance(snippet["created_at"], datetime) else snippet["created_at"],
        "updated_at": snippet.get("updated_at", snippet["created_at"]).isoformat() if isinstance(snippet.get("updated_at", snippet["created_at"]), datetime) else snippet.get("updated_at", snippet["created_at"]),
        "user_id": str(snippet["user_id"])
    }

@router.post("/register")
async def register(payload: RegisterSchema):
    db = get_db()
    
    error_msg = validate_registration(payload.username, payload.email, payload.password)
    if error_msg:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error_msg)
    
    clean_username = sanitize_text(payload.username)
    clean_email = payload.email.strip().lower()
    
    if db.users.find_one({"username": clean_username}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is already taken."
        )
    if db.users.find_one({"email": clean_email}):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already registered."
        )
        
    hashed = hash_password(payload.password)
    user_doc = {
        "username": clean_username,
        "email": clean_email,
        "password": hashed
    }
    
    try:
        db.users.insert_one(user_doc)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during registration: {str(e)}"
        )
        
    return {"message": "Registration successful. You can now log in."}

@router.post("/login")
async def login(payload: LoginSchema, response: Response):
    db = get_db()
    
    login_term = payload.username.strip()
    user = db.users.find_one({
        "$or": [
            {"username": login_term},
            {"email": login_term.lower()}
        ]
    })
    
    if not user or not verify_password(payload.password, user["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/email or password."
        )
        
    token = create_access_token(data={"sub": str(user["_id"])})
    
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        max_age=86400,
        expires=86400,
        samesite="lax",
        secure=False
    )
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user["_id"]),
            "username": user["username"],
            "email": user["email"]
        }
    }

@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(key="access_token")
    return {"message": "Logged out successfully."}

@router.get("/snippets")
async def get_snippets(
    workspace_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    
    if workspace_id:
        try:
            ws_oid = ObjectId(workspace_id)
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid workspace ID.")
    else:
        # Find first/default workspace
        ws = db.workspaces.find_one({"user_id": user_uid})
        if not ws:
            ws_oid = db.workspaces.insert_one({
                "user_id": user_uid,
                "name": "Personal Workspace",
                "created_at": datetime.utcnow()
            }).inserted_id
        else:
            ws_oid = ws["_id"]
            
    query = {"user_id": user_uid, "workspace_id": ws_oid}
    
    if collection_id:
        if collection_id in ("null", "none"):
            query["collection_id"] = None
        else:
            try:
                query["collection_id"] = ObjectId(collection_id)
            except Exception:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid collection ID.")
                
    snippets_cursor = db.snippets.find(query).sort([("pinned", -1), ("created_at", -1)])
    return [format_snippet(s) for s in snippets_cursor]

@router.post("/snippets", status_code=status.HTTP_201_CREATED)
async def create_snippet(payload: SnippetCreateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    
    lang_key = payload.language.lower().strip()
    if lang_key not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported language. Supported: {', '.join(SUPPORTED_LANGUAGES.values())}"
        )
    normalized_lang = SUPPORTED_LANGUAGES[lang_key]
    
    clean_title = sanitize_text(payload.title)
    clean_tags = [sanitize_text(t) for t in payload.tags if t.strip()]
    
    try:
        ws_oid = ObjectId(payload.workspace_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid workspace ID.")
        
    coll_oid = None
    if payload.collection_id:
        try:
            coll_oid = ObjectId(payload.collection_id)
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid collection ID.")
            
    snippet_code = sanitize_code_string(payload.code)
    now = datetime.utcnow()
    
    snippet_doc = {
        "user_id": ObjectId(current_user["_id"]),
        "workspace_id": ws_oid,
        "collection_id": coll_oid,
        "title": clean_title,
        "language": normalized_lang,
        "tags": clean_tags,
        "code": snippet_code,
        "description": sanitize_text(payload.description or ""),
        "favorite": False,
        "pinned": False,
        "archived": False,
        "created_at": now,
        "updated_at": now,
        "versions": [
            {
                "version_id": 1,
                "code": snippet_code,
                "updated_at": now
            }
        ]
    }
    
    try:
        result = db.snippets.insert_one(snippet_doc)
        snippet_doc["_id"] = result.inserted_id
        return format_snippet(snippet_doc)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during snippet creation: {str(e)}"
        )

@router.get("/snippet/{id}")
async def get_snippet(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid snippet ID format.")
        
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snippet not found.")
        
    return format_snippet(snippet)

@router.put("/snippet/{id}")
async def update_snippet(id: str, payload: SnippetUpdateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid snippet ID format.")
        
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snippet not found or unauthorized.")
        
    update_data = {}
    
    if payload.title is not None:
        update_data["title"] = sanitize_text(payload.title)
        
    if payload.language is not None:
        lang_key = payload.language.lower().strip()
        if lang_key not in SUPPORTED_LANGUAGES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported language. Supported: {', '.join(SUPPORTED_LANGUAGES.values())}"
            )
        update_data["language"] = SUPPORTED_LANGUAGES[lang_key]
        
    if payload.tags is not None:
        update_data["tags"] = [sanitize_text(t) for t in payload.tags if t.strip()]
        
    if payload.description is not None:
        update_data["description"] = sanitize_text(payload.description)
        
    if payload.workspace_id is not None:
        try:
            update_data["workspace_id"] = ObjectId(payload.workspace_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid workspace ID.")
            
    if payload.collection_id is not None:
        if payload.collection_id in ("", "null", "none"):
            update_data["collection_id"] = None
        else:
            try:
                update_data["collection_id"] = ObjectId(payload.collection_id)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid collection ID.")
                
    if payload.pinned is not None:
        update_data["pinned"] = payload.pinned
        
    if payload.archived is not None:
        update_data["archived"] = payload.archived
        
    code_changed = False
    if payload.code is not None:
        snippet_code_new = sanitize_code_string(payload.code)
        if snippet_code_new != snippet.get("code", ""):
            update_data["code"] = snippet_code_new
            code_changed = True
            
    if not update_data and not code_changed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update.")
        
    now = datetime.utcnow()
    update_data["updated_at"] = now
    
    if code_changed:
        versions = snippet.get("versions", [])
        if not versions:
            versions = [{
                "version_id": 1,
                "code": snippet.get("code", ""),
                "updated_at": snippet.get("created_at", now)
            }]
        next_ver_id = max([v["version_id"] for v in versions]) + 1 if versions else 1
        versions.append({
            "version_id": next_ver_id,
            "code": update_data["code"],
            "updated_at": now
        })
        update_data["versions"] = versions
        
    try:
        db.snippets.update_one({"_id": obj_id}, {"$set": update_data})
        updated_doc = db.snippets.find_one({"_id": obj_id})
        return format_snippet(updated_doc)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during update: {str(e)}"
        )

@router.delete("/snippet/{id}")
async def delete_snippet(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid snippet ID format.")
        
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snippet not found or unauthorized.")
        
    try:
        db.snippets.delete_one({"_id": obj_id})
        return {"message": "Snippet deleted successfully."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during deletion: {str(e)}"
        )

@router.get("/search")
async def search_snippets(
    q: Optional[str] = None,
    language: Optional[str] = None,
    tag: Optional[str] = None,
    workspace_id: Optional[str] = None,
    collection_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    
    if workspace_id:
        try:
            ws_oid = ObjectId(workspace_id)
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid workspace ID.")
    else:
        ws = db.workspaces.find_one({"user_id": user_uid})
        ws_oid = ws["_id"] if ws else None
        
    query_filter = {"user_id": user_uid}
    if ws_oid:
        query_filter["workspace_id"] = ws_oid
        
    if collection_id:
        if collection_id in ("null", "none"):
            query_filter["collection_id"] = None
        else:
            try:
                query_filter["collection_id"] = ObjectId(collection_id)
            except Exception:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid collection ID.")
                
    if language:
        lang_key = language.lower().strip()
        if lang_key in SUPPORTED_LANGUAGES:
            query_filter["language"] = SUPPORTED_LANGUAGES[lang_key]
        else:
            query_filter["language"] = language
            
    if tag:
        query_filter["tags"] = sanitize_text(tag)
        
    projection = None
    sort_order = [("pinned", -1), ("created_at", -1)]
    
    if q and q.strip():
        search_query = q.strip()
        query_filter["$text"] = {"$search": search_query}
        projection = {"score": {"$meta": "textScore"}}
        sort_order = [("pinned", -1), ("score", {"$meta": "textScore"})]
        
    try:
        if projection:
            snippets_cursor = db.snippets.find(query_filter, projection).sort(sort_order)
        else:
            snippets_cursor = db.snippets.find(query_filter).sort(sort_order)
            
        results = [format_snippet(s) for s in snippets_cursor]
        
        if q and q.strip() and len(results) == 0:
            regex_filter = {
                "user_id": user_uid,
                "$or": [
                    {"title": {"$regex": search_query, "$options": "i"}},
                    {"tags": {"$regex": search_query, "$options": "i"}},
                    {"code": {"$regex": search_query, "$options": "i"}}
                ]
            }
            if ws_oid:
                regex_filter["workspace_id"] = ws_oid
            if collection_id:
                if collection_id in ("null", "none"):
                    regex_filter["collection_id"] = None
                else:
                    regex_filter["collection_id"] = ObjectId(collection_id)
                    
            if language:
                lang_key = language.lower().strip()
                regex_filter["language"] = SUPPORTED_LANGUAGES.get(lang_key, language)
            if tag:
                regex_filter["tags"] = sanitize_text(tag)
                
            snippets_cursor = db.snippets.find(regex_filter).sort([("pinned", -1), ("created_at", -1)])
            results = [format_snippet(s) for s in snippets_cursor]
            
        return results
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during search: {str(e)}"
        )

@router.post("/snippet/{id}/clone", status_code=status.HTTP_201_CREATED)
async def clone_snippet(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid snippet ID format.")
        
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snippet not found or unauthorized.")
        
    now = datetime.utcnow()
    cloned_doc = {
        "user_id": snippet["user_id"],
        "workspace_id": snippet.get("workspace_id"),
        "collection_id": snippet.get("collection_id"),
        "title": f"{snippet['title']} (Clone)",
        "language": snippet["language"],
        "tags": snippet["tags"],
        "code": snippet["code"],
        "description": snippet.get("description", ""),
        "favorite": False,
        "pinned": False,
        "archived": False,
        "created_at": now,
        "updated_at": now,
        "versions": [
            {
                "version_id": 1,
                "code": snippet["code"],
                "updated_at": now
            }
        ]
    }
    
    try:
        result = db.snippets.insert_one(cloned_doc)
        cloned_doc["_id"] = result.inserted_id
        return format_snippet(cloned_doc)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during cloning: {str(e)}"
        )

def interpret_simple_code(code: str, language: str) -> str:
    lang = language.lower().strip()
    outputs = []
    lines = code.splitlines()
    for line in lines:
        line_strip = line.strip()
        if line_strip.startswith("//") or line_strip.startswith("/*"):
            continue
        if lang in ("c++", "cpp"):
            matches = re.findall(r'cout\s*<<\s*["\'](.*?)(?<!\\)["\']', line_strip)
            if matches:
                outputs.append("".join(matches))
        elif lang == "c":
            matches = re.findall(r'printf\s*\(\s*["\'](.*?)(?<!\\)["\']', line_strip)
            if matches:
                for m in matches:
                    outputs.append(m.replace("\\n", "\n").replace("\\t", "\t"))
        elif lang == "java":
            matches = re.findall(r'System\.out\.print(?:ln)?\s*\(\s*["\'](.*?)(?<!\\)["\']', line_strip)
            if matches:
                outputs.append("\n".join(matches))
    if outputs:
        return "\n".join(outputs)
    return ""

@router.post("/snippets/run")
async def run_snippet(payload: SnippetRunSchema, current_user: dict = Depends(get_current_user)):
    import shutil
    lang_key = payload.language.lower().strip()
    code_to_run = payload.code
    stdin_data = payload.input or ""
    if lang_key == "python":
        with tempfile.NamedTemporaryFile(suffix=".py", delete=False) as f:
            f.write(code_to_run.encode("utf-8"))
            temp_file_path = f.name
        try:
            res = subprocess.run(
                [sys.executable, temp_file_path],
                input=stdin_data,
                capture_output=True,
                text=True,
                timeout=3
            )
            return {
                "stdout": res.stdout,
                "stderr": res.stderr,
                "exit_code": res.returncode
            }
        except subprocess.TimeoutExpired:
            return {
                "stdout": "",
                "stderr": "Execution timed out (3 seconds limit).",
                "exit_code": -1
            }
        except Exception as e:
            return {
                "stdout": "",
                "stderr": f"Execution error: {str(e)}",
                "exit_code": -1
            }
        finally:
            try:
                os.remove(temp_file_path)
            except Exception:
                pass
    elif lang_key in ("c++", "cpp"):
        gxx_path = shutil.which("g++")
        if gxx_path:
            with tempfile.NamedTemporaryFile(suffix=".cpp", delete=False) as f:
                f.write(code_to_run.encode("utf-8"))
                temp_src = f.name
            exe_name = temp_src + ".exe"
            try:
                compile_res = subprocess.run(
                    ["g++", temp_src, "-o", exe_name],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if compile_res.returncode != 0:
                    return {
                        "stdout": "",
                        "stderr": f"Compilation Error:\n{compile_res.stderr}",
                        "exit_code": compile_res.returncode
                    }
                run_res = subprocess.run(
                    [exe_name],
                    input=stdin_data,
                    capture_output=True,
                    text=True,
                    timeout=3
                )
                return {
                    "stdout": run_res.stdout,
                    "stderr": run_res.stderr,
                    "exit_code": run_res.returncode
                }
            except subprocess.TimeoutExpired:
                return {
                    "stdout": "",
                    "stderr": "Execution timed out (3 seconds limit).",
                    "exit_code": -1
                }
            except Exception as e:
                return {
                    "stdout": "",
                    "stderr": f"Error running compiler: {str(e)}",
                    "exit_code": -1
                }
            finally:
                for path in (temp_src, exe_name):
                    try:
                        os.remove(path)
                    except Exception:
                        pass
        else:
            output = interpret_simple_code(code_to_run, "cpp")
            if output:
                return {
                    "stdout": output,
                    "stderr": "",
                    "exit_code": 0
                }
            return {
                "stdout": "",
                "stderr": "C++ Compiler (g++) not found in system PATH. For simple code execution, ensure you use std::cout statement lines.",
                "exit_code": -1
            }
    elif lang_key == "c":
        gcc_path = shutil.which("gcc")
        if gcc_path:
            with tempfile.NamedTemporaryFile(suffix=".c", delete=False) as f:
                f.write(code_to_run.encode("utf-8"))
                temp_src = f.name
            exe_name = temp_src + ".exe"
            try:
                compile_res = subprocess.run(
                    ["gcc", temp_src, "-o", exe_name],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if compile_res.returncode != 0:
                    return {
                        "stdout": "",
                        "stderr": f"Compilation Error:\n{compile_res.stderr}",
                        "exit_code": compile_res.returncode
                    }
                run_res = subprocess.run(
                    [exe_name],
                    input=stdin_data,
                    capture_output=True,
                    text=True,
                    timeout=3
                )
                return {
                    "stdout": run_res.stdout,
                    "stderr": run_res.stderr,
                    "exit_code": run_res.returncode
                }
            except subprocess.TimeoutExpired:
                return {
                    "stdout": "",
                    "stderr": "Execution timed out (3 seconds limit).",
                    "exit_code": -1
                }
            except Exception as e:
                return {
                    "stdout": "",
                    "stderr": f"Error running compiler: {str(e)}",
                    "exit_code": -1
                }
            finally:
                for path in (temp_src, exe_name):
                    try:
                        os.remove(path)
                    except Exception:
                        pass
        else:
            output = interpret_simple_code(code_to_run, "c")
            if output:
                return {
                    "stdout": output,
                    "stderr": "",
                    "exit_code": 0
                }
            return {
                "stdout": "",
                "stderr": "C Compiler (gcc) not found in system PATH. For simple code execution, ensure you use printf statement lines.",
                "exit_code": -1
            }
    elif lang_key == "java":
        javac_path = shutil.which("javac")
        if javac_path:
            with tempfile.TemporaryDirectory() as temp_dir:
                class_name_match = re.search(r'class\s+(\w+)', code_to_run)
                class_name = class_name_match.group(1) if class_name_match else "Main"
                temp_src = os.path.join(temp_dir, f"{class_name}.java")
                with open(temp_src, "w", encoding="utf-8") as f:
                    f.write(code_to_run)
                try:
                    compile_res = subprocess.run(
                        ["javac", temp_src],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    if compile_res.returncode != 0:
                        return {
                            "stdout": "",
                            "stderr": f"Compilation Error:\n{compile_res.stderr}",
                            "exit_code": compile_res.returncode
                        }
                    run_res = subprocess.run(
                        ["java", "-cp", temp_dir, class_name],
                        input=stdin_data,
                        capture_output=True,
                        text=True,
                        timeout=3
                    )
                    return {
                        "stdout": run_res.stdout,
                        "stderr": run_res.stderr,
                        "exit_code": run_res.returncode
                    }
                except subprocess.TimeoutExpired:
                    return {
                        "stdout": "",
                        "stderr": "Execution timed out (3 seconds limit).",
                        "exit_code": -1
                    }
                except Exception as e:
                    return {
                        "stdout": "",
                        "stderr": f"Error running Java runtime: {str(e)}",
                        "exit_code": -1
                    }
        else:
            output = interpret_simple_code(code_to_run, "java")
            if output:
                return {
                    "stdout": output,
                    "stderr": "",
                    "exit_code": 0
                }
            return {
                "stdout": "",
                "stderr": "Java Compiler (javac) not found in system PATH. For simple code execution, ensure you use System.out.println statement lines.",
                "exit_code": -1
            }
    elif lang_key in ("javascript", "html", "css"):
        return {
            "stdout": "",
            "stderr": "Client-side execution",
            "exit_code": 0
        }
    else:
        return {
            "stdout": "",
            "stderr": f"Execution not supported for language '{payload.language}' on this system.",
            "exit_code": -1
        }

class UserProfileUpdateSchema(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = None

@router.post("/snippet/{id}/favorite")
async def toggle_favorite(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid snippet ID format.")
    
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snippet not found or unauthorized.")
    
    new_fav = not snippet.get("favorite", False)
    try:
        db.snippets.update_one({"_id": obj_id}, {"$set": {"favorite": new_fav}})
        return {"id": id, "favorite": new_fav}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error while updating favorite status: {str(e)}"
        )

@router.get("/snippets/stats")
async def get_snippet_stats(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = ObjectId(current_user["_id"])
    
    try:
        snippets = list(db.snippets.find({"user_id": user_id}))
        total_snippets = len(snippets)
        favorite_snippets = sum(1 for s in snippets if s.get("favorite", False))
        
        lang_distribution = {}
        for s in snippets:
            lang = s.get("language", "Unknown")
            lang_distribution[lang] = lang_distribution.get(lang, 0) + 1
            
        return {
            "total": total_snippets,
            "favorites": favorite_snippets,
            "languages": lang_distribution
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error while retrieving stats: {str(e)}"
        )

@router.put("/user/profile")
async def update_user_profile(payload: UserProfileUpdateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_id = ObjectId(current_user["_id"])
    update_data = {}
    
    if payload.email is not None:
        email = payload.email.strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="Email cannot be empty.")
        if "@" not in email:
            raise HTTPException(status_code=400, detail="Invalid email format.")
        
        existing = db.users.find_one({"email": email, "_id": {"$ne": user_id}})
        if existing:
            raise HTTPException(status_code=400, detail="Email is already in use by another user.")
        update_data["email"] = email
        
    if payload.password is not None:
        password = payload.password
        if len(password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters long.")
        if not any(c.isalpha() for c in password) or not any(c.isdigit() for c in password):
            raise HTTPException(status_code=400, detail="Password must contain at least one letter and one number.")
        update_data["password"] = hash_password(password)
        
    if not update_data:
        raise HTTPException(status_code=400, detail="No changes provided.")
        
    try:
        db.users.update_one({"_id": user_id}, {"$set": update_data})
        updated_user = db.users.find_one({"_id": user_id})
        return {
            "message": "Profile updated successfully.",
            "user": {
                "id": str(updated_user["_id"]),
                "username": updated_user["username"],
                "email": updated_user["email"]
            }
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Database error while updating profile: {str(e)}"
        )

# ==========================================
# NOTES ENDPOINTS
# ==========================================

@router.get("/notes")
async def get_notes(
    workspace_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    
    query = {"user_id": user_uid}
    if workspace_id:
        try:
            query["workspace_id"] = ObjectId(workspace_id)
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid workspace ID.")
            
    notes_cursor = db.notes.find(query).sort("updated_at", -1)
    return [format_note(n) for n in notes_cursor]

@router.post("/notes", status_code=status.HTTP_201_CREATED)
async def create_note(payload: NoteCreateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    
    try:
        ws_oid = ObjectId(payload.workspace_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid workspace ID.")
        
    clean_title = sanitize_text(payload.title)
    now = datetime.utcnow()
    
    note_doc = {
        "user_id": user_uid,
        "workspace_id": ws_oid,
        "title": clean_title,
        "content": payload.content,
        "created_at": now,
        "updated_at": now
    }
    
    try:
        result = db.notes.insert_one(note_doc)
        note_doc["_id"] = result.inserted_id
        return format_note(note_doc)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during note creation: {str(e)}"
        )

@router.get("/note/{id}")
async def get_note(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid note ID format.")
        
    note = db.notes.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")
        
    return format_note(note)

@router.put("/note/{id}")
async def update_note(id: str, payload: NoteUpdateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid note ID format.")
        
    note = db.notes.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found or unauthorized.")
        
    update_data = {}
    if payload.title is not None:
        update_data["title"] = sanitize_text(payload.title)
    if payload.content is not None:
        update_data["content"] = payload.content
        
    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields provided to update.")
        
    now = datetime.utcnow()
    update_data["updated_at"] = now
    
    try:
        db.notes.update_one({"_id": obj_id}, {"$set": update_data})
        updated_doc = db.notes.find_one({"_id": obj_id})
        return format_note(updated_doc)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during note update: {str(e)}"
        )

@router.delete("/note/{id}")
async def delete_note(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid note ID format.")
        
    note = db.notes.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found or unauthorized.")
        
    try:
        db.notes.delete_one({"_id": obj_id})
        return {"message": "Note deleted successfully."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error during note deletion: {str(e)}"
        )

# ==========================================
# WORKSPACE & COLLECTIONS ENDPOINTS
# ==========================================

@router.get("/workspaces")
async def get_workspaces(current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    cursor = db.workspaces.find({"user_id": user_uid}).sort("created_at", 1)
    workspaces = []
    for w in cursor:
        workspaces.append({
            "id": str(w["_id"]),
            "name": w["name"],
            "created_at": w["created_at"].isoformat()
        })
    if not workspaces:
        now = datetime.utcnow()
        ws_id = db.workspaces.insert_one({
            "user_id": user_uid,
            "name": "Personal Workspace",
            "created_at": now
        }).inserted_id
        workspaces.append({
            "id": str(ws_id),
            "name": "Personal Workspace",
            "created_at": now.isoformat()
        })
    return workspaces

@router.post("/workspaces")
async def create_workspace(payload: WorkspaceCreateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    name_clean = sanitize_text(payload.name)
    
    existing = db.workspaces.find_one({"user_id": user_uid, "name": name_clean})
    if existing:
        raise HTTPException(status_code=400, detail="Workspace name already exists.")
        
    doc = {
        "user_id": user_uid,
        "name": name_clean,
        "created_at": datetime.utcnow()
    }
    db.workspaces.insert_one(doc)
    return {
        "id": str(doc["_id"]),
        "name": doc["name"],
        "created_at": doc["created_at"].isoformat()
    }

@router.delete("/workspace/{id}")
async def delete_workspace(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        ws_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid workspace ID format.")
        
    user_uid = ObjectId(current_user["_id"])
    ws = db.workspaces.find_one({"_id": ws_oid, "user_id": user_uid})
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found or unauthorized.")
        
    count = db.workspaces.count_documents({"user_id": user_uid})
    if count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete your only workspace.")
        
    db.workspaces.delete_one({"_id": ws_oid})
    db.collections.delete_many({"workspace_id": ws_oid})
    db.snippets.delete_many({"workspace_id": ws_oid})
    db.notes.delete_many({"workspace_id": ws_oid})
    
    return {"message": "Workspace and all scoped snippets deleted successfully."}

@router.put("/workspace/{id}")
async def update_workspace(id: str, payload: WorkspaceUpdateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        ws_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid workspace ID format.")
        
    user_uid = ObjectId(current_user["_id"])
    ws = db.workspaces.find_one({"_id": ws_oid, "user_id": user_uid})
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found or unauthorized.")
        
    name_clean = sanitize_text(payload.name)
    existing = db.workspaces.find_one({"user_id": user_uid, "name": name_clean, "_id": {"$ne": ws_oid}})
    if existing:
        raise HTTPException(status_code=400, detail="Workspace name already exists.")
        
    db.workspaces.update_one({"_id": ws_oid}, {"$set": {"name": name_clean}})
    return {"id": id, "name": name_clean}

@router.get("/collections")
async def get_collections(workspace_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    query = {"user_id": user_uid}
    if workspace_id:
        try:
            query["workspace_id"] = ObjectId(workspace_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid workspace ID.")
            
    cursor = db.collections.find(query).sort("name", 1)
    collections = []
    for c in cursor:
        collections.append({
            "id": str(c["_id"]),
            "workspace_id": str(c["workspace_id"]),
            "name": c["name"],
            "created_at": c["created_at"].isoformat()
        })
    return collections

@router.post("/collections")
async def create_collection(payload: CollectionCreateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    try:
        ws_oid = ObjectId(payload.workspace_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid workspace ID.")
        
    name_clean = sanitize_text(payload.name)
    existing = db.collections.find_one({"user_id": user_uid, "workspace_id": ws_oid, "name": name_clean})
    if existing:
        raise HTTPException(status_code=400, detail="Collection name already exists in this workspace.")
        
    doc = {
        "user_id": user_uid,
        "workspace_id": ws_oid,
        "name": name_clean,
        "created_at": datetime.utcnow()
    }
    db.collections.insert_one(doc)
    return {
        "id": str(doc["_id"]),
        "workspace_id": str(doc["workspace_id"]),
        "name": doc["name"],
        "created_at": doc["created_at"].isoformat()
    }

@router.delete("/collection/{id}")
async def delete_collection(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        coll_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid collection ID.")
        
    user_uid = ObjectId(current_user["_id"])
    coll = db.collections.find_one({"_id": coll_oid, "user_id": user_uid})
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found or unauthorized.")
        
    db.collections.delete_one({"_id": coll_oid})
    db.snippets.update_many({"collection_id": coll_oid}, {"$set": {"collection_id": None}})
    
    return {"message": "Collection deleted successfully. Snippets moved to root."}

@router.put("/collection/{id}")
async def update_collection(id: str, payload: CollectionUpdateSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        coll_oid = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid collection ID format.")
        
    user_uid = ObjectId(current_user["_id"])
    coll = db.collections.find_one({"_id": coll_oid, "user_id": user_uid})
    if not coll:
        raise HTTPException(status_code=404, detail="Collection not found or unauthorized.")
        
    name_clean = sanitize_text(payload.name)
    existing = db.collections.find_one({
        "user_id": user_uid, 
        "workspace_id": coll["workspace_id"], 
        "name": name_clean, 
        "_id": {"$ne": coll_oid}
    })
    if existing:
        raise HTTPException(status_code=400, detail="Collection name already exists in this workspace.")
        
    db.collections.update_one({"_id": coll_oid}, {"$set": {"name": name_clean}})
    return {"id": id, "name": name_clean}

# ==========================================
# MODIFIERS (PIN, ARCHIVE, VERSIONS)
# ==========================================

@router.post("/snippet/{id}/pin")
async def toggle_pin_snippet(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid snippet ID.")
        
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found or unauthorized.")
        
    new_pinned = not snippet.get("pinned", False)
    db.snippets.update_one({"_id": obj_id}, {"$set": {"pinned": new_pinned, "updated_at": datetime.utcnow()}})
    return {"id": id, "pinned": new_pinned}

@router.post("/snippet/{id}/archive")
async def toggle_archive_snippet(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid snippet ID.")
        
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found or unauthorized.")
        
    new_archived = not snippet.get("archived", False)
    db.snippets.update_one({"_id": obj_id}, {"$set": {"archived": new_archived, "updated_at": datetime.utcnow()}})
    return {"id": id, "archived": new_archived}

@router.get("/snippet/{id}/versions")
async def get_snippet_versions(id: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid snippet ID.")
        
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found or unauthorized.")
        
    versions = snippet.get("versions", [])
    formatted_versions = []
    for v in versions:
        formatted_versions.append({
            "version_id": v["version_id"],
            "code": v["code"],
            "updated_at": v["updated_at"].isoformat() if isinstance(v["updated_at"], datetime) else v["updated_at"]
        })
    return formatted_versions

@router.post("/snippet/{id}/versions/{version_id}/restore")
async def restore_snippet_version(id: str, version_id: int, current_user: dict = Depends(get_current_user)):
    db = get_db()
    try:
        obj_id = ObjectId(id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid snippet ID.")
        
    snippet = db.snippets.find_one({"_id": obj_id, "user_id": ObjectId(current_user["_id"])})
    if not snippet:
        raise HTTPException(status_code=404, detail="Snippet not found or unauthorized.")
        
    versions = snippet.get("versions", [])
    target_version = next((v for v in versions if v["version_id"] == version_id), None)
    if not target_version:
        raise HTTPException(status_code=404, detail="Version not found.")
        
    now = datetime.utcnow()
    next_ver_id = max([v["version_id"] for v in versions]) + 1 if versions else 1
    versions.append({
        "version_id": next_ver_id,
        "code": target_version["code"],
        "updated_at": now
    })
    
    db.snippets.update_one(
        {"_id": obj_id},
        {"$set": {"code": target_version["code"], "versions": versions, "updated_at": now}}
    )
    
    updated_doc = db.snippets.find_one({"_id": obj_id})
    return format_snippet(updated_doc)

# ==========================================
# LOCAL AI ANALYSIS ENDPOINT
# ==========================================

@router.post("/snippets/ai-analyze")
async def ai_analyze_snippet(payload: SnippetAIAnalyzeSchema, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user_uid = ObjectId(current_user["_id"])
    
    other_snippets = list(db.snippets.find({"user_id": user_uid}))
    
    from ai_analyzer import run_ai_analysis
    analysis = run_ai_analysis(payload.code, payload.language, other_snippets, payload.id)
    return analysis
