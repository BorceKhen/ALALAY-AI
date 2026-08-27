import os
import json
import random

class TextSimplifier:
    """
    Simplifies dense, complex academic text into clear, direct paragraphs 
    with straightforward vocabulary and definitions, tailored for users 
    experiencing visual or cognitive strain.
    """

    _instance = None  # Singleton pattern

    @classmethod
    def get_instance(cls) -> "TextSimplifier":
        """Returns a cached singleton instance of the simplifier."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.groq_client = None
        self.gemini_model = None
        self.groq_initialized = False
        self.gemini_initialized = False

    def _init_groq(self):
        if self.groq_initialized:
            return
        api_key = os.environ.get("GROQ_API_KEY", "")
        if api_key:
            try:
                from groq import Groq
                self.groq_client = Groq(api_key=api_key)
                self.groq_initialized = True
            except Exception as e:
                print(f"[TextSimplifier] Failed to initialize Groq client: {e}")

    def _init_gemini(self):
        if self.gemini_initialized:
            return
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=api_key)
                self.gemini_model = genai.GenerativeModel('gemini-3.6-flash')
                self.gemini_initialized = True
            except Exception as e:
                print(f"[TextSimplifier] Failed to initialize Gemini client: {e}")

    def simplify(self, text: str) -> str:
        """
        Attempts to simplify the provided text using Groq first, 
        falling back to Gemini if needed. Returns simplified text 
        or original text on failure.
        """
        if not text or not text.strip():
            return ""

        # Simple Tagalog keyword matching
        tagalog_keywords = {
            "ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o",
            "isang", "may", "para", "dahil", "wika", "filipino", "pilipino", "ito", "sila", "tayo"
        }
        words = set(text.lower().split()[:2000])
        is_tagalog = len(words.intersection(tagalog_keywords)) >= 3

        if is_tagalog:
            lang_instruction = "LANGUAGE REQUIREMENT: The input text is in Filipino/Tagalog (or Taglish). You MUST output the simplified text in Filipino/Tagalog (or Taglish). DO NOT translate it to English. Keep technical words as they are."
        else:
            lang_instruction = "LANGUAGE REQUIREMENT: The input text is in English. You MUST output the simplified text in English."

        prompt = f"""
You are an expert accessibility assistant. Your task is to simplify the study text below to make it easier to read and comprehend for users with low vision, learning difficulties (like dyslexia), or cognitive fatigue.

Guidelines:
1. Simplify complex vocabulary into straightforward, plain terms.
2. Provide clean, understandable definitions for key concepts or terms.
3. Shorten long, dense sentences into clear, concise statements.
4. Maintain 100% accuracy of the original facts, context, and educational concepts.
5. {lang_instruction}
6. Output ONLY the simplified version of the text, maintaining the original paragraph structure. Do not include any introductory remarks, explanations, conversational text, or markdown blocks.

Study Text to Simplify:
{text[:8000]}
"""

        # 1. Try Groq
        self._init_groq()
        if self.groq_initialized and self.groq_client:
            try:
                print("[TextSimplifier] Attempting text simplification via Groq (llama-3.3-70b-versatile)...")
                response = self.groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {"role": "user", "content": prompt}
                    ]
                )
                res_content = response.choices[0].message.content
                if res_content and res_content.strip():
                    return res_content.strip()
            except Exception as e:
                print(f"[TextSimplifier] Groq simplification failed: {e}")

        # 2. Try Gemini (Fallback)
        self._init_gemini()
        if self.gemini_initialized and self.gemini_model:
            try:
                print("[TextSimplifier] Attempting text simplification via Gemini (gemini-3.6-flash)...")
                response = self.gemini_model.generate_content(prompt)
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                print(f"[TextSimplifier] Gemini simplification failed: {e}")

        # 3. Graceful fallback
        print("[TextSimplifier] Simplification failed or no API keys set. Returning original text.")
        return text

    def simplify_cards(self, cards: list) -> list:
        """
        Simplifies a list of card dictionaries: [{'question': '...', 'answer': '...'}]
        Returns the simplified card array.
        """
        if not cards:
            return []

        sample_text = " ".join([c.get('question', '') + ' ' + c.get('answer', '') for c in cards[:5]])
        tagalog_keywords = {
            "ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o",
            "isang", "may", "para", "dahil", "wika", "filipino", "pilipino", "ito", "sila", "tayo"
        }
        words = set(sample_text.lower().split())
        is_tagalog = len(words.intersection(tagalog_keywords)) >= 2

        if is_tagalog:
            lang_instruction = "LANGUAGE REQUIREMENT: The input cards are in Filipino/Tagalog. You MUST simplify them in Filipino/Tagalog. DO NOT translate to English. Keep technical words as they are."
            json_example = """[
  {
    "question": "Ano ang wika?",
    "answer": "Ito ay sistema ng tunog para sa komunikasyon."
  }
]"""
        else:
            lang_instruction = "LANGUAGE REQUIREMENT: The input cards are in English. You MUST simplify them in English."
            json_example = """[
  {
    "question": "What is language?",
    "answer": "It is a system of sounds used for communication."
  }
]"""

        prompt = f"""
