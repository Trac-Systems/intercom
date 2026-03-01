# agent2.py - Task Receiver
import time
import os

print("[Agent2] Listening for tasks...")

while True:
    if os.path.exists("task.txt"):
        with open("task.txt", "r") as f:
            task = f.read()

        response = f"[Agent2] Response: Summary -> '{task[:30]}...'"
        print(response)

        with open("response.txt", "w") as f:
            f.write(response)

        os.remove("task.txt")
    time.sleep(1)
