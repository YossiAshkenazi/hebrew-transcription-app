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
  Grid,
} from '@mui/material';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Link as RouterLink, useNavigate } from 'react-router-dom';

import { useAuth } from '../../contexts/AuthContext';

const schema = yup.object({
  firstName: yup.string().min(2, 'שם פרטי חייב להכיל לפחות 2 תווים').required('שדה חובה'),
  lastName: yup.string().min(2, 'שם משפחה חייב להכיל לפחות 2 תווים').required('שדה חובה'),
  email: yup.string().email('כתובת אימייל לא תקינה').required('שדה חובה'),
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

const Register: React.FC = () => {
  const navigate = useNavigate();
  const { register: registerUser, isLoading } = useAuth();
  const [error, setError] = useState<string>('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      setError('');
      await registerUser({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
      });
      navigate('/dashboard');
    } catch (error: any) {
      setError(error.response?.data?.error || 'שגיאה בהרשמה');
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
            הרשמה
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ mt: 1 }}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  id="firstName"
                  label="שם פרטי"
                  autoFocus
                  {...register('firstName')}
                  error={!!errors.firstName}
                  helperText={errors.firstName?.message}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  required
                  fullWidth
                  id="lastName"
                  label="שם משפחה"
                  {...register('lastName')}
                  error={!!errors.lastName}
                  helperText={errors.lastName?.message}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  id="email"
                  label="כתובת אימייל"
                  type="email"
                  autoComplete="email"
                  {...register('email')}
                  error={!!errors.email}
                  helperText={errors.email?.message}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  label="סיסמא"
                  type="password"
                  id="password"
                  autoComplete="new-password"
                  {...register('password')}
                  error={!!errors.password}
                  helperText={errors.password?.message}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  required
                  fullWidth
                  label="אישור סיסמא"
                  type="password"
                  id="confirmPassword"
                  {...register('confirmPassword')}
                  error={!!errors.confirmPassword}
                  helperText={errors.confirmPassword?.message}
                />
              </Grid>
            </Grid>

            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
              disabled={isLoading}
            >
              {isLoading ? <CircularProgress size={24} /> : 'הירשם'}
            </Button>

            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2">
                יש לך כבר חשבון?{' '}
                <Link component={RouterLink} to="/login">
                  התחבר כאן
                </Link>
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
};

export default Register;