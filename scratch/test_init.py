import os
import json
import base64
import firebase_admin
from firebase_admin import credentials, firestore

init_error = None

def init_firebase():
    global init_error
    if firebase_admin._apps:
        return True
        
    cred_json_str = os.environ.get("FIREBASE_CREDENTIALS_JSON")
    if cred_json_str:
        cred_json_str = cred_json_str.strip()
        # Handle quotes wrapped around string
        if (cred_json_str.startswith("'") and cred_json_str.endswith("'")) or \
           (cred_json_str.startswith('"') and cred_json_str.endswith('"') and not cred_json_str.startswith('{"')):
            cred_json_str = cred_json_str[1:-1].strip()
            
        # Check if base64 encoded
        if not cred_json_str.startswith("{"):
            try:
                cred_json_str = base64.b64decode(cred_json_str).decode("utf-8")
            except Exception as b64_err:
                init_error = f"Base64 decode failed: {b64_err}"
                
        try:
            cred_dict = json.loads(cred_json_str)
            # If double encoded string
            if isinstance(cred_dict, str):
                cred_dict = json.loads(cred_dict)
                
            if isinstance(cred_dict, dict) and "private_key" in cred_dict:
                cred_dict["private_key"] = cred_dict["private_key"].replace("\\n", "\n")
                cred = credentials.Certificate(cred_dict)
                firebase_admin.initialize_app(cred)
                print("[Firebase-Backend] Admin SDK initialized successfully using FIREBASE_CREDENTIALS_JSON env var.")
                return True
            else:
                init_error = f"Parsed JSON is not a valid service account dict: type={type(cred_dict)}"
        except Exception as e:
            init_error = f"Error initializing from FIREBASE_CREDENTIALS_JSON: {e}"
            print(f"[Firebase-Backend] {init_error}")
            
    cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH", "firebase-credentials.json")
    if not os.path.isabs(cred_path):
        cred_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", cred_path)
        
    if os.path.exists(cred_path):
        try:
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
            print(f"[Firebase-Backend] Admin SDK initialized successfully using: {cred_path}")
            return True
        except Exception as e:
            init_error = f"Error initializing from credentials file: {e}"
            print(f"[Firebase-Backend] {init_error}")
    else:
        if not init_error:
            init_error = f"Credentials file not found at {cred_path} and FIREBASE_CREDENTIALS_JSON was not provided."
        print(f"[Firebase-Backend] {init_error}")
        
    return False

if __name__ == "__main__":
    success = init_firebase()
    print("Init success:", success)
    print("Init error:", init_error)
