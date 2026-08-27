# t5_quiz_generator.py — Plain T5 (e2e-qg) Quiz Generation Module
import os
import sys
import random
from typing import List, Dict

# Add the question_generation directory to the Python path
QG_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "question_generation"
)
if QG_DIR not in sys.path:
    sys.path.insert(0, QG_DIR)


class T5QuizGenerator:
    """
    Generates multiple-choice quiz questions from deck text using
    the Plain T5 (e2e-qg) pipeline from the question_generation directory.

    Lazily loads the model on first use and caches it in memory.
    """

    _instance = None  # Singleton to avoid reloading model on every request

    def __init__(self):
        self.pipeline = None

    @classmethod
    def get_instance(cls) -> "T5QuizGenerator":
        """Returns a cached singleton instance to avoid reloading the model."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def _load_pipeline(self):
        """Lazy-loads the Plain T5 e2e-qg pipeline."""
        if self.pipeline is not None:
            return  # Already loaded

        print("[T5-QuizGen] Loading Plain T5 e2e-qg pipeline...")

        from pipelines import pipeline as qg_pipeline
        self.pipeline = qg_pipeline("e2e-qg", use_cuda=False)

        print("[T5-QuizGen] Pipeline loaded successfully.")

    @staticmethod
    def chunk_text(text: str, max_words: int = 300) -> List[str]:
        """Splits text into chunks suitable for the T5 512-token limit."""
        words = text.split()
        chunks = []
        i = 0
        while i < len(words):
            chunk_words = words[i:i + max_words]
            chunks.append(" ".join(chunk_words))
            i += max_words
        return chunks

    @staticmethod
    def _find_best_answer(question: str, flashcard_pairs: List[Dict[str, str]]) -> str:
        """
        Finds the most relevant flashcard answer for a generated question
        by checking word overlap between the question and each flashcard's question.
        """
        best_score = -1
        best_answer = ""

        question_words = set(question.lower().split())

        for card in flashcard_pairs:
            card_q_words = set(card["question"].lower().split())
            overlap = len(question_words & card_q_words)
            if overlap > best_score:
                best_score = overlap
                best_answer = card["answer"]

        return best_answer if best_answer else "N/A"

    @staticmethod
    def _make_distractors(question: str, correct_answer: str, all_answers: List[str], count: int = 3) -> List[str]:
        """
        Uses SmartDistractorGenerator to generate contextually matched, high-quality distractors.
        """
        from models.distractor_generator import SmartDistractorGenerator
        generator = SmartDistractorGenerator.get_instance()
        return generator.generate_distractors(question, correct_answer, existing_deck_answers=all_answers, count=count)

    def generate_quiz(
        self,
        extracted_text: str,
        flashcard_pairs: List[Dict[str, str]],
        max_questions: int = 20
    ) -> List[Dict]:
        """
        Generates multiple-choice quiz questions strictly focused on the content of the provided flashcards.
        Guarantees 100% topic alignment and prevents any duplicate questions.
        """
        if not flashcard_pairs:
            print("[T5-QuizGen] No flashcards available for quiz generation.")
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

        all_answers = [c.get('answer', '').strip() for c in flashcard_pairs if isinstance(c, dict) and c.get('answer')]

        quiz_items = []
        for card in unique_cards:
            q_text = card.get('question', '').strip()
            correct = card.get('answer', '').strip()

            # Build smart distractors matching the specific question category
            distractors = self._make_distractors(q_text, correct, all_answers, count=3)

            # Combine and shuffle options
            options = [{"text": correct, "is_correct": True}]
            for d in distractors:
                options.append({"text": d, "is_correct": False})
            random.shuffle(options)

            quiz_items.append({
                "question": q_text,
                "correct_answer": correct,
                "options": options
            })

        print(f"[T5-QuizGen] Quiz generated successfully with {len(quiz_items)} questions from flashcards.")
        return quiz_items
