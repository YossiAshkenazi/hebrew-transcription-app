#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "elevenlabs",
#     "python-dotenv",
# ]
# ///

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

def main():
    """
    ElevenLabs Turbo v2.5 TTS Script
    
    Uses ElevenLabs' Turbo v2.5 model for fast, high-quality text-to-speech.
    Accepts optional text prompt as command-line argument.
    
    Usage:
    - ./eleven_turbo_tts.py                    # Uses default text
    - ./eleven_turbo_tts.py "Your custom text" # Uses provided text
    
    Features:
    - Fast generation (optimized for real-time use)
    - High-quality voice synthesis
    - Stable production model
    - Cost-effective for high-volume usage
    """
    
    # Load environment variables
    load_dotenv()
    
    # Get API key from environment
    api_key = os.getenv('ELEVENLABS_API_KEY')
    if not api_key:
        print("Error: ELEVENLABS_API_KEY not found in environment variables")
        print("Please add your ElevenLabs API key to .env file:")
        print("ELEVENLABS_API_KEY=your_api_key_here")
        sys.exit(1)
    
    try:
        from elevenlabs.client import ElevenLabs
        import tempfile
        import platform
        
        # Initialize client
        elevenlabs = ElevenLabs(api_key=api_key)
        
        print("ElevenLabs Turbo v2.5 TTS")
        print("=" * 40)
        
        # Get text from command line argument or use default
        if len(sys.argv) > 1:
            text = " ".join(sys.argv[1:])  # Join all arguments as text
        else:
            text = "The first move is what sets everything in motion."
        
        print(f"Text: {text}")
        print("Generating and playing...")
        
        try:
            # Generate and play audio directly
            audio = elevenlabs.text_to_speech.convert(
                text=text,
                voice_id="pNInz6obpgDQGcFmaJgB",  # Adam (free tier compatible)
                model_id="eleven_turbo_v2_5",
                output_format="mp3_44100_128",
            )
            
            # Save to temporary file and play
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as f:
                audio_file = f.name
                for chunk in audio:
                    f.write(chunk)
            
            # Play the audio file on Windows using multiple methods
            if platform.system() == "Windows":
                import subprocess
                played = False
                
                # Method 1: Try Windows Media Player
                try:
                    subprocess.run(['wmplayer', audio_file], 
                                 timeout=1, capture_output=True, check=False)
                    played = True
                except:
                    pass
                
                # Method 2: Try PowerShell with SoundPlayer (for WAV, but let's try)
                if not played:
                    try:
                        ps_cmd = f'Add-Type -AssemblyName presentationCore; $player = New-Object System.Windows.Media.MediaPlayer; $player.Open([uri]"{audio_file}"); $player.Play(); Start-Sleep -Seconds 3'
                        subprocess.run(['powershell', '-c', ps_cmd], 
                                     timeout=5, capture_output=True, check=False)
                        played = True
                    except:
                        pass
                
                # Method 3: Try VLC if available
                if not played:
                    try:
                        subprocess.run(['vlc', '--play-and-exit', '--intf', 'dummy', audio_file], 
                                     timeout=5, capture_output=True, check=False)
                        played = True
                    except:
                        pass
                
                # Method 4: Fallback to start command
                if not played:
                    try:
                        os.startfile(audio_file)
                    except Exception as alt_error:
                        print(f"All playback methods failed. Audio file saved to: {audio_file}")
                        print("You can manually play this file to test audio.")
            
            print("Playback complete!")
            
        except Exception as e:
            print(f"Error: {e}")
        
        
    except ImportError:
        print("Error: elevenlabs package not installed")
        print("This script uses UV to auto-install dependencies.")
        print("Make sure UV is installed: https://docs.astral.sh/uv/")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()