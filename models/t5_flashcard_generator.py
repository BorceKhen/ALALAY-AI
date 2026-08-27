# t5_flashcard_generator.py — LoRA-Enhanced T5 Flashcard Generation Module
import os
import torch
from typing import List, Dict, Tuple


class T5FlashcardGenerator:
    """
    Generates question–answer flashcard pairs from text using a
    LoRA-enhanced T5 model fine-tuned on SQuAD/SciQ datasets.

    Lazily loads the model on first use and caches it in memory.
    """

    _instance = None  # Singleton to avoid reloading model on every request

    def __init__(self, adapter_path: str):
        self.adapter_path = adapter_path
        self.model = None
        self.tokenizer = None
        self.device = "cpu"

    @classmethod
    def get_instance(cls, adapter_path: str) -> "T5FlashcardGenerator":
        """Returns a cached singleton instance to avoid reloading the model."""
        if cls._instance is None or cls._instance.adapter_path != adapter_path:
            cls._instance = cls(adapter_path)
        return cls._instance

    def _load_model(self):
        """Lazy-loads the LoRA T5 model and tokenizer."""
        if self.model is not None:
            return  # Already loaded

        print("[T5-FlashGen] Loading LoRA-enhanced T5 model...")

        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
        from peft import PeftModel, PeftConfig

        peft_config = PeftConfig.from_pretrained(self.adapter_path)
        self.tokenizer = AutoTokenizer.from_pretrained(self.adapter_path)
        base_model = AutoModelForSeq2SeqLM.from_pretrained(peft_config.base_model_name_or_path)
        self.model = PeftModel.from_pretrained(base_model, self.adapter_path)
        self.model.eval()

        # Attempt GPU placement
        if torch.cuda.is_available():
            try:
                self.device = "cuda"
                self.model = self.model.to(self.device)
                print(f"[T5-FlashGen] Model loaded on GPU (CUDA).")
            except RuntimeError as e:
                print(f"[T5-FlashGen] GPU load failed ({e}); falling back to CPU.")
                self.device = "cpu"
                self.model = self.model.to(self.device)
        else:
            self.device = "cpu"
            print(f"[T5-FlashGen] Model loaded on CPU.")

    @staticmethod
    def chunk_text(text: str, max_words: int = 300, overlap: int = 50) -> List[str]:
        """Splits document text into digestible blocks fitted to the 512 token model limit."""
        words = text.split()
        chunks = []
        i = 0
        while i < len(words):
            chunk_words = words[i:i + max_words]
            chunks.append(" ".join(chunk_words))
            i += (max_words - overlap)
        return chunks

    def generate_flashcard(self, context: str) -> Tuple[str, str]:
        """
        Performs inference using T5 LoRA weights to output a single QA flashcard.
        Returns (question, answer) tuple.
        """
        self._load_model()

        inputs = self.tokenizer(
            context,
            max_length=512,
            truncation=True,
            padding="max_length",
            return_tensors="pt"
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model.generate(
                input_ids=inputs["input_ids"],
                attention_mask=inputs["attention_mask"],
                max_length=128,
                num_beams=4,
                early_stopping=True
            )

        # ── 1. Decode WITHOUT skipping special tokens to preserve <sep> ──
        raw_text = self.tokenizer.decode(outputs[0], skip_special_tokens=False)

        def clean_special_tokens(text: str) -> str:
            """Removes T5 special tokens and strips whitespace."""
            for tok in ["<pad>", "<s>", "</s>", "<unk>"]:
                text = text.replace(tok, "")
            return text.strip()

        # Check if the separator token is in the raw decoded text
        if "<sep>" in raw_text:
            q_raw, a_raw = raw_text.split("<sep>", 1)
            q = clean_special_tokens(q_raw)
            a = clean_special_tokens(a_raw)
            if q and a:
                return q, a

        # ── 2. Fallback: Split by the last question mark '?' ──
        clean_text = clean_special_tokens(raw_text)
        if "?" in clean_text:
            parts = clean_text.rsplit("?", 1)
            q = parts[0].strip() + "?"
            a = parts[1].strip()
            if a:
                return q, a

        return clean_text, "No distinct answer generated."

    def generate_deck(self, text: str, num_cards: int = None) -> List[Dict[str, str]]:
        """
        Orchestrates chunking + batch generation to produce a full flashcard deck.
        If num_cards is None, generates one card per chunk (full coverage).
        Returns a list of {question, answer} dicts.
        """
        self._load_model()

        chunks = self.chunk_text(text)

        if num_cards is not None:
            chunks = chunks[:num_cards]

        print(f"[T5-FlashGen] Generating {len(chunks)} flashcards from {len(text.split())} words...")

        flashcards = []
        for i, chunk in enumerate(chunks):
            print(f"[T5-FlashGen] Generating card {i + 1}/{len(chunks)}...")
            q, a = self.generate_flashcard(chunk)
            if q.strip():
                flashcards.append({
                    "question": q,
                    "answer": a
                })

        print(f"[T5-FlashGen] Done! Generated {len(flashcards)} flashcards.")
        return flashcards
