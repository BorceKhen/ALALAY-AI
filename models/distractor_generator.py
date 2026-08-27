# models/distractor_generator.py
"""
Smart Contextual Distractor Generator for ALALAY-AI
Generates semantically matched, plausible distractors for quiz options
matching language (Filipino/English), category (Numbers, Shapes, Locations, Persons, Concepts),
and guarantees no repetitive distractors across questions.
"""

import re
import random
from typing import List, Dict


class SmartDistractorGenerator:
    _instance = None

    @classmethod
    def get_instance(cls) -> "SmartDistractorGenerator":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def generate_distractors(
        self,
        question: str,
        correct_answer: str,
        existing_deck_answers: List[str] = None,
        count: int = 3,
        content_level: str = "Medium"
    ) -> List[str]:
        q_lower = (question or "").lower()
        a_lower = (correct_answer or "").lower()
        ans_str = (correct_answer or "").strip()
        level = (content_level or "Medium").strip().capitalize()

        is_filipino = self._is_tagalog(q_lower + " " + a_lower)
        distractors = []

        # ── Category 1: Numbers / Quantities / Measurements ──────────
        num_match = re.search(r'\b(\d+(?:\.\d+)?)\s*([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]*)\b', ans_str)
        if num_match and not self._is_year(ans_str):
            val_str, unit = num_match.groups()
            try:
                val = float(val_str)
                is_int = val.is_integer()
                val_int = int(val) if is_int else val
                
                # Adjust numerical offsets based on difficulty content_level
                if level == "Easy":
                    multipliers = [0.5, 2.0, 3.0, 4.0]  # Clearly distinct numbers
                elif level == "Hard":
                    multipliers = [0.8, 1.2, 0.9, 1.1, 1.3]  # Challenging, close numbers
                else:
                    multipliers = [0.5, 1.5, 2.0, 0.25, 3.0, 2.5]  # Medium (Default)
                random.shuffle(multipliers)
                
                generated_nums = []
                for m in multipliers:
                    new_val = val * m
                    if is_int:
                        new_val = int(round(new_val))
                    else:
                        new_val = round(new_val, 1)
                    if new_val != val_int and new_val > 0 and new_val not in generated_nums:
                        generated_nums.append(new_val)
                    if len(generated_nums) >= count:
                        break
                
                prefix = ans_str[:num_match.start()]
                suffix = ans_str[num_match.end():]
                unit_str = ((" " + unit) if unit else "")
                
                for g_val in generated_nums:
                    dist_text = f"{prefix}{g_val}{unit_str}{suffix}".strip()
                    dist_text = re.sub(r'\s+', ' ', dist_text)
                    if dist_text and dist_text.lower() != a_lower and dist_text not in distractors:
                        distractors.append(dist_text)
            except Exception:
                pass

        # ── Category 2: Shapes / Geometry ────────────────────────────
        if not distractors and any(w in q_lower or w in a_lower for w in ["shape", "hugis", "oktagono", "tatsulok", "bilog", "parisukat", "hexagon", "pentagon", "sulok"]):
            if is_filipino:
                if level == "Easy":
                    candidates = ["Tatsulok", "Bilog", "Parisukat", "Hexagon", "Pentagon", "Rektanggulo"]
                else:
                    candidates = [
                        "Tatsulok (hugis na may 3 sulok)",
                        "Bilog (hugis na walang sulok)",
                        "Parisukat (hugis na may 4 na pantay na sulok)",
                        "Hexagon (hugis na may 6 na sulok)",
                        "Pentagon (hugis na may 5 sulok)",
                        "Rektanggulo (hugis na may 4 na sulok)"
                    ]
            else:
                if level == "Easy":
                    candidates = ["Triangle", "Circle", "Square", "Hexagon", "Pentagon", "Rectangle"]
                else:
                    candidates = [
                        "Triangle (3 sides)",
                        "Circle (no corners)",
                        "Square (4 equal sides)",
                        "Hexagon (6 sides)",
                        "Pentagon (5 sides)",
                        "Rectangle (4 sides)"
                    ]
            for c in candidates:
                if c.lower() != a_lower and c not in distractors:
                    distractors.append(c)
                if len(distractors) >= count:
                    break

        # ── Category 3: Countries / Groups of Countries / Alliances ──
        if not distractors and any(w in q_lower or w in a_lower for w in ["bansa", "country", "countries", "axis", "allies", "nations", "digmaan", "war"]):
            if is_filipino:
                candidates = [
                    "Estados Unidos, Gran Britanya, at Rusya",
                    "Pransya, Espanya, at Portugal",
                    "Tsina, Timog Korea, at Hapon",
                    "Alemanya, Austria, at Hungary",
                    "Kanada, Australia, at Bagong Silang"
                ]
            else:
                candidates = [
                    "United States, Great Britain, and Soviet Union",
                    "France, Spain, and Portugal",
                    "China, South Korea, and Japan",
                    "Germany, Austria, and Hungary",
                    "Canada, Australia, and New Zealand"
                ]
            for c in candidates:
                if c.lower() != a_lower and c not in distractors:
                    distractors.append(c)
                if len(distractors) >= count:
                    break

        # ── Category 4: Cities / Locations (Only for location questions) ──
        if not distractors and any(w in q_lower for w in ["kapital", "capital", "lungsod", "city", "lunsod", "bayan", "saan", "where", "location"]):
            if is_filipino or "pilipinas" in q_lower or "philippines" in q_lower:
                candidates = [
                    "Cebu City",
                    "Davao City",
                    "Iloilo City",
                    "Baguio City",
                    "Quezon City",
                    "Zamboanga City"
                ]
            else:
                candidates = [
                    "Tokyo",
                    "Paris",
                    "London",
                    "Washington D.C.",
                    "Berlin",
                    "Rome"
                ]
            for c in candidates:
                if c.lower() != a_lower and c not in distractors:
                    distractors.append(c)
                if len(distractors) >= count:
                    break

        # ── Category 5: Filter existing deck answers for semantically relevant matches ──
        if len(distractors) < count and existing_deck_answers:
            for ans in existing_deck_answers:
                ans_clean = (ans or "").strip()
                if not ans_clean or ans_clean.lower() == a_lower:
                    continue
                # Do NOT use cities as distractors unless question asks for location
                ans_is_city = any(c in ans_clean.lower() for c in ["maynila", "cebu", "boracay", "davao"])
                q_wants_city = any(w in q_lower for w in ["kapital", "capital", "lungsod", "city", "saan", "where"])
                if ans_is_city and not q_wants_city:
                    continue
                
                if ans_clean not in distractors:
                    distractors.append(ans_clean)
                if len(distractors) >= count:
                    break

        # ── Fallback filler if still needed ──
        if len(distractors) < count:
            if is_filipino:
                fallback_pool = [
                    "Wala sa mga nabanggit",
                    "Lahat ng nabanggit",
                    "Hindi matukoy sa impormasyon",
                    "Parehong A at B"
                ]
            else:
                fallback_pool = [
                    "None of the above",
                    "All of the above",
                    "Cannot be determined",
                    "Both A and B"
                ]
            for fb in fallback_pool:
                if fb.lower() != a_lower and fb not in distractors:
                    distractors.append(fb)
                if len(distractors) >= count:
                    break

        return distractors[:count]

    @staticmethod
    def _is_tagalog(text: str) -> bool:
        stopwords = {"ang", "mga", "ano", "paano", "bakit", "saan", "kailan", "sa", "ng", "na", "at", "o", "isang", "ito", "sila", "tayo", "kami"}
        tokens = set(re.findall(r'\b[a-z]+\b', text.lower()))
        return len(tokens & stopwords) >= 1

    @staticmethod
    def _is_year(text: str) -> bool:
        m = re.search(r'\b(1[789]\d{2}|20\d{2})\b', text)
        return bool(m)
