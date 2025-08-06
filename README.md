# Integration Template

This folder contains the template files needed to integrate other Claude Code projects with the Multi-Agent Observability System.

## Contents

- `.claude/` - Claude Code hooks configuration and scripts
- `.env.sample` - Environment variables template

## Quick Integration Steps

1. **Copy these files to your project:**
   ```bash
   # Copy to your project root
   cp -R integration/.claude /path/to/your/project/
   cp integration/.env.sample /path/to/your/project/
   ```

2. **Configure your project:**
   ```bash
   # Rename and edit environment file
   mv .env.sample .env
   # Edit .env and set APP_NAME=your-project-name
   ```

3. **Start observability server** (from this repository)

4. **Use Claude Code** in your project - events will automatically appear in the dashboard!

## Features

- ✅ **No API keys needed** - All AI calls proxied through observability server
- ✅ **Docker support** - Automatic fallback to `host.docker.internal:4000`
- ✅ **Environment-based config** - Set `APP_NAME` in `.env`
- ✅ **Real-time monitoring** - Events appear instantly in dashboard

For detailed instructions, see [INTEGRATION.md](../INTEGRATION.md) in the main repository.