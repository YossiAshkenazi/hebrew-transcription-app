import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Button,
  Grid,
  CircularProgress,
  Alert,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem as SelectMenuItem,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  PlayArrow as TestIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  Schedule as PendingIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { toast } from 'react-toastify';
import { useForm, Controller } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

import { WebhookConfig } from '../../services/api';
import apiService from '../../services/api';

const webhookSchema = yup.object({
  name: yup.string().min(1, 'שם חובה').max(100, 'שם ארוך מדי').required('שדה חובה'),
  url: yup.string().url('כתובת URL לא תקינה').required('שדה חובה'),
  method: yup.string().oneOf(['POST', 'PUT', 'PATCH']).required('שדה חובה'),
  isActive: yup.boolean(),
});

type WebhookFormData = yup.InferType<typeof webhookSchema>;

const WebhookList: React.FC = () => {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookConfig | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<WebhookFormData>({
    resolver: yupResolver(webhookSchema),
    defaultValues: {
      name: '',
      url: '',
      method: 'POST',
      isActive: true,
    },
  });

  useEffect(() => {
    loadWebhooks();
  }, []);

  const loadWebhooks = async () => {
    try {
      setIsLoading(true);
      const response = await apiService.getWebhooks();
      
      if (response.success) {
        setWebhooks(response.data.webhooks);
      }
    } catch (error: any) {
      console.error('Failed to load webhooks:', error);
      toast.error('שגיאה בטעינת הוובהוקים');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, webhook: WebhookConfig) => {
    setAnchorEl(event.currentTarget);
    setSelectedWebhook(webhook);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedWebhook(null);
  };

  const handleCreateWebhook = () => {
    setIsEditing(false);
    reset({
      name: '',
      url: '',
      method: 'POST',
      isActive: true,
    });
    setIsDialogOpen(true);
  };

  const handleEditWebhook = () => {
    if (!selectedWebhook) return;
    
    setIsEditing(true);
    reset({
      name: selectedWebhook.name,
      url: selectedWebhook.url,
      method: selectedWebhook.method,
      isActive: selectedWebhook.isActive,
    });
    setIsDialogOpen(true);
    handleMenuClose();
  };

  const handleDeleteWebhook = async () => {
    if (!selectedWebhook) return;

    if (window.confirm('האם אתה בטוח שברצונך למחוק את הוובהוק?')) {
      try {
        await apiService.deleteWebhook(selectedWebhook.id);
        toast.success('הוובהוק נמחק');
        loadWebhooks();
      } catch (error: any) {
        toast.error('שגיאה במחיקת הוובהוק');
      }
    }
    handleMenuClose();
  };

  const handleTestWebhook = async () => {
    if (!selectedWebhook) return;

    try {
      const response = await apiService.testWebhook(selectedWebhook.id);
      
      if (response.success && response.data.testResult.success) {
        toast.success('בדיקת הוובהוק הצליחה!');
      } else {
        toast.error('בדיקת הוובהוק נכשלה');
      }
    } catch (error: any) {
      toast.error('שגיאה בבדיקת הוובהוק');
    }
    handleMenuClose();
  };

  const onSubmit = async (data: WebhookFormData) => {
    try {
      setIsSaving(true);
      
      if (isEditing && selectedWebhook) {
        await apiService.updateWebhook(selectedWebhook.id, data);
        toast.success('הוובהוק עודכן');
      } else {
        await apiService.createWebhook(data);
        toast.success('הוובהוק נוצר');
      }
      
      setIsDialogOpen(false);
      loadWebhooks();
    } catch (error: any) {
      toast.error(isEditing ? 'שגיאה בעדכון הוובהוק' : 'שגיאה ביצירת הוובהוק');
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusIcon = (webhook: WebhookConfig) => {
    if (!webhook.isActive) {
      return <PendingIcon color="disabled" />;
    }
    
    const successRate = webhook.totalTriggers > 0 
      ? (webhook.totalSuccesses / webhook.totalTriggers) * 100 
      : 0;
    
    if (successRate >= 80) {
      return <SuccessIcon color="success" />;
    } else if (successRate >= 50) {
      return <PendingIcon color="warning" />;
    } else {
      return <ErrorIcon color="error" />;
    }
  };

  const getStatusText = (webhook: WebhookConfig) => {
    if (!webhook.isActive) return 'לא פעיל';
    
    const successRate = webhook.totalTriggers > 0 
      ? (webhook.totalSuccesses / webhook.totalTriggers) * 100 
      : 0;
    
    return `${Math.round(successRate)}% הצלחה`;
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
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">
          ניהול וובהוקים
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={handleCreateWebhook}
        >
          צור וובהוק חדש
        </Button>
      </Box>

      {webhooks.length === 0 ? (
        <Alert severity="info">
          לא נמצאו וובהוקים. <Button onClick={handleCreateWebhook}>צור את הראשון!</Button>
        </Alert>
      ) : (
        <Grid container spacing={3}>
          {webhooks.map((webhook) => (
            <Grid item xs={12} md={6} lg={4} key={webhook.id}>
              <Card>
                <CardContent>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
                    <Box flex={1}>
                      <Typography variant="h6" gutterBottom>
                        {webhook.name}
                      </Typography>
                      <Typography variant="body2" color="textSecondary" gutterBottom>
                        {webhook.url}
                      </Typography>
                    </Box>
                    <IconButton onClick={(e) => handleMenuOpen(e, webhook)}>
                      <MoreIcon />
                    </IconButton>
                  </Box>

                  <Box display="flex" gap={1} mb={2} flexWrap="wrap">
                    <Chip label={webhook.method} size="small" />
                    <Chip 
                      label={webhook.isActive ? 'פעיל' : 'לא פעיל'} 
                      color={webhook.isActive ? 'success' : 'default'}
                      size="small" 
                    />
                  </Box>

                  <Box display="flex" alignItems="center" gap={1} mb={2}>
                    {getStatusIcon(webhook)}
                    <Typography variant="body2">
                      {getStatusText(webhook)}
                    </Typography>
                  </Box>

                  <Typography variant="body2" color="textSecondary">
                    סך הכל הפעלות: {webhook.totalTriggers}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    הצלחות: {webhook.totalSuccesses}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    כשלונות: {webhook.totalFailures}
                  </Typography>
                  
                  {webhook.lastTriggeredAt && (
                    <Typography variant="body2" color="textSecondary">
                      הופעל לאחרונה: {format(new Date(webhook.lastTriggeredAt), 'dd/MM/yyyy HH:mm', { locale: he })}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem onClick={handleEditWebhook}>
          <EditIcon sx={{ mr: 1 }} />
          ערוך
        </MenuItem>
        <MenuItem onClick={handleTestWebhook}>
          <TestIcon sx={{ mr: 1 }} />
          בדוק
        </MenuItem>
        <MenuItem onClick={handleDeleteWebhook}>
          <DeleteIcon sx={{ mr: 1 }} />
          מחק
        </MenuItem>
      </Menu>

      {/* Create/Edit Dialog */}
      <Dialog 
        open={isDialogOpen} 
        onClose={() => setIsDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {isEditing ? 'ערוך וובהוק' : 'צור וובהוק חדש'}
        </DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="שם הוובהוק"
                      error={!!errors.name}
                      helperText={errors.name?.message}
                    />
                  )}
                />
              </Grid>
              
              <Grid item xs={12}>
                <Controller
                  name="url"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="כתובת URL"
                      placeholder="https://example.com/webhook"
                      error={!!errors.url}
                      helperText={errors.url?.message}
                    />
                  )}
                />
              </Grid>
              
              <Grid item xs={12} sm={6}>
                <Controller
                  name="method"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <InputLabel>שיטת HTTP</InputLabel>
                      <Select {...field} label="שיטת HTTP">
                        <SelectMenuItem value="POST">POST</SelectMenuItem>
                        <SelectMenuItem value="PUT">PUT</SelectMenuItem>
                        <SelectMenuItem value="PATCH">PATCH</SelectMenuItem>
                      </Select>
                    </FormControl>
                  )}
                />
              </Grid>
              
              <Grid item xs={12}>
                <Controller
                  name="isActive"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Switch {...field} checked={field.value} />}
                      label="הוובהוק פעיל"
                    />
                  )}
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setIsDialogOpen(false)}>
              ביטול
            </Button>
            <Button 
              type="submit" 
              variant="contained"
              disabled={isSaving}
            >
              {isSaving ? <CircularProgress size={20} /> : (isEditing ? 'עדכן' : 'צור')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Container>
  );
};

export default WebhookList;