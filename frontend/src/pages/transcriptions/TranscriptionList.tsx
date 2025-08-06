import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Pagination,
  CircularProgress,
  Alert,
  IconButton,
  Menu,
  MenuItem as MenuItemComponent,
} from '@mui/material';
import {
  Search as SearchIcon,
  MoreVert as MoreIcon,
  Visibility as ViewIcon,
  Cancel as CancelIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

import { Transcription } from '../../services/api';
import apiService from '../../services/api';

const TranscriptionList: React.FC = () => {
  const navigate = useNavigate();
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedTranscription, setSelectedTranscription] = useState<Transcription | null>(null);

  const itemsPerPage = 10;

  const loadTranscriptions = useCallback(async () => {
    try {
      setIsLoading(true);
      const params: any = {
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage,
        sortBy: 'createdAt',
        sortOrder: 'DESC' as const,
      };

      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }

      const response = await apiService.getTranscriptions(params);
      
      if (response.success) {
        setTranscriptions(response.data.transcriptions);
        setTotalPages(Math.ceil(response.data.pagination.total / itemsPerPage));
      }
    } catch (error: any) {
      console.error('Failed to load transcriptions:', error);
      toast.error('שגיאה בטעינת התמלולים');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, statusFilter]);

  useEffect(() => {
    loadTranscriptions();
  }, [loadTranscriptions]);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, transcription: Transcription) => {
    setAnchorEl(event.currentTarget);
    setSelectedTranscription(transcription);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedTranscription(null);
  };

  const handleCancelTranscription = async () => {
    if (!selectedTranscription) return;

    try {
      await apiService.cancelTranscription(selectedTranscription.id);
      toast.success('התמלול בוטל');
      loadTranscriptions();
    } catch (error: any) {
      toast.error('שגיאה בביטול התמלול');
    } finally {
      handleMenuClose();
    }
  };

  const handleDeleteTranscription = async () => {
    if (!selectedTranscription) return;

    if (window.confirm('האם אתה בטוח שברצונך למחוק את התמלול?')) {
      try {
        await apiService.deleteTranscription(selectedTranscription.id);
        toast.success('התמלול נמחק');
        loadTranscriptions();
      } catch (error: any) {
        toast.error('שגיאה במחיקת התמלול');
      } finally {
        handleMenuClose();
      }
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

  const filteredTranscriptions = transcriptions.filter(transcription =>
    transcription.originalFilename.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          התמלולים שלי
        </Typography>
        <Button
          variant="contained"
          onClick={() => navigate('/transcriptions/upload')}
        >
          העלה קובץ חדש
        </Button>
      </Box>

      {/* Filters */}
      <Box sx={{ mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              fullWidth
              placeholder="חפש לפי שם קובץ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                endAdornment: <SearchIcon />,
              }}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth>
              <InputLabel>סטטוס</InputLabel>
              <Select
                value={statusFilter}
                label="סטטוס"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="all">כל הסטטוסים</MenuItem>
                <MenuItem value="pending">ממתין</MenuItem>
                <MenuItem value="processing">מתמלל</MenuItem>
                <MenuItem value="completed">הושלם</MenuItem>
                <MenuItem value="failed">כשל</MenuItem>
                <MenuItem value="cancelled">בוטל</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Box>

      {/* Transcriptions List */}
      {filteredTranscriptions.length === 0 ? (
        <Alert severity="info">
          לא נמצאו תמלולים. <Button onClick={() => navigate('/transcriptions/upload')}>העלה את הראשון!</Button>
        </Alert>
      ) : (
        <>
          {filteredTranscriptions.map((transcription) => (
            <Card key={transcription.id} sx={{ mb: 2 }}>
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start">
                  <Box flex={1}>
                    <Typography variant="h6" gutterBottom>
                      {transcription.originalFilename}
                    </Typography>
                    
                    <Box display="flex" gap={2} mb={2} flexWrap="wrap">
                      <Chip
                        label={getStatusText(transcription.status)}
                        color={getStatusColor(transcription.status) as any}
                        size="small"
                      />
                      <Typography variant="body2" color="textSecondary">
                        {formatDuration(transcription.duration)}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {formatFileSize(transcription.fileSize)}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        {format(new Date(transcription.createdAt), 'dd/MM/yyyy HH:mm', {
                          locale: he,
                        })}
                      </Typography>
                    </Box>

                    {transcription.status === 'completed' && transcription.transcriptionText && (
                      <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                        {transcription.transcriptionText.substring(0, 150)}
                        {transcription.transcriptionText.length > 150 && '...'}
                      </Typography>
                    )}

                    {transcription.status === 'failed' && transcription.errorMessage && (
                      <Alert severity="error" sx={{ mt: 1 }}>
                        {transcription.errorMessage}
                      </Alert>
                    )}
                  </Box>

                  <Box display="flex" alignItems="center" gap={1}>
                    <Button
                      size="small"
                      startIcon={<ViewIcon />}
                      onClick={() => navigate(`/transcriptions/${transcription.id}`)}
                    >
                      צפה
                    </Button>
                    <IconButton
                      onClick={(e) => handleMenuOpen(e, transcription)}
                    >
                      <MoreIcon />
                    </IconButton>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <Box display="flex" justifyContent="center" mt={3}>
              <Pagination
                count={totalPages}
                page={currentPage}
                onChange={(_, page) => setCurrentPage(page)}
                color="primary"
              />
            </Box>
          )}
        </>
      )}

      {/* Context Menu */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItemComponent
          onClick={() => {
            if (selectedTranscription) {
              navigate(`/transcriptions/${selectedTranscription.id}`);
            }
            handleMenuClose();
          }}
        >
          <ViewIcon sx={{ mr: 1 }} />
          צפה בפרטים
        </MenuItemComponent>
        
        {selectedTranscription?.status === 'completed' && (
          <MenuItemComponent onClick={handleMenuClose}>
            <DownloadIcon sx={{ mr: 1 }} />
            הורד תמלול
          </MenuItemComponent>
        )}
        
        {['pending', 'processing'].includes(selectedTranscription?.status || '') && (
          <MenuItemComponent onClick={handleCancelTranscription}>
            <CancelIcon sx={{ mr: 1 }} />
            ביטול תמלול
          </MenuItemComponent>
        )}
        
        {!['processing'].includes(selectedTranscription?.status || '') && (
          <MenuItemComponent onClick={handleDeleteTranscription}>
            <DeleteIcon sx={{ mr: 1 }} />
            מחק תמלול
          </MenuItemComponent>
        )}
      </Menu>
    </Container>
  );
};

export default TranscriptionList;