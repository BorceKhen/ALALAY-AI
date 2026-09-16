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

        try:
            from models.groq_helper import get_groq_client
            self.client, _ = get_groq_client()
            self.client_initialized = True
        except Exception as e:
            print(f"[Groq-QuizGen] Error initializing Groq client: {e}")
            raise

    def generate_quiz(
        self,
        extracted_text: str,
        flashcard_pairs: List[Dict[str, str]],
        max_questions: int = 20,
        content_level: str = "Medium",
        deck_structure: str = "question"
    ) -> List[Dict]:
        """
        Generates multiple-choice quiz questions strictly focused on the content of the provided flashcards.
        Guarantees 100% topic alignment and prevents any duplicate questions.
        Supports both Question and Descriptive deck structures.
        """
        try:
            self._init_client()
        except Exception:
            return []

        if not flashcard_pairs:
            print("[Groq-QuizGen] Error: No flashcards available for quiz generation.")
            return []

        # Detect if deck is descriptive (explicit flag, card type tag, or declarative structure)
        is_descriptive = (str(deck_structure or "question").strip().lower() == "descriptive")
        if not is_descriptive:
            is_descriptive = any(c.get('type') == 'descriptive' for c in flashcard_pairs if isinstance(c, dict))
            if not is_descriptive and flashcard_pairs:
                sample = [c for c in flashcard_pairs[:5] if isinstance(c, dict)]
                if sample and all(not c.get('question', '').strip().endswith('?') and len(c.get('question', '').split()) <= 6 and len(c.get('answer', '').split()) >= 12 for c in sample):
                    is_descriptive = True

        if is_descriptive:
            print(f"[Groq-QuizGen] Descriptive deck detected. Generating contextual multiple-choice quiz...")
            quiz_data = self._generate_descriptive_quiz_questions(extracted_text, flashcard_pairs, needed=max_questions, content_level=content_level)
            if quiz_data:
                print(f"[Groq-QuizGen] Descriptive quiz generated successfully with {len(quiz_data)} questions.")
                return quiz_data[:max_questions]

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
        to_generate = [{"question": c.get('question', '').strip(), "correct_answer": c.get('answer', '').strip()} for c in unique_cards]

        # If fewer than max_questions (20), generate extra quiz items from study context
        if len(to_generate) < max_questions:
            needed = max_questions - len(to_generate)
            extra_items = self._generate_extra_quiz_questions(extracted_text, flashcard_pairs, needed=needed, content_level=content_level)
            for ex in extra_items:
                q_text = ex.get('question', '').strip()
                c_ans = ex.get('correct_answer', '').strip()
                if not q_text or not c_ans:
                    continue
                q_norm = re.sub(r'[^\w\s]', '', q_text).lower().strip()
                q_norm = re.sub(r'\s+', ' ', q_norm)
                if q_norm and q_norm not in seen_questions:
                    seen_questions.add(q_norm)
                    to_generate.append({
                        "question": q_text,
                        "correct_answer": c_ans,
                        "options": ex.get("options", [])
                    })
                if len(to_generate) >= max_questions:
                    break

        # Batch generate distractors for the questions
        distractors_map = self._generate_batch_distractors(to_generate)

        quiz_data = []
        for item in to_generate[:max_questions]:
            q_text = item["question"]
            c_ans = item["correct_answer"]
            distractors = distractors_map.get(q_text.lower(), [])
            
            raw_opts = item.get("options", [])
            if not raw_opts:
                options = [{"text": c_ans, "is_correct": True}]
                for d in distractors:
                    options.append({"text": d, "is_correct": False})
            else:
                options = raw_opts

            norm = self._normalize_quiz_item({
                'question': q_text,
                'correct_answer': c_ans,
                'options': options
            }, answer_pool, content_level=content_level)
            
            if norm:
                quiz_data.append(norm)

        # Guarantee exact max_questions (20 questions) target
        if len(quiz_data) < max_questions and to_generate:
            idx = 0
            while len(quiz_data) < max_questions and idx < len(to_generate):
                item = to_generate[idx % len(to_generate)]
                options = item.get("options", [])
                if not options:
                    options = [{"text": item["correct_answer"], "is_correct": True}]
                    for d in distractors_map.get(item["question"].lower(), []):
                        options.append({"text": d, "is_correct": False})
                norm = self._normalize_quiz_item({
                    'question': item["question"],
                    'correct_answer': item["correct_answer"],
                    'options': options
                }, answer_pool, content_level=content_level)
                if norm:
                    quiz_data.append(norm)
                idx += 1

        print(f"[Groq-QuizGen] Quiz generated successfully with {len(quiz_data[:max_questions])} questions.")
        return quiz_data[:max_questions]

    def _generate_descriptive_quiz_questions(self, text: str, flashcards: List[Dict], needed: int = 20, content_level: str = "Medium") -> List[Dict]:
        """
        Generates high-quality multiple-choice questions directly from descriptive flashcards.
        Tests concept identification (from definition/purpose) and mechanisms/outcomes (from Sentence 2).
        """
        try:
            self._init_client()
            if not self.client:
                return []

            # Format descriptive cards as clear study concepts
            concept_snippets = []
            for i, c in enumerate(flashcards[:25]):
                if not isinstance(c, dict):
                    continue
                subj = c.get('question', '').strip()
                desc = c.get('answer', '').strip()
                if subj and desc:
                    concept_snippets.append(f"Concept {i+1}: {subj}\nExplanation: {desc}")

            context_str = "\n\n".join(concept_snippets)
            if not context_str:
                context_str = text[:10000]

            prompt = f"""
You are an expert educational quiz creator. Generate exactly {needed} unique, high-quality multiple-choice questions based STRICTLY on the concepts and details in the study flashcards below.

Study Flashcards (Concepts & Explanations):
{context_str}

Study Text Context:
{text[:6000]}

CRITICAL QUIZ GENERATION REQUIREMENTS:
1. Generate exactly {needed} unique multiple-choice questions.
2. The questions MUST directly test the student's knowledge of the flashcard concepts:
   - Formulate questions that test identification of the concept based on its core purpose or definition (e.g., "Which biological process allows plants to convert sunlight into chemical energy?" -> "Photosynthesis").
   - Formulate questions that test specific mechanisms, components, fuels, and outcomes described in Sentence 2 of the flashcards (e.g., "Where inside plant cells does the transformation of carbon dioxide and water into glucose take place?" -> "Chloroplasts").
3. Multiple Choice Choices:
   - Every question must have EXACTLY 4 options (1 correct answer, 3 plausible, category-matched distractors).
   - Keep answers and distractors concise and direct (do NOT use long paragraphs as options).
   - Category Matching: Distractors must belong to the same topic/entity category as the correct answer.
4. Keep the exact same language (Filipino/Tagalog or English) as the study flashcards.
5. Output MUST be a strictly valid JSON object without markdown wrappers:
{{
  "questions": [
    {{
      "question": "Clear question text here...",
      "correct_answer": "Concise correct answer here...",
      "options": [
        {{"text": "Option 1", "is_correct": false}},
        {{"text": "Concise correct answer here...", "is_correct": true}},
        {{"text": "Option 3", "is_correct": false}},
        {{"text": "Option 4", "is_correct": false}}
      ]
    }}
  ]
}}
"""
            model_to_use = "openai/gpt-oss-20b"
            try:
                response = self.client.chat.completions.create(
                    model=model_to_use,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
            except Exception as api_err:
                print(f"[Groq-QuizGen] Descriptive quiz primary key failed: {api_err}. Trying backup API key...")
                from models.groq_helper import get_groq_client, mark_primary_failed
                mark_primary_failed()
                self.client, _ = get_groq_client(force_backup=True)
                response = self.client.chat.completions.create(
                    model=model_to_use,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )

            quiz_items = []
            if response and response.choices:
                raw_json = response.choices[0].message.content.strip()
                res_data = json.loads(raw_json)
                if isinstance(res_data, list):
                    quiz_items = res_data
                elif isinstance(res_data, dict):
                    if "questions" in res_data and isinstance(res_data["questions"], list):
                        quiz_items = res_data["questions"]
                    elif "quiz" in res_data and isinstance(res_data["quiz"], list):
                        quiz_items = res_data["quiz"]
                    else:
                        lists = [v for v in res_data.values() if isinstance(v, list)]
                        quiz_items = lists[0] if lists else []

            # Normalize and validate each item
            answer_pool = [c.get('question', '').strip() for c in flashcards if isinstance(c, dict) and c.get('question')]
            normalized = []
            for item in quiz_items:
                norm = self._normalize_quiz_item(item, answer_pool, content_level=content_level)
                if norm:
                    normalized.append(norm)

            # If still fewer than needed, generate remaining extra questions
            if len(normalized) < needed:
                rem = needed - len(normalized)
                print(f"[Groq-QuizGen] Descriptive quiz generated {len(normalized)} items. Requesting {rem} more...")
                extra = self._generate_extra_quiz_questions(text, flashcards, needed=rem, content_level=content_level)
                for ex in extra:
                    norm = self._normalize_quiz_item(ex, answer_pool, content_level=content_level)
                    if norm:
                        normalized.append(norm)

            # Final safety guarantee: if still short of needed, synthesize contextual variations from existing cards
            if len(normalized) < needed and (flashcards or normalized):
                source_pool = normalized if normalized else []
                idx = 0
                while len(normalized) < needed and source_pool:
                    base = source_pool[idx % len(source_pool)]
                    idx += 1
                    var_item = {
                        "question": f"Review: {base['question']}",
                        "correct_answer": base["correct_answer"],
                        "options": [dict(o) for o in base["options"]]
                    }
                    random.shuffle(var_item["options"])
                    normalized.append(var_item)

            return normalized[:needed]
        except Exception as e:
            print(f"[Groq-QuizGen] Failed to generate descriptive quiz: {e}")
            return []

    def _generate_extra_quiz_questions(self, text: str, flashcards: List[Dict], needed: int = 17, content_level: str = "Medium") -> List[Dict]:
        """
        Generates additional multiple-choice questions from study text and flashcards
        to ensure every quiz reaches the standard 20-question target.
        """
        try:
            self._init_client()
            if not self.client:
                return []
            
            context_str = text[:10000] if text else json.dumps(flashcards, ensure_ascii=False)
            
            prompt = f"""
You are an expert educational quiz creator. Generate exactly {needed} unique, high-quality multiple-choice questions based on the study content below.

Study Content:
{context_str}

Requirements:
1. Generate exactly {needed} unique questions.
2. Keep the exact same language as the text (Filipino/Tagalog or English).
3. Output MUST be a strictly valid JSON object with a "questions" key:
{{
  "questions": [
    {{
      "question": "Question text here...",
      "correct_answer": "Correct answer here...",
      "options": [
        {{"text": "Option 1", "is_correct": false}},
        {{"text": "Correct answer here...", "is_correct": true}},
        {{"text": "Option 3", "is_correct": false}},
        {{"text": "Option 4", "is_correct": false}}
      ]
    }}
  ]
}}
"""
            try:
                response = self.client.chat.completions.create(
                    model="openai/gpt-oss-20b",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
            except Exception as api_err:
                print(f"[Groq-QuizGen] Extra question generation primary key failed: {api_err}. Trying backup API key...")
                from models.groq_helper import get_groq_client, mark_primary_failed
                mark_primary_failed()
                self.client, _ = get_groq_client(force_backup=True)
                response = self.client.chat.completions.create(
                    model="openai/gpt-oss-20b",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
            if response and response.choices:
                raw_text = response.choices[0].message.content.strip()
                res_data = json.loads(raw_text)
                if isinstance(res_data, list):
                    return res_data
                elif isinstance(res_data, dict):
                    if "questions" in res_data and isinstance(res_data["questions"], list):
                        return res_data["questions"]
                    elif "quiz" in res_data and isinstance(res_data["quiz"], list):
                        return res_data["quiz"]
                    else:
                        lists = [v for v in res_data.values() if isinstance(v, list)]
                        if lists:
                            return lists[0]
        except Exception as e:
            print(f"[Groq-QuizGen] Failed to generate extra quiz items via Groq: {e}")

        # Fallback to Gemini if Groq failed or couldn't generate extra items
        if os.environ.get("GEMINI_API_KEY"):
            try:
                from models.gemini_quiz_generator import GeminiQuizGenerator
                gem_gen = GeminiQuizGenerator.get_instance()
                gem_extra = gem_gen._generate_extra_quiz_questions(text, flashcards, needed=needed, content_level=content_level)
                if gem_extra:
                    print(f"[Groq-QuizGen] Gemini successfully generated {len(gem_extra)} extra quiz items as fallback.")
                    return gem_extra
            except Exception as ge:
                print(f"[Groq-QuizGen] Gemini extra quiz generation fallback failed: {ge}")

        return []

    def _generate_batch_distractors(self, items: List[Dict]) -> Dict[str, List[str]]:
        """
        Generates 3 semantic-category-matched incorrect options for each Q-A pair in batch.
        """
        try:
            self._init_client()
            if not self.client:
                return {}
            
            items_list = [{"question": item["question"], "correct_answer": item["correct_answer"]} for item in items]
            
            prompt = f"""
You are an expert educational test designer. For each of the following quiz questions and correct answers, generate exactly 3 incorrect distractors.

CRITICAL CHOICE CORRELATION REQUIREMENTS:
1. Strict Category Matching: Every distractor MUST belong to the exact same domain, entity type, and topic as the correct answer.
   - Tech / Acronym (e.g., "www" -> "World Wide Web"): Distractors MUST be plausible tech acronym variations (e.g., ["Wide World Web", "World Web Wide", "Web Wide Window"]). NEVER use city, province, or mountain names!
   - Island Province (e.g., "Romblon"): Distractors MUST be other island provinces (e.g., ["Palawan", "Marinduque", "Batanes"]). NEVER use mountains ("Bundok Apo") or historical sites ("Intramuros")!
   - Mountain (e.g., "Bundok Apo"): Distractors MUST be other mountains (e.g., ["Bundok Pulag", "Bundok Mayon", "Bundok Kanlaon"]). NEVER use city names!
   - City (e.g., "Maynila"): Distractors MUST be other cities (e.g., ["Cebu City", "Davao City", "Iloilo City"]).
2. Zero Cross-Topic Contamination: Do NOT reuse options across unrelated topics. Options for a question MUST be 100% relevant to that specific question's concept.
3. Plausibility: Distractors must be plausible and challenging, not obviously wrong or silly.
4. Language: Distractors must be in the exact same language (Filipino/Tagalog/Taglish or English) as the correct answer.
5. Output must be a JSON object mapping the lowercase question text to an array of exactly 3 distractor strings. Do not include markdown wrappers.

Input Questions and Answers:
{json.dumps(items_list, ensure_ascii=False)}

Expected JSON Output format:
{{
  "question text here": ["distractor 1", "distractor 2", "distractor 3"]
}}
"""
            try:
                response = self.client.chat.completions.create(
                    model="openai/gpt-oss-20b",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
            except Exception as api_err:
                print(f"[Groq-QuizGen] Batch distractor generation primary key failed: {api_err}. Trying backup API key...")
                from models.groq_helper import get_groq_client, mark_primary_failed
                mark_primary_failed()
                self.client, _ = get_groq_client(force_backup=True)
                response = self.client.chat.completions.create(
                    model="openai/gpt-oss-20b",
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
            if response and response.choices:
                res_dict = json.loads(response.choices[0].message.content.strip())
                return {str(k).lower().strip(): v for k, v in res_dict.items() if isinstance(v, list)}
        except Exception as e:
            print(f"[Groq-QuizGen] Failed to generate batch distractors: {e}")
        return {}

    def _normalize_quiz_item(self, q: Dict, fallback_pool: List[str] = None, content_level: str = "Medium") -> Dict:
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
            smart_dist = generator.generate_distractors(question, correct_ans, existing_deck_answers=fallback_pool or [], count=needed, content_level=content_level)
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
