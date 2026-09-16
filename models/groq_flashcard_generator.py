# groq_flashcard_generator.py — Groq API Flashcard Generation Module
import os
import json
from typing import List, Dict


class GroqFlashcardGenerator:
    """
    Generates question–answer flashcard pairs from text using Groq's API.
    Natively supports multilingual text (such as Filipino, English, and Taglish).
    """

    _instance = None  # Singleton pattern

    @classmethod
    def get_instance(cls) -> "GroqFlashcardGenerator":
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
            print(f"[Groq-FlashGen] Error initializing Groq client: {e}")
            raise

    def generate_deck(self, extracted_text: str, content_level: str = "Medium", deck_structure: str = "question") -> List[Dict[str, str]]:
        """
        Queries Groq to generate flashcard pairs from the study text.
        Supports both Question-Answer and Descriptive 2-Sentence Paragraph structures.
        """
        # Initialize client (will raise if keys missing or package not installed)
        self._init_client()

        if not extracted_text or not extracted_text.strip():
            print("[Groq-FlashGen] Error: No extracted text available for flashcard generation.")
            return []

        is_descriptive = (str(deck_structure or "question").strip().lower() == "descriptive")

        # Simple Tagalog keyword matching
        tagalog_keywords = {
            "ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o",
            "isang", "may", "para", "dahil", "wika", "filipino", "pilipino", "ito", "sila", "tayo"
        }
        words = set(extracted_text.lower().split()[:2000])
        is_tagalog = len(words.intersection(tagalog_keywords)) >= 3

        # Configure language instruction and matching format example
        if is_descriptive:
            if is_tagalog:
                lang_instruction = "LANGUAGE REQUIREMENT: The study text is in Filipino/Tagalog (or Taglish). You MUST generate all concepts and descriptions in Filipino/Tagalog (or Taglish). DO NOT translate to English."
                format_instruction = """CRITICAL STRUCTURE REQUIREMENT — DESCRIPTIVE DECLARATIVE FORMAT (TALATA):
Format bawat flashcard bilang structured descriptive concept na may eksaktong DALAWANG PANGUNGUSAP sa sagot:
- "question": Ang tiyak na Paksa o Pangalan ng Konsepto (hal. "Photosynthesis").
- "answer": Isang talata na may eksaktong DALAWANG PANGUNGUSAP gamit ang sumusunod na pormula:
  * Pangungusap 1 (Pagkakakilanlan at Pangunahing Layunin): [Paksa] ay isang [mas malawak na kategorya] na [pangunahing gamit, depinisyon, o pagkilos]. (Sinasagot: Ano ito at ano ang layunin nito?)
  * Pangungusap 2 (Paraan ng Pagsasagawa at Kahalagahan): Sa pamamagitan ng [pangunahing mekanismo, pamamaraan, o sangkap], ito ay [pangunahing resulta, epekto, o gamit sa totoong buhay]. (Sinasagot: Paano ito gumagana at ano ang resulta?)
Pagsamahin ang dalawang pangungusap sa isang maayos na talata. Huwag gumamit ng bullet points o numbering sa sagot."""
                json_example = """{
  "cards": [
    {
      "question": "Photosynthesis",
      "answer": "Ang photosynthesis ay ang proseso kung saan ang mga halaman at ilang bakterya ay nagko-convert ng sikat ng araw tungo sa kemikal na enerhiya. Sa pamamagitan ng pagbabago ng carbon dioxide at tubig sa loob ng chloroplasts, lumilikha ito ng glucose para sa enerhiya habang naglalabas ng oxygen bilang byproduct."
    }
  ]
}"""
            else:
                lang_instruction = "LANGUAGE REQUIREMENT: The study text is in English. You MUST generate all concepts and descriptions in English."
                format_instruction = """CRITICAL DESCRIPTIVE STRUCTURE REQUIREMENT (2-SENTENCE PARAGRAPH):
Format every flashcard as a structured descriptive concept with an EXACT TWO-SENTENCE paragraph for the answer:
- "question": The exact Subject or Concept name (e.g., "Photosynthesis").
- "answer": A strict TWO-SENTENCE descriptive paragraph following this EXACT formula:
  * Sentence 1 (Identification & Core Purpose): [Subject] is a [broader category] that [primary function, definition, or primary action]. Answers: What is it, and what is its main goal?
  * Sentence 2 (Execution & Significance): By [key mechanism, method, or components], it [key outcome, consequence, or real-world application]. (Or starting with 'Inside/By/Through [key mechanism]...'). Answers: How does it work, and what is the outcome?
Both sentences MUST combine smoothly into a single coherent paragraph. Do NOT use bullet points or numbering in the answer."""
                json_example = """{
  "cards": [
    {
      "question": "Photosynthesis",
      "answer": "Photosynthesis is the process where plants, algae, and certain bacteria convert sunlight into chemical energy. Inside chloroplasts, they transform carbon dioxide and water into glucose for fuel, releasing oxygen as a byproduct."
    }
  ]
}"""
        else:
            if is_tagalog:
                lang_instruction = "LANGUAGE REQUIREMENT: The study text is in Filipino/Tagalog (or Taglish). You MUST generate all questions and answers in Filipino/Tagalog (or Taglish). DO NOT translate to English."
                format_instruction = "Format each flashcard as a question-answer pair. Keep questions clear and answers concise."
                json_example = """{
  "cards": [
    {
      "question": "Ano ang pangunahing ideya ng teksto?",
      "answer": "Ang pangunahing ideya ay naglalarawan ng kahalagahan ng paksa."
    }
  ]
}"""
            else:
                lang_instruction = "LANGUAGE REQUIREMENT: The study text is in English. You MUST generate all questions and answers in English."
                format_instruction = "Format each flashcard as a question-answer pair. Keep questions clear and answers concise."
                json_example = """{
  "cards": [
    {
      "question": "What is the primary concept of the text?",
      "answer": "The primary concept describes the core meaning of the topic."
    }
  ]
}"""

        # Set up difficulty/complexity constraints dynamically based on language
        content_level_str = str(content_level or "Medium").strip().lower()
        if is_tagalog:
            if content_level_str == "easy":
                level_instruction = "Siguraduhing napakasimple ng mga salita at ang mga paliwanag ay nakasulat gamit ang mga payak at madaling maunawaang salita (in Filipino/Tagalog)."
            elif content_level_str == "hard":
                level_instruction = "Siguraduhing ang mga paliwanag ay nangangailangan ng masusing pagsusuri at komprehensibo (in Filipino/Tagalog)."
            else:
                level_instruction = "Siguraduhing ang mga paliwanag ay malinaw, maikli, at balanse (in Filipino/Tagalog)."
        else:
            if content_level_str == "easy":
                level_instruction = "Ensure content is written using straightforward, plain-language definitions and easy-to-understand words."
            elif content_level_str == "hard":
                level_instruction = "Ensure content is rigorous, detailed, and comprehensive."
            else:
                level_instruction = "Ensure content is clear, concise, and balanced."

        prompt = f"""
You are an expert educational assistant. Your task is to generate high-quality study flashcards based on the study text provided below.

---
Study Text:
{extracted_text[:12000]}
---

Requirements:
1. {lang_instruction}
2. CRITICAL QUANTITY REQUIREMENT: You MUST generate EXACTLY 20 distinct flashcards covering every main idea, detail, vocabulary, concept, and sub-point in the study text. Do not stop until you have created 20 cards.
3. {format_instruction}
4. {level_instruction}
5. Output must be strictly valid JSON matching the format below, without markdown wrappers or descriptions.
6. CRITICAL SPELLING ACCURACY: You must preserve the EXACT spelling of all concepts, terms, vocabulary, names, and key definitions from the Study Text. Do not translate, paraphrase, correct, or change the spelling of these key terms.

Expected JSON output format:
{json_example}
"""

        try:
            model_to_use = "openai/gpt-oss-20b"
            print(f"[Groq-FlashGen] Requesting flashcards from Groq using model ({model_to_use}, structure={deck_structure})...")
            
            try:
                response = self.client.chat.completions.create(
                    model=model_to_use,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )
            except Exception as api_err:
                print(f"[Groq-FlashGen] Primary key failed: {api_err}. Trying backup API key...")
                from models.groq_helper import get_groq_client, mark_primary_failed
                mark_primary_failed()
                self.client, _ = get_groq_client(force_backup=True)
                response = self.client.chat.completions.create(
                    model=model_to_use,
                    messages=[{"role": "user", "content": prompt}],
                    response_format={"type": "json_object"}
                )

            response_text = response.choices[0].message.content
            cards = []
            if response_text:
                data = json.loads(response_text.strip())
                if isinstance(data, list):
                    cards = data
                elif isinstance(data, dict):
                    if "cards" in data and isinstance(data["cards"], list):
                        cards = data["cards"]
                    elif "flashcards" in data and isinstance(data["flashcards"], list):
                        cards = data["flashcards"]
                    else:
                        lists = [v for v in data.values() if isinstance(v, list)]
                        if lists:
                            cards = lists[0]
                        else:
                            cards = [v for v in data.values() if isinstance(v, dict) and "question" in v and "answer" in v]
                
            # If fewer than 20 cards generated, request additional cards to reach 20
            if len(cards) < 20 and extracted_text:
                needed = 20 - len(cards)
                print(f"[Groq-FlashGen] Flashcards initial count is {len(cards)}. Requesting {needed} more to reach 20 standard cards...")
                try:
                    if is_descriptive:
                        extra_rule = "Each card MUST have 'question' (Subject Name) and 'answer' (exact 2-sentence descriptive paragraph: Sentence 1 = Identification/Purpose, Sentence 2 = Execution/Significance)."
                    else:
                        extra_rule = "Each card MUST have 'question' (clear inquiry) and 'answer' (concise target answer)."

                    extra_prompt = f"""
Based on the study text below, generate EXACTLY {needed} additional UNIQUE study flashcards that do NOT repeat any previous cards.
{extra_rule}

Existing Cards:
{json.dumps([c.get('question', '') for c in cards if isinstance(c, dict)], ensure_ascii=False)}

Study Text:
{extracted_text[:10000]}

Output MUST be a JSON object with a "cards" array:
{json_example}
"""
                    try:
                        extra_res = self.client.chat.completions.create(
                            model=model_to_use,
                            messages=[{"role": "user", "content": extra_prompt}],
                            response_format={"type": "json_object"}
                        )
                    except Exception as api_err:
                        print(f"[Groq-FlashGen] Extra generation primary key failed: {api_err}. Trying backup API key...")
                        from models.groq_helper import get_groq_client, mark_primary_failed
                        mark_primary_failed()
                        self.client, _ = get_groq_client(force_backup=True)
                        extra_res = self.client.chat.completions.create(
                            model=model_to_use,
                            messages=[{"role": "user", "content": extra_prompt}],
                            response_format={"type": "json_object"}
                        )
                    
                    if extra_res and extra_res.choices:
                        extra_data = json.loads(extra_res.choices[0].message.content.strip())
                        if isinstance(extra_data, list):
                            extra_list = extra_data
                        elif isinstance(extra_data, dict):
                            if "cards" in extra_data and isinstance(extra_data["cards"], list):
                                extra_list = extra_data["cards"]
                            elif "flashcards" in extra_data and isinstance(extra_data["flashcards"], list):
                                extra_list = extra_data["flashcards"]
                            else:
                                lists = [v for v in extra_data.values() if isinstance(v, list)]
                                if lists:
                                    extra_list = lists[0]
                                else:
                                    extra_list = [v for v in extra_data.values() if isinstance(v, dict) and "question" in v and "answer" in v]
                        else:
                            extra_list = []
                        cards.extend(extra_list)
                except Exception as extra_err:
                    print(f"[Groq-FlashGen] Extra card generation warning: {extra_err}")

            # Fallback to Gemini if still fewer than 20 cards and Gemini is configured
            if len(cards) < 20 and os.environ.get("GEMINI_API_KEY") and extracted_text:
                try:
                    from models.gemini_flashcard_generator import GeminiFlashcardGenerator
                    gem_gen = GeminiFlashcardGenerator.get_instance()
                    gem_cards = gem_gen.generate_deck(extracted_text, content_level=content_level, deck_structure=deck_structure)
                    seen_q = {c.get('question', '').strip().lower() for c in cards if isinstance(c, dict)}
                    for gc in gem_cards:
                        if isinstance(gc, dict) and gc.get('question', '').strip().lower() not in seen_q:
                            cards.append(gc)
                            seen_q.add(gc.get('question', '').strip().lower())
                        if len(cards) >= 20:
                            break
                    print(f"[Groq-FlashGen] Gemini catch-up added cards. Total count now: {len(cards)}")
                except Exception as ge:
                    print(f"[Groq-FlashGen] Gemini fallback catch-up failed: {ge}")

            # Final safety guarantee: if still short of 20 (e.g. very short text), synthesize contextual variations
            if len(cards) < 20 and cards:
                source_pool = [c for c in cards if isinstance(c, dict)]
                idx = 0
                while len(cards) < 20 and source_pool:
                    base = source_pool[idx % len(source_pool)]
                    idx += 1
                    if is_descriptive:
                        var_card = {
                            "question": f"Key Concept: {base.get('question', '')}",
                            "answer": base.get('answer', ''),
                            "type": "descriptive"
                        }
                    else:
                        var_card = {
                            "question": f"Review: {base.get('question', '')}",
                            "answer": base.get('answer', ''),
                            "type": "question"
                        }
                    cards.append(var_card)

            # Tag cards with structure type
            for c in cards:
                if isinstance(c, dict):
                    c['type'] = 'descriptive' if is_descriptive else 'question'

            print(f"[Groq-FlashGen] Flashcards generated successfully using {model_to_use} with {len(cards[:20])} cards.")
            return cards[:20]
            
            print("[Groq-FlashGen] Empty response received from Groq.")
            return []

        except Exception as e:
            print(f"[Groq-FlashGen] Failed to generate flashcard content: {e}", flush=True)
            raise RuntimeError(f"Groq failed: {e}")
