import sys
import pandas as pd
import hashlib
import subprocess

def generate_commands(file_path, user_agent, log_folder):
    # Load URLs from the CSV file
    urls = pd.read_csv(file_path, header=None, names=["url"])
    
    # Generate and execute commands with hashed IDs
    for _, row in urls.iterrows():
        url = row['url'].split(';')[0]
        # Generate a unique hash of the URL
        url_hash = hashlib.sha256(url.encode()).hexdigest()[:12]  # Shorten the hash to 12 characters if desired
        command = f"node capture_screenshots.js {url} {url_hash} 86400 {user_agent} SE {log_folder}"
        
        # Print the command to the screen
        print(command)
        
        # Execute the command in the shell
        try:
            subprocess.run(command, shell=True, check=True)
        except subprocess.CalledProcessError as e:
            print(f"Command failed with error: {e}")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python script.py <csv_file_path> <user_agent> <log_folder>")
    else:
        csv_file_path = sys.argv[1]
        user_agent = sys.argv[2]
        log_folder = sys.argv[3]
        generate_commands(csv_file_path, user_agent, log_folder)