You are an expert accessibility assistant. Your task is to simplify the questions and answers of the study flashcards below. Make the vocabulary and sentence structure easy to read for users with learning/cognitive difficulties.

Requirements:
1. {lang_instruction}
2. Maintain the exact count of cards and the JSON structure. Do not change the meaning or educational concepts.
3. Output MUST be strictly valid JSON matching the format below, without markdown wrappers or descriptions.

Expected JSON output format:
{json_example}

Input JSON cards:
{json.dumps(cards, indent=2)}
"""
        # 1. Try Groq
        self._init_groq()
        if self.groq_initialized and self.groq_client:
            try:
                print("[TextSimplifier] Attempting bulk card simplification via Groq (llama-3.3-70b-versatile)...")
                response = self.groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {"role": "user", "content": prompt}
                    ]
                )
                res_content = response.choices[0].message.content
                if res_content:
                    text = res_content.strip()
                    if text.startswith("```"):
                        text = text.split("```")[1]
                        if text.startswith("json"):
                            text = text[4:]
                    data = json.loads(text.strip())
                    if isinstance(data, list):
                        return data
                    elif isinstance(data, dict) and "cards" in data:
                        return data["cards"]
            except Exception as e:
                print(f"[TextSimplifier] Groq bulk card simplification failed: {e}")

        # 2. Try Gemini (Fallback)
        self._init_gemini()
        if self.gemini_initialized and self.gemini_model:
            try:
                print("[TextSimplifier] Attempting bulk card simplification via Gemini...")
                response = self.gemini_model.generate_content(prompt)
                if response and response.text:
                    text = response.text.strip()
                    if text.startswith("```"):
                        text = text.split("```")[1]
                        if text.startswith("json"):
                            text = text[4:]
                    data = json.loads(text.strip())
                    if isinstance(data, list):
                        return data
                    elif isinstance(data, dict) and "cards" in data:
                        return data["cards"]
            except Exception as e:
                print(f"[TextSimplifier] Gemini bulk card simplification failed: {e}")

        return cards

    def simplify_quiz_items(self, quiz_items: list) -> list:
        """
        Simplifies a list of quiz items: [{'question': '...', 'options': [...], 'answer': '...'}]
        Returns the simplified quiz array.
        """
        if not quiz_items:
            return []

        sample_text = " ".join([q.get('question', '') + ' ' + q.get('correct_answer', '') for q in quiz_items[:3]])
        tagalog_keywords = {
            "ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o",
            "isang", "may", "para", "dahil", "wika", "filipino", "pilipino", "ito", "sila", "tayo"
        }
        words = set(sample_text.lower().split())
        is_tagalog = len(words.intersection(tagalog_keywords)) >= 2

        if is_tagalog:
            lang_instruction = "LANGUAGE REQUIREMENT: The input quiz items are in Filipino/Tagalog. You MUST simplify them in Filipino/Tagalog. DO NOT translate to English. Keep technical words as they are."
            json_example = """[
  {
    "question": "Ano ang pangunahing layunin ng wika?",
    "correct_answer": "Ang magbahagi ng impormasyon",
    "options": [
      {"text": "Ang gumawa ng liham lamang", "is_correct": false},
      {"text": "Ang magbahagi ng impormasyon", "is_correct": true},
      {"text": "Ang makipag-away", "is_correct": false},
      {"text": "Ang matulog", "is_correct": false}
    ]
  }
]"""
        else:
            lang_instruction = "LANGUAGE REQUIREMENT: The input quiz items are in English. You MUST simplify them in English."
            json_example = """[
  {
    "question": "What is the main goal of language?",
    "correct_answer": "To share information",
    "options": [
      {"text": "To write letters only", "is_correct": false},
      {"text": "To share information", "is_correct": true},
      {"text": "To argue with others", "is_correct": false},
      {"text": "To sleep", "is_correct": false}
    ]
  }
]"""

        prompt = f"""
You are an expert accessibility assistant. Your task is to simplify the questions, multiple-choice options, and answers of the study quiz below. Make the vocabulary and sentence structure easy to read for users with learning/cognitive difficulties.

Requirements:
1. {lang_instruction}
2. Maintain the exact count of quiz items and the JSON structure. The options must align directly with the simplified question/answer options.
3. Output MUST be strictly valid JSON matching the format below, without markdown wrappers or descriptions.

Expected JSON output format:
{json_example}

