/// <reference types="react-scripts" />

declare module 'react-dropzone' {

  export interface DropzoneOptions {
    onDrop?: (acceptedFiles: File[], rejectedFiles: File[]) => void;
    accept?: Record<string, string[]> | string;
    multiple?: boolean;
    disabled?: boolean;
    maxSize?: number;
    minSize?: number;
  }

  export interface DropzoneState {
    isDragActive: boolean;
    isDragAccept: boolean;
    isDragReject: boolean;
    draggedFiles: File[];
    acceptedFiles: File[];
    rejectedFiles: File[];
  }

  export interface DropzoneRef {
    open: () => void;
  }

  export function useDropzone(options?: DropzoneOptions): {
    getRootProps: () => any;
    getInputProps: () => any;
    isDragActive: boolean;
    isDragAccept: boolean;
    isDragReject: boolean;
    draggedFiles: File[];
    acceptedFiles: File[];
    rejectedFiles: File[];
    open: () => void;
  };
}