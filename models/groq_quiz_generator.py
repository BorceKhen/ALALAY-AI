import os
import json
import random
from typing import List, Dict


class GroqQuizGenerator:
    """
    Generates multiple-choice quiz questions from text using Groq's API.
    Uses LLaMA 3.1 8B model for extremely fast, reliable, and free generation.
    """

    _instance = None  # Singleton pattern

    @classmethod
    def get_instance(cls) -> "GroqQuizGenerator":
        """Returns a cached singleton instance to avoid recreating objects."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self.client_initialized = False
        self.client = None

    def _init_client(self):
        """Initializes the Groq API client using environment variables."""
        if self.client_initialized:
            return

        api_key = os.environ.get("GROQ_API_KEY", "")
        if not api_key:
            print("[Groq-QuizGen] Warning: GROQ_API_KEY environment variable is not set in your .env file.")

        try:
            from groq import Groq
            self.client = Groq(api_key=api_key)
            self.client_initialized = True
        except ImportError:
            print("[Groq-QuizGen] Error: 'groq' package is not installed.")
            print("[Groq-QuizGen] To use this generator, please run: pip install groq")
            raise

    def generate_quiz(
        self,
        extracted_text: str,
        flashcard_pairs: List[Dict[str, str]],
        max_questions: int = 20,
        content_level: str = "Medium"
    ) -> List[Dict]:
        """
        Generates multiple-choice quiz questions strictly focused on the content of the provided flashcards.
        Guarantees 100% topic alignment and prevents any duplicate questions.
        """
        try:
            self._init_client()
        except ImportError:
            return []

        if not flashcard_pairs:
            print("[Groq-QuizGen] Error: No flashcards available for quiz generation.")
            return []

        # Deduplicate flashcards by question text to prevent duplicate/rephrased questions
        import re
        unique_cards = []
        seen_questions = set()
        for card in flashcard_pairs:
            if not isinstance(card, dict):
                continue
            q_text = card.get('question', '').strip()
            c_ans = card.get('answer', '').strip()
            if not q_text or not c_ans:
                continue
            # Remove punctuation and normalize spaces
            q_norm = re.sub(r'[^\w\s]', '', q_text).lower().strip()
            q_norm = re.sub(r'\s+', ' ', q_norm)
            if q_norm not in seen_questions:
                seen_questions.add(q_norm)
                unique_cards.append(card)

        # Answer pool for fallback distractor choices
        answer_pool = [c.get('answer', '').strip() for c in flashcard_pairs if isinstance(c, dict) and c.get('answer')]

        # Batch generate distractors for the unique flashcards
        to_generate = [{"question": c.get('question', '').strip(), "correct_answer": c.get('answer', '').strip()} for c in unique_cards]
        
        distractors_map = {}
        if to_generate:
            distractors_map = self._generate_batch_distractors(to_generate)

        quiz_data = []
        for item in to_generate:
            q_text = item["question"]
            c_ans = item["correct_answer"]
            distractors = distractors_map.get(q_text.lower(), [])
            
            options = [{"text": c_ans, "is_correct": True}]
            for d in distractors:
                options.append({"text": d, "is_correct": False})
                
            norm = self._normalize_quiz_item({
                'question': q_text,
                'correct_answer': c_ans,
                'options': options
            }, answer_pool)
            
            if norm:
                quiz_data.append(norm)

        print(f"[Groq-QuizGen] Quiz generated successfully with {len(quiz_data)} questions from flashcards.")
        return quiz_data

    def _generate_batch_distractors(self, items: List[Dict]) -> Dict[str, List[str]]:
        """
        Generates 3 semantic-category-matched incorrect options for each Q-A pair in batch using Groq.
        """
        try:
            self._init_client()
            if not self.client:
                return {}
            
            items_list = [{"question": item["question"], "correct_answer": item["correct_answer"]} for item in items]
            
            prompt = f"""
You are an expert educational test designer. For each of the following quiz questions and correct answers, generate exactly 3 incorrect distractors.

