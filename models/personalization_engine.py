import os
import json
import threading
from datetime import datetime, timezone
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from auth_helper import get_db

# Paths for models
MODEL_DIR = os.path.dirname(os.path.abspath(__file__))
WEIGHTS_PATH = os.path.join(MODEL_DIR, "personalization_dqn_model.pth")

# Global thread lock to prevent weight file write race conditions
MODEL_LOCK = threading.Lock()

# Empirical boundaries matching generator.py
DEVICE_UX_BASELINES = {
    "Desktop": {"max_dead_clicks": 15.0, "max_magnification": 6.0, "max_velocity_variance": 40.0},
    "Mobile": {"max_dead_clicks": 30.0, "max_magnification": 15.0, "max_velocity_variance": 75.0},
    "Tablet": {"max_dead_clicks": 20.0, "max_magnification": 10.0, "max_velocity_variance": 55.0}
}
CLI_BASELINES = {"max_regressions": 15.0, "max_replays": 8.0, "max_pauses": 12.0, "max_idle": 120.0, "max_duration": 400.0}
DI_BASELINES = {"max_revisits": 10.0}

ACTION_MAP = {
    idx: {
        "ui_choice": idx // 3,
        "ui_desc": [
            "Standard Buttons, Auto-enable Off",
            "Bigger Buttons, Auto-enable Off",
            "Standard Buttons, Auto-enable On",
            "Bigger Buttons, Auto-enable On"
        ][idx // 3],
        "content_choice": idx % 3,
        "content_desc": ["Easy", "Medium", "Hard"][idx % 3]
    } for idx in range(12)
}

# --- Define PyTorch QNetwork for DQN ---
class QNetwork(nn.Module):
    def __init__(self, state_dim, action_dim):
        super(QNetwork, self).__init__()
        self.network = nn.Sequential(
            nn.Linear(state_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim)
        )

    def forward(self, state):
        return self.network(state)

def _normalize(value, max_val, min_val=0.0):
    if max_val == min_val:
        return 0.0
    norm = (value - min_val) / (max_val - min_val)
    return max(0.0, min(1.0, norm))

def update_user_personalization(user_id, latest_log_id=None, latest_log_data=None):
    """
    1. Fetches all historical logs for user_id from Firestore.
    2. Computes the user state indices (CLI, NFI, DI) and Feature Dependency Scores (FDS) with renamed features.
    3. Feeds these variables into the PyTorch Q-Network model.
    4. Saves the predicted settings as pending_settings in the user's Firestore profile.
    """
    db = get_db()
    if not db:
        print("[Engine] Database connection failed. Aborting personalization.")
        return None

    try:
        # A. Fetch all historical logs of this user
        logs_ref = db.collection("behavioral_logs").where("user_id", "==", user_id)
        logs = []
        for doc in logs_ref.stream():
            log_data = doc.to_dict()
            log_data["_doc_id"] = doc.id
            logs.append(log_data)
            
        if latest_log_id and latest_log_data:
            if not any(l.get("_doc_id") == latest_log_id for l in logs):
                import copy
                log_copy = copy.deepcopy(latest_log_data)
                log_copy["_doc_id"] = latest_log_id
                logs.append(log_copy)
        
        if not logs:
            print(f"[Engine] No interaction history found for user {user_id}. Skipping adaptation.")
            return None

        # Sort logs in memory by timestamp
        logs.sort(key=lambda x: x.get("timestamp", ""))

        valid_logs = [
            log for log in logs 
            if float(log.get("reading_duration_seconds") or 0) >= 5 
            or log.get("quiz_score_percentage") is not None
        ]
        if not valid_logs:
            valid_logs = logs

        total_sessions = len(valid_logs)
        latest_log = valid_logs[-1]
        
        # B. Load profile traits
        profile_ref = db.collection("profiles").document(user_id)
        profile_doc = profile_ref.get()
        disability_type = "None"
        active_settings = {}
        if profile_doc.exists:
            profile_data = profile_doc.to_dict()
            disability_type = profile_data.get("disability_type", "None")
            active_settings = profile_data.get("current_accessibility_configurations") or {}

        # C. Calculate Feature Dependency Scores (FDS) (Rename screen reader to tts, line ruler to dyslexia ruler)
        sessions_active_tts = sum(1 for log in valid_logs if int((log.get("accessibility_feature_usage") or {}).get("tts") or (log.get("accessibility_feature_usage") or {}).get("screen_reader") or 0) > 0)
        sessions_active_focus = sum(1 for log in valid_logs if int((log.get("accessibility_feature_usage") or {}).get("line_focus") or 0) > 0)
        sessions_active_scroll = sum(1 for log in valid_logs if int((log.get("accessibility_feature_usage") or {}).get("auto_scroll") or 0) > 0)

        fds_tts = sessions_active_tts / total_sessions
        fds_dyslexia_ruler = sessions_active_focus / total_sessions
        fds_scroll = sessions_active_scroll / total_sessions

        # D. Calculate Cognitive Load Index (CLI)
        reg = float(latest_log.get("regression_scroll_count") or 0)
        rep = float(latest_log.get("tts_replay_count") or 0)
        pause = float(latest_log.get("tts_pause_frequency") or 0)
        idle = float(latest_log.get("idle_time_seconds") or 0)
        dur = float(latest_log.get("reading_duration_seconds") or 0)

        n_reg = _normalize(reg, CLI_BASELINES["max_regressions"])
        n_rep = _normalize(rep, CLI_BASELINES["max_replays"])
        n_pau = _normalize(pause, CLI_BASELINES["max_pauses"])
        n_idl = _normalize(idle, CLI_BASELINES["max_idle"])
        n_dur = _normalize(dur, CLI_BASELINES["max_duration"])
        cli = (0.50 * n_dur) + (0.30 * n_reg) + (0.20 * n_rep) + (0.20 * n_pau) + (0.20 * n_idl)

        # E. Calculate Navigation Friction Index (NFI / NPC)
        device = latest_log.get("active_device_type", "Desktop")
        if device not in DEVICE_UX_BASELINES:
            device = "Desktop"
        baselines = DEVICE_UX_BASELINES[device]
        
        clicks = float(latest_log.get("dead_clicks") or 0)
        mag = float(latest_log.get("screen_magnification_frequency") or 0)
        vel = float(latest_log.get("scroll_velocity_px_sec") or 0)

        n_clicks = _normalize(clicks, baselines["max_dead_clicks"])
        n_mag = _normalize(mag, baselines["max_magnification"])
        n_vel = _normalize(vel, baselines["max_velocity_variance"])
        nfi = (0.50 * n_vel) + (0.30 * n_clicks) + (0.20 * n_mag)

        # F. Calculate Difficulty Index (DI)
        score = latest_log.get("quiz_score_percentage")
        if score is None:
            quiz_scores = [log.get("quiz_score_percentage") for log in logs if log.get("quiz_score_percentage") is not None]
            score = quiz_scores[-1] if quiz_scores else 75.0
            
        comp = float(latest_log.get("lesson_completion_rate") or 0)
        rev = float(latest_log.get("revisit_frequency") or 1)

        n_quiz = _normalize(score, 100.0)
        n_comp = _normalize(comp, 100.0)
        n_rev = _normalize(rev, DI_BASELINES["max_revisits"])
        di = (0.50 * (1.0 - n_quiz)) + (0.30 * n_rev) + (0.20 * (1.0 - n_comp))

        # F2. Calculate Behavioral Fatigue state
        if (cli > 0.45 or nfi > 0.45 or di > 0.55 or 
            n_clicks >= 0.8 or n_mag >= 0.8 or n_reg >= 0.8 or (1.0 - n_quiz) >= 0.8):
            user_state = "Struggling"
        elif cli < 0.25 and nfi < 0.25 and di < 0.35:
            user_state = "Efficient"
        else:
            user_state = "Normal"

        # G. Save calculated indices back to behavioral logs in Firestore
        latest_doc_id = latest_log.get("_doc_id")
        if latest_doc_id:
            db.collection("behavioral_logs").document(latest_doc_id).update({
                "fds_tts": round(fds_tts, 4),
                "fds_dyslexia_ruler": round(fds_dyslexia_ruler, 4),
                "fds_auto_scroll": round(fds_scroll, 4),
                "cognitive_load_index": round(cli, 4),
                "navigation_friction_index": round(nfi, 4),
                "difficulty_index": round(di, 4),
                "user_state": user_state
            })

            # Also save root profile fields
            db.collection("profiles").document(user_id).set({
                "current_behavioral_state": user_state,
                "latest_cli_score": round(cli, 4),
                "latest_nfi_score": round(nfi, 4),
                "latest_di_score": round(di, 4),
                "last_updated": datetime.now(timezone.utc).isoformat()
            }, merge=True)

        cli_flagged = (cli > 0.45 or n_reg >= 0.8)
        nfi_flagged = (nfi > 0.45 or n_clicks >= 0.8 or n_mag >= 0.8)
        di_flagged = (di > 0.55 or (1.0 - n_quiz) >= 0.8)

        # --- MDP LOGIC ---
        try:
            cli_prev = None
            nfi_prev = None
            di_prev = None
            
            if total_sessions > 1:
                prev_log = logs[-2]
                cli_prev = prev_log.get("cognitive_load_index")
                nfi_prev = prev_log.get("navigation_friction_index")
                di_prev = prev_log.get("difficulty_index")
            
            # Fetch active recommendations (action) from profile doc
            active_action = {}
            if profile_doc.exists:
                active_action = profile_doc.to_dict().get("recommended_settings") or profile_doc.to_dict().get("current_accessibility_configurations") or {}
            
            # Calculate reward: R = 0.4*d_cli + 0.4*d_nfi + 0.2*d_di
            reward = 0.0
            if cli_prev is not None and nfi_prev is not None and di_prev is not None:
                delta_cli = cli_prev - cli
                delta_nfi = nfi_prev - nfi
                delta_di = di_prev - di
                reward = (0.4 * delta_cli) + (0.4 * delta_nfi) + (0.2 * delta_di)
            
            # Formulate MDP transition tuple with gated variables if flagged
            state = {}
            if total_sessions > 1:
                prev_log = logs[-2]
                cli_prev_val = prev_log.get("cognitive_load_index") or 0.0
                nfi_prev_val = prev_log.get("navigation_friction_index") or 0.0
                di_prev_val = prev_log.get("difficulty_index") or 0.0
                
                # Fetch raw variables for previous log
                reg_prev = float(prev_log.get("regression_scroll_count") or 0)
                rep_prev = float(prev_log.get("tts_replay_count") or 0)
                pause_prev = float(prev_log.get("tts_pause_frequency") or 0)
                idle_prev = float(prev_log.get("idle_time_seconds") or 0)
                dur_prev = float(prev_log.get("reading_duration_seconds") or 0)

                clicks_prev = float(prev_log.get("dead_clicks") or 0)
                mag_prev = float(prev_log.get("screen_magnification_frequency") or 0)
                vel_prev = float(prev_log.get("scroll_velocity_px_sec") or 0)

                score_prev = prev_log.get("quiz_score_percentage")
                comp_prev = float(prev_log.get("lesson_completion_rate") or 0)
                rev_prev = float(prev_log.get("revisit_frequency") or 1)

                dev_prev = prev_log.get("active_device_type", "Desktop")
                if dev_prev not in DEVICE_UX_BASELINES:
                    dev_prev = "Desktop"
                baselines_prev = DEVICE_UX_BASELINES[dev_prev]

                cli_prev_flagged = (cli_prev_val > 0.45 or _normalize(reg_prev, CLI_BASELINES["max_regressions"]) >= 0.8)
                nfi_prev_flagged = (nfi_prev_val > 0.45 or 
                                    _normalize(clicks_prev, baselines_prev["max_dead_clicks"]) >= 0.8 or 
                                    _normalize(mag_prev, baselines_prev["max_magnification"]) >= 0.8)
                di_prev_flagged = (di_prev_val > 0.55 or (1.0 - _normalize(score_prev or 75.0, 100.0)) >= 0.8)

                if cli_prev_flagged:
                    state.update({
                        "reading_duration_seconds": round(dur_prev, 2),
                        "regression_scroll_count": round(reg_prev, 2),
                        "tts_replay_count": round(rep_prev, 2),
                        "tts_pause_frequency": round(pause_prev, 2),
                        "idle_time_seconds": round(idle_prev, 2)
                    })
                else:
                    state.update({
                        "reading_duration_seconds": 0.0,
                        "regression_scroll_count": 0.0,
                        "tts_replay_count": 0.0,
                        "tts_pause_frequency": 0.0,
                        "idle_time_seconds": 0.0
                    })

                if nfi_prev_flagged:
                    state.update({
                        "scroll_velocity_px_sec": round(vel_prev, 2),
                        "dead_clicks": round(clicks_prev, 2),
                        "screen_magnification_frequency": round(mag_prev, 2)
                    })
                else:
                    state.update({
                        "scroll_velocity_px_sec": 0.0,
                        "dead_clicks": 0.0,
                        "screen_magnification_frequency": 0.0
                    })

                if di_prev_flagged:
                    state.update({
                        "quiz_score_percentage": round(score_prev, 2) if score_prev is not None else 0.0,
                        "revisit_frequency": round(rev_prev, 2),
                        "lesson_completion_rate": round(comp_prev, 2)
                    })
                else:
                    state.update({
                        "quiz_score_percentage": 0.0,
                        "revisit_frequency": 0.0,
                        "lesson_completion_rate": 0.0
                    })
            else:
                state = {
                    "reading_duration_seconds": 0.0,
                    "regression_scroll_count": 0.0,
                    "tts_replay_count": 0.0,
                    "tts_pause_frequency": 0.0,
                    "idle_time_seconds": 0.0,
                    "scroll_velocity_px_sec": 0.0,
                    "dead_clicks": 0.0,
                    "screen_magnification_frequency": 0.0,
                    "quiz_score_percentage": 0.0,
                    "revisit_frequency": 0.0,
                    "lesson_completion_rate": 0.0
                }

            next_state = {}
            if cli_flagged:
                next_state.update({
                    "reading_duration_seconds": round(dur, 2),
                    "regression_scroll_count": round(reg, 2),
                    "tts_replay_count": round(rep, 2),
                    "tts_pause_frequency": round(pause, 2),
                    "idle_time_seconds": round(idle, 2)
                })
            else:
                next_state.update({
                    "reading_duration_seconds": 0.0,
                    "regression_scroll_count": 0.0,
                    "tts_replay_count": 0.0,
                    "tts_pause_frequency": 0.0,
                    "idle_time_seconds": 0.0
                })

            if nfi_flagged:
                next_state.update({
                    "scroll_velocity_px_sec": round(vel, 2),
                    "dead_clicks": round(clicks, 2),
                    "screen_magnification_frequency": round(mag, 2)
                })
            else:
                next_state.update({
                    "scroll_velocity_px_sec": 0.0,
                    "dead_clicks": 0.0,
                    "screen_magnification_frequency": 0.0
                })

            if di_flagged:
                next_state.update({
                    "quiz_score_percentage": round(score, 2) if score is not None else 0.0,
                    "revisit_frequency": round(rev, 2),
                    "lesson_completion_rate": round(comp, 2)
                })
            else:
                next_state.update({
                    "quiz_score_percentage": 0.0,
                    "revisit_frequency": 0.0,
                    "lesson_completion_rate": 0.0
                })

            mdp_doc = {
                "user_id": user_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "state": state,
                "action": active_action,
                "next_state": next_state,
                "reward": round(reward, 4),
                "user_state_transition": f"{prev_log.get('user_state') if total_sessions > 1 else 'None'} -> {user_state}"
            }
            
            # Log transition to Firestore
            db.collection("mdp_transitions").add(mdp_doc)
            print(f"[Engine-MDP] Logged MDP transition for user {user_id} with reward: {round(reward, 4)}")
            
        except Exception as mdp_err:
            print(f"[Engine-MDP] Warning: Failed to compute or log MDP transition: {mdp_err}")

        # H. Prepare Input State Vector for DQN
        disability_map = {"None": 0, "Dyslexia": 1, "Low-Vision": 2, "Low Vision": 2, "Color Blindness": 3, "Complete Blindness": 4, "Complete Blindess": 4}
        device_map = {"Desktop": 0, "Mobile": 1, "Tablet": 2}
        
        enc_dis = disability_map.get(disability_type, 0)
        enc_dev = device_map.get(device, 0)

        cli_input = float(cli) if cli_flagged else 0.0
        nfi_input = float(nfi) if nfi_flagged else 0.0
        di_input = float(di) if di_flagged else 0.0

        state_vector = torch.FloatTensor([
            float(enc_dis),
            float(enc_dev),
            float(fds_tts),
            float(fds_dyslexia_ruler),
            float(fds_scroll),
            cli_input,
            nfi_input,
            di_input
        ])

        # I. Run DQN Inference
        if not os.path.exists(WEIGHTS_PATH):
            print(f"[Engine] DQN model weight file not found at {WEIGHTS_PATH}. Aborting prediction.")
            return None

        model = QNetwork(state_dim=8, action_dim=12)
        with MODEL_LOCK:
            model.load_state_dict(torch.load(WEIGHTS_PATH, map_location=torch.device('cpu')))
        model.eval()

        with torch.no_grad():
            q_values = model(state_vector.unsqueeze(0))
            action_idx = q_values.argmax(dim=1).item()
            rec_action = ACTION_MAP[action_idx]

            ui_choice = rec_action["ui_choice"]
            content_choice = rec_action["content_choice"]

            # Map ui_choice to settings
            pred_ts = "large" if ui_choice in [1, 3] else "medium"
            pred_as = "on" if (ui_choice in [2, 3] and fds_scroll > 0.5) else "off"
            pred_tts = "on" if (ui_choice in [2, 3] and fds_tts > 0.5) else "off"
            pred_lf = "on" if (ui_choice in [2, 3] and (fds_dyslexia_ruler > 0.5 or disability_type == "Dyslexia")) else "off"

            # Map content_choice
            pred_ct = "Easy" if content_choice == 0 else "Hard" if content_choice == 2 else "Medium"

            # Heuristic safety override: If user state is "Struggling", force Easy Content Level
            if user_state == "Struggling":
                pred_ct = "Easy"

            # Colleague-specified heuristics: Recommend tools when disabled if struggle is flagged
            if cli_flagged:
                pred_tts = "on"
                pred_lf = "on"
                pred_as = "on"
            if nfi_flagged:
                pred_as = "on"
                pred_lf = "on"
            if di_flagged:
                pred_ct = "Easy"
                pred_tts = "on"
                pred_lf = "on"

        recommended_settings = {
            "text_size": pred_ts,
            "auto_scroll": pred_as,
            "tts": pred_tts,
            "line_focus": pred_lf,
            "content_level": pred_ct,
            "last_updated": datetime.now(timezone.utc).isoformat()
        }

        # UX Guard: Respect manual user selections
        if active_settings.get("tts") == "on":
            recommended_settings["tts"] = "on"
        if active_settings.get("auto_scroll") == "on":
            recommended_settings["auto_scroll"] = "on"
        if active_settings.get("line_focus") == "on":
            recommended_settings["line_focus"] = "on"

        size_ranks = {"medium": 1, "large": 2, "xl": 3}
        active_size = active_settings.get("text_size", "medium")
        pred_size = recommended_settings.get("text_size", "medium")
        if size_ranks.get(active_size, 1) > size_ranks.get(pred_size, 1):
            recommended_settings["text_size"] = active_size

        has_changes = False
        for key in ["text_size", "auto_scroll", "tts", "line_focus", "content_level"]:
            if recommended_settings.get(key) != active_settings.get(key):
                has_changes = True
                break

        from firebase_admin import firestore
        update_data = {}
        if has_changes:
            update_data["pending_settings"] = recommended_settings
        else:
            update_data["pending_settings"] = firestore.DELETE_FIELD
            
        profile_ref.update(update_data)
        return recommended_settings

    except Exception as e:
        import traceback
        print(f"[Engine Error] {e}")
        traceback.print_exc()
        return None

def optimize_personalization_model(user_id, target_actions, feedback=None):
    """
    Performs online backpropagation to update the personalization DQN model's weights.
    Also records user feedback (accept/reject recommendations) for agency control adjustments.
    """
    db = get_db()
    if not db:
        return False

    try:
        # A. Save user feedback count to Firestore
        if feedback in ["accept", "reject"]:
            profile_ref = db.collection("profiles").document(user_id)
            profile_doc = profile_ref.get()
            if profile_doc.exists:
                p_data = profile_doc.to_dict()
                accept_count = int(p_data.get("accepted_recommendations_count") or 0)
                reject_count = int(p_data.get("rejected_recommendations_count") or 0)
                
                if feedback == "accept":
                    accept_count += 1
                    profile_ref.update({"accepted_recommendations_count": accept_count})
                else:
                    reject_count += 1
                    profile_ref.update({"rejected_recommendations_count": reject_count})

        # B. Fetch all historical logs of this user
        logs_ref = db.collection("behavioral_logs").where("user_id", "==", user_id)
        logs = []
        for doc in logs_ref.stream():
            log_data = doc.to_dict()
            log_data["_doc_id"] = doc.id
            logs.append(log_data)
        
        if not logs:
            return False

        logs.sort(key=lambda x: x.get("timestamp", ""))
        total_sessions = len(logs)
        latest_log = logs[-1]

        profile_ref = db.collection("profiles").document(user_id)
        profile_doc = profile_ref.get()
        disability_type = "None"
        if profile_doc.exists:
            disability_type = profile_doc.to_dict().get("disability_type", "None")

        sessions_active_tts = sum(1 for log in logs if int((log.get("accessibility_feature_usage") or {}).get("tts") or (log.get("accessibility_feature_usage") or {}).get("screen_reader") or 0) > 0)
        sessions_active_focus = sum(1 for log in logs if int((log.get("accessibility_feature_usage") or {}).get("line_focus") or 0) > 0)
        sessions_active_scroll = sum(1 for log in logs if int((log.get("accessibility_feature_usage") or {}).get("auto_scroll") or 0) > 0)

        fds_tts = sessions_active_tts / total_sessions
        fds_dyslexia_ruler = sessions_active_focus / total_sessions
        fds_scroll = sessions_active_scroll / total_sessions

        reg = float(latest_log.get("regression_scroll_count") or 0)
        rep = float(latest_log.get("tts_replay_count") or 0)
        pause = float(latest_log.get("tts_pause_frequency") or 0)
        idle = float(latest_log.get("idle_time_seconds") or 0)
        dur = float(latest_log.get("reading_duration_seconds") or 0)

        n_reg = _normalize(reg, CLI_BASELINES["max_regressions"])
        n_rep = _normalize(rep, CLI_BASELINES["max_replays"])
        n_pau = _normalize(pause, CLI_BASELINES["max_pauses"])
        n_idl = _normalize(idle, CLI_BASELINES["max_idle"])
        n_dur = _normalize(dur, CLI_BASELINES["max_duration"])
        cli = (0.50 * n_dur) + (0.30 * n_reg) + (0.20 * n_rep) + (0.20 * n_pau) + (0.20 * n_idl)

        device = latest_log.get("active_device_type", "Desktop")
        if device not in DEVICE_UX_BASELINES:
            device = "Desktop"
        baselines = DEVICE_UX_BASELINES[device]

        clicks = float(latest_log.get("dead_clicks") or 0)
        mag = float(latest_log.get("screen_magnification_frequency") or 0)
        vel = float(latest_log.get("scroll_velocity_px_sec") or 0)

        n_clicks = _normalize(clicks, baselines["max_dead_clicks"])
        n_mag = _normalize(mag, baselines["max_magnification"])
        n_vel = _normalize(vel, baselines["max_velocity_variance"])
        nfi = (0.50 * n_vel) + (0.30 * n_clicks) + (0.20 * n_mag)

        score = latest_log.get("quiz_score_percentage")
        if score is None:
            quiz_scores = [log.get("quiz_score_percentage") for log in logs if log.get("quiz_score_percentage") is not None]
            score = quiz_scores[-1] if quiz_scores else 75.0
            
        comp = float(latest_log.get("lesson_completion_rate") or 0)
        rev = float(latest_log.get("revisit_frequency") or 1)

        n_quiz = _normalize(score, 100.0)
        n_comp = _normalize(comp, 100.0)
        n_rev = _normalize(rev, DI_BASELINES["max_revisits"])
        di = (0.50 * (1.0 - n_quiz)) + (0.30 * n_rev) + (0.20 * (1.0 - n_comp))

        disability_map = {"None": 0, "Dyslexia": 1, "Low-Vision": 2, "Low Vision": 2, "Color Blindness": 3, "Complete Blindness": 4, "Complete Blindess": 4}
        device_map = {"Desktop": 0, "Mobile": 1, "Tablet": 2}
        
        enc_dis = disability_map.get(disability_type, 0)
        enc_dev = device_map.get(device, 0)

        cli_flagged = (cli > 0.45 or n_reg >= 0.8)
        nfi_flagged = (nfi > 0.45 or n_clicks >= 0.8 or n_mag >= 0.8)
        di_flagged = (di > 0.55 or (1.0 - n_quiz) >= 0.8)

        cli_input = float(cli) if cli_flagged else 0.0
        nfi_input = float(nfi) if nfi_flagged else 0.0
        di_input = float(di) if di_flagged else 0.0

        state_vector = torch.FloatTensor([
            float(enc_dis),
            float(enc_dev),
            float(fds_tts),
            float(fds_dyslexia_ruler),
            float(fds_scroll),
            cli_input,
            nfi_input,
            di_input
        ])

        # Load Q-Network
        model = QNetwork(state_dim=8, action_dim=12)
        if os.path.exists(WEIGHTS_PATH):
            with MODEL_LOCK:
                model.load_state_dict(torch.load(WEIGHTS_PATH, map_location=torch.device('cpu')))
        
        model.train()
        optimizer = optim.Adam(model.parameters(), lr=0.005)
        criterion = nn.MSELoss()

        # Build target action based on preferences/feedback
        ts_val = target_actions.get("text_size", "medium")
        as_val = target_actions.get("auto_scroll", "off")
        tts_val = target_actions.get("tts", "off")
        lf_val = target_actions.get("line_focus", "off")
        ct_val = target_actions.get("content_level", "Medium")

        # UI Choice Mapping
        needs_bigger = (ts_val in ["large", "xl"])
        needs_auto = (as_val == "on" or tts_val == "on" or lf_val == "on")
        
        expected_ui = 0
        if needs_bigger and needs_auto:
            expected_ui = 3
        elif needs_auto:
            expected_ui = 2
        elif needs_bigger:
            expected_ui = 1

        expected_content = 0 if ct_val == "Easy" else 2 if ct_val == "Hard" else 1
        target_action_idx = expected_ui * 3 + expected_content

        # Update Q-Network using gradient steps
        optimizer.zero_grad()
        output_q = model(state_vector.unsqueeze(0))
        
        target_q = output_q.clone().detach()
        # MSE update target towards expected index
        target_q[0, target_action_idx] = 1.0 if feedback != "reject" else -0.5
        
        loss = criterion(output_q, target_q)
        loss.backward()
        optimizer.step()

        with MODEL_LOCK:
            torch.save(model.state_dict(), WEIGHTS_PATH)
        return True

    except Exception as e:
        import traceback
        print(f"[Engine-Optimizer Error] {e}")
        traceback.print_exc()
        return False