Input JSON quiz items:
{json.dumps(quiz_items, indent=2)}
"""
        # 1. Try Groq
        self._init_groq()
        if self.groq_initialized and self.groq_client:
            try:
                print("[TextSimplifier] Attempting bulk quiz simplification via Groq (llama-3.3-70b-versatile)...")
                response = self.groq_client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[
                        {"role": "user", "content": prompt}
                    ]
                )
                res_content = response.choices[0].message.content
                if res_content:
                    text = res_content.strip()
                    if text.startswith("```"):
                        text = text.split("```")[1]
                        if text.startswith("json"):
                            text = text[4:]
                    data = json.loads(text.strip())
                    items = []
                    if isinstance(data, list):
                        items = data
                    elif isinstance(data, dict) and "quiz_items" in data:
                        items = data["quiz_items"]
                    elif isinstance(data, dict):
                        lists = [v for v in data.values() if isinstance(v, list)]
                        items = lists[0] if lists else []

                    if items:
                        return self._normalize_quiz_items(items, quiz_items)
            except Exception as e:
                print(f"[TextSimplifier] Groq bulk quiz simplification failed: {e}")

        # 2. Try Gemini (Fallback)
        self._init_gemini()
        if self.gemini_initialized and self.gemini_model:
            try:
                print("[TextSimplifier] Attempting bulk quiz simplification via Gemini...")
                response = self.gemini_model.generate_content(prompt)
                if response and response.text:
                    text = response.text.strip()
                    if text.startswith("```"):
                        text = text.split("```")[1]
                        if text.startswith("json"):
                            text = text[4:]
                    data = json.loads(text.strip())
                    items = []
                    if isinstance(data, list):
                        items = data
                    elif isinstance(data, dict) and "quiz_items" in data:
                        items = data["quiz_items"]
                    elif isinstance(data, dict):
                        lists = [v for v in data.values() if isinstance(v, list)]
                        items = lists[0] if lists else []

                    if items:
                        return self._normalize_quiz_items(items, quiz_items)
            except Exception as e:
                print(f"[TextSimplifier] Gemini bulk quiz simplification failed: {e}")

        return quiz_items

    def _normalize_quiz_items(self, simplified_items: list, original_items: list) -> list:
        """
        Ensures all simplified quiz items have questions and 4 valid, randomized options.
        """
        # Build answer pool from original items
        answer_pool = []
        for q in original_items:
            if isinstance(q, dict):
                ans = q.get('correct_answer') or q.get('answer')
                if ans:
                    answer_pool.append(str(ans).strip())

        normalized = []
        for i, q in enumerate(simplified_items):
            if not isinstance(q, dict):
                continue
            question = str(q.get("question") or (original_items[i].get("question") if i < len(original_items) else "")).strip()
            correct_ans = str(q.get("correct_answer") or q.get("answer") or (original_items[i].get("correct_answer") if i < len(original_items) else "")).strip()
            
            raw_options = q.get("options") or q.get("choices") or (original_items[i].get("options") if i < len(original_items) else [])
            if isinstance(raw_options, dict):
                raw_options = list(raw_options.values())
            
            cleaned_options = []
            has_correct = False
            for opt in (raw_options if isinstance(raw_options, list) else []):
                if isinstance(opt, str):
                    text = opt.strip()
                    is_corr = (text.lower() == correct_ans.lower()) if correct_ans else False
                elif isinstance(opt, dict):
                    text = str(opt.get("text") or opt.get("option") or opt.get("choice") or opt.get("value") or "").strip()
                    is_corr = bool(opt.get("is_correct") or opt.get("correct") or (correct_ans and text.lower() == correct_ans.lower()))
                else:
                    continue
                if text:
                    cleaned_options.append({"text": text, "is_correct": is_corr})
                    if is_corr:
                        has_correct = True
            
            if not has_correct and correct_ans:
                cleaned_options.append({"text": correct_ans, "is_correct": True})
            
            seen = set()
            unique_opts = []
            for o in cleaned_options:
                k = o["text"].lower()
                if k not in seen:
                    seen.add(k)
                    unique_opts.append(o)
            
            if len(unique_opts) < 4:
                for fb in answer_pool:
                    if len(unique_opts) >= 4:
                        break
                    if fb.lower() not in seen:
                        seen.add(fb.lower())
                        unique_opts.append({"text": fb, "is_correct": False})
            
            generic = ["Wala sa nabanggit", "Lahat ng nabanggit", "Hindi matukoy", "Parehong A at B"]
            for g in generic:
                if len(unique_opts) >= 4:
                    break
                if g.lower() not in seen:
                    seen.add(g.lower())
                    unique_opts.append({"text": g, "is_correct": False})

            if len(unique_opts) > 4:
                correct_opts = [o for o in unique_opts if o["is_correct"]]
                incorrect_opts = [o for o in unique_opts if not o["is_correct"]]
                final_opts = (correct_opts[:1] or unique_opts[:1]) + incorrect_opts[:3]
                unique_opts = final_opts[:4]
            
            random.shuffle(unique_opts)
            normalized.append({
                "question": question,
                "correct_answer": correct_ans,
                "options": unique_opts
            })

        return normalized if normalized else original_items