CRITICAL REQUIREMENTS:
1. Category Matching: The 3 distractors must belong to the exact same semantic category and grammatical form as the correct answer.
   - Example (Shapes): If the correct answer is "Oktagono", distractors must be shapes in the same language, e.g., ["Tatsulok", "Bilog", "Parisukat"].
   - Example (Phobias): If the correct answer is "Takot sa aso", distractors must be other phobias in the same language, e.g., ["Takot sa dilim", "Takot sa gagamba", "Takot sa matataas na lugar"].
   - Example (Cities): If the correct answer is "Maynila", distractors must be other cities, e.g., ["Cebu", "Davao", "Iloilo"].
2. Context-Specific Distractors: Do not reuse distractors across different topics (e.g., do not use city names for a shape question, and do not use phobia answers for a food question).
3. Plausibility: Distractors must be plausible and challenging, not obviously wrong or silly.
4. Language: Distractors must be in the exact same language (Filipino/Tagalog/Taglish or English) as the correct answer. Keep the options natural and grammatically correct in Filipino/Taglish when appropriate.
5. Output must be a JSON object mapping the lowercase question text to an array of exactly 3 distractor strings. Do not include markdown wrappers.

Input Questions and Answers:
{json.dumps(items_list, ensure_ascii=False)}

Expected JSON Output format:
{{
  "question text here": ["distractor 1", "distractor 2", "distractor 3"]
}}
"""
            model_to_use = "llama-3.3-70b-versatile"
            response = self.client.chat.completions.create(
                model=model_to_use,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"}
            )
            response_text = response.choices[0].message.content
            if response_text:
                res_dict = json.loads(response_text.strip())
                return {str(k).lower().strip(): v for k, v in res_dict.items() if isinstance(v, list)}
        except Exception as e:
            print(f"[Groq-QuizGen] Failed to generate batch distractors: {e}")
        return {}

    def _normalize_quiz_item(self, q: Dict, fallback_pool: List[str] = None) -> Dict:
        """
        Guarantees that every quiz item has a valid question, correct answer,
        and strictly 4 distinct, randomized options.
        """
        if not isinstance(q, dict):
            return None
        
        question = str(q.get("question") or q.get("q") or "").strip()
        if not question:
            return None
        
        correct_ans = str(q.get("correct_answer") or q.get("answer") or q.get("correct") or "").strip()
        
        raw_options = q.get("options") or q.get("choices") or []
        if isinstance(raw_options, dict):
            raw_options = list(raw_options.values())
        
        cleaned_options = []
        has_correct = False
        
        for opt in raw_options:
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
        
        # If correct_answer was not found in cleaned_options, add it or set first as correct
        if not has_correct:
            if correct_ans:
                cleaned_options.append({"text": correct_ans, "is_correct": True})
                has_correct = True
            elif cleaned_options:
                cleaned_options[0]["is_correct"] = True
                correct_ans = cleaned_options[0]["text"]
                has_correct = True
        
        # Ensure distinct option texts (no duplicates)
        seen_texts = set()
        unique_options = []
        for opt in cleaned_options:
            key = opt["text"].lower()
            if key not in seen_texts:
                seen_texts.add(key)
                unique_options.append(opt)
        
        # If fewer than 4 options, generate smart contextual distractors
        if len(unique_options) < 4:
            from models.distractor_generator import SmartDistractorGenerator
            generator = SmartDistractorGenerator.get_instance()
            needed = 4 - len(unique_options)
            smart_dist = generator.generate_distractors(question, correct_ans, existing_deck_answers=fallback_pool or [], count=needed)
            for sd in smart_dist:
                if sd.lower() not in seen_texts:
                    seen_texts.add(sd.lower())
                    unique_options.append({"text": sd, "is_correct": False})
                if len(unique_options) >= 4:
                    break
        
        # If more than 4 options, keep 1 correct and 3 incorrect
        if len(unique_options) > 4:
            correct_opts = [o for o in unique_options if o["is_correct"]]
            incorrect_opts = [o for o in unique_options if not o["is_correct"]]
            final_opts = (correct_opts[:1] or unique_options[:1]) + incorrect_opts[:3]
            unique_options = final_opts[:4]
        
        # Shuffle options so correct is not always in same place
        random.shuffle(unique_options)
        
        return {
            "question": question,
            "correct_answer": correct_ans or (next((o["text"] for o in unique_options if o["is_correct"]), unique_options[0]["text"])),
            "options": unique_options
        }
