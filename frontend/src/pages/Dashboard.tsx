import React, { useState, useEffect } from 'react';
import {
  Container,
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  CircularProgress,
  Chip,
} from '@mui/material';
import {
  Upload as UploadIcon,
  Mic as MicIcon,
  CheckCircle as CheckCircleIcon,
  Schedule as ScheduleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

import { useAuth } from '../contexts/AuthContext';
import { Transcription } from '../services/api';
import apiService from '../services/api';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [recentTranscriptions, setRecentTranscriptions] = useState<Transcription[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    completed: 0,
    processing: 0,
    failed: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      
      // Load recent transcriptions
      const response = await apiService.getTranscriptions({
        limit: 5,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });

      if (response.success) {
        setRecentTranscriptions(response.data.transcriptions);
        
        // Calculate stats
        const allTranscriptions = await apiService.getTranscriptions({
          limit: 1000,
        });
        
        if (allTranscriptions.success) {
          const transcriptions = allTranscriptions.data.transcriptions;
          setStats({
            total: transcriptions.length,
            completed: transcriptions.filter(t => t.status === 'completed').length,
            processing: transcriptions.filter(t => ['pending', 'processing'].includes(t.status)).length,
            failed: transcriptions.filter(t => t.status === 'failed').length,
          });
        }
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setIsLoading(false);
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

  if (isLoading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        שלום {user?.firstName}!
      </Typography>
      
      <Grid container spacing={3}>
        {/* Stats Cards */}
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <MicIcon color="primary" />
                <Box sx={{ ml: 2 }}>
                  <Typography color="textSecondary" gutterBottom>
                    סך הכל תמלולים
                  </Typography>
                  <Typography variant="h5">
                    {stats.total}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <CheckCircleIcon color="success" />
                <Box sx={{ ml: 2 }}>
                  <Typography color="textSecondary" gutterBottom>
                    הושלמו
                  </Typography>
                  <Typography variant="h5">
                    {stats.completed}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <ScheduleIcon color="info" />
                <Box sx={{ ml: 2 }}>
                  <Typography color="textSecondary" gutterBottom>
                    בתהליך
                  </Typography>
                  <Typography variant="h5">
                    {stats.processing}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <ErrorIcon color="error" />
                <Box sx={{ ml: 2 }}>
                  <Typography color="textSecondary" gutterBottom>
                    כשלו
                  </Typography>
                  <Typography variant="h5">
                    {stats.failed}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              פעולות מהירות
            </Typography>
            <Box display="flex" gap={2} flexWrap="wrap">
              <Button
                variant="contained"
                startIcon={<UploadIcon />}
                onClick={() => navigate('/transcriptions/upload')}
              >
                העלה קובץ חדש
              </Button>
              <Button
                variant="outlined"
                onClick={() => navigate('/transcriptions')}
              >
                צפה בכל התמלולים
              </Button>
              <Button
                variant="outlined"
                onClick={() => navigate('/webhooks')}
              >
                נהל וובהוקים
              </Button>
            </Box>
          </Paper>
        </Grid>

        {/* Recent Transcriptions */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              תמלולים אחרונים
            </Typography>
            {recentTranscriptions.length === 0 ? (
              <Typography color="textSecondary">
                אין תמלולים עדיין. <Button onClick={() => navigate('/transcriptions/upload')}>העלה את הראשון!</Button>
              </Typography>
            ) : (
              <Box>
                {recentTranscriptions.map((transcription) => (
                  <Card key={transcription.id} sx={{ mb: 2 }}>
                    <CardContent>
                      <Box display="flex" justifyContent="space-between" alignItems="center">
                        <Box>
                          <Typography variant="h6">
                            {transcription.originalFilename}
                          </Typography>
                          <Typography color="textSecondary" variant="body2">
                            {formatDuration(transcription.duration)} • {' '}
                            {format(new Date(transcription.createdAt), 'dd/MM/yyyy HH:mm', {
                              locale: he,
                            })}
                          </Typography>
                        </Box>
                        <Box display="flex" alignItems="center" gap={1}>
                          <Chip
                            label={getStatusText(transcription.status)}
                            color={getStatusColor(transcription.status) as any}
                            size="small"
                          />
                          <Button
                            size="small"
                            onClick={() => navigate(`/transcriptions/${transcription.id}`)}
                          >
                            צפה
                          </Button>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
                <Button
                  fullWidth
                  variant="outlined"
                  onClick={() => navigate('/transcriptions')}
                >
                  צפה בכל התמלולים
                </Button>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Dashboard;