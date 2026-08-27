import os
import sys
import json
import urllib.request
import urllib.error

# Directory where audio files will be saved
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "static", "audio", "narrator")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# List of all authentication and navigation audio prompts
PROMPTS = {
    "welcome": "Welcome to ALALAY-AI. To enable the built-in screen reader guided signup at any time, press Shift plus S, or double-tap anywhere on the screen. Use the arrow keys or Tab to choose your accessibility profile.",
    "tab_signup": "Sign Up tab. Press right button to switch to Sign In, or press down button to choose an accessibility profile.",
    "tab_signin": "Sign In tab. Press left button to switch to Sign Up, or press down button to enter your email.",
    
    # Step 1: Disability Profile Cards
    "card_standard": "Standard Layout, option card. Default visual experience without additional adjustments. Press Enter or Space to select.",
    "card_low_vision": "Low-Vision Support, option card. Larger text size and high-contrast styling for better visibility. Press Enter or Space to select.",
    "card_dyslexia": "Dyslexia Friendly, option card. Specialized dyslexic font, wider word spacing, and text guidance ruler. Press Enter or Space to select.",
    "card_screen_reader": "Screen Reader Support, option card. Auditory narration that reads page content out loud immediately. Press Enter or Space to select.",
    "card_color_blindness": "Color Blindness Filter, option card. Daltonization color correction overlays to distinguish contrasting colors. Press Enter or Space to select.",
    
    # Step 1 Buttons
    "btn_next_disabled": "Next: Account details button, disabled. Choose an accessibility profile first.",
    "btn_next": "Next: Account details button. Press Enter to proceed to account details.",
    "btn_signup_google": "Sign up with Google button. Press Enter to authenticate with Google.",
    
    # Step 2: Sign Up Details
    "input_signup_email": "Email address input field. Type your email address or press down button to select gender.",
    "select_gender": "Gender dropdown. Press Space to show options, choose your gender, then press Right button to enter birthdate.",
    "input_birthdate": "Birthdate input field. In: day, month, and year format. Enter your date of birth, then press Down button to enter password.",
    "input_signup_password": "Password input field. Type a secure password of at least 8 characters.",
    "input_signup_repassword": "Re-enter password. Type your password again to confirm.",
    "btn_back": "Back button. Press Enter to return to step 1 accessibility profiles.",
    "btn_signup_submit": "Sign up button. Press Enter to register your account.",
    
    # Sign In View
    "input_signin_email": "Email address input field. Type your email or press down button to go to password.",
    "input_signin_password": "Password input field. Type your password or press down button to go to sign in button.",
    "btn_signin_submit": "Sign In button. Press Enter to submit your credentials.",
    "btn_signin_google": "Sign up with Google button. Press Enter to sign in with your Google account."
}

def generate_with_elevenlabs(api_key: str, voice_id: str = "21m00Tcm4TlvDq8ikWAM"):
    """Generates audio using ElevenLabs REST API."""
    print(f"[*] Starting ElevenLabs generation for {len(PROMPTS)} audio prompts...")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key
    }
    
    for filename, text in PROMPTS.items():
        out_path = os.path.join(OUTPUT_DIR, f"{filename}.mp3")
        
        # Optimize pronunciation of "arrow(s)" to "ar-row(s)" for ElevenLabs
        import re
        # First replace directional arrows with buttons
        processed_text = re.sub(
            r'\b(down|up|left|right)\s+arrow(s?)\b',
            lambda m: m.group(1) + (" buttons" if m.group(2) else " button"),
            text,
            flags=re.IGNORECASE
        )
        # Standalone arrow fallback
        processed_text = re.sub(
            r'\b(arrow)(s?)\b', 
            lambda m: ('Ar-row' if m.group(1)[0] == 'A' else 'ar-row') + m.group(2), 
            processed_text, 
            flags=re.IGNORECASE
        )
        
        print(f"Generating: {filename}.mp3 -> '{processed_text[:40]}...'")
        
        payload = json.dumps({
            "text": processed_text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {
                "stability": 0.75,
                "similarity_boost": 0.85
            }
        }).encode('utf-8')
        
        req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(req) as response:
                if response.status == 200:
                    with open(out_path, 'wb') as f:
                        f.write(response.read())
                    print(f"  [OK] Saved to {out_path}")
                else:
                    print(f"  [ERROR] Status {response.status}")
        except urllib.error.HTTPError as e:
            print(f"  [ERROR] ElevenLabs API error for {filename}: {e.read().decode('utf-8')}")
        except Exception as e:
            print(f"  [ERROR] {e}")

    print("\n[✔] Finished generating ElevenLabs audio files!")

if __name__ == "__main__":
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if len(sys.argv) > 1:
        api_key = sys.argv[1]
    
    if not api_key:
        print("Usage:")
        print("  python generate_narrator_audio.py <YOUR_ELEVENLABS_API_KEY>")
        print("\nOr set environment variable ELEVENLABS_API_KEY.")
    else:
        generate_with_elevenlabs(api_key)
