#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "python-dotenv",
# ]
# ///

"""
Server discovery utility for Docker and local environments.
Handles automatic fallback from localhost to host.docker.internal.
"""

import os
import urllib.request
import urllib.error
from dotenv import load_dotenv


def discover_server_url(base_url=None):
    """
    Discover the correct observability server URL.
    
    Tries in order:
    1. Provided base_url
    2. OBSERVABILITY_SERVER_URL environment variable  
    3. localhost:4000
    4. host.docker.internal:4000 (Docker fallback)
    
    Args:
        base_url (str, optional): Base URL to try first
        
    Returns:
        str: Working server URL, or None if none work
    """
    load_dotenv()
    
    # Candidate URLs to try
    candidates = []
    
    # 1. Explicit base_url provided
    if base_url:
        candidates.append(base_url)
    
    # 2. Environment variable
    env_url = os.getenv('OBSERVABILITY_SERVER_URL')
    if env_url:
        candidates.append(env_url)
    
    # 3. Default localhost
    candidates.append('http://localhost:4000')
    
    # 4. Docker fallback
    candidates.append('http://host.docker.internal:4000')
    
    # Remove duplicates while preserving order
    seen = set()
    unique_candidates = []
    for url in candidates:
        if url not in seen:
            seen.add(url)
            unique_candidates.append(url)
    
    # Test each candidate
    for url in unique_candidates:
        if test_server_connectivity(url):
            return url
    
    return None


def test_server_connectivity(base_url, timeout=3):
    """
    Test if the observability server is reachable.
    
    Args:
        base_url (str): Base URL like 'http://localhost:4000'
        timeout (int): Connection timeout in seconds
        
    Returns:
        bool: True if server is reachable
    """
    try:
        # Test the root endpoint
        req = urllib.request.Request(
            base_url,
            headers={'User-Agent': 'Claude-Code-Hook/1.0'}
        )
        
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status == 200
            
    except (urllib.error.URLError, urllib.error.HTTPError, OSError):
        return False
    except Exception:
        return False


def get_events_endpoint(base_url=None):
    """
    Get the events endpoint URL with automatic server discovery.
    
    Args:
        base_url (str, optional): Base server URL
        
    Returns:
        str: Full events endpoint URL, or None if server not found
    """
    server_url = discover_server_url(base_url)
    if server_url:
        return f"{server_url}/events"
    return None


def get_api_endpoint(endpoint_path, base_url=None):
    """
    Get an API endpoint URL with automatic server discovery.
    
    Args:
        endpoint_path (str): API path like '/api/llm/anthropic'
        base_url (str, optional): Base server URL
        
    Returns:
        str: Full API endpoint URL, or None if server not found
    """
    server_url = discover_server_url(base_url)
    if server_url:
        return f"{server_url}{endpoint_path}"
    return None


def main():
    """Command line interface for testing server discovery."""
    import sys
    
    if len(sys.argv) > 1:
        test_url = sys.argv[1]
        if test_server_connectivity(test_url):
            print(f"Server reachable: {test_url}")
        else:
            print(f"Server unreachable: {test_url}")
    else:
        print("Discovering observability server...")
        server_url = discover_server_url()
        if server_url:
            print(f"Found server: {server_url}")
        else:
            print("No reachable server found")
            print("Tried:")
            print("  - OBSERVABILITY_SERVER_URL environment variable")
            print("  - http://localhost:4000")
            print("  - http://host.docker.internal:4000")


if __name__ == "__main__":
    main()