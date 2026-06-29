import os
import re
import jwt
import bcrypt
from datetime import datetime, timedelta
from fastapi import Request, HTTPException, status
from bson import ObjectId
from database import get_db

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "scriptvault-jwt-secret-key-2024")
ALGO = "HS256"
TOKEN_EXPIRE = 1440

def hash_password(pw):
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pw.encode('utf-8'), salt).decode('utf-8')

def verify_password(pw, hashed):
    try:
        return bcrypt.checkpw(pw.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False

def create_access_token(data):
    payload = data.copy()
    exp = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE)
    payload["exp"] = exp.timestamp()
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGO)

def verify_token(token):
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=[ALGO])
        if "exp" in data:
            if datetime.utcfromtimestamp(data["exp"]) < datetime.utcnow():
                return None
        return data
    except jwt.PyJWTError:
        return None

def validate_registration(username, email, password):
    if not re.match(r"^[a-zA-Z0-9_]{3,20}$", username):
        return "Username must be 3-20 chars, only letters/numbers/underscore."
    if not re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email):
        return "That email doesn't look right."
    if not re.match(r"^(?=.*[A-Za-z])(?=.*\d).{8,}$", password):
        return "Password needs 8+ chars with at least one letter and one number."
    return None

async def get_current_user(request: Request):
    token = None
    auth = request.headers.get("Authorization")
    if auth and auth.startswith("Bearer "):
        token = auth.split(" ")[1]

    if not token:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not logged in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    data = verify_token(token)
    if not data or "sub" not in data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token invalid or expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    uid = data["sub"]
    try:
        db = get_db()
        user = db.users.find_one({"_id": ObjectId(uid)})
    except Exception:
        user = None

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )

    user["_id"] = str(user["_id"])
    return user
