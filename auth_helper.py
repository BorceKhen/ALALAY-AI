# -------------------------------------------------------------
# auth_helper.py: Flask-Firebase Backend Verification Scaffold
# -------------------------------------------------------------

import os
from functools import wraps
from flask import request, jsonify, session, redirect, url_for

# Load local environment variables from .env file securely
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_env_path):
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        with open(_env_path, "r", encoding="utf-8") as _f:
            for _line in _f:
                if _line.strip() and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.strip().split("=", 1)
                    os.environ[_k.strip()] = _v.strip()

# Initialize Firebase Admin SDK
import firebase_admin
from firebase_admin import credentials, auth, firestore

firebase_db = None

# Only initialize once to avoid duplicate app errors
if not firebase_admin._apps:
    cred_json_str = os.environ.get("FIREBASE_CREDENTIALS_JSON")
    if cred_json_str:
        try:
            import json
            cred_dict = json.loads(cred_json_str)
            cred = credentials.Certificate(cred_dict)
            firebase_admin.initialize_app(cred)
            print("[Firebase-Backend] Admin SDK initialized successfully using FIREBASE_CREDENTIALS_JSON env var.")
        except Exception as e:
            print(f"[Firebase-Backend] Error initializing Firebase SDK from FIREBASE_CREDENTIALS_JSON: {e}")
    
    if not firebase_admin._apps:
        cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH", "firebase-credentials.json")
        if not os.path.isabs(cred_path):
            cred_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), cred_path)
            
        if os.path.exists(cred_path):
            try:
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
                print(f"[Firebase-Backend] Admin SDK initialized successfully using: {cred_path}")
            except Exception as e:
                print(f"[Firebase-Backend] Error initializing Firebase SDK: {e}")
        else:
            print(f"[Firebase-Backend] Warning: Credentials file not found at {cred_path}")


def get_db():
    """Returns the Firestore client instance."""
    global firebase_db
    if firebase_db is None:
        try:
            firebase_db = firestore.client()
        except Exception as e:
            print(f"[Firebase-Backend] Error getting Firestore client: {e}")
    return firebase_db


def login_required(f):
    """
    Flask decorator to protect routes. 
    Verifies the active Firebase user session ID token.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # 1. Check Flask server-side session first
        user = session.get("user")
        
        # 2. Check HTTP Authorization header (useful for APIs)
        auth_header = request.headers.get("Authorization")
        if not user and auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            try:
                # Retrieve and verify user session from Firebase
                decoded_token = auth.verify_id_token(token)
                user = {
                    "id": decoded_token["uid"],
                    "email": decoded_token.get("email")
                }
                session["user"] = user
            except Exception as e:
                print(f"[Firebase-Backend] Token validation failed: {e}")
                return jsonify({"success": False, "error": "Invalid auth token"}), 401
        
        if not user:
            # If it's an API/profile request or expects JSON (via AJAX), return a 401 JSON error instead of redirecting.
            # Avoid using accept_json directly as it matches wildcard '*/*' sent by default in Android WebViews.
            is_json_request = (
                request.path.startswith('/profile/') or 
                request.path.startswith('/api/') or 
                request.headers.get('X-Requested-With') == 'XMLHttpRequest' or
                (request.accept_mimetypes.accept_json and not request.accept_mimetypes.accept_html)
            )
            if is_json_request:
                return jsonify({"success": False, "error": "Authentication required"}), 401
                
            # Not authenticated, redirect to login page
            return redirect(url_for('auth'))
            
        return f(*args, **kwargs)
    return decorated_function


def fetch_user_profile(user_id: str):
    """
    Fetches custom user profile metadata (disability, gender, birthdate) 
    from the firestore 'profiles' collection.
    """
    db = get_db()
    if not db:
        return {"error": "Firestore client not initialized."}
        
    try:
        doc_ref = db.collection("profiles").document(user_id)
        doc = doc_ref.get()
        if doc.exists:
            return doc.to_dict()
        return None
    except Exception as e:
        print(f"[Firebase-Backend] Error fetching user profile: {e}")
        return {"error": str(e)}
