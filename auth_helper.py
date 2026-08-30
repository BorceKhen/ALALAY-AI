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
firebase_init_error = None


def init_firebase_admin():
    """Initializes Firebase Admin SDK supporting raw JSON, Base64 JSON, or file path."""
    global firebase_init_error, firebase_db
    
    if firebase_admin._apps:
        return True
        
    # 1. Try FIREBASE_CREDENTIALS_JSON (Raw JSON, Base64, certutil, escaped)
    cred_json_str = os.environ.get("FIREBASE_CREDENTIALS_JSON")
    if cred_json_str and str(cred_json_str).strip():
        try:
            import json, base64
            s = str(cred_json_str).strip()
            
            # Clean PEM / certutil header lines if present
            if "-----BEGIN" in s:
                lines = [line.strip() for line in s.splitlines() if not line.startswith("-----")]
                s = "".join(lines).strip()
                
            # Strip wrapping quotes
            while (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
                s = s[1:-1].strip()
                
            cred_dict = None

            # A. Try Base64 decoding FIRST (primary method). Railway env vars
            # store the service account JSON as base64 so it can be safely
            # passed through the platform without shell/quoting issues.
            try:
                cleaned_b64 = "".join(s.split())
                decoded = base64.b64decode(cleaned_b64).decode("utf-8")
                while (decoded.startswith('"') and decoded.endswith('"')) or (decoded.startswith("'") and decoded.endswith("'")):
                    decoded = decoded[1:-1].strip()
                print(f"[Firebase-Backend] Base64 decode succeeded. decoded_length={len(decoded)} preview={decoded[:30]!r}")
                parsed = json.loads(decoded)
                if isinstance(parsed, str):
                    parsed = json.loads(parsed)
                if isinstance(parsed, dict) and "private_key" in parsed:
                    cred_dict = parsed
                    print(f"[Firebase-Backend] Base64-decoded JSON parsed successfully. project_id={parsed.get('project_id')} client_email={parsed.get('client_email')}")
                else:
                    print("[Firebase-Backend] Base64-decoded JSON parsed but is missing the 'private_key' field.")
            except (ValueError, TypeError) as e:
                # Covers binascii.Error (subclass of ValueError) for invalid base64 padding/characters
                print(f"[Firebase-Backend] Base64 decode step failed (input is not valid base64): {e}")
            except json.JSONDecodeError as e:
                print(f"[Firebase-Backend] Base64 decoded successfully, but JSON parsing of the decoded string failed: {e}")
            except Exception as e:
                print(f"[Firebase-Backend] Unexpected error during base64 decode/parse step: {e}")

            # B. Fallback: Try direct JSON parsing (in case raw JSON was passed unencoded)
            if not cred_dict and s.startswith("{"):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, str):
                        parsed = json.loads(parsed)
                    if isinstance(parsed, dict) and "private_key" in parsed:
                        cred_dict = parsed
                        print("[Firebase-Backend] Fell back to direct (non-base64) JSON parsing successfully.")
                except Exception as e:
                    print(f"[Firebase-Backend] Fallback direct JSON parsing failed: {e}")

            # C. Fallback: Try unicode escape decode (handles escaped JSON strings)
            if not cred_dict:
                try:
                    unescaped = s.encode("utf-8").decode("unicode_escape")
                    parsed = json.loads(unescaped)
                    if isinstance(parsed, dict) and "private_key" in parsed:
                        cred_dict = parsed
                        print("[Firebase-Backend] Fell back to unicode-escape JSON parsing successfully.")
                except Exception as e:
                    print(f"[Firebase-Backend] Fallback unicode-escape parsing failed: {e}")

                 
            if isinstance(cred_dict, dict) and "private_key" in cred_dict:
                if isinstance(cred_dict["private_key"], str):
                    cred_dict["private_key"] = cred_dict["private_key"].replace("\\n", "\n")
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred)
                firebase_init_error = None
                print("[Firebase-Backend] Admin SDK initialized successfully using FIREBASE_CREDENTIALS_JSON env var.")
                return True
            else:
                firebase_init_error = "Unable to parse FIREBASE_CREDENTIALS_JSON into valid service account credentials."
                print(f"[Firebase-Backend] Error: {firebase_init_error}")
        except Exception as e:
            firebase_init_error = f"Error initializing from FIREBASE_CREDENTIALS_JSON: {e}"
            print(f"[Firebase-Backend] {firebase_init_error}")

    # 2. Try credentials file path
    if not firebase_admin._apps:
        cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH", "firebase-credentials.json")
        if not os.path.isabs(cred_path):
            cred_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), cred_path)
            
        if os.path.exists(cred_path):
            try:
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
                firebase_init_error = None
                print(f"[Firebase-Backend] Admin SDK initialized successfully using: {cred_path}")
                return True
            except Exception as e:
                firebase_init_error = f"Error initializing from credentials file ({cred_path}): {e}"
                print(f"[Firebase-Backend] {firebase_init_error}")
        else:
            if not firebase_init_error:
                firebase_init_error = f"Credentials file not found at {cred_path} and FIREBASE_CREDENTIALS_JSON env var is missing or invalid."
            print(f"[Firebase-Backend] Warning: {firebase_init_error}")
            
    return bool(firebase_admin._apps)


# Run initialization on import
init_firebase_admin()


def get_db():
    """Returns the Firestore client instance."""
    global firebase_db
    if not firebase_admin._apps:
        init_firebase_admin()
        
    if firebase_db is None and firebase_admin._apps:
        try:
            firebase_db = firestore.client()
        except Exception as e:
            print(f"[Firebase-Backend] Error getting Firestore client: {e}")
    return firebase_db


def get_firebase_status():
    """Returns detailed diagnostic status about Firebase Admin SDK."""
    db = get_db()
    return {
        "admin_sdk_initialized": bool(firebase_admin._apps),
        "init_error": firebase_init_error,
        "firestore_client_ready": db is not None,
        "has_credentials_env": bool(os.environ.get("FIREBASE_CREDENTIALS_JSON")),
        "credentials_path_checked": os.environ.get("FIREBASE_CREDENTIALS_PATH", "firebase-credentials.json"),
        "firebase_project_id": os.environ.get("FIREBASE_PROJECT_ID", "")
    }


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

