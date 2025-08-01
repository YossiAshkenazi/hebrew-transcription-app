import React, { useState, useCallback } from 'react';
import {
  Container,
  Paper,
  Typography,
  Box,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Alert,
  CircularProgress,
  Card,
  CardContent,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import { CloudUpload as UploadIcon } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import apiService from '../../services/api';

const schema = yup.object({
  deliveryEmail: yup.string().email('כתובת אימייל לא תקינה').optional(),
  language: yup.string().required('שדה חובה'),
  enableSpeakerDetection: yup.boolean(),
});

type FormData = yup.InferType<typeof schema>;

const TranscriptionUpload: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string>('');

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      deliveryEmail: user?.email || '',
      language: 'he-IL',
      enableSpeakerDetection: true,
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      
      // Validate file size (100MB limit)
      if (file.size > 100 * 1024 * 1024) {
        setError('גודל הקובץ לא יכול לעלות על 100MB');
        return;
      }

      // Validate file type
      const allowedTypes = [
        'audio/mpeg',
        'audio/wav',
        'audio/mp4',
        'audio/m4a',
        'audio/aac',
        'audio/flac',
      ];
      
      if (!allowedTypes.includes(file.type)) {
        setError('פורמט קובץ לא נתמך. קבצים נתמכים: MP3, WAV, M4A, AAC, FLAC');
        return;
      }

      setSelectedFile(file);
      setError('');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.m4a', '.aac', '.flac'],
    },
    multiple: false,
  });

  const onSubmit = async (data: FormData) => {
    if (!selectedFile) {
      setError('אנא בחר קובץ קול');
      return;
    }

    try {
      setIsLoading(true);
      setError('');

      const response = await apiService.uploadTranscription({
        audio: selectedFile,
        deliveryEmail: data.deliveryEmail,
        language: data.language,
        enableSpeakerDetection: data.enableSpeakerDetection,
      });

      if (response.success) {
        toast.success('הקובץ הועלה בהצלחה! התמלול התחיל.');
        navigate('/transcriptions');
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'שגיאה בהעלאת הקובץ');
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        העלאת קובץ לתמלול
      </Typography>

      <Paper sx={{ p: 4 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit(onSubmit)}>
          {/* File Upload Area */}
          <Box
            {...getRootProps()}
            sx={{
              border: '2px dashed',
              borderColor: isDragActive ? 'primary.main' : 'grey.300',
              borderRadius: 2,
              p: 4,
              mb: 3,
              textAlign: 'center',
              cursor: 'pointer',
              backgroundColor: isDragActive ? 'action.hover' : 'transparent',
              '&:hover': {
                backgroundColor: 'action.hover',
              },
            }}
          >
            <input {...getInputProps()} />
            <UploadIcon sx={{ fontSize: 48, color: 'grey.400', mb: 2 }} />
            {selectedFile ? (
              <Box>
                <Typography variant="h6" gutterBottom>
                  {selectedFile.name}
                </Typography>
                <Typography color="textSecondary">
                  {formatFileSize(selectedFile.size)}
                </Typography>
              </Box>
            ) : (
              <Box>
                <Typography variant="h6" gutterBottom>
                  גרור קובץ קול לכאן או לחץ לבחירה
                </Typography>
                <Typography color="textSecondary">
                  פורמטים נתמכים: MP3, WAV, M4A, AAC, FLAC
                </Typography>
                <Typography color="textSecondary" variant="body2">
                  עד 100MB
                </Typography>
              </Box>
            )}
          </Box>

          {/* Upload Settings */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="h6" gutterBottom>
              הגדרות תמלול
            </Typography>

            <Controller
              name="deliveryEmail"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  fullWidth
                  label="אימייל לקבלת התוצאות (אופציונלי)"
                  type="email"
                  margin="normal"
                  error={!!errors.deliveryEmail}
                  helperText={errors.deliveryEmail?.message || 'אם לא מולא, התוצאות יישלחו לאימייל המשתמש'}
                />
              )}
            />

            <Controller
              name="language"
              control={control}
              render={({ field }) => (
                <FormControl fullWidth margin="normal">
                  <InputLabel>שפה</InputLabel>
                  <Select {...field} label="שפה">
                    <MenuItem value="he-IL">עברית</MenuItem>
                    <MenuItem value="en-US">אנגלית</MenuItem>
                    <MenuItem value="ar">ערבית</MenuItem>
                  </Select>
                </FormControl>
              )}
            />

            <Controller
              name="enableSpeakerDetection"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Switch {...field} checked={field.value} />}
                  label="זיהוי דוברים"
                  sx={{ mt: 2 }}
                />
              )}
            />
          </Box>

          {/* Submit Button */}
          <Box sx={{ textAlign: 'center' }}>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={!selectedFile || isLoading}
              sx={{ minWidth: 200 }}
            >
              {isLoading ? (
                <>
                  <CircularProgress size={20} sx={{ mr: 1 }} />
                  מעלה...
                </>
              ) : (
                'התחל תמלול'
              )}
            </Button>
          </Box>

          {uploadProgress > 0 && uploadProgress < 100 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="textSecondary" align="center">
                מתקדמת העלאה: {uploadProgress}%
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      {/* Info Card */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            מידע חשוב
          </Typography>
          <Typography variant="body2" paragraph>
            • זמן התמלול תלוי באורך הקובץ ובעומס המערכת
          </Typography>
          <Typography variant="body2" paragraph>
            • תקבל הודעת אימייל כשהתמלול יושלם
          </Typography>
          <Typography variant="body2" paragraph>
            • המערכת מותאמת לתמלול של טקסטים דתיים ומונחים יהודיים
          </Typography>
          <Typography variant="body2">
            • התמלולים נשמרים במערכת ל-30 יום כברירת מחדל
          </Typography>
        </CardContent>
      </Card>
    </Container>
  );
};

export default TranscriptionUpload;