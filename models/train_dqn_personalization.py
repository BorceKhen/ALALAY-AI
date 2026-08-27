import os
import random
import pandas as pd
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from sklearn.model_selection import train_test_split

# Config & Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(os.path.dirname(os.path.dirname(SCRIPT_DIR)), "ALALAY-AI Datasets", "cleaned_student_dataset.csv")
PRETRAINED_WEIGHTS_PATH = os.path.join(os.path.dirname(os.path.dirname(SCRIPT_DIR)), "ROUI Model", "roui_dqn_model.pth")
MODEL_SAVE_PATH = os.path.join(SCRIPT_DIR, "personalization_dqn_model.pth")

# Action Maps (12 actions)
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

# --- Q-Network ---
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

# --- Replay Buffer ---
class ReplayBuffer:
    def __init__(self, capacity):
        self.capacity = capacity
        self.buffer = []
        self.position = 0

    def push(self, state, target_q):
        if len(self.buffer) < self.capacity:
            self.buffer.append(None)
        self.buffer[self.position] = (state, target_q)
        self.position = (self.position + 1) % self.capacity

    def sample(self, batch_size):
        batch = random.sample(self.buffer, batch_size)
        state, target_q = zip(*batch)
        return (
            np.array(state, dtype=np.float32),
            np.array(target_q, dtype=np.float32)
        )

    def __len__(self):
        return len(self.buffer)

# --- DQN Agent ---
class DQNAgent:
    def __init__(self, state_dim, action_dim, lr=1e-3, gamma=0.99):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.gamma = gamma
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        self.q_network = QNetwork(state_dim, action_dim).to(self.device)
        self.target_network = QNetwork(state_dim, action_dim).to(self.device)
        self.target_network.load_state_dict(self.q_network.state_dict())
        self.target_network.eval()

        self.optimizer = optim.Adam(self.q_network.parameters(), lr=lr)
        self.replay_buffer = ReplayBuffer(10000)
        self.epsilon = 1.0
        self.epsilon_decay = 0.995
        self.epsilon_min = 0.1

    def select_action(self, state, eval_mode=False):
        if not eval_mode and random.random() < self.epsilon:
            return random.randint(0, self.action_dim - 1)
        state_t = torch.FloatTensor(state).unsqueeze(0).to(self.device)
        with torch.no_grad():
            q_values = self.q_network(state_t)
        return int(q_values.argmax(dim=1).item())

    def update(self, batch_size):
        if len(self.replay_buffer) < batch_size:
            return None
        states, target_qs = self.replay_buffer.sample(batch_size)
        
        states_t = torch.FloatTensor(states).to(self.device)
        target_qs_t = torch.FloatTensor(target_qs).to(self.device)

        curr_q = self.q_network(states_t)
        loss = nn.MSELoss()(curr_q, target_qs_t)
        
        self.optimizer.zero_grad()
        loss.backward()
        self.optimizer.step()
        return loss.item()

    def update_target_network(self):
        self.target_network.load_state_dict(self.q_network.state_dict())

    def save(self, filepath):
        torch.save(self.q_network.state_dict(), filepath)

def calculate_reward(row, action_idx):
    """
    Computes MDP reward based on how the selected action matches the user's needs.
    """
    ui_choice = action_idx // 3
    content_choice = action_idx % 3

    # 1. UI Choice Matcher
    needs_bigger = (row["encoded_disability"] == 2) or (row["navigation_friction_index"] > 0.45)
    needs_auto = (row["encoded_disability"] in [1, 4]) or (row["fds_line_focus"] > 0.5) or (row["fds_auto_scroll"] > 0.5) or (row["fds_screen_reader"] > 0.5)
    
    expected_ui = 0
    if needs_bigger and needs_auto:
        expected_ui = 3
    elif needs_auto:
        expected_ui = 2
    elif needs_bigger:
        expected_ui = 1

    ui_reward = 10.0 if ui_choice == expected_ui else -5.0

    # 2. Content Level Choice Matcher (Scaffolding)
    if (row["cognitive_load_index"] > 0.45) or (row["difficulty_index"] > 0.55):
        expected_content = 0  # Easy
    elif row["difficulty_index"] < 0.25:
        expected_content = 2  # Hard
    else:
        expected_content = 1  # Medium

    content_reward = 10.0 if content_choice == expected_content else -5.0

    return ui_reward + content_reward

