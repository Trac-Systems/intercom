# agent1.py - Task Sender
task = "Summarize this text: 'Trac is amazing!'"

print(f"[Agent1] Sending task: {task}")

with open("task.txt", "w") as f:
    f.write(task)

print("[Agent1] Task sent!")

# wait for response
import time
time.sleep(2)

if __name__ == "__main__":
    try:
        with open("response.txt", "r") as f:
            print(f.read())
    except:
        print("No response yet.")
