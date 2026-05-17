export enum ConnectionStatus {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  AWAITING_SCAN = 'awaiting_scan',
}

export interface MessageHistoryEntry {
  customerId: string;
  phone: string;
  message: string;
  mediaUrl?: string;
  timestamp: string;
  status: 'delivered' | 'failed';
  jobId: string;
}

export interface MessageJobPayload {
  customerId: string;
  phone: string;
  message: string;
  mediaUrl?: string;
}

export interface StatusResponse {
  customerId: string;
  status: ConnectionStatus;
}
