from flask import Flask, render_template, redirect, url_for, request, jsonify, session
import os
import json
import re
from auth_helper import login_required, fetch_user_profile, get_db

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

from werkzeug.middleware.proxy_fix import ProxyFix

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "super-secret-key-alalay-ai-12345")
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = False
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = 604800

# Fix reverse proxy headers (X-Forwarded-Proto / Host) on Azure App Service
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1, x_prefix=1)

# ── Upload configuration ────────────────────────────────────
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'pptx'}

# ── T5 LoRA adapter path ────────────────────────────────────
T5_ADAPTER_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "t5 squad finetuned", "SQuAD Finetuned", "t5squad_finetuned_sciq"
)


def allowed_file(filename: str) -> bool:
    """Check if the uploaded file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def load_user_decks(user_id: str) -> list:
    """Load decks for a specific user strictly from Firebase Cloud Firestore."""
    db = get_db()
    if not db or not user_id:
        print(f"[Firestore] Unable to load decks: db={db is not None}, user_id={user_id}")
        return []
    try:
        decks_ref = db.collection("users").document(user_id).collection("decks")
        docs = list(decks_ref.stream())
        decks = []
        for doc in docs:
            deck_data = doc.to_dict()
            deck_data['doc_id'] = doc.id
            if 'name' not in deck_data:
                deck_data['name'] = doc.id
            decks.append(deck_data)
        print(f"[Firestore] Loaded {len(decks)} decks for user_id={user_id}")
        return decks
    except Exception as e:
        print(f"[Firestore] Error loading decks from Firestore for user {user_id}: {e}")
        return []


def save_user_deck(user_id: str, deck: dict):
    """Save a single deck to a user's Firestore decks collection."""
    db = get_db()
    if not db or not user_id or not deck.get('name'):
        return
    try:
        # Sanitize deck to prevent Firestore "Nested arrays are not allowed" error
        import copy
        sanitized_deck = copy.deepcopy(deck)
        
        # 1. Clean 'cards' array
        if 'cards' in sanitized_deck and isinstance(sanitized_deck['cards'], list):
            cleaned_cards = []
            for card in sanitized_deck['cards']:
                if isinstance(card, dict):
                    cleaned_card = {}
                    for k, v in card.items():
                        if isinstance(v, (list, tuple)):
                            cleaned_card[str(k)] = "; ".join(str(x) for x in v)
                        elif isinstance(v, dict):
                            cleaned_card[str(k)] = json.dumps(v)
                        else:
                            cleaned_card[str(k)] = str(v)
                    
                    if 'question' not in cleaned_card:
                        cleaned_card['question'] = ""
                    if 'answer' not in cleaned_card:
                        cleaned_card['answer'] = ""
                    cleaned_cards.append(cleaned_card)
                elif isinstance(card, (list, tuple)):
                    q = str(card[0]) if len(card) > 0 else ""
                    a = "; ".join(str(x) for x in card[1:]) if len(card) > 1 else ""
                    cleaned_cards.append({"question": q, "answer": a})
                else:
                    cleaned_cards.append({"question": str(card), "answer": ""})
            sanitized_deck['cards'] = cleaned_cards

        # 2. Clean 'quiz_items' array
        if 'quiz_items' in sanitized_deck and isinstance(sanitized_deck['quiz_items'], list):
            cleaned_quiz = []
            for item in sanitized_deck['quiz_items']:
                if isinstance(item, dict):
                    cleaned_item = {}
                    cleaned_item['question'] = str(item.get('question', ''))
                    cleaned_item['correct_answer'] = str(item.get('correct_answer', ''))
                    
                    cleaned_options = []
                    options = item.get('options', [])
                    if isinstance(options, list):
                        for opt in options:
                            if isinstance(opt, dict):
                                cleaned_opt = {}
                                for k, v in opt.items():
                                    if isinstance(v, (list, tuple)):
                                        cleaned_opt[str(k)] = "; ".join(str(x) for x in v)
                                    elif isinstance(v, dict):
                                        cleaned_opt[str(k)] = json.dumps(v)
                                    else:
                                        cleaned_opt[str(k)] = v
                                cleaned_options.append(cleaned_opt)
                            else:
                                cleaned_options.append({"text": str(opt), "is_correct": False})
                    cleaned_item['options'] = cleaned_options
                    cleaned_quiz.append(cleaned_item)
            sanitized_deck['quiz_items'] = cleaned_quiz

        deck_name = sanitized_deck['name']
        deck_ref = db.collection("users").document(user_id).collection("decks").document(deck_name)
        deck_ref.set(sanitized_deck)
        print(f"Deck '{deck_name}' saved successfully in Firestore for user {user_id}.")
    except Exception as e:
        print(f"Error saving deck to Firestore: {e}")



def simplify_deck_name(filename: str, max_length: int = 30) -> str:
    """
    Simplifies a filename into a clean, short deck name.
    - Strips the file extension
    - Replaces underscores, hyphens, dots with spaces
    - Removes redundant numbering prefixes (e.g., "Module-3-", "Chapter_01_")
    - Title-cases the result
    - Truncates with '...' if still too long
    """
    # Remove extension
    name = os.path.splitext(filename)[0]

    # Replace separators with spaces
    name = re.sub(r'[_\-\.]+', ' ', name)

    # Remove common prefixes like "CMSC 314 Module 3" → keep meaningful part
    # But keep the subject code if it's short enough
    name = re.sub(r'^\s*\d+\s*', '', name)  # Leading pure numbers

    # Clean up multiple spaces
    name = re.sub(r'\s+', ' ', name).strip()

    # Title case
    name = name.title()

    # Truncate if too long
    if len(name) > max_length:
        name = name[:max_length - 3].rstrip() + '...'

    return name


# ── Deck color palette for new decks ────────────────────────
DECK_COLORS = [
    '#FFE0B2', '#F8BBD0', '#DCEDC8', '#B3E5FC', '#E1BEE7',
    '#FFD180', '#FF8A80', '#B2DFDB', '#C5CAE9', '#FFF9C4'
]


# ── Firebase credentials ────────────────────────────────────
FIREBASE_API_KEY = os.environ.get("FIREBASE_API_KEY", "")
FIREBASE_AUTH_DOMAIN = os.environ.get("FIREBASE_AUTH_DOMAIN", "")
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "")
FIREBASE_STORAGE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET", "")
FIREBASE_MESSAGING_SENDER_ID = os.environ.get("FIREBASE_MESSAGING_SENDER_ID", "")
FIREBASE_APP_ID = os.environ.get("FIREBASE_APP_ID", "")