def main():
    print(f"[DQN-Train] Loading dataset from: {DATASET_PATH}")
    if not os.path.exists(DATASET_PATH):
        print(f"Error: Dataset not found at {DATASET_PATH}")
        return

    df = pd.read_csv(DATASET_PATH)

    # Clean and encode properties
    disability_map = {"None": 0, "Dyslexia": 1, "Low-Vision": 2, "Low Vision": 2, "Color Blindness": 3, "Complete Blindness": 4, "Complete Blindess": 4}
    device_map = {"Desktop": 0, "Mobile": 1, "Tablet": 2}
    df['encoded_disability'] = df['disability_type'].map(disability_map).fillna(0).astype(int)
    df['encoded_device'] = df['active_device_type'].map(device_map).fillna(0).astype(int)

    features = [
        'encoded_disability',
        'encoded_device',
        'fds_screen_reader',
        'fds_line_focus',
        'fds_auto_scroll',
        'cognitive_load_index',
        'navigation_friction_index',
        'difficulty_index'
    ]

    # Perform 700 / 300 Train-Test split
    # Since dataset is 1000 records, first 700 = Train, remaining 300 = Test
    train_df = df.iloc[:700].reset_index(drop=True)
    test_df = df.iloc[700:1000].reset_index(drop=True)

    agent = DQNAgent(state_dim=8, action_dim=12, lr=0.01)

    # Load pre-trained weights from EdNet
    if os.path.exists(PRETRAINED_WEIGHTS_PATH):
        print(f"[DQN-Train] Loading pre-trained EdNet weights from: {PRETRAINED_WEIGHTS_PATH}")
        try:
            agent.q_network.load_state_dict(torch.load(PRETRAINED_WEIGHTS_PATH, map_location=agent.device))
            agent.target_network.load_state_dict(agent.q_network.state_dict())
            print("[DQN-Train] EdNet weights loaded successfully.")
        except Exception as e:
            print(f"[DQN-Train] Warning: Mismatch or failed to load pre-trained EdNet weights: {e}. Starting fresh.")
    else:
        print(f"[DQN-Train] Pre-trained weights not found at {PRETRAINED_WEIGHTS_PATH}. Training from scratch.")

    print("\n--- Starting DQN Offline Training/Fine-Tuning (700 records) ---")
    batch_size = 32
    epochs = 80

    for epoch in range(epochs):
        epoch_losses = []
        epoch_rewards = []

        # Fill Replay Buffer with states/rewards from training set
        for idx, row in train_df.iterrows():
            state = row[features].values.astype(np.float32)
            # Build target Q-value vector containing rewards for all 12 actions
            target_q = np.zeros(12, dtype=np.float32)
            for act in range(12):
                target_q[act] = calculate_reward(row, act)
            
            agent.replay_buffer.push(state, target_q)

        # Update Q-values using batches
        for _ in range(100):
            loss = agent.update(batch_size)
            if loss is not None:
                epoch_losses.append(loss)

        agent.epsilon = max(agent.epsilon * agent.epsilon_decay, agent.epsilon_min)
        if epoch % 5 == 0:
            agent.update_target_network()

        avg_loss = np.mean(epoch_losses) if epoch_losses else 0.0
        print(f"Epoch {epoch+1:02d}/{epochs:02d} | Avg Loss: {avg_loss:.6f} | Epsilon: {agent.epsilon:.3f}")

    # Evaluate model on 300 test records
    print("\n--- Starting Evaluation on Test Set (300 records) ---")
    correct_predictions = 0
    total_test = len(test_df)

    for idx, row in test_df.iterrows():
        state = row[features].values.astype(np.float32)
        predicted_action = agent.select_action(state, eval_mode=True)
        
        # Calculate target expected action index
        best_action = 0
        best_reward = -999.0
        for act in range(12):
            r = calculate_reward(row, act)
            if r > best_reward:
                best_reward = r
                best_action = act

        if predicted_action == best_action:
            correct_predictions += 1

    accuracy = (correct_predictions / total_test) * 100
    print(f"Test Accuracy (Matches Expected Scaffolding Rules): {accuracy:.2f}%\n")

    # Save final model weights
    os.makedirs(os.path.dirname(MODEL_SAVE_PATH), exist_ok=True)
    agent.save(MODEL_SAVE_PATH)
    print(f"[DQN-Train] Model successfully saved to: {MODEL_SAVE_PATH}")

if __name__ == "__main__":
    main()
