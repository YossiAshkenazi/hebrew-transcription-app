import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { toast } from 'react-toastify';

// Types
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  emailVerified: boolean;
  settings?: any;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  success: boolean;
  token: string;
  data: {
    user: User;
  };
}

export interface Transcription {
  id: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  transcriptionText?: string;
  speakerLabels?: any[];
  confidence?: number;
  lowConfidenceWords?: any[];
  language: string;
  processingTime?: number;
  errorMessage?: string;
  metadata?: any;
  deliveryEmail?: string;
  emailSent: boolean;
  emailSentAt?: string;
  webhookSent: boolean;
  webhookSentAt?: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptionQuote {
  estimatedCost: number;
  estimatedTimeSeconds: number;
  durationMinutes: number;
  currency: string;
}

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers?: any;
  isActive: boolean;
  events: string[];
  retryAttempts: number;
  timeout: number;
  totalTriggers: number;
  totalSuccesses: number;
  totalFailures: number;
  lastTriggeredAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  createdAt: string;
  updatedAt: string;
}

class ApiService {
  private client: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    this.client.interceptors.request.use(
      (config) => {
        if (this.token) {
          config.headers.Authorization = `Bearer ${this.token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          this.clearToken();
          window.location.href = '/login';
        } else if (error.response?.data?.error) {
          toast.error(error.response.data.error);
        } else if (error.message) {
          toast.error(error.message);
        }
        return Promise.reject(error);
      }
    );

    // Load token from localStorage
    this.loadToken();
  }

  setToken(token: string) {
    this.token = token;
    localStorage.setItem('authToken', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('authToken');
  }

  private loadToken() {
    const token = localStorage.getItem('authToken');
    if (token) {
      this.token = token;
    }
  }

  // Auth endpoints
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<AuthResponse> {
    const response: AxiosResponse<AuthResponse> = await this.client.post('/auth/register', data);
    return response.data;
  }

  async login(data: { email: string; password: string; rememberMe?: boolean }): Promise<AuthResponse> {
    const response: AxiosResponse<AuthResponse> = await this.client.post('/auth/login', data);
    return response.data;
  }

  async logout(): Promise<void> {
    await this.client.post('/auth/logout');
    this.clearToken();
  }

  async getCurrentUser(): Promise<{ success: boolean; data: { user: User } }> {
    const response = await this.client.get('/auth/me');
    return response.data;
  }

  async forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
    const response = await this.client.post('/auth/forgot-password', { email });
    return response.data;
  }

  async resetPassword(token: string, password: string): Promise<AuthResponse> {
    const response: AxiosResponse<AuthResponse> = await this.client.post('/auth/reset-password', {
      token,
      password,
    });
    return response.data;
  }

  async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
    const response = await this.client.post('/auth/verify-email', { token });
    return response.data;
  }

  // User endpoints
  async updateProfile(data: {
    firstName?: string;
    lastName?: string;
    email?: string;
  }): Promise<{ success: boolean; data: { user: User } }> {
    const response = await this.client.put('/users/profile', data);
    return response.data;
  }

  async getUserSettings(): Promise<{ success: boolean; data: { settings: any } }> {
    const response = await this.client.get('/users/settings');
    return response.data;
  }

  async updateUserSettings(settings: any): Promise<{ success: boolean; data: { settings: any } }> {
    const response = await this.client.put('/users/settings', { settings });
    return response.data;
  }

  // Transcription endpoints
  async getTranscriptions(params?: {
    status?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
  }): Promise<{
    success: boolean;
    data: {
      transcriptions: Transcription[];
      pagination: {
        total: number;
        limit: number;
        offset: number;
        hasMore: boolean;
      };
    };
  }> {
    const response = await this.client.get('/transcriptions', { params });
    return response.data;
  }

  async getTranscription(id: string): Promise<{ success: boolean; data: { transcription: Transcription } }> {
    const response = await this.client.get(`/transcriptions/${id}`);
    return response.data;
  }

  async uploadTranscription(data: {
    audio: File;
    deliveryEmail?: string;
    language?: string;
    enableSpeakerDetection?: boolean;
  }): Promise<{
    success: boolean;
    data: {
      transcription: Transcription;
      quote: TranscriptionQuote;
    };
  }> {
    const formData = new FormData();
    formData.append('audio', data.audio);
    if (data.deliveryEmail) formData.append('deliveryEmail', data.deliveryEmail);
    if (data.language) formData.append('language', data.language);
    if (data.enableSpeakerDetection !== undefined) {
      formData.append('enableSpeakerDetection', data.enableSpeakerDetection.toString());
    }

    const response = await this.client.post('/transcriptions/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async uploadAnonymousTranscription(data: {
    audio: File;
    deliveryEmail: string;
    language?: string;
    enableSpeakerDetection?: boolean;
  }): Promise<{
    success: boolean;
    data: {
      transcriptionId: string;
      quote: TranscriptionQuote;
      message: string;
    };
  }> {
    const formData = new FormData();
    formData.append('audio', data.audio);
    formData.append('deliveryEmail', data.deliveryEmail);
    if (data.language) formData.append('language', data.language);
    if (data.enableSpeakerDetection !== undefined) {
      formData.append('enableSpeakerDetection', data.enableSpeakerDetection.toString());
    }

    const response = await this.client.post('/transcriptions/upload/anonymous', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  async cancelTranscription(id: string): Promise<{ success: boolean; message: string }> {
    const response = await this.client.post(`/transcriptions/${id}/cancel`);
    return response.data;
  }

  async deleteTranscription(id: string): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/transcriptions/${id}`);
    return response.data;
  }

  async getTranscriptionQuote(duration: number): Promise<{ success: boolean; data: { quote: TranscriptionQuote } }> {
    const response = await this.client.post('/transcriptions/quote', { duration });
    return response.data;
  }

  // Webhook endpoints
  async getWebhooks(): Promise<{ success: boolean; data: { webhooks: WebhookConfig[] } }> {
    const response = await this.client.get('/webhooks');
    return response.data;
  }

  async getWebhook(id: string): Promise<{ success: boolean; data: { webhook: WebhookConfig } }> {
    const response = await this.client.get(`/webhooks/${id}`);
    return response.data;
  }

  async createWebhook(data: {
    name: string;
    url: string;
    method?: 'POST' | 'PUT' | 'PATCH';
    events?: string[];
    headers?: any;
    secret?: string;
    retryAttempts?: number;
    timeout?: number;
  }): Promise<{ success: boolean; data: { webhook: WebhookConfig } }> {
    const response = await this.client.post('/webhooks', data);
    return response.data;
  }

  async updateWebhook(
    id: string,
    data: {
      name?: string;
      url?: string;
      method?: 'POST' | 'PUT' | 'PATCH';
      isActive?: boolean;
    }
  ): Promise<{ success: boolean; data: { webhook: WebhookConfig } }> {
    const response = await this.client.put(`/webhooks/${id}`, data);
    return response.data;
  }

  async deleteWebhook(id: string): Promise<{ success: boolean; message: string }> {
    const response = await this.client.delete(`/webhooks/${id}`);
    return response.data;
  }

  async testWebhook(id: string): Promise<{ success: boolean; data: { testResult: any } }> {
    const response = await this.client.post(`/webhooks/${id}/test`);
    return response.data;
  }

  async getWebhookStats(): Promise<{ success: boolean; data: { stats: any } }> {
    const response = await this.client.get('/webhooks/stats');
    return response.data;
  }
}

export const apiService = new ApiService();
export default apiService;