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
  Tabs,
  Tab,
} from '@mui/material';
import {
  Add as AddIcon,
  MoreVert as MoreIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Upload as UploadIcon,
} from '@mui/icons-material';
import { toast } from 'react-toastify';
import { useForm, Controller } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

import { CustomVocabulary } from '../../services/api';
import apiService from '../../services/api';

const vocabularySchema = yup.object({
  word: yup.string().min(1, 'מילה חובה').max(100, 'מילה ארוכה מדי').required('שדה חובה'),
  pronunciation: yup.string().max(200, 'הגייה ארוכה מדי').optional(),
  category: yup
    .string()
    .oneOf(['halachic', 'chassidic', 'yiddish', 'calendar', 'names', 'places', 'general'])
    .required('שדה חובה'),
});

type VocabularyFormData = yup.InferType<typeof vocabularySchema>;

const VocabularyList: React.FC = () => {
  const [vocabulary, setVocabulary] = useState<CustomVocabulary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedWord, setSelectedWord] = useState<CustomVocabulary | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VocabularyFormData>({
    resolver: yupResolver(vocabularySchema),
    defaultValues: {
      word: '',
      pronunciation: '',
      category: 'general',
    },
  });

  useEffect(() => {
    loadVocabulary();
  }, [currentTab]);

  const loadVocabulary = async () => {
    try {
      setIsLoading(true);
      const includeGlobal = currentTab === 1;
      const response = await apiService.getVocabulary({ includeGlobal });
      
      if (response.success) {
        setVocabulary(response.data.vocabulary);
      }
    } catch (error: any) {
      console.error('Failed to load vocabulary:', error);
      toast.error('שגיאה בטעינת המילון');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, word: CustomVocabulary) => {
    setAnchorEl(event.currentTarget);
    setSelectedWord(word);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedWord(null);
  };

  const handleCreateWord = () => {
    setIsEditing(false);
    reset({
      word: '',
      pronunciation: '',
      category: 'general',
    });
    setIsDialogOpen(true);
  };

  const handleEditWord = () => {
    if (!selectedWord) return;
    
    setIsEditing(true);
    reset({
      word: selectedWord.word,
      pronunciation: selectedWord.pronunciation || '',
      category: selectedWord.category,
    });
    setIsDialogOpen(true);
    handleMenuClose();
  };

  const handleDeleteWord = async () => {
    if (!selectedWord) return;

    if (window.confirm('האם אתה בטוח שברצונך למחוק את המילה?')) {
      try {
        await apiService.deleteVocabularyWord(selectedWord.id);
        toast.success('המילה נמחקה');
        loadVocabulary();
      } catch (error: any) {
        toast.error('שגיאה במחיקת המילה');
      }
    }
    handleMenuClose();
  };

  const onSubmit = async (data: VocabularyFormData) => {
    try {
      setIsSaving(true);
      
      if (isEditing && selectedWord) {
        await apiService.updateVocabularyWord(selectedWord.id, data);
        toast.success('המילה עודכנה');
      } else {
        await apiService.createVocabularyWord(data);
        toast.success('המילה נוספה');
      }
      
      setIsDialogOpen(false);
      loadVocabulary();
    } catch (error: any) {
      toast.error(isEditing ? 'שגיאה בעדכון המילה' : 'שגיאה בהוספת המילה');
    } finally {
      setIsSaving(false);
    }
  };

  const getCategoryText = (category: string) => {
    const categories = {
      halachic: 'הלכה',
      chassidic: 'חסידות',
      yiddish: 'יידיש',
      calendar: 'לוח',
      names: 'שמות',
      places: 'מקומות',
      general: 'כללי',
    };
    return categories[category as keyof typeof categories] || category;
  };

  const getCategoryColor = (category: string) => {
    const colors = {
      halachic: 'primary',
      chassidic: 'secondary',
      yiddish: 'success',
      calendar: 'warning',
      names: 'info',
      places: 'error',
      general: 'default',
    };
    return colors[category as keyof typeof colors] || 'default';
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
          ניהול מילון מותאם
        </Typography>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<UploadIcon />}
            onClick={() => {/* TODO: Implement bulk upload */}}
          >
            העלאה קבצית
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreateWord}
          >
            הוסף מילה
          </Button>
        </Box>
      </Box>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={(_, newValue) => setCurrentTab(newValue)}>
          <Tab label="המילון שלי" />
          <Tab label="מילון כללי + מילון אישי" />
        </Tabs>
      </Box>

      {vocabulary.length === 0 ? (
        <Alert severity="info">
          לא נמצאו מילים במילון. <Button onClick={handleCreateWord}>הוסף את הראשונה!</Button>
        </Alert>
      ) : (
        <Grid container spacing={2}>
          {vocabulary.map((word) => (
            <Grid item xs={12} sm={6} md={4} key={word.id}>
              <Card>
                <CardContent>
                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', direction: 'rtl' }}>
                      {word.word}
                    </Typography>
                    {!word.isGlobal && (
                      <IconButton 
                        size="small" 
                        onClick={(e) => handleMenuOpen(e, word)}
                      >
                        <MoreIcon />
                      </IconButton>
                    )}
                  </Box>

                  {word.pronunciation && (
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                      הגייה: {word.pronunciation}
                    </Typography>
                  )}

                  <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                    <Chip
                      label={getCategoryText(word.category)}
                      color={getCategoryColor(word.category) as any}
                      size="small"
                    />
                    {word.isGlobal && (
                      <Chip
                        label="כללי"
                        color="default"
                        size="small"
                        variant="outlined"
                      />
                    )}
                    <Typography variant="caption" color="textSecondary">
                      שימושים: {word.frequency}
                    </Typography>
                  </Box>
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
        <MenuItem onClick={handleEditWord}>
          <EditIcon sx={{ mr: 1 }} />
          ערוך
        </MenuItem>
        <MenuItem onClick={handleDeleteWord}>
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
          {isEditing ? 'ערוך מילה' : 'הוסף מילה חדשה'}
        </DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Controller
                  name="word"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="מילה"
                      error={!!errors.word}
                      helperText={errors.word?.message}
                      autoFocus
                    />
                  )}
                />
              </Grid>
              
              <Grid item xs={12}>
                <Controller
                  name="pronunciation"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      fullWidth
                      label="הגייה (אופציונלי)"
                      error={!!errors.pronunciation}
                      helperText={errors.pronunciation?.message}
                    />
                  )}
                />
              </Grid>
              
              <Grid item xs={12}>
                <Controller
                  name="category"
                  control={control}
                  render={({ field }) => (
                    <FormControl fullWidth>
                      <InputLabel>קטגוריה</InputLabel>
                      <Select {...field} label="קטגוריה">
                        <SelectMenuItem value="general">כללי</SelectMenuItem>
                        <SelectMenuItem value="halachic">הלכה</SelectMenuItem>
                        <SelectMenuItem value="chassidic">חסידות</SelectMenuItem>
                        <SelectMenuItem value="yiddish">יידיש</SelectMenuItem>
                        <SelectMenuItem value="calendar">לוח</SelectMenuItem>
                        <SelectMenuItem value="names">שמות</SelectMenuItem>
                        <SelectMenuItem value="places">מקומות</SelectMenuItem>
                      </Select>
                    </FormControl>
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
              {isSaving ? <CircularProgress size={20} /> : (isEditing ? 'עדכן' : 'הוסף')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Container>
  );
};

export default VocabularyList;