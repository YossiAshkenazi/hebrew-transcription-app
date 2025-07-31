# Hebrew Call Transcription App

A web application for transcribing Hebrew call recordings with specialized focus on Jewish religious terminology and concepts.

## Features

- 🎵 Support for multiple audio formats (MP3, WAV, M4A, AAC, FLAC)
- 🇮🇱 Hebrew language transcription with Jewish terminology
- 👥 Multi-speaker detection and identification
- 📧 Email delivery of transcripts
- 🔗 Webhook support for integrations
- 📱 Mobile-friendly responsive design
- 🔒 GDPR-compliant privacy and security

## Tech Stack

- **Frontend**: React.js with TypeScript
- **Backend**: Node.js with Express
- **Database**: PostgreSQL
- **File Storage**: AWS S3
- **Queue System**: Redis with Bull
- **Transcription**: OpenAI Whisper API

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 13+
- Redis
- AWS Account (for S3)
- OpenAI API Key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/YossiAshkenazi/hebrew-transcription-app.git
cd hebrew-transcription-app
```

2. Install backend dependencies:
```bash
cd backend
npm install
```

3. Install frontend dependencies:
```bash
cd ../frontend
npm install
```

4. Set up environment variables (see `.env.example` files)

5. Start the development servers:
```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm start
```

## Project Structure

```
hebrew-transcription-app/
├── frontend/          # React.js application
├── backend/           # Express.js API server
├── models/            # Custom vocabulary and language models
├── docker/            # Containerization files
├── docs/              # Documentation and API specs
├── tests/             # Automated test suites
└── deployment/        # CI/CD and infrastructure as code
```

## Contributing

Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
