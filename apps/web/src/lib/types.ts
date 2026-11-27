export type Role = 'ADMIN' | 'EXAMINER' | 'CANDIDATE';
export interface Prefs {
  theme?: 'light' | 'dark' | 'contrast' | 'system';
  fontSize?: number;
  font?: 'default' | 'dyslexic' | 'serif' | 'mono' | 'legible';
  lineHeight?: number;
  paletteSide?: 'left' | 'right' | 'hidden';
  layout?: 'single' | 'scroll';
  reduceMotion?: boolean;
}
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  groupName: string | null;
  mustChangePassword: boolean;
  prefs: Prefs;
}
export type Phase = 'DRAFT' | 'PUBLISHED' | 'ONGOING' | 'COMPLETED' | 'ARCHIVED';