@app.route('/')
@app.route('/auth')
def auth():
    # Renders authentication.html with credentials passed to frontend
    return render_template('authentication.html', 
                           firebase_api_key=FIREBASE_API_KEY, 
                           firebase_auth_domain=FIREBASE_AUTH_DOMAIN,
                           firebase_project_id=FIREBASE_PROJECT_ID,
                           firebase_storage_bucket=FIREBASE_STORAGE_BUCKET,
                           firebase_messaging_sender_id=FIREBASE_MESSAGING_SENDER_ID,
                           firebase_app_id=FIREBASE_APP_ID)

@app.route('/login', methods=['POST'])
def login():
    # Sync server-side session with client-side Firebase authentication
    try:
        data = request.get_json() or {}
        user_data = data.get("user")
        if user_data:
            session.permanent = True
            session["user"] = user_data
            return jsonify({"success": True})
        return jsonify({"success": False, "error": "No user payload"}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.route('/logout', methods=['POST', 'GET'])
def logout():
    session.clear()
    if request.method == 'POST':
        return jsonify({"success": True})
    return redirect(url_for('auth'))

@app.context_processor
def inject_user_settings():
    """Injects user profile accessibility settings globally into all HTML templates."""
    user = session.get("user")
    if not user:
        return {}
        
    user_id = user.get("id")
    db = get_db()
    if not db:
        return {}
        
    try:
        profile_ref = db.collection("profiles").document(user_id)
        profile_doc = profile_ref.get()
        
        # Load user decks for sidebar!
        decks = load_user_decks(user_id)
        # Slicing the latest 3 decks
        recent_decks = list(reversed(decks))[:3]
        
        if profile_doc.exists:
            profile_data = profile_doc.to_dict()
            recommended = profile_data.get("recommended_settings", {})
            return {
                "user_recommended_settings": recommended,
                "user_profile": profile_data,
                "sidebar_decks": recent_decks,
                "user_state": profile_data.get("current_behavioral_state", "Normal")
            }
        else:
            return {
                "sidebar_decks": recent_decks,
                "user_state": "Normal"
            }
    except Exception as e:
        import traceback
        with open("debug_error.log", "a") as f:
            f.write(f"Error in context processor: {e}\n")
            traceback.print_exc(file=f)
        print(f"[Context Processor] Error: {e}")
        
    return {}


@app.route('/home')
@login_required
def home():
    # Renders home.html inside the base layout
    return render_template('home.html')

@app.route('/decks')
@login_required
def my_decks():
    # Renders my_decks.html with user-scoped decks
    user_id = session.get("user", {}).get("id")
    decks = load_user_decks(user_id)
    return render_template('my_decks.html', decks=decks)

@app.route('/flashcard')
@login_required
def flashcard():
    # Default flashcard page (no specific deck)
    return render_template('flashcard.html',
                           deck_name='Flashcards',
                           deck_color='#D8C8FF',
                           cards=[],
                           card_count=0)

@app.route('/flashcard/<path:deck_name>')
@login_required
def flashcard_deck(deck_name):
    """Renders the flashcard page for a specific generated deck."""
    user_id = session.get("user", {}).get("id")
    decks = load_user_decks(user_id)

    # Find the matching deck
    deck = None
    for d in decks:
        if d.get('name') == deck_name:
            deck = d
            break

    if deck is None:
        # Deck not found, redirect to My Decks
        return redirect(url_for('my_decks'))

    cards = deck.get('cards', [])

    # Check if user settings recommended content level is set to "easy"
    db = get_db()
    content_level = "Medium"
    if db:
        try:
            profile_doc = db.collection("profiles").document(user_id).get()
            if profile_doc.exists:
                content_level = profile_doc.to_dict().get("recommended_settings", {}).get("content_level", "Medium")
        except Exception as pe:
            print(f"[Flashcard-Route] Failed to load user preference: {pe}")

    if content_level.lower() == "easy" and cards:
        simplified_cards = deck.get('cards_simplified')
        if simplified_cards and cards:
            orig_sample = " ".join([c.get('question', '') for c in cards[:3]])
            simp_sample = " ".join([c.get('question', '') for c in simplified_cards[:3]])
            tagalog_keywords = {"ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o"}
            orig_is_tagalog = len(set(orig_sample.lower().split()).intersection(tagalog_keywords)) >= 1
            simp_is_tagalog = len(set(simp_sample.lower().split()).intersection(tagalog_keywords)) >= 1
            if orig_is_tagalog and not simp_is_tagalog:
                print("[Flashcard-Simplification] Stale cache mismatch (orig: Tagalog, cached: English). Forcing regeneration.")
                simplified_cards = None

        if not simplified_cards:
            try:
                from models.text_simplifier import TextSimplifier
                simplifier = TextSimplifier.get_instance()
                simplified_cards = simplifier.simplify_cards(cards)
                if simplified_cards:
                    # Update cache in Firestore
                    doc_id = deck.get('doc_id')
                    if doc_id:
                        db.collection("users").document(user_id).collection("decks").document(doc_id).update({
                            "cards_simplified": simplified_cards
                        })
                        print(f"[Flashcard-Simplification] Cached simplified cards for deck: {deck_name}")
            except Exception as se:
                print(f"[Flashcard-Simplification] Error during card simplification: {se}")
                simplified_cards = cards
        cards = simplified_cards
    elif content_level.lower() == "hard" and cards:
        hard_cards = deck.get('cards_hard')
        if hard_cards and cards:
            orig_sample = " ".join([c.get('question', '') for c in cards[:3]])
            hard_sample = " ".join([c.get('question', '') for c in hard_cards[:3]])
            tagalog_keywords = {"ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o"}
            orig_is_tagalog = len(set(orig_sample.lower().split()).intersection(tagalog_keywords)) >= 1
            hard_is_tagalog = len(set(hard_sample.lower().split()).intersection(tagalog_keywords)) >= 1
            if orig_is_tagalog and not hard_is_tagalog:
                print("[Flashcard-Enhancement] Stale cache mismatch. Forcing regeneration.")
                hard_cards = None

        if not hard_cards:
            try:
                from models.text_simplifier import TextSimplifier
                simplifier = TextSimplifier.get_instance()
                hard_cards = simplifier.enhance_cards(cards)
                if hard_cards:
                    # Update cache in Firestore
                    doc_id = deck.get('doc_id')
                    if doc_id:
                        db.collection("users").document(user_id).collection("decks").document(doc_id).update({
                            "cards_hard": hard_cards
                        })
                        print(f"[Flashcard-Enhancement] Cached enhanced hard cards for deck: {deck_name}")
            except Exception as se:
                print(f"[Flashcard-Enhancement] Error during card enhancement: {se}")
                hard_cards = cards
        cards = hard_cards

    return render_template('flashcard.html',
                           deck_name=deck['name'],
                           deck_color=deck.get('color', '#D8C8FF'),
                           cards=cards,
                           card_count=len(cards))

@app.route('/quiz')
@login_required
def quiz():
    # No specific deck — redirect to My Decks
    return redirect(url_for('my_decks'))

@app.route('/quiz/<path:deck_name>')
@login_required
def quiz_deck(deck_name):
    """Generates and renders a multiple-choice quiz for a specific deck."""
    user_id = session.get("user", {}).get("id")
    decks = load_user_decks(user_id)

    # Find the matching deck
    deck = None
    for d in decks:
        if d.get('name') == deck_name:
            deck = d
            break

    if deck is None:
        return redirect(url_for('my_decks'))

    cards = deck.get('cards', [])
    extracted_text = deck.get('extracted_text', '')

    if not cards or not extracted_text.strip():
        # Not enough data to generate a quiz
        return render_template('quiz.html',
                               deck_name=deck_name,
                               deck_color=deck.get('color', '#D8C8FF'),
                               quiz_items=[],
                               quiz_count=0)

    # ── Check if quiz is already cached under the deck document ──
    quiz_items = deck.get('quiz_items')
    
    # Validate cached quiz_items to ensure distractors are not stale and full 20 questions are generated
    if quiz_items:
        if len(quiz_items) < 20:
            print(f"[Quiz-Route] Cached quiz has only {len(quiz_items)} questions (target 20). Purging cache for full 20-question generation.")
            quiz_items = None
        else:
            distractor_counts = {}
            for item in quiz_items:
                opts = item.get('options', [])
                for opt in opts:
                    txt = (opt.get('text') if isinstance(opt, dict) else str(opt)).strip()
                    if txt and not (isinstance(opt, dict) and opt.get('is_correct')):
                        distractor_counts[txt] = distractor_counts.get(txt, 0) + 1
            if len(quiz_items) >= 3:
                max_freq = max(distractor_counts.values()) if distractor_counts else 0
                if max_freq > (len(quiz_items) * 0.35):
                    print(f"[Quiz-Route] Stale repetitive distractors detected (max_freq={max_freq}/{len(quiz_items)}). Purging stale cache for fresh smart distractor generation.")
                    quiz_items = None
    
    # Fetch user recommended content level from Firestore profile document
    db = get_db()
    content_level = "Medium"
    if db:
        try:
            profile_doc = db.collection("profiles").document(user_id).get()
            if profile_doc.exists:
                content_level = profile_doc.to_dict().get("recommended_settings", {}).get("content_level", "Medium")
        except Exception as pe:
            print(f"[Quiz-Route] Failed to load user preference: {pe}")

    if not quiz_items:
        # Generate quiz using Groq, Gemini, or local T5 with adaptive content level complexity
        try:
            quiz_items = []
            
            if os.environ.get("GROQ_API_KEY"):
                try:
                    print(f"[Quiz-Generation] Trying Groq Quiz Generator (level={content_level})...")
                    from models.groq_quiz_generator import GroqQuizGenerator
                    generator = GroqQuizGenerator.get_instance()
                    quiz_items = generator.generate_quiz(extracted_text, cards, max_questions=20, content_level=content_level)
                except Exception as e:
                    print(f"[Quiz-Generation] Groq failed: {e}")
 
            if not quiz_items and os.environ.get("GEMINI_API_KEY"):
                try:
                    print(f"[Quiz-Generation] Trying Gemini Quiz Generator (level={content_level})...")
                    from models.gemini_quiz_generator import GeminiQuizGenerator
                    generator = GeminiQuizGenerator.get_instance()
                    quiz_items = generator.generate_quiz(extracted_text, cards, max_questions=20, content_level=content_level)
                except Exception as e:
                    print(f"[Quiz-Generation] Gemini failed: {e}")
             
            # Fall back to local T5 if both cloud APIs failed or are not set
            if not quiz_items:
                print("[Quiz-Generation] Cloud APIs failed or keys not set. Falling back to local T5 Quiz Generator...")
                from models.t5_quiz_generator import T5QuizGenerator
                generator = T5QuizGenerator.get_instance()
                quiz_items = generator.generate_quiz(extracted_text, cards, max_questions=20) # T5 uses direct extractive templates
             
            # Save generated quiz items to deck document in Firestore if successfully generated
            if quiz_items:
                deck['quiz_items'] = quiz_items
                save_user_deck(user_id, deck)
        except Exception as e:
            import traceback
            traceback.print_exc()
            quiz_items = []

    # If content level is "easy", simplify the loaded quiz items (or fetch cached simplified version)
    if content_level.lower() == "easy" and quiz_items:
        simplified_quiz = deck.get('quiz_items_simplified')
        if simplified_quiz and quiz_items:
            orig_sample = " ".join([q.get('question', '') for q in quiz_items[:3]])
            simp_sample = " ".join([q.get('question', '') for q in simplified_quiz[:3]])
            tagalog_keywords = {"ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o"}
            orig_is_tagalog = len(set(orig_sample.lower().split()).intersection(tagalog_keywords)) >= 1
            simp_is_tagalog = len(set(simp_sample.lower().split()).intersection(tagalog_keywords)) >= 1
            if orig_is_tagalog and not simp_is_tagalog:
                print("[Quiz-Simplification] Stale cache mismatch (orig: Tagalog, cached: English). Forcing regeneration.")
                simplified_quiz = None

        if not simplified_quiz:
            try:
                from models.text_simplifier import TextSimplifier
                simplifier = TextSimplifier.get_instance()
                simplified_quiz = simplifier.simplify_quiz_items(quiz_items)
                if simplified_quiz:
                    # Update cache in Firestore
                    doc_id = deck.get('doc_id')
                    if doc_id:
                        db.collection("users").document(user_id).collection("decks").document(doc_id).update({
                            "quiz_items_simplified": simplified_quiz
                        })
                        print(f"[Quiz-Simplification] Cached simplified quiz items for deck: {deck_name}")
            except Exception as se:
                print(f"[Quiz-Simplification] Error during quiz simplification: {se}")
                simplified_quiz = quiz_items
        quiz_items = simplified_quiz
    elif content_level.lower() == "hard" and quiz_items:
        hard_quiz = deck.get('quiz_items_hard')
        if hard_quiz and quiz_items:
            orig_sample = " ".join([q.get('question', '') for q in quiz_items[:3]])
            hard_sample = " ".join([q.get('question', '') for q in hard_quiz[:3]])
            tagalog_keywords = {"ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o"}
            orig_is_tagalog = len(set(orig_sample.lower().split()).intersection(tagalog_keywords)) >= 1
            hard_is_tagalog = len(set(hard_sample.lower().split()).intersection(tagalog_keywords)) >= 1
            if orig_is_tagalog and not hard_is_tagalog:
                print("[Quiz-Enhancement] Stale cache mismatch. Forcing regeneration.")
                hard_quiz = None

        if not hard_quiz:
            try:
                from models.text_simplifier import TextSimplifier
                simplifier = TextSimplifier.get_instance()
                hard_quiz = simplifier.enhance_quiz_items(quiz_items)
                if hard_quiz:
                    # Update cache in Firestore
                    doc_id = deck.get('doc_id')
                    if doc_id:
                        db.collection("users").document(user_id).collection("decks").document(doc_id).update({
                            "quiz_items_hard": hard_quiz
                        })
                        print(f"[Quiz-Enhancement] Cached enhanced hard quiz items for deck: {deck_name}")
            except Exception as se:
                print(f"[Quiz-Enhancement] Error during quiz enhancement: {se}")
                hard_quiz = quiz_items
        quiz_items = hard_quiz

    return render_template('quiz.html',
                           deck_name=deck_name,
                           deck_color=deck.get('color', '#D8C8FF'),
                           quiz_items=quiz_items,
                           quiz_count=len(quiz_items))

@app.route('/accessibility')
@login_required
def accessibility():
    # Renders accessibility.html inside the base layout
    return render_template('accessibility.html')

@app.route('/profile')
@login_required
def profile():
    # Renders profile.html with database profile details
    user = session.get("user", {})
    user_id = user.get("id")
    
    # Recalculate indices on load to clear any stale records
    try:
        from models.personalization_engine import update_user_personalization
        update_user_personalization(user_id)
    except Exception as e:
        print(f"[Profile] Failed to recalculate personalization indices: {e}")
        
    profile_data = fetch_user_profile(user_id) or {}
    if isinstance(profile_data, dict) and not profile_data.get("email"):
        profile_data["email"] = user.get("email", "")
    decks = load_user_decks(user_id)
    return render_template('profile.html', user=user, profile=profile_data, decks=decks)


@app.route('/ishihara-prompt')
@login_required
def ishihara_prompt():
    # Renders the Ishihara prompt page
    return render_template('ishihara_prompt.html')


@app.route('/ishihara-test')
@login_required
def ishihara_test():
    # Renders the 38-plate Ishihara test page
    return render_template('ishihara_test.html')


@app.route('/api/ishihara/submit', methods=['POST'])
@login_required
def submit_ishihara():
    try:
        user_id = session.get("user", {}).get("id")
        db = get_db()
        if not db or not user_id:
            return jsonify({"success": False, "error": "Database error"}), 500
            
        data = request.get_json() or {}
        selected_filter = data.get("color_filter", "none")
        
        # Merge the diagnosed filter directly into Firestore's recommended_settings
        profile_ref = db.collection("profiles").document(user_id)
        profile_ref.update({
            "recommended_settings.color_filter": selected_filter
        })
        
        return jsonify({"success": True, "message": "Ishihara test results saved successfully."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ── UHTEM Upload & Extract endpoint ─────────────────────────
@app.route('/upload', methods=['POST'])
def upload_file():
    """
    Accepts a file upload (PDF, DOCX, PPTX), runs it through the
    UHTEM extraction pipeline, and returns the extracted text as JSON.
    """
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided.'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected.'}), 400

    if not allowed_file(file.filename):
        return jsonify({
            'success': False,
            'error': 'Unsupported file type. Only PDF, DOCX, and PPTX files are accepted.'
        }), 400

    # Save file temporarily
    from werkzeug.utils import secure_filename
    filename = secure_filename(file.filename)
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    try:
        # Run UHTEM extraction
        from models.uhtem_pipeline import UHTEMEngine
        engine = UHTEMEngine(use_gpu="auto", low_resource_mode=True)
        pages_data = engine.extract(filepath)

        # Build JSON-safe response (strip PIL images)
        result_pages = []
        for page in pages_data:
            result_pages.append({
                'page_number': page['page_number'],
                'extraction_method': page['extraction_method'],
                'word_count': len(page['words']),
                'text': ' '.join(page['words']),
                'device_used': page['device_used'],
                'metrics': page.get('metrics', {})
            })

        # Combine pages to get full extracted text
        full_text = '\n\n'.join([p['text'] for p in result_pages])
        
        return jsonify({
            'success': True,
            'filename': file.filename,
            'total_pages': len(result_pages),
            'pages': result_pages,
            'simplified_text': None
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

    finally:
        # Cleanup uploaded file
        try:
            os.remove(filepath)
        except OSError:
            pass


# ── Generate Flashcard Deck endpoint ────────────────────────
@app.route('/generate-flashcard', methods=['POST'])
@login_required
def generate_flashcard():
    """
    Creates a new flashcard deck from extracted text using the
    LoRA-enhanced T5 model to generate question–answer pairs.
    """
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data provided.'}), 400

    filename = data.get('filename', '')
    extracted_text = data.get('extracted_text', '')
    original_extracted_text = data.get('original_extracted_text', '')
    total_pages = data.get('total_pages', 1)
    word_count = data.get('word_count', 0)

    if not filename:
        return jsonify({'success': False, 'error': 'No filename provided.'}), 400

    if not extracted_text.strip():
        return jsonify({'success': False, 'error': 'No extracted text to generate flashcards from.'}), 400

    # Get current user ID
    user_id = session.get("user", {}).get("id")

    # Simplify the filename into a clean deck name
    deck_name = simplify_deck_name(filename)

    # Assign a color from the palette
    decks = load_user_decks(user_id)
    color_index = len(decks) % len(DECK_COLORS)
    deck_color = DECK_COLORS[color_index]

    # Check if a deck with the same name already exists
    for existing_deck in decks:
        if existing_deck.get('name') == deck_name:
            return jsonify({
                'success': False,
                'error': f'A deck named "{deck_name}" already exists.'
            }), 409

    # Fetch user recommended content level from Firestore profile document
    content_level = "Medium"
    if user_id:
        db = get_db()
        if db:
            profile_doc = db.collection("profiles").document(user_id).get()
            if profile_doc.exists:
                content_level = profile_doc.to_dict().get("recommended_settings", {}).get("content_level", "Medium")

    # ── Generate flashcards using Groq, Gemini, or local T5 model ──
    try:
        cards = []
        if os.environ.get("GROQ_API_KEY"):
            try:
                print(f"[Flashcard-Generation] Trying Groq Flashcard Generator (level={content_level})...")
                from models.groq_flashcard_generator import GroqFlashcardGenerator
                generator = GroqFlashcardGenerator.get_instance()
                cards = generator.generate_deck(extracted_text, content_level=content_level)
            except Exception as e:
                print(f"[Flashcard-Generation] Groq failed: {e}")

        if not cards and os.environ.get("GEMINI_API_KEY"):
            try:
                print(f"[Flashcard-Generation] Trying Gemini Flashcard Generator (level={content_level})...")
                from models.gemini_flashcard_generator import GeminiFlashcardGenerator
                generator = GeminiFlashcardGenerator.get_instance()
                cards = generator.generate_deck(extracted_text, content_level=content_level)
            except Exception as e:
                print(f"[Flashcard-Generation] Gemini failed: {e}")
            
        # Fall back to local T5 if both cloud APIs failed or are not set
        if not cards:
            print("[Flashcard-Generation] Cloud APIs failed or keys not set. Falling back to local T5 Flashcard Generator...")
            from models.t5_flashcard_generator import T5FlashcardGenerator
            generator = T5FlashcardGenerator.get_instance(T5_ADAPTER_PATH)
            cards = generator.generate_deck(extracted_text)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': f'Flashcard generation failed: {str(e)}'
        }), 500

    if not cards:
        return jsonify({
            'success': False,
            'error': 'Failed to generate flashcards. The generator returned no cards, possibly due to an API rate limit, quota issue, or model failure.'
        }), 500

    # Create the new deck entry with generated cards
    new_deck = {
        'name': deck_name,
        'original_filename': filename,
        'color': deck_color,
        'card_count': len(cards),
        'cards': cards,
        'extracted_text': extracted_text[:10000],  # Store up to 10k chars (simplified if active)
        'original_extracted_text': original_extracted_text[:10000] if original_extracted_text else None,
        'total_pages': total_pages,
        'word_count': word_count
    }

    # Save to user's Firestore decks collection
    save_user_deck(user_id, new_deck)

    return jsonify({
        'success': True,
        'deck_name': deck_name,
        'card_count': len(cards),
        'message': f'Flashcard deck "{deck_name}" created with {len(cards)} cards!'
    })


@app.route('/profile/update', methods=['POST'])
@login_required
def update_profile():
    try:
        data = request.get_json() or {}
        disability = data.get("disability_type")
        gender = data.get("gender")
        birthdate = data.get("birthdate")

        if not disability or not gender or not birthdate:
            return jsonify({"success": False, "error": "Missing required fields"}), 400

        user_id = session.get("user", {}).get("id")
        
        # Update Firestore
        db = get_db()
        if not db:
            return jsonify({"success": False, "error": "Database connection failed"}), 500

        doc_ref = db.collection("profiles").document(user_id)
        profile_doc = doc_ref.get()
        recommended = {}
        if profile_doc.exists:
            recommended = profile_doc.to_dict().get("recommended_settings", {})
            
        # Sync recommended settings immediately with disability profile change
        recommended.setdefault("font_style", "default")
        recommended.setdefault("tts_engine", "azure")
        recommended.setdefault("tts_voice", "en-US-AvaNeural")
        if disability == "Low-Vision":
            recommended["text_size"] = "large"
            recommended["contrast_theme"] = "light"
        elif disability == "Dyslexia":
            recommended["line_focus"] = "on"
            recommended["dyslexia_font"] = "on"
            recommended["font_style"] = "opendyslexic"
            recommended["letter_spacing"] = "wide"
            recommended["line_spacing"] = "wide"
        elif disability == "Complete Blindness":
            recommended["screen_reader"] = "on"
        elif disability == "Color Blindness":
            recommended["color_filter"] = "deuteranopia"
            
        doc_ref.set({
            "disability_type": disability,
            "gender": gender,
            "birthdate": birthdate,
            "email": session.get("user", {}).get("email"),
            "recommended_settings": recommended
        }, merge=True)

        return jsonify({"success": True, "message": "Profile updated successfully"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/profile/delete', methods=['POST'])
@login_required
def delete_profile():
    try:
        user_id = session.get("user", {}).get("id")
        if not user_id:
            return jsonify({"success": False, "error": "Unauthorized"}), 401

        db = get_db()
        if not db:
            return jsonify({"success": False, "error": "Database connection failed"}), 500

        # 1. Delete all decks in users/{user_id}/decks subcollection
        decks_ref = db.collection("users").document(user_id).collection("decks")
        decks = decks_ref.stream()
        for deck in decks:
            deck.reference.delete()

        # 2. Delete the parent users/{user_id} document itself
        db.collection("users").document(user_id).delete()

        # 3. Delete user document in profiles
        db.collection("profiles").document(user_id).delete()

        # 4. Delete all logs in behavioral_logs where user_id == user_id
        logs_ref = db.collection("behavioral_logs").where("user_id", "==", user_id).stream()
        for log in logs_ref:
            log.reference.delete()

        # 5. Delete from Firebase Authentication
        from firebase_admin import auth as firebase_auth
        try:
            firebase_auth.delete_user(user_id)
        except Exception as auth_err:
            print(f"[Auth-Deletion] Warning: Failed to delete user from Firebase Auth: {auth_err}")

        # 6. Clear Flask session
        session.pop("user", None)

        return jsonify({"success": True, "message": "Account deleted permanently"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/profile/avatar/upload', methods=['POST'])
@login_required
def upload_avatar():
    try:
        data = request.get_json() or {}
        avatar_data = data.get("avatar_data")
        if not avatar_data:
            return jsonify({"success": False, "error": "No avatar image data provided"}), 400

        user_id = session.get("user", {}).get("id")

        db = get_db()
        if db:
            db.collection("profiles").document(user_id).set({
                "avatar_url": avatar_data
            }, merge=True)

        return jsonify({"success": True, "avatar_url": avatar_data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/telemetry/log', methods=['POST'])
def log_telemetry():
    try:
        user = session.get("user")
        if not user:
            # Fallback check header for APIs or non-cookie beacons
            auth_header = request.headers.get("Authorization")
            if auth_header and auth_header.startswith("Bearer "):
                token = auth_header.split(" ")[1]
                from firebase_admin import auth as firebase_auth
                decoded_token = firebase_auth.verify_id_token(token)
                user = {
                    "id": decoded_token["uid"],
                    "email": decoded_token.get("email")
                }
            else:
                return jsonify({"success": False, "error": "Unauthorized"}), 401
                
        user_id = user.get("id")
        data = request.get_json() or {}
        
        db = get_db()
        if not db:
            return jsonify({"success": False, "error": "Database connection failed"}), 500
            
        # 1. Fetch user profile context details
        profile_ref = db.collection("profiles").document(user_id)
        profile_doc = profile_ref.get()
        disability_type = "None"
        initial_preferred_settings = {}
        
        if profile_doc.exists:
            profile_data = profile_doc.to_dict()
            disability_type = profile_data.get("disability_type", "None")
            initial_preferred_settings = profile_data.get("initial_preferred_settings", {})
            
        # 2. Revisit Frequency counter increment and dynamic stats updates
        deck_name = data.get("deck_name", "")
        revisit_frequency = 1
        if deck_name:
            deck_ref = db.collection("users").document(user_id).collection("decks").document(deck_name)
            deck_doc = deck_ref.get()
            if deck_doc.exists:
                deck_data = deck_doc.to_dict()
                current_revisits = deck_data.get("revisit_frequency", 0)
                revisit_frequency = current_revisits + 1
                
                # Dynamic completion rate tracker (max completion scroll depth tracked)
                new_completion = float(data.get("lesson_completion_rate", 0.0))
                current_completion = float(deck_data.get("lesson_completion_rate", 0.0))
                max_completion = max(current_completion, new_completion)
                
                update_fields = {
                    "revisit_frequency": revisit_frequency,
                    "lesson_completion_rate": max_completion
                }
                
                # Dynamic quiz score tracker (highest score tracked)
                new_quiz_score = data.get("quiz_score_percentage")
                if new_quiz_score is not None:
                    new_score_val = float(new_quiz_score)
                    current_score = deck_data.get("quiz_score_percentage")
                    current_score_val = float(current_score) if current_score is not None else 0.0
                    update_fields["quiz_score_percentage"] = max(current_score_val, new_score_val)
                
                deck_ref.set(update_fields, merge=True)
            
        # 3. Build telemetric document
        from datetime import datetime, timezone
        log_doc = {
            "user_id": user_id,
            "deck_name": deck_name,
            "session_type": data.get("session_type"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            
            # Context
            "disability_type": disability_type,
            "initial_preferred_settings": initial_preferred_settings,
            "active_device_type": data.get("active_device_type", "Desktop"),
            "accessibility_feature_usage": data.get("accessibility_feature_usage", {}),
            
            # Interactive Metrics
            "reading_duration_seconds": int(data.get("reading_duration_seconds", 0)),
            "screen_magnification_frequency": int(data.get("screen_magnification_frequency", 0)),
            "dead_clicks": int(data.get("dead_clicks", 0)),
            "scroll_velocity_px_sec": float(data.get("scroll_velocity_px_sec", 0.0)),
            "regression_scroll_count": int(data.get("regression_scroll_count", 0)),
            "idle_time_seconds": int(data.get("idle_time_seconds", 0)),
            
            # TTS Metrics
            "tts_playback_rate": float(data.get("tts_playback_rate", 1.0)),
            "tts_replay_count": int(data.get("tts_replay_count", 0)),
            "tts_pause_frequency": int(data.get("tts_pause_frequency", 0)),
            
            # Outcomes
            "quiz_score_percentage": data.get("quiz_score_percentage"),  # float or None
            "lesson_completion_rate": float(data.get("lesson_completion_rate", 0.0)),
            "revisit_frequency": int(revisit_frequency)
        }
        
        # Save to behavioral_logs Firestore collection
        res = db.collection("behavioral_logs").add(log_doc)
        doc_ref = res[1] if isinstance(res, tuple) else res
        
        # Trigger the PyTorch Personalization Engine to calculate indices and update recommendations
        try:
            from models.personalization_engine import update_user_personalization
            update_user_personalization(user_id, latest_log_id=doc_ref.id, latest_log_data=log_doc)
        except Exception as pe:
            import traceback
            with open("telemetry_error.log", "a") as f:
                f.write(f"Error triggering engine: {pe}\n")
                traceback.print_exc(file=f)
            print(f"[Telemetry] Failed to trigger personalization engine: {pe}")
            
        return jsonify({"success": True, "message": "Telemetry logged successfully", "revisit_frequency": revisit_frequency})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/decks/delete', methods=['POST'])
@login_required
def delete_decks():
    try:
        data = request.get_json() or {}
        deck_names = data.get("deck_names", [])
        if not deck_names:
            return jsonify({"success": False, "error": "No decks selected for deletion."}), 400

        user_id = session.get("user", {}).get("id")
        db = get_db()
        if not db:
            return jsonify({"success": False, "error": "Database connection failed"}), 500

        for deck_name in deck_names:
            deck_ref = db.collection("users").document(user_id).collection("decks").document(deck_name)
            deck_ref.delete()

        return jsonify({"success": True, "message": "Decks deleted successfully."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/settings/update', methods=['POST'])
@login_required
def update_settings():
    try:
        user_id = session.get("user", {}).get("id")
        db = get_db()
        if not db or not user_id:
            return jsonify({"success": False, "error": "Database error"}), 500
            
        data = request.get_json() or {}
        
        # Merge the user's manual settings into the recommended_settings profile block
        profile_ref = db.collection("profiles").document(user_id)
        profile_ref.set({
            "recommended_settings": data
        }, merge=True)

        # Sync tts_playback_rate to the root document level if provided
        tts_rate = data.get("tts_playback_rate")
        if tts_rate is not None:
            profile_ref.update({
                "tts_playback_rate": float(tts_rate)
            })
        
        return jsonify({"success": True, "message": "Settings synchronized successfully."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/settings/accept', methods=['POST'])
@login_required
def accept_pending_settings():
    try:
        user_id = session.get("user", {}).get("id")
        db = get_db()
        if not db or not user_id:
            return jsonify({"success": False, "error": "Database error"}), 500
            
        profile_ref = db.collection("profiles").document(user_id)
        profile_doc = profile_ref.get()
        if not profile_doc.exists:
            return jsonify({"success": False, "error": "Profile not found"}), 404
            
        profile_data = profile_doc.to_dict()
        pending = profile_data.get("pending_settings")
        if not pending:
            return jsonify({"success": False, "error": "No pending recommendations found"}), 400
            
        from firebase_admin import firestore
        from datetime import datetime, timezone
        
        # Save as recommended_settings and clear pending_settings
        profile_ref.update({
            "recommended_settings": pending,
            "pending_settings": firestore.DELETE_FIELD
        })
        
        # Log Positive MDP feedback reward specifically for the accept event
        mdp_doc = {
            "user_id": user_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": "agency_accept",
            "action": pending,
            "reward": 1.0  # High positive reward for user confirmation
        }
        db.collection("mdp_transitions").add(mdp_doc)
        
        # ── Trigger Live Neural Net Backpropagation Optimization (MLE) ──
        try:
            from models.personalization_engine import optimize_personalization_model
            optimize_personalization_model(user_id, target_actions=pending)
        except Exception as opt_err:
            print(f"[Engine-Optimizer] Warning: Optimization triggered from Accept failed: {opt_err}")
        
        return jsonify({"success": True, "message": "Settings accepted successfully"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/settings/decline', methods=['POST'])
@login_required
def decline_pending_settings():
    try:
        user_id = session.get("user", {}).get("id")
        db = get_db()
        if not db or not user_id:
            return jsonify({"success": False, "error": "Database error"}), 500
            
        profile_ref = db.collection("profiles").document(user_id)
        profile_doc = profile_ref.get()
        if not profile_doc.exists:
            return jsonify({"success": False, "error": "Profile not found"}), 404
            
        profile_data = profile_doc.to_dict()
        pending = profile_data.get("pending_settings")
        
        from firebase_admin import firestore
        from datetime import datetime, timezone
        
        # Clear pending_settings without changing active settings
        profile_ref.update({
            "pending_settings": firestore.DELETE_FIELD
        })
        
        # Log Negative MDP feedback reward specifically for the decline event
        mdp_doc = {
            "user_id": user_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": "agency_decline",
            "action": pending or {},
            "reward": -1.0  # High negative reward for user rejection
        }
        db.collection("mdp_transitions").add(mdp_doc)

        # ── Trigger Live Neural Net Backpropagation Optimization (MLE) ──
        # Since they declined the recommendation, we train the model to target their ACTUAL active settings
        # to ensure it learns they prefer their current layout for this state vector.
        try:
            from models.personalization_engine import optimize_personalization_model
            active_settings = profile_data.get("recommended_settings") or {}
            if active_settings:
                optimize_personalization_model(user_id, target_actions=active_settings)
        except Exception as opt_err:
            print(f"[Engine-Optimizer] Warning: Optimization triggered from Decline failed: {opt_err}")
        
        return jsonify({"success": True, "message": "Recommendations declined successfully"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/debug-context')
def debug_context():
    user = session.get("user")
    if not user:
        return jsonify({"error": "No user in session"})
    user_id = user.get("id")
    try:
        decks = load_user_decks(user_id)
        from auth_helper import get_db
        db = get_db()
        profile_ref = db.collection("profiles").document(user_id)
        profile_doc = profile_ref.get()
        return jsonify({
            "session_user": user,
            "user_id": user_id,
            "decks_count": len(decks),
            "decks_list": [d.get("name") for d in decks],
            "profile_exists": profile_doc.exists,
            "profile_data": profile_doc.to_dict() if profile_doc.exists else None
        })
    except Exception as e:
        return jsonify({"error": str(e)})


@app.route('/api/tts')
def text_to_speech_api():
    """
    Server-side TTS endpoint.
    Accepts:
      - 'text': String to read aloud
      - 'lang': Language code ('en' or 'tl')
      - 'engine': TTS Engine ('azure', 'elevenlabs', 'gtts')
      - 'voice': Selected Voice ID/Name
    Returns an audio/mpeg file stream.
    """
    text = request.args.get('text', '').strip()
    lang = request.args.get('lang', 'en').strip()
    engine = request.args.get('engine', 'azure').strip().lower()
    voice = request.args.get('voice', '').strip()

    if not text:
        return "No text provided.", 400

    # Replace down/up/left/right arrow(s) with button(s) dynamically
    text = re.sub(
        r'\b(down|up|left|right)\s+arrow(s?)\b',
        lambda m: m.group(1) + (" buttons" if m.group(2) else " button"),
        text,
        flags=re.IGNORECASE
    )

    # Map language codes cleanly to gTTS supported targets
    if lang.lower() in ['fil', 'fil-ph', 'tl-ph', 'tl']:
        lang = 'tl'
    else:
        lang = 'en'

    # Helper functions to run the individual synthesis models:
    
    def try_azure(voice_id):
        azure_key = os.environ.get("AZURE_SPEECH_KEY", "")
        azure_region = os.environ.get("AZURE_SPEECH_REGION", "southeastasia")
        if not azure_key:
            return None

        import requests
        import io
        import html

        # Map legacy ElevenLabs IDs or voice fallback names to Azure voice names
        voice_map_en = {
            "Xb7hH8MSUJpSbSDYk0k2": "en-US-AvaNeural",
            "EXAVITQu4vr4xnSDxMaL": "en-US-EmmaNeural",
            "cgSgspJ2msm6clMCkdW9": "en-US-JennyNeural",
            "JBFqnCBsd6RMkjVDRZzb": "en-US-AndrewNeural",
            "nPczCjzI2devNBz1zQrb": "en-US-SteffanNeural",
            "IKne3meq5aSn9XLyUdCD": "en-US-ChristopherNeural"
        }

        if lang == 'tl':
            xml_lang = 'fil-PH'
            is_male = voice_id in [
                "JBFqnCBsd6RMkjVDRZzb", "nPczCjzI2devNBz1zQrb", "IKne3meq5aSn9XLyUdCD",
                "en-US-AndrewNeural", "en-US-SteffanNeural", "en-US-ChristopherNeural"
            ]
            voice_name = "fil-PH-AngeloNeural" if is_male else "fil-PH-BlessicaNeural"
        else:
            xml_lang = 'en-US'
            voice_name = voice_map_en.get(voice_id, voice_id)
            if not voice_name or voice_name == "default":
                voice_name = "en-US-AvaNeural"

        try:
            url = f"https://{azure_region}.tts.speech.microsoft.com/cognitiveservices/v1"
            headers = {
                "Ocp-Apim-Subscription-Key": azure_key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-24khz-160kbitrate-mono-mp3",
                "User-Agent": "ALALAY-AI"
            }

            escaped_text = html.escape(text)
            
            # Optimize pronunciation of "arrow(s)" in Azure using SSML phoneme tags
            def replace_arrow_ssml(match):
                word = match.group(0)
                if word.lower() == 'arrows':
                    return f'<phoneme alphabet="ipa" ph="ˈæroʊz">{word}</phoneme>'
                else:
                    return f'<phoneme alphabet="ipa" ph="ˈæroʊ">{word}</phoneme>'
            escaped_text = re.sub(r'\b(arrows?)\b', replace_arrow_ssml, escaped_text, flags=re.IGNORECASE)

            ssml = f"<speak version='1.0' xml:lang='{xml_lang}'><voice name='{voice_name}'>{escaped_text}</voice></speak>"

            response = requests.post(url, data=ssml.encode('utf-8'), headers=headers, timeout=10)
            if response.status_code == 200:
                print(f"[Azure TTS] Success using Neural Voice: {voice_name}")
                return response.content
            else:
                print(f"[Azure TTS] Failed with status {response.status_code}: {response.text}")
        except Exception as e:
            print(f"[Azure TTS] Request error: {e}")
        return None


    def try_elevenlabs(voice_id):
        raw_keys = os.environ.get("ELEVENLABS_API_KEY", "")
        eleven_keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
        if not eleven_keys:
            return None

        import requests

        # Map new Azure IDs or default settings back to standard ElevenLabs voice ID
        voice_map_el = {
            "en-US-AvaNeural": "21m00Tcm4TlvDq8ikWAM",
            "en-US-EmmaNeural": "EXAVITQu4vr4xnSDxMaL",
            "en-US-JennyNeural": "EXAVITQu4vr4xnSDxMaL",
            "en-US-AndrewNeural": "pNInz6obpgfrhhF2EwM3",
            "en-US-SteffanNeural": "pNInz6obpgfrhhF2EwM3",
            "en-US-ChristopherNeural": "TxGE277ZNo3A4vRMvIMw",
            "en-US-BrianNeural": "ErXwobaYiN019ALwOOzi",
            "en-US-AnaNeural": "21m00Tcm4TlvDq8ikWAM"
        }
        
        voice_name = voice_map_el.get(voice_id, voice_id)
        if not voice_name or voice_name == "default":
            voice_name = "pNInz6obpgfrhhF2EwM3" # Adam default

        for idx, key in enumerate(eleven_keys):
            try:
                headers = {
                    "Accept": "audio/mpeg",
                    "Content-Type": "application/json",
                    "xi-api-key": key
                }

                # Optimize pronunciation of "arrow(s)" to "ar-row(s)" for ElevenLabs
                processed_text = re.sub(
                    r'\b(arrow)(s?)\b', 
                    lambda m: ('Ar-row' if m.group(1)[0] == 'A' else 'ar-row') + m.group(2), 
                    text, 
                    flags=re.IGNORECASE
                )

                payload = {
                    "text": processed_text,
                    "model_id": "eleven_multilingual_v2",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.75
                    }
                }

                url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_name}"
                response = requests.post(url, json=payload, headers=headers, timeout=12)

                if response.status_code == 200:
                    print(f"[ElevenLabs] Success using Key #{idx+1} in rotation pool.")
                    return response.content
                else:
                    print(f"[ElevenLabs] Key #{idx+1} failed with status {response.status_code}: {response.text}. Cycling to next key...")
            except Exception as e:
                print(f"[ElevenLabs] Key #{idx+1} request error: {e}. Cycling to next key...")
        return None


    def try_gtts():
        try:
            from gtts import gTTS
            import io
            processed_text = re.sub(
                r'\b(arrow)(s?)\b', 
                lambda m: ('Ar-row' if m.group(1)[0] == 'A' else 'ar-row') + m.group(2), 
                text, 
                flags=re.IGNORECASE
            )
            tts = gTTS(text=processed_text, lang=lang, slow=False)
            fp = io.BytesIO()
            tts.write_to_fp(fp)
            fp.seek(0)
            return fp.read()
        except Exception as e:
            print(f"[gTTS] Error: {e}")
            return None


    # ── Dispatching Logic based on User's Preferred Engine ──
    audio_data = None
    import io
    from flask import send_file

    if engine == 'azure':
        audio_data = try_azure(voice)
        if audio_data is None:
            print("[Fallback] Azure TTS failed. Trying ElevenLabs...")
            audio_data = try_elevenlabs(voice)
        if audio_data is None:
            print("[Fallback] ElevenLabs failed. Trying gTTS...")
            audio_data = try_gtts()

    elif engine == 'elevenlabs':
        audio_data = try_elevenlabs(voice)
        if audio_data is None:
            print("[Fallback] ElevenLabs failed. Trying gTTS...")
            audio_data = try_gtts()

    elif engine == 'gtts':
        audio_data = try_gtts()

    # If all options failed, output error
    if audio_data is None:
        return "All server-side TTS engines failed.", 500

    # Stream file to front-end
    fp = io.BytesIO(audio_data)
    fp.seek(0)
    return send_file(
        fp,
        mimetype="audio/mpeg",
        as_attachment=False,
        download_name="tts.mp3"
    )


if __name__ == '__main__':
    # ── Start UHTEM OCR Warmup Thread ───────────────────────
    def warmup_ocr_background():
        try:
            from models.uhtem_pipeline import UHTEMEngine
            engine = UHTEMEngine(use_gpu="auto", low_resource_mode=True)
            print("[UHTEM-Warmup] Initiating background OCR pre-warming thread...")
            engine.warmup()
        except Exception as e:
            print(f"[UHTEM-Warmup] Error during background warming: {e}")

    import threading
    threading.Thread(target=warmup_ocr_background, daemon=True).start()

    app.run(debug=True, use_reloader=False, host='0.0.0.0', port=5000)