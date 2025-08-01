import React, { useState } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Grid,
  Alert,
  CircularProgress,
  Avatar,
  Divider,
} from '@mui/material';
import { Edit as EditIcon, Save as SaveIcon, Cancel as CancelIcon } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { toast } from 'react-toastify';

import { useAuth } from '../../contexts/AuthContext';
import apiService from '../../services/api';

const schema = yup.object({
  firstName: yup.string().min(2, 'שם פרטי חייב להכיל לפחות 2 תווים').required('שדה חובה'),
  lastName: yup.string().min(2, 'שם משפחה חייב להכיל לפחות 2 תווים').required('שדה חובה'),
  email: yup.string().email('כתובת אימייל לא תקינה').required('שדה חובה'),
});

type FormData = yup.InferType<typeof schema>;

const Profile: React.FC = () => {
  const { user, updateUser, refreshUser } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      email: user?.email || '',
    },
  });

  const handleEdit = () => {
    setIsEditing(true);
    setError('');
    setSuccess('');
    reset({
      firstName: user?.firstName || '',
      lastName: user?.lastName || '',
      email: user?.email || '',
    });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError('');
    setSuccess('');
    reset();
  };

  const onSubmit = async (data: FormData) => {
    try {
      setIsLoading(true);
      setError('');
      setSuccess('');

      const response = await apiService.updateProfile(data);
      
      if (response.success) {
        updateUser(response.data.user);
        setSuccess('הפרופיל עודכן בהצלחה!');
        setIsEditing(false);
        toast.success('הפרופיל עודכן בהצלחה!');
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'שגיאה בעדכון הפרופיל');
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Alert severity="error">
          שגיאה בטעינת פרטי המשתמש
        </Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
      <Typography variant="h4" gutterBottom>
        פרופיל אישי
      </Typography>

      <Card>
        <CardContent>
          <Box display="flex" alignItems="center" mb={3}>
            <Avatar 
              sx={{ width: 80, height: 80, mr: 3, fontSize: '2rem' }}
            >
              {user.firstName[0]?.toUpperCase()}{user.lastName[0]?.toUpperCase()}
            </Avatar>
            <Box>
              <Typography variant="h5">
                {user.firstName} {user.lastName}
              </Typography>
              <Typography color="textSecondary">
                {user.email}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                הצטרף ב-{format(new Date(user.createdAt), 'dd/MM/yyyy', { locale: he })}
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit(onSubmit)}>
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="שם פרטי"
                  {...register('firstName')}
                  error={!!errors.firstName}
                  helperText={errors.firstName?.message}
                  disabled={!isEditing}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  label="שם משפחה"
                  {...register('lastName')}
                  error={!!errors.lastName}
                  helperText={errors.lastName?.message}
                  disabled={!isEditing}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="כתובת אימייל"
                  type="email"
                  {...register('email')}
                  error={!!errors.email}
                  helperText={errors.email?.message || (isEditing ? 'שינוי האימייל ידרוש אימות מחדש' : '')}
                  disabled={!isEditing}
                />
              </Grid>
            </Grid>

            <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
              {!isEditing ? (
                <Button
                  variant="contained"
                  startIcon={<EditIcon />}
                  onClick={handleEdit}
                >
                  ערוך פרופיל
                </Button>
              ) : (
                <>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<SaveIcon />}
                    disabled={isLoading}
                  >
                    {isLoading ? <CircularProgress size={20} /> : 'שמור שינויים'}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<CancelIcon />}
                    onClick={handleCancel}
                    disabled={isLoading}
                  >
                    ביטול
                  </Button>
                </>
              )}
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Account Status */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            סטטוס החשבון
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography color="textSecondary" gutterBottom>
                סטטוס החשבון
              </Typography>
              <Typography>
                {user.isActive ? 'פעיל' : 'לא פעיל'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography color="textSecondary" gutterBottom>
                אימות אימייל
              </Typography>
              <Typography>
                {user.emailVerified ? 'מאומת' : 'לא מאומת'}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography color="textSecondary" gutterBottom>
                תאריך יצירת החשבון
              </Typography>
              <Typography>
                {format(new Date(user.createdAt), 'dd/MM/yyyy HH:mm', { locale: he })}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography color="textSecondary" gutterBottom>
                עדכון אחרון
              </Typography>
              <Typography>
                {format(new Date(user.updatedAt), 'dd/MM/yyyy HH:mm', { locale: he })}
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </Container>
  );
};

export default Profile;