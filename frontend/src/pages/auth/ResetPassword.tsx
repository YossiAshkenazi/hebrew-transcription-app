import React, { useState } from 'react';
import {
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Box,
  Link,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Link as RouterLink, useSearchParams, useNavigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';
import apiService from '../../services/api';

const schema = yup.object({
  password: yup
    .string()
    .min(8, 'סיסמא חייבת להכיל לפחות 8 תווים')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'הסיסמא חייבת להכיל אות קטנה, אות גדולה ומספר')
    .required('שדה חובה'),
  confirmPassword: yup
    .string()
    .oneOf([yup.ref('password')], 'הסיסמאות אינן תואמות')
    .required('שדה חובה'),
});

type FormData = yup.InferType<typeof schema>;

const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: yupResolver(schema),
  });

  if (!token) {
    return (
      <Container component="main" maxWidth="sm">
        <Box
          sx={{
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Paper elevation={3} sx={{ padding: 4, width: '100%' }}>
            <Alert severity="error" sx={{ mb: 2 }}>
              טוקן לא תקין או חסר. בקש קישור איפוס סיסמא חדש.
            </Alert>
            <Box sx={{ textAlign: 'center' }}>
              <Link component={RouterLink} to="/forgot-password">
                בקש קישור איפוס חדש
              </Link>
            </Box>
          </Paper>
        </Box>
      </Container>
    );
  }

  const onSubmit = async (data: FormData) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await apiService.resetPassword(token, data.password);
      
      if (response.success) {
        apiService.setToken(response.token);
        navigate('/dashboard');
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'שגיאה באיפוס הסיסמא');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container component="main" maxWidth="sm">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper elevation={3} sx={{ padding: 4, width: '100%' }}>
          <Typography component="h1" variant="h4" align="center" gutterBottom>
            איפוס סיסמא
          </Typography>

          <Typography variant="body1" align="center" sx={{ mb: 3 }}>
            הכנס את הסיסמא החדשה שלך
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ mt: 1 }}>
            <TextField
              margin="normal"
              required
              fullWidth
              label="סיסמא חדשה"
              type="password"
              id="password"
              autoComplete="new-password"
              autoFocus
              {...register('password')}
              error={!!errors.password}
              helperText={errors.password?.message}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              label="אישור סיסמא"
              type="password"
              id="confirmPassword"
              {...register('confirmPassword')}
              error={!!errors.confirmPassword}
              helperText={errors.confirmPassword?.message}
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={isLoading}
            >
              {isLoading ? <CircularProgress size={24} /> : 'עדכן סיסמא'}
            </Button>

            <Box sx={{ textAlign: 'center' }}>
              <Link component={RouterLink} to="/login" variant="body2">
                חזור להתחברות
              </Link>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default ResetPassword;