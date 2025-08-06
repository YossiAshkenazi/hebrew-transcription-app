#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "python-dotenv",
# ]
# ///

"""
Multi-Agent Observability Hook Script
Sends Claude Code hook events to the observability server.
"""

import json
import sys
import os
import argparse
import urllib.request
import urllib.error
from datetime import datetime
from dotenv import load_dotenv
from utils.summarizer import generate_event_summary
from utils.server_discovery import get_events_endpoint

def send_event_to_server(event_data, server_url=None):
    """Send event data to the observability server with Docker fallback."""
    try:
        # Auto-discover server URL if not provided
        if not server_url:
            server_url = get_events_endpoint()
            if not server_url:
                print("Failed to discover observability server (tried localhost and host.docker.internal)", file=sys.stderr)
                return False
        
        # Prepare the request
        req = urllib.request.Request(
            server_url,
            data=json.dumps(event_data).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'Claude-Code-Hook/1.0'
            }
        )
        
        # Send the request
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return True
            else:
                print(f"Server returned status: {response.status}", file=sys.stderr)
                return False
                
    except urllib.error.URLError as e:
        print(f"Failed to send event: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        return False

def main():
    # Load environment variables
    load_dotenv()
    
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Send Claude Code hook events to observability server')
    parser.add_argument('--source-app', help='Source application name (can be set via APP_NAME env var)')
    parser.add_argument('--event-type', required=True, help='Hook event type (PreToolUse, PostToolUse, etc.)')
    parser.add_argument('--server-url', help='Server URL (can be set via OBSERVABILITY_SERVER_URL env var)')
    parser.add_argument('--add-chat', action='store_true', help='Include chat transcript if available')
    parser.add_argument('--summarize', action='store_true', help='Generate AI summary of the event')
    
    args = parser.parse_args()
    
    # Get source app from args or environment
    source_app = args.source_app or os.getenv('APP_NAME')
    if not source_app:
        print("Error: --source-app argument or APP_NAME environment variable is required", file=sys.stderr)
        sys.exit(1)
    
    # Get server URL from args, environment, or auto-discovery
    if args.server_url:
        server_url = args.server_url
    else:
        server_url = get_events_endpoint()
        if not server_url:
            print("Error: Could not discover observability server. Tried localhost and host.docker.internal", file=sys.stderr)
            sys.exit(1)
    
    try:
        # Read hook data from stdin
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON input: {e}", file=sys.stderr)
        sys.exit(1)
    
    # Prepare event data for server
    event_data = {
        'source_app': source_app,
        'session_id': input_data.get('session_id', 'unknown'),
        'hook_event_type': args.event_type,
        'payload': input_data,
        'timestamp': int(datetime.now().timestamp() * 1000)
    }
    
    # Handle --add-chat option
    if args.add_chat and 'transcript_path' in input_data:
        transcript_path = input_data['transcript_path']
        if os.path.exists(transcript_path):
            # Read .jsonl file and convert to JSON array
            chat_data = []
            try:
                with open(transcript_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                chat_data.append(json.loads(line))
                            except json.JSONDecodeError:
                                pass  # Skip invalid lines
                
                # Add chat to event data
                event_data['chat'] = chat_data
            except Exception as e:
                print(f"Failed to read transcript: {e}", file=sys.stderr)
    
    # Generate summary if requested
    if args.summarize:
        summary = generate_event_summary(event_data)
        if summary:
            event_data['summary'] = summary
        # Continue even if summary generation fails
    
    # Send to server
    success = send_event_to_server(event_data, server_url)
    
    # Always exit with 0 to not block Claude Code operations
    sys.exit(0)

if __name__ == '__main__':
    main()