import os
import json
import firebase_admin
from firebase_admin import credentials, firestore

cred_path = "firebase-credentials.json"
if os.path.exists(cred_path):
    cred = credentials.Certificate(cred_path)
    if not firebase_admin._apps:
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    
    print("=== FIRESTORE USERS ===")
    users_ref = db.collection("users")
    user_docs = list(users_ref.stream())
    print(f"Total user documents in 'users' collection: {len(user_docs)}")
    for udoc in user_docs:
        print(f"User ID: {udoc.id}")
        decks_ref = db.collection("users").document(udoc.id).collection("decks")
        decks = list(decks_ref.stream())
        print(f"   -> Decks count: {len(decks)}")
        for d in decks:
            print(f"      - Deck: {d.id}")
            
    print("\n=== FIRESTORE PROFILES ===")
    profiles_ref = db.collection("profiles")
    prof_docs = list(profiles_ref.stream())
    print(f"Total profile documents in 'profiles' collection: {len(prof_docs)}")
    for pdoc in prof_docs:
        print(f"Profile ID: {pdoc.id} => Data: {pdoc.to_dict()}")
else:
    print(f"Credentials file {cred_path} not found!")
