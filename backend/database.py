import os
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = "scriptvault"

_client = None

def get_db():
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        try:
            _client.admin.command("ping")
        except ConnectionFailure:
            _client = None
            raise RuntimeError("MongoDB not running bro")
    return _client[DB_NAME]

def init_db():
    db = get_db()

    existing = [i["name"] for i in db.snippets.list_indexes()]
    if "snippet_text_index" in existing:
        db.snippets.drop_index("snippet_text_index")

    db.snippets.create_index(
        [("title", "text"), ("code", "text"), ("tags", "text")],
        name="snippet_text_index",
        weights={"title": 10, "tags": 5, "code": 1},
        language_override="none"
    )

    user_idx = [i["name"] for i in db.users.list_indexes()]
    if "username_1" not in user_idx:
        db.users.create_index("username", unique=True)
    if "email_1" not in user_idx:
        db.users.create_index("email", unique=True)
