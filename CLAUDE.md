# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Hebrew call transcription application that uses OpenAI Whisper API to transcribe Hebrew audio files with specialized focus on Jewish religious terminology. The system is built as a full-stack web application with a React TypeScript frontend and Node.js Express backend.

## Development Commands

### Backend Development
```bash
cd backend
npm run dev          # Start backend in development mode with nodemon
npm start           # Start backend in production mode
npm test            # Run Jest tests
npm run test:watch  # Run tests in watch mode
npm run lint        # Lint backend code
npm run lint:fix    # Lint and auto-fix backend issues
```

### Frontend Development
```bash
cd frontend
npm start           # Start React development server
npm run build       # Build for production
npm test            # Run React tests
npm run lint        # Lint frontend code
npm run lint:fix    # Lint and auto-fix frontend issues
npm run type-check  # TypeScript type checking without emit
```

### Database Management
```bash
cd backend
npm run migrate     # Run Sequelize migrations
npm run migrate:undo # Undo last migration
npm run seed        # Run database seeders
```

### Docker Development
```bash
docker-compose up -d          # Start all services in background
docker-compose up postgres    # Start only PostgreSQL
docker-compose down           # Stop all services
```

## Architecture Overview

### Backend Architecture (Node.js/Express)
- **Entry Point**: `backend/src/index.js` - Express server setup with middleware, routing, and service initialization
- **Queue System**: Bull queues with Redis for background job processing (transcription, email, webhooks, cleanup)
- **Database**: Sequelize ORM with PostgreSQL, models for Users, Transcriptions, WebhookConfigs, CustomVocabulary
- **Services**: Modular services for transcription (OpenAI Whisper), S3 file storage, email delivery, webhooks
- **Authentication**: JWT-based auth with bcrypt password hashing
- **File Processing**: Multer for uploads, FFmpeg for audio processing

### Queue System Design
The application uses a robust job queue system with separate queues for different operations:
- **Transcription Queue**: Processes audio files with OpenAI Whisper API (5 concurrent jobs)
- **Email Queue**: Handles email notifications (10 concurrent jobs)
- **Webhook Queue**: Delivers webhook notifications (10 concurrent jobs)  
- **Cleanup Queue**: Removes old files and data (1 concurrent job, runs daily at 2 AM)

All queues have exponential backoff retry logic and comprehensive event logging.

### Database Schema
- **Users**: UUID primary keys, email/password auth, JSONB settings, email verification
- **Transcriptions**: Links to users, stores file paths, status tracking, transcription results
- **WebhookConfigs**: User-specific webhook endpoints for integration
- **CustomVocabulary**: User-specific vocabulary for improved transcription accuracy

### Frontend Architecture (React/TypeScript)
- **Tech Stack**: React 18, TypeScript, Material-UI, React Router, Axios
- **Audio Processing**: WaveSurfer.js for audio visualization, React Player for playback
- **Forms**: React Hook Form with Yup validation
- **Notifications**: React Toastify for user feedback

## Key Services

### Transcription Service (`backend/src/services/transcriptionService.js`)
Handles OpenAI Whisper API integration with Hebrew language optimization and custom vocabulary support.

### S3 Service (`backend/src/services/s3Service.js`)
Manages file uploads, downloads, and cleanup operations with AWS S3.

### Email Service (`backend/src/services/emailService.js`)
Sends transactional emails using Nodemailer with template support.

### Webhook Service (`backend/src/services/webhookService.js`)
Delivers webhook notifications to configured endpoints with retry logic.

## Environment Configuration

Both backend and frontend require environment configuration:
- Backend uses `.env` file (see `.env.example` for required variables)
- Frontend uses `REACT_APP_` prefixed environment variables
- Docker Compose provides default development configuration

## Testing Strategy

- **Backend**: Jest with Supertest for API testing
- **Frontend**: React Testing Library with Jest
- Run tests before committing changes
- Use `npm run test:watch` during development

## File Structure Conventions

- Backend follows modular structure with separate directories for models, services, middleware, queues
- Frontend uses component-based architecture with TypeScript interfaces
- Database migrations handled through Sequelize CLI
- All sensitive data handled through environment variables

## Development Workflow

1. Start Docker services for database and Redis: `docker-compose up -d postgres redis`
2. Run backend in development mode: `cd backend && npm run dev`
3. Run frontend in development mode: `cd frontend && npm start`
4. Use linting and type checking before commits
5. Run database migrations when schema changes are made