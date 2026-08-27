# gemini_flashcard_generator.py — Gemini API Flashcard Generation Module
import os
import json
from typing import List, Dict


class GeminiFlashcardGenerator:
    """
    Generates question–answer flashcard pairs from text using Google's Gemini API.
    Natively supports multilingual text (such as Filipino and Taglish).
    """

    _instance = None  # Singleton pattern

    @classmethod
    def get_instance(cls) -> "GeminiFlashcardGenerator":
        """Returns a cached singleton instance to avoid recreating objects."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.client_initialized = False
        self.model = None

    def _init_client(self):
        """Initializes the Gemini API client securely using environment variables."""
        if self.client_initialized:
            return

        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            print("[Gemini-FlashGen] Warning: GEMINI_API_KEY environment variable is not set in your .env file.")

        try:
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            self.model = genai.GenerativeModel('gemini-3.6-flash')
            self.client_initialized = True
        except ImportError:
            print("[Gemini-FlashGen] Error: 'google-generativeai' package is not installed.")
            print("[Gemini-FlashGen] Please run: pip install google-generativeai")
            raise

    def generate_deck(self, extracted_text: str, content_level: str = "Medium") -> List[Dict[str, str]]:
        """
        Queries Gemini to generate flashcard pairs from the study text.
        Matches the signature of t5_flashcard_generator.py for easy drop-in replacement.
        """
        try:
            self._init_client()
        except ImportError:
            return []

        if not extracted_text or not extracted_text.strip():
            print("[Gemini-FlashGen] Error: No extracted text available for flashcard generation.")
            return []

        # Simple Tagalog keyword matching
        tagalog_keywords = {
            "ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o",
            "isang", "may", "para", "dahil", "wika", "filipino", "pilipino", "ito", "sila", "tayo"
        }
        words = set(extracted_text.lower().split()[:2000])
        is_tagalog = len(words.intersection(tagalog_keywords)) >= 3

        # Configure language instruction and matching format example
        if is_tagalog:
            lang_instruction = "LANGUAGE REQUIREMENT: The study text is in Filipino/Tagalog (or Taglish). You MUST generate all questions and answers in Filipino/Tagalog (or Taglish). DO NOT translate to English."
            json_example = """[
  {
    "question": "Ano ang pangunahing ideya ng teksto?",
    "answer": "Ang pangunahing ideya ay naglalarawan ng kahalagahan ng paksa."
  }
]"""
        else:
            lang_instruction = "LANGUAGE REQUIREMENT: The study text is in English. You MUST generate all questions and answers in English."
            json_example = """[
  {
    "question": "What is the primary concept of the text?",
    "answer": "The primary concept describes the core meaning of the topic."
  }
]"""

        # Set up difficulty/complexity constraints dynamically based on language
        if is_tagalog:
            if content_level.lower() == "easy":
                level_instruction = "Siguraduhing napakasimple ng mga tanong at ang mga sagot ay nakasulat gamit ang mga payak at madaling maunawaang salita (in Filipino/Tagalog)."
            elif content_level.lower() == "hard":
                level_instruction = "Siguraduhing ang mga tanong ay nangangailangan ng kritikal na pag-iisip at pagsusuri, at ang mga sagot ay komprehensibo (in Filipino/Tagalog)."
            else:
                level_instruction = "Siguraduhing ang mga tanong at sagot ay malinaw, maikli, at balanse (in Filipino/Tagalog)."
        else:
            if content_level.lower() == "easy":
                level_instruction = "Ensure questions are VERY SIMPLE and answers are written using straightforward, plain-language definitions and easy-to-understand words."
            elif content_level.lower() == "hard":
                level_instruction = "Ensure questions demand critical thinking and analytical application, and answers are comprehensive."
            else:
                level_instruction = "Ensure questions and answers are clear, concise, and balanced."

        prompt = f"""
You are an expert educational assistant. Your task is to generate high-quality study flashcards based on the study text provided below.

---
Study Text:
{extracted_text[:12000]}
---

Requirements:
1. {lang_instruction}
2. Extract key concepts, formulas, dates, vocabulary, definitions, and important ideas.
3. Format each flashcard as a question-answer pair. Keep questions clear and answers concise.
4. {level_instruction}
5. Output must be strictly valid JSON matching the format below, without markdown wrappers or descriptions.
6. CRITICAL SPELLING ACCURACY: You must preserve the EXACT spelling of all concepts, terms, vocabulary, names, and key definitions from the Study Text. Do not translate, paraphrase, correct, or change the spelling of these key terms under any circumstances (e.g. if the text says 'BERBAL', you must use 'BERBAL' or 'Berbal' exactly, not 'Bermabal').

Expected JSON output format:
{json_example}
"""

        try:
            print("[Gemini-FlashGen] Requesting flashcards from Gemini...")
            response = self.model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )

            if response and response.text:
                cards = json.loads(response.text.strip())
                print(f"[Gemini-FlashGen] Flashcards generated successfully with {len(cards)} cards.")
                return cards
            
            print("[Gemini-FlashGen] Empty response received from Gemini.")
            return []

        except Exception as e:
            print(f"[Gemini-FlashGen] Failed to generate flashcard content: {e}")
            return []
