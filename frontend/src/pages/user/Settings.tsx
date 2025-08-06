import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  Grid,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Divider,
} from '@mui/material';
import { Save as SaveIcon } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { toast } from 'react-toastify';

import apiService from '../../services/api';

interface SettingsFormData {
  transcription: {
    defaultLanguage: string;
    enableSpeakerDetection: boolean;
    autoDelete: number;
    emailNotifications: boolean;
  };
  notifications: {
    emailOnComplete: boolean;
    emailOnError: boolean;
    webhooksEnabled: boolean;
  };
  privacy: {
    saveAudioFiles: boolean;
    dataRetentionDays: number;
  };
}

const Settings: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const { control, handleSubmit, reset } = useForm<SettingsFormData>({
    defaultValues: {
      transcription: {
        defaultLanguage: 'he-IL',
        enableSpeakerDetection: true,
        autoDelete: 30,
        emailNotifications: true,
      },
      notifications: {
        emailOnComplete: true,
        emailOnError: true,
        webhooksEnabled: false,
      },
      privacy: {
        saveAudioFiles: true,
        dataRetentionDays: 30,
      },
    },
  });

  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await apiService.getUserSettings();
      
      if (response.success && response.data.settings) {
        const settings = response.data.settings;
        reset({
          transcription: {
            defaultLanguage: settings.transcription?.defaultLanguage || 'he-IL',
            enableSpeakerDetection: settings.transcription?.enableSpeakerDetection ?? true,
            autoDelete: settings.transcription?.autoDelete || 30,
            emailNotifications: settings.transcription?.emailNotifications ?? true,
          },
          notifications: {
            emailOnComplete: settings.notifications?.emailOnComplete ?? true,
            emailOnError: settings.notifications?.emailOnError ?? true,
            webhooksEnabled: settings.notifications?.webhooksEnabled ?? false,
          },
          privacy: {
            saveAudioFiles: settings.privacy?.saveAudioFiles ?? true,
            dataRetentionDays: settings.privacy?.dataRetentionDays || 30,
          },
        });
      }
    } catch (error: any) {
      console.error('Failed to load settings:', error);
      setError('שגיאה בטעינת ההגדרות');
    } finally {
      setIsLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const onSubmit = async (data: SettingsFormData) => {
    try {
      setIsSaving(true);
      setError('');
      setSuccess('');

      const response = await apiService.updateUserSettings(data);
      
      if (response.success) {
        setSuccess('ההגדרות נשמרו בהצלחה!');
        toast.success('ההגדרות נשמרו בהצלחה!');
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'שגיאה בשמירת ההגדרות');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
          <CircularProgress />
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        הגדרות
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }}>
          {success}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit(onSubmit)}>
        {/* Transcription Settings */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              הגדרות תמלול
            </Typography>
            <Divider sx={{ mb: 3 }} />
            
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <Controller
                  name="transcription.defaultLanguage"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <InputLabel>שפת ברירת מחדל</InputLabel>
                      <Select {...field} label="שפת ברירת מחדל">
                        <MenuItem value="he-IL">עברית</MenuItem>
                        <MenuItem value="en-US">אנגלית</MenuItem>
                        <MenuItem value="ar">ערבית</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                />
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <Controller
                  name="transcription.autoDelete"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <InputLabel>מחיקה אוטומטית (ימים)</InputLabel>
                      <Select {...field} label="מחיקה אוטומטית (ימים)">
                        <MenuItem value={7}>7 ימים</MenuItem>
                        <MenuItem value={14}>14 ימים</MenuItem>
                        <MenuItem value={30}>30 ימים</MenuItem>
                        <MenuItem value={60}>60 ימים</MenuItem>
                        <MenuItem value={90}>90 ימים</MenuItem>
                        <MenuItem value={0}>אף פעם</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Controller
                  name="transcription.enableSpeakerDetection"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} />}
                      label="זיהוי דוברים כברירת מחדל"
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Controller
                  name="transcription.emailNotifications"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} />}
                      label="הודעות אימייל על תמלולים"
                    />
                  )}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              הגדרות התראות
            </Typography>
            <Divider sx={{ mb: 3 }} />
            
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Controller
                  name="notifications.emailOnComplete"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} />}
                      label="שלח אימייל כשהתמלול מסתיים"
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Controller
                  name="notifications.emailOnError"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} />}
                      label="שלח אימייל על שגיאות בתמלול"
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12}>
                <Controller
                  name="notifications.webhooksEnabled"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} />}
                      label="הפעל וובהוקים"
                    />
                  )}
                />
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Privacy Settings */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              הגדרות פרטיות
            </Typography>
            <Divider sx={{ mb: 3 }} />
            
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Controller
                  name="privacy.saveAudioFiles"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} />}
                      label="שמור קבצי אודיו במערכת"
                    />
                  )}
                />
                <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                  כיבוי האפשרות ימחק את קבצי האודיו מיד לאחר התמלול
                </Typography>
              </Grid>

              <Grid item xs={12} sm={6}>
                <Controller
                  name="privacy.dataRetentionDays"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <InputLabel>שמירת נתונים (ימים)</InputLabel>
                      <Select {...field} label="שמירת נתונים (ימים)">
                        <MenuItem value={7}>7 ימים</MenuItem>
                        <MenuItem value={14}>14 ימים</MenuItem>
                        <MenuItem value={30}>30 ימים</MenuItem>
                        <MenuItem value={60}>60 ימים</MenuItem>
                        <MenuItem value={90}>90 ימים</MenuItem>
                        <MenuItem value={365}>שנה</MenuItem>
                      </Select>
                    </FormControl>
                  )}
                />
                <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                  כמה זמן לשמור את התמלולים והנתונים במערכת
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Save Button */}
        <Box sx={{ textAlign: 'center' }}>
          <Button
            type="submit"
            variant="contained"
            size="large"
            startIcon={<SaveIcon />}
            disabled={isSaving}
            sx={{ minWidth: 200 }}
          >
            {isSaving ? (
              <>
                <CircularProgress size={20} sx={{ mr: 1 }} />
                שומר...
              </>
            ) : (
              'שמור הגדרות'
            )}
          </Button>
        </Box>
      </Box>
    </Container>
  );
};

export default Settings;