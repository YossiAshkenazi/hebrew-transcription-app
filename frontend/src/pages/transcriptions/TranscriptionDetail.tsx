import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  Button,
  Grid,
  CircularProgress,
  Alert,
  Paper,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ArrowBack as BackIcon,
  Download as DownloadIcon,
  ContentCopy as CopyIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Schedule as ScheduleIcon,
  Person as PersonIcon,
  Language as LanguageIcon,
  Email as EmailIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { toast } from 'react-toastify';
import { useParams, useNavigate } from 'react-router-dom';

import { Transcription } from '../../services/api';
import apiService from '../../services/api';

const TranscriptionDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [transcription, setTranscription] = useState<Transcription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (id) {
      loadTranscription();
    }
  }, [id]);

  const loadTranscription = async () => {
    if (!id) return;

    try {
      setIsLoading(true);
      const response = await apiService.getTranscription(id);
      
      if (response.success) {
        setTranscription(response.data.transcription);
      }
    } catch (error: any) {
      setError('שגיאה בטעינת התמלול');
      console.error('Failed to load transcription:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelTranscription = async () => {
    if (!transcription) return;

    if (window.confirm('האם אתה בטוח שברצונך לבטל את התמלול?')) {
      try {
        await apiService.cancelTranscription(transcription.id);
        toast.success('התמלול בוטל');
        loadTranscription();
      } catch (error: any) {
        toast.error('שגיאה בביטול התמלול');
      }
    }
  };

  const handleDeleteTranscription = async () => {
    if (!transcription) return;

    if (window.confirm('האם אתה בטוח שברצונך למחוק את התמלול? פעולה זו אינה הפיכה.')) {
      try {
        await apiService.deleteTranscription(transcription.id);
        toast.success('התמלול נמחק');
        navigate('/transcriptions');
      } catch (error: any) {
        toast.error('שגיאה במחיקת התמלול');
      }
    }
  };

  const handleCopyText = () => {
    if (transcription?.transcriptionText) {
      navigator.clipboard.writeText(transcription.transcriptionText);
      toast.success('הטקסט הועתק ללוח');
    }
  };

  const handleDownload = () => {
    if (transcription?.transcriptionText) {
      const element = document.createElement('a');
      const file = new Blob([transcription.transcriptionText], { type: 'text/plain' });
      element.href = URL.createObjectURL(file);
      element.download = `${transcription.originalFilename}_transcription.txt`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'processing':
        return 'info';
      case 'pending':
        return 'warning';
      case 'failed':
        return 'error';
      case 'cancelled':
        return 'default';
      default:
        return 'default';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'הושלם';
      case 'processing':
        return 'מתמלל';
      case 'pending':
        return 'ממתין';
      case 'failed':
        return 'כשל';
      case 'cancelled':
        return 'בוטל';
      default:
        return status;
    }
  };

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  if (error || !transcription) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error">
          {error || 'תמלול לא נמצא'}
        </Alert>
        <Box mt={2}>
          <Button onClick={() => navigate('/transcriptions')}>
            חזור לרשימת התמלולים
          </Button>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      {/* Header */}
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={() => navigate('/transcriptions')} sx={{ mr: 2 }}>
          <BackIcon />
        </IconButton>
        <Typography variant="h4" flex={1}>
          {transcription.originalFilename}
        </Typography>
        <Chip
          label={getStatusText(transcription.status)}
          color={getStatusColor(transcription.status) as any}
        />
      </Box>

      <Grid container spacing={3}>
        {/* File Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                פרטי הקובץ
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Box display="flex" alignItems="center">
                  <ScheduleIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  <Typography>
                    משך: {formatDuration(transcription.duration)}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <Typography>
                    גודל: {formatFileSize(transcription.fileSize)}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <LanguageIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  <Typography>
                    שפה: {transcription.language === 'he-IL' ? 'עברית' : transcription.language}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center">
                  <PersonIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  <Typography>
                    זיהוי דוברים: {transcription.metadata?.enableSpeakerDetection ? 'מופעל' : 'כבוי'}
                  </Typography>
                </Box>
                {transcription.deliveryEmail && (
                  <Box display="flex" alignItems="center">
                    <EmailIcon sx={{ mr: 1, color: 'text.secondary' }} />
                    <Typography>
                      אימייל: {transcription.deliveryEmail}
                    </Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Processing Information */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                מידע על העיבוד
              </Typography>
              <Box display="flex" flexDirection="column" gap={2}>
                <Typography>
                  נוצר: {format(new Date(transcription.createdAt), 'dd/MM/yyyy HH:mm', { locale: he })}
                </Typography>
                <Typography>
                  עודכן: {format(new Date(transcription.updatedAt), 'dd/MM/yyyy HH:mm', { locale: he })}
                </Typography>
                {transcription.processingTime && (
                  <Typography>
                    זמן עיבוד: {transcription.processingTime} שניות
                  </Typography>
                )}
                {transcription.confidence && (
                  <Typography>
                    רמת ביטחון: {Math.round(transcription.confidence * 100)}%
                  </Typography>
                )}
                <Typography>
                  אימייל נשלח: {transcription.emailSent ? 'כן' : 'לא'}
                </Typography>
                <Typography>
                  וובהוק נשלח: {transcription.webhookSent ? 'כן' : 'לא'}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Actions */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                פעולות
              </Typography>
              <Box display="flex" gap={2} flexWrap="wrap">
                {transcription.status === 'completed' && transcription.transcriptionText && (
                  <>
                    <Button
                      variant="contained"
                      startIcon={<DownloadIcon />}
                      onClick={handleDownload}
                    >
                      הורד תמלול
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<CopyIcon />}
                      onClick={handleCopyText}
                    >
                      העתק טקסט
                    </Button>
                  </>
                )}
                
                {['pending', 'processing'].includes(transcription.status) && (
                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={<CancelIcon />}
                    onClick={handleCancelTranscription}
                  >
                    בטל תמלול
                  </Button>
                )}
                
                {!['processing'].includes(transcription.status) && (
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={handleDeleteTranscription}
                  >
                    מחק תמלול
                  </Button>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Transcription Text */}
        {transcription.status === 'completed' && transcription.transcriptionText && (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="h6">
                    תמלול
                  </Typography>
                  <Tooltip title="העתק טקסט">
                    <IconButton onClick={handleCopyText}>
                      <CopyIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Paper sx={{ p: 3, backgroundColor: 'background.paper' }}>
                  <Typography
                    variant="body1"
                    sx={{
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.6,
                      fontFamily: 'Arial, sans-serif',
                      direction: 'rtl',
                    }}
                  >
                    {transcription.transcriptionText}
                  </Typography>
                </Paper>
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Error Message */}
        {transcription.status === 'failed' && transcription.errorMessage && (
          <Grid item xs={12}>
            <Alert severity="error">
              <Typography variant="h6" gutterBottom>
                שגיאת עיבוד
              </Typography>
              {transcription.errorMessage}
            </Alert>
          </Grid>
        )}

        {/* Processing Status */}
        {['pending', 'processing'].includes(transcription.status) && (
          <Grid item xs={12}>
            <Alert severity="info">
              <Box display="flex" alignItems="center">
                <CircularProgress size={20} sx={{ mr: 2 }} />
                <Typography>
                  {transcription.status === 'pending' 
                    ? 'התמלול ממתין בתור לעיבוד...'
                    : 'התמלול בעיבוד... אנא המתן.'
                  }
                </Typography>
              </Box>
            </Alert>
          </Grid>
        )}
      </Grid>
    </Container>
  );
};

export default TranscriptionDetail;